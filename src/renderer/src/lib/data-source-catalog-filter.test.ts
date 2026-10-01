import { describe, expect, it } from 'vitest'
import {
  catalogNodeKey,
  childPath,
  type CatalogNode,
  type CatalogResult
} from '@shared/data-source-catalog'
import { collapseFilterView, filterCatalog, filterViewExpanded } from './data-source-catalog-filter'

const db = (name: string): CatalogNode => ({ kind: 'database', name })
const schema = (name: string): CatalogNode => ({ kind: 'schema', name })
const tables: CatalogNode = { kind: 'group', group: 'tables', count: 2 }
const views: CatalogNode = { kind: 'group', group: 'views', count: 1 }
const obj = (name: string): CatalogNode => ({ kind: 'object', name })

// shop → public → 表（orders、users）/ 视图（order_totals）；crm 没展开过
const root: CatalogResult = { nodes: [db('shop'), db('crm')] }
const shopPath = childPath({}, db('shop'))
const publicPath = childPath(shopPath, schema('public'))
const shopKey = catalogNodeKey({}, db('shop'))
const publicKey = catalogNodeKey(shopPath, schema('public'))
const tablesKey = catalogNodeKey(publicPath, tables)
const viewsKey = catalogNodeKey(publicPath, views)
const loaded = new Map<string, CatalogResult>([
  [shopKey, { nodes: [schema('public')] }],
  [publicKey, { nodes: [tables, views] }],
  [tablesKey, { nodes: [obj('orders'), obj('users')] }],
  [viewsKey, { nodes: [obj('order_totals')] }]
])
const none = new Map<string, CatalogResult>()

// 表结构缓存里：crm → sales → 表（leads、users_archive）；shop 的表是旧的（还有 users_old）；
// shop 下的 legacy 模式已不在读到的 shop 这一层里
const crmPath = childPath({}, db('crm'))
const salesPath = childPath(crmPath, schema('sales'))
const legacyPath = childPath(shopPath, schema('legacy'))
const crmKey = catalogNodeKey({}, db('crm'))
const salesKey = catalogNodeKey(crmPath, schema('sales'))
const salesTablesKey = catalogNodeKey(salesPath, tables)
const legacyKey = catalogNodeKey(shopPath, schema('legacy'))
const cached = new Map<string, CatalogResult>([
  [crmKey, { nodes: [schema('sales')] }],
  [salesKey, { nodes: [tables] }],
  [salesTablesKey, { nodes: [obj('leads'), obj('users_archive')] }],
  [shopKey, { nodes: [schema('public'), schema('legacy')] }],
  [tablesKey, { nodes: [obj('orders'), obj('users'), obj('users_old')] }],
  [legacyKey, { nodes: [tables] }],
  [catalogNodeKey(legacyPath, tables), { nodes: [obj('users_legacy')] }]
])

describe('filterCatalog', () => {
  it('命中的对象连同各级祖先显示，没命中的兄弟不显示', () => {
    const result = filterCatalog(root, loaded, none, 'user')
    expect(result.root.nodes).toEqual([db('shop')])
    expect(result.loaded.get(shopKey)).toEqual({ nodes: [schema('public')] })
    expect(result.loaded.get(publicKey)).toEqual({ nodes: [tables] })
    expect(result.loaded.get(tablesKey)).toEqual({ nodes: [obj('users')] })
    expect(result.loaded.has(viewsKey)).toBe(false)
  })

  it('不分大小写；一层里多处命中都留着', () => {
    const result = filterCatalog(root, loaded, none, 'ORDER')
    expect(result.loaded.get(publicKey)).toEqual({ nodes: [tables, views] })
    expect(result.loaded.get(tablesKey)).toEqual({ nodes: [obj('orders')] })
    expect(result.loaded.get(viewsKey)).toEqual({ nodes: [obj('order_totals')] })
  })

  it('命中的库 / 模式下已读取的各层整支纳入', () => {
    const result = filterCatalog(root, loaded, none, 'publ')
    expect(result.root.nodes).toEqual([db('shop')])
    expect(result.loaded.get(publicKey)).toEqual(loaded.get(publicKey))
    expect(result.loaded.get(tablesKey)).toEqual(loaded.get(tablesKey))
    expect(result.loaded.get(viewsKey)).toEqual(loaded.get(viewsKey))
  })

  it('命中但没拿到的库只显示自己，不另查', () => {
    const result = filterCatalog(root, loaded, none, 'crm')
    expect(result.root.nodes).toEqual([db('crm')])
    expect(result.loaded.size).toBe(0)
  })

  it('分组按标签不算命中；没有命中时根为空', () => {
    expect(filterCatalog(root, loaded, none, '表').root.nodes).toEqual([])
    expect(filterCatalog(root, loaded, none, 'nothing').root.nodes).toEqual([])
  })

  it('读不出来的层：在命中的节点下原样纳入，否则不显示', () => {
    const denied = new Map(loaded).set(viewsKey, { denied: true })
    expect(filterCatalog(root, denied, none, 'user').loaded.has(viewsKey)).toBe(false)
    expect(filterCatalog(root, denied, none, 'public').loaded.get(viewsKey)).toEqual({
      denied: true
    })
  })

  it('没读取过、只在缓存里的层也找，命中的连同各级祖先显示', () => {
    const result = filterCatalog(root, loaded, cached, 'archive')
    expect(result.root.nodes).toEqual([db('crm')])
    expect(result.loaded.get(crmKey)).toEqual({ nodes: [schema('sales')] })
    expect(result.loaded.get(salesKey)).toEqual({ nodes: [tables] })
    expect(result.loaded.get(salesTablesKey)).toEqual({ nodes: [obj('users_archive')] })
  })

  it('同一层已读取的为准：缓存里多出的对象不算命中', () => {
    const result = filterCatalog(root, loaded, cached, 'user')
    expect(result.root.nodes).toEqual([db('shop'), db('crm')])
    expect(result.loaded.get(tablesKey)).toEqual({ nodes: [obj('users')] })
  })

  it('已读取的上一层不再列出的节点，缓存里它下面的层不找', () => {
    const result = filterCatalog(root, loaded, cached, 'legacy')
    expect(result.root.nodes).toEqual([])
    expect(result.loaded.has(legacyKey)).toBe(false)
  })

  it('命中的库下缓存里的各层整支纳入', () => {
    const result = filterCatalog(root, loaded, cached, 'crm')
    expect(result.root.nodes).toEqual([db('crm')])
    expect(result.loaded.get(crmKey)).toEqual(cached.get(crmKey))
    expect(result.loaded.get(salesKey)).toEqual(cached.get(salesKey))
    expect(result.loaded.get(salesTablesKey)).toEqual(cached.get(salesTablesKey))
  })

  it('给出筛过的各层的位置', () => {
    const result = filterCatalog(root, loaded, cached, 'archive')
    expect(result.paths).toEqual(
      new Map([
        [crmKey, crmPath],
        [salesKey, salesPath],
        [salesTablesKey, childPath(salesPath, tables)]
      ])
    )
  })
})

describe('filterViewExpanded', () => {
  it('没开合过：筛过的各层都展开，其余不展开', () => {
    const open = filterViewExpanded(filterCatalog(root, loaded, none, 'user'), new Map())
    expect(open.has(shopKey)).toBe(true)
    expect(open.has(publicKey)).toBe(true)
    expect(open.has(tablesKey)).toBe(true)
    expect(open.has(viewsKey)).toBe(false)
    expect(open.has(crmKey)).toBe(false)
  })

  it('开合过的以开合为准', () => {
    const overrides = new Map([
      [tablesKey, false],
      [crmKey, true]
    ])
    const open = filterViewExpanded(filterCatalog(root, loaded, none, 'user'), overrides)
    expect(open.has(tablesKey)).toBe(false)
    expect(open.has(crmKey)).toBe(true)
    expect(open.has(publicKey)).toBe(true)
  })

  it('缓存重取后新筛出的层照样展开，开合过的不变', () => {
    const overrides = new Map([[tablesKey, false]])
    const open = filterViewExpanded(filterCatalog(root, loaded, cached, 'user'), overrides)
    expect(open.has(crmKey)).toBe(true)
    expect(open.has(salesKey)).toBe(true)
    expect(open.has(salesTablesKey)).toBe(true)
    expect(open.has(tablesKey)).toBe(false)
  })
})

describe('collapseFilterView', () => {
  it('当前各层都合上，开合过的也合上', () => {
    const filtered = filterCatalog(root, loaded, none, 'user')
    const collapsed = collapseFilterView(filtered, new Map([[crmKey, true]]))
    expect(collapsed).toEqual(
      new Map([
        [shopKey, false],
        [publicKey, false],
        [tablesKey, false],
        [crmKey, false]
      ])
    )
    const open = filterViewExpanded(filtered, collapsed)
    for (const key of [shopKey, publicKey, tablesKey, crmKey]) expect(open.has(key)).toBe(false)
  })

  it('之后新筛出的层照样展开', () => {
    const collapsed = collapseFilterView(filterCatalog(root, loaded, none, 'user'), new Map())
    const open = filterViewExpanded(filterCatalog(root, loaded, cached, 'user'), collapsed)
    expect(open.has(shopKey)).toBe(false)
    expect(open.has(crmKey)).toBe(true)
    expect(open.has(salesTablesKey)).toBe(true)
  })
})
