import { describe, expect, it } from 'vitest'
import {
  catalogBulkBatchOf,
  catalogBulkGroupBatch,
  catalogBulkGroupLayers,
  catalogBulkObjectLayers,
  catalogBulkReads,
  catalogDatabases,
  catalogGroupsOf,
  catalogHasObject,
  catalogLayerKey,
  catalogListedDatabases,
  catalogNodeKey,
  catalogObjectKey,
  catalogObjectsOf,
  catalogPathShown,
  catalogRevealLayers,
  catalogShownDatabases,
  catalogShownRoot,
  childPath,
  flattenCatalog,
  groupBySchema,
  isPermissionDenied,
  type CatalogGroup,
  type CatalogLayer,
  type CatalogNode,
  type CatalogPath,
  type CatalogQueryRow,
  type CatalogResult
} from './data-source-catalog'

const db = (name: string): CatalogNode => ({ kind: 'database', name })
const tables: CatalogNode = { kind: 'group', group: 'tables', count: 2 }

describe('childPath', () => {
  it('库重开一条路径；模式与分组接在当前路径后面', () => {
    expect(childPath({}, db('shop'))).toEqual({ database: 'shop' })
    expect(childPath({ database: 'shop' }, { kind: 'schema', name: 'public' })).toEqual({
      database: 'shop',
      schema: 'public'
    })
    expect(childPath({ database: 'shop', schema: 'public' }, tables)).toEqual({
      database: 'shop',
      schema: 'public',
      group: 'tables'
    })
  })
})

describe('catalogNodeKey', () => {
  it('不同位置的同名节点键不同；函数重载按参数表区分', () => {
    const a = catalogNodeKey({ database: 'a' }, { kind: 'schema', name: 'public' })
    const b = catalogNodeKey({ database: 'b' }, { kind: 'schema', name: 'public' })
    expect(a).not.toBe(b)
    const path = { database: 'a', schema: 'public', group: 'functions' as const }
    expect(catalogNodeKey(path, { kind: 'object', name: 'f', detail: 'integer' })).not.toBe(
      catalogNodeKey(path, { kind: 'object', name: 'f', detail: 'text' })
    )
  })
})

describe('catalogObjectKey / catalogHasObject', () => {
  const path: CatalogPath = { database: 'a', schema: 'public', group: 'functions' }
  const nodes: CatalogNode[] = [
    { kind: 'object', name: 'f', detail: 'integer' },
    { kind: 'object', name: 'g' }
  ]

  it('对象的键即它在目录里的节点键', () => {
    expect(catalogObjectKey({ path, name: 'f', detail: 'integer' })).toBe(
      catalogNodeKey(path, nodes[0]!)
    )
  })

  it('同名且说明相同才算在；重载的其他版本、同名的库或模式不算', () => {
    expect(catalogHasObject(nodes, { path, name: 'f', detail: 'integer' })).toBe(true)
    expect(catalogHasObject(nodes, { path, name: 'g' })).toBe(true)
    expect(catalogHasObject(nodes, { path, name: 'f', detail: 'text' })).toBe(false)
    expect(catalogHasObject(nodes, { path, name: 'f' })).toBe(false)
    expect(catalogHasObject([db('f')], { path: {}, name: 'f' })).toBe(false)
  })
})

describe('isPermissionDenied', () => {
  it('按各数据库的错误码认出无权读取', () => {
    const denied = (kind: Parameters<typeof isPermissionDenied>[0], e: object): boolean =>
      isPermissionDenied(kind, { message: '', ...e })
    expect(denied('postgresql', { code: '42501' })).toBe(true)
    expect(denied('postgresql', { code: '42P01' })).toBe(false)
    expect(denied('mysql', { errno: 1142 })).toBe(true)
    expect(denied('mariadb', { errno: 1146 })).toBe(false)
    expect(denied('sqlite', { code: 'SQLITE_ERROR' })).toBe(false)
  })
})

describe('flattenCatalog', () => {
  const root: CatalogResult = { nodes: [db('shop'), db('crm')] }
  const shopKey = catalogNodeKey({}, db('shop'))

  it('只展开已展开的节点；没读到的显示正在读取', () => {
    const rows = flattenCatalog(root, new Map(), new Set([shopKey]))
    expect(rows.map((r) => (r.kind === 'node' ? r.node : r.message))).toEqual([
      db('shop'),
      '正在读取…',
      db('crm')
    ])
    expect(rows[1]).toMatchObject({ depth: 1, loading: true })
  })

  it('读到的结果按层缩进；无权与空各给一行提示', () => {
    const tablesKey = catalogNodeKey({ database: 'shop' }, tables)
    const loaded = new Map<string, CatalogResult>([
      [shopKey, { nodes: [tables, { kind: 'group', group: 'views', count: 0 }] }],
      [tablesKey, { denied: true }]
    ])
    const rows = flattenCatalog(root, loaded, new Set([shopKey, tablesKey]))
    expect(rows.map((r) => [r.depth, r.kind === 'node' ? r.node.kind : r.message])).toEqual([
      [0, 'database'],
      [1, 'group'],
      [2, '无权查看'],
      [1, 'group'],
      [0, 'database']
    ])
    // 只有读取中的那行标 loading
    expect(rows.some((r) => r.kind === 'notice' && r.loading)).toBe(false)
    expect(flattenCatalog({ nodes: [] }, new Map(), new Set())).toMatchObject([{ message: '空' }])
  })
})

describe('catalogLayerKey', () => {
  it('一层的键即打开它的那个节点的键，根为空串', () => {
    const cases: [CatalogPath, CatalogNode][] = [
      [{}, db('shop')],
      [{}, { kind: 'group', group: 'roles', count: 3 }],
      [{ database: 'shop' }, { kind: 'schema', name: 'public' }],
      [{ database: 'shop' }, { kind: 'group', group: 'extensions', count: 1 }],
      [{ database: 'shop', schema: 'public' }, tables],
      // MySQL：库下直接是分组；SQLite：根下直接是分组
      [{ database: 'shop' }, tables],
      [{}, tables]
    ]
    for (const [path, node] of cases) {
      expect(catalogLayerKey(childPath(path, node))).toBe(catalogNodeKey(path, node))
    }
    expect(catalogLayerKey({})).toBe('')
  })

  it('不同位置的层键不同', () => {
    const keys = [
      {},
      { database: 'shop' },
      { database: 'shop', schema: 'public' },
      { database: 'shop', schema: 'public', group: 'tables' as const },
      { database: 'shop', group: 'tables' as const },
      { group: 'tables' as const }
    ].map(catalogLayerKey)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('catalogRevealLayers', () => {
  const schema = (name: string): CatalogNode => ({ kind: 'schema', name })
  const users: CatalogNode = { kind: 'object', name: 'users' }

  it('PostgreSQL 依次为库、模式、分组，位置同 childPath', () => {
    expect(
      catalogRevealLayers({ database: 'shop', schema: 'public', group: 'tables' })
    ).toStrictEqual([
      { key: catalogNodeKey({}, db('shop')), path: { database: 'shop' } },
      {
        key: catalogNodeKey({ database: 'shop' }, schema('public')),
        path: { database: 'shop', schema: 'public' }
      },
      {
        key: catalogNodeKey({ database: 'shop', schema: 'public' }, tables),
        path: { database: 'shop', schema: 'public', group: 'tables' }
      }
    ])
  })

  it('MySQL 没有模式，SQLite 只有分组', () => {
    expect(catalogRevealLayers({ database: 'shop', group: 'views' })).toStrictEqual([
      { key: catalogNodeKey({}, db('shop')), path: { database: 'shop' } },
      {
        key: catalogNodeKey({ database: 'shop' }, { kind: 'group', group: 'views' }),
        path: { database: 'shop', group: 'views' }
      }
    ])
    expect(catalogRevealLayers({ group: 'tables' })).toStrictEqual([
      { key: catalogNodeKey({}, tables), path: { group: 'tables' } }
    ])
  })

  it('按它展开后目录里出现目标对象', () => {
    const path = { database: 'shop', schema: 'public', group: 'tables' } as const
    const layers = catalogRevealLayers(path)
    const root: CatalogResult = { nodes: [db('crm'), db('shop')] }
    const loaded = new Map<string, CatalogResult>([
      [layers[0]!.key, { nodes: [schema('public')] }],
      [layers[1]!.key, { nodes: [tables] }],
      [layers[2]!.key, { nodes: [users] }]
    ])
    const rows = flattenCatalog(root, loaded, new Set(layers.map((layer) => layer.key)))
    expect(rows.map((row) => row.key)).toContain(catalogNodeKey(path, users))
  })
})

describe('catalogObjectsOf / catalogGroupsOf', () => {
  it('对象带上补充文字（有的话）', () => {
    expect(
      catalogObjectsOf([{ name: 'f', detail: 'integer', s: 'public' }, { name: 'users' }])
    ).toEqual([
      { kind: 'object', name: 'f', detail: 'integer' },
      { kind: 'object', name: 'users' }
    ])
  })

  it('分组只留有对象的，顺序按给定的分组', () => {
    const rows = [
      { g: 'views', n: '2' },
      { g: 'tables', n: '5' },
      { g: 'types', n: '0' }
    ]
    expect(catalogGroupsOf(rows, ['tables', 'views', 'types'])).toEqual([
      { kind: 'group', group: 'tables', count: 5 },
      { kind: 'group', group: 'views', count: 2 }
    ])
  })
})

describe('groupBySchema', () => {
  it('按所在模式分开，各模式内保持原来的顺序；没有模式列的归空串', () => {
    const rows = [
      { name: 'a', s: 'sales' },
      { name: 'b', s: 'public' },
      { name: 'c', s: 'sales' },
      { name: 'd', s: 'public' }
    ]
    const grouped = groupBySchema(rows)
    expect([...grouped.keys()]).toEqual(['sales', 'public'])
    expect(grouped.get('sales')!.map((r) => r.name)).toEqual(['a', 'c'])
    expect(grouped.get('public')!.map((r) => r.name)).toEqual(['b', 'd'])
    expect([...groupBySchema([{ name: 'x' }]).keys()]).toEqual([''])
  })
})

describe('catalogBulkGroupLayers', () => {
  const groups: CatalogGroup[] = ['tables', 'views', 'matviews', 'functions']
  const pathOf = (schema: string): CatalogPath => ({ database: 'shop', schema })
  // 跨模式一次读出的各分组个数，带所在模式
  const counts: CatalogQueryRow[] = [
    { g: 'tables', s: 'public', n: '2' },
    { g: 'tables', s: 'sales', n: '1' },
    { g: 'views', s: 'public', n: '1' },
    { g: 'functions', s: 'sales', n: '3' }
  ]

  it('与逐个模式读的一致：每个模式一层分组，只列有对象的', () => {
    const layers = catalogBulkGroupLayers(['public', 'sales'], pathOf, groups, counts)
    // 逐个模式读：同样的查询只取这个模式的行
    const one = (schema: string): CatalogLayer => ({
      path: pathOf(schema),
      nodes: catalogGroupsOf(
        counts.filter((row) => row.s === schema),
        groups
      )
    })
    expect(layers).toEqual([one('public'), one('sales')])
    expect(layers[1]!.nodes).toEqual([
      { kind: 'group', group: 'tables', count: 1 },
      { kind: 'group', group: 'functions', count: 3 }
    ])
  })

  it('没有对象的模式为空的一层', () => {
    expect(catalogBulkGroupLayers(['empty'], pathOf, groups, counts)).toEqual([
      { path: pathOf('empty'), nodes: [] }
    ])
  })

  it('SQLite 没有模式：行不带模式列，只有根这一个位置', () => {
    const layers = catalogBulkGroupLayers(
      [''],
      () => ({}),
      ['tables', 'views'],
      [
        { g: 'tables', n: '1' },
        { g: 'views', n: '0' }
      ]
    )
    expect(layers).toEqual([{ path: {}, nodes: [{ kind: 'group', group: 'tables', count: 1 }] }])
  })
})

describe('catalogBulkObjectLayers', () => {
  const pathOf = (schema: string): CatalogPath => ({ database: 'shop', schema })
  // 跨模式一次读出的对象列表：按名称排序，带所在模式；同名函数以参数表区分
  const lists = new Map<CatalogGroup, CatalogQueryRow[]>([
    [
      'tables',
      [
        { name: 'orders', s: 'sales' },
        { name: 'posts', s: 'public' },
        { name: 'users', s: 'public' }
      ]
    ],
    [
      'functions',
      [
        { name: 'total', detail: 'bigint', s: 'sales' },
        { name: 'total', detail: 'integer', s: 'sales' }
      ]
    ],
    ['matviews', []]
  ])

  it('与逐个模式读的一致：各分组按所在模式各得一层对象，没有对象的不得', () => {
    // 逐个模式读：同样的查询只取这个模式的行
    const one = (schema: string, group: CatalogGroup): CatalogLayer => ({
      path: { ...pathOf(schema), group },
      nodes: catalogObjectsOf(lists.get(group)!.filter((row) => row.s === schema))
    })
    const layers = catalogBulkObjectLayers(pathOf, lists)
    expect(layers).toEqual([
      one('sales', 'tables'),
      one('public', 'tables'),
      one('sales', 'functions')
    ])
    expect(layers[2]!.nodes).toEqual([
      { kind: 'object', name: 'total', detail: 'bigint' },
      { kind: 'object', name: 'total', detail: 'integer' }
    ])
  })

  it('SQLite 没有模式：行不带模式列，各分组在根下', () => {
    const layers = catalogBulkObjectLayers(
      () => ({}),
      new Map([['indexes', [{ name: 'notes_title', detail: 'notes' }]]])
    )
    expect(layers).toEqual([
      {
        path: { group: 'indexes' },
        nodes: [{ kind: 'object', name: 'notes_title', detail: 'notes' }]
      }
    ])
  })
})

describe('catalogBulkGroupBatch', () => {
  it('表、视图、物化视图在第一批，其余分组在第二批', () => {
    for (const group of ['tables', 'views', 'matviews'] as const) {
      expect(catalogBulkGroupBatch(group)).toBe(0)
    }
    for (const group of [
      'functions',
      'procedures',
      'sequences',
      'types',
      'triggers',
      'indexes',
      'events',
      'extensions',
      'roles',
      'users'
    ] as const) {
      expect(catalogBulkGroupBatch(group)).toBe(1)
    }
  })
})

describe('catalogBulkBatchOf', () => {
  const pg = (path: CatalogPath): { database: string; batch: number } | null =>
    catalogBulkBatchOf('postgresql', 'shop', path)
  const pgBatch = (path: CatalogPath): number | null => pg(path)?.batch ?? null

  it('PostgreSQL：库这一层与各模式的分组在第一批，其下的对象、扩展与角色在第二批', () => {
    expect(pgBatch({ database: 'shop' })).toBe(0)
    expect(pgBatch({ database: 'shop', schema: 'public' })).toBe(0)
    for (const group of ['tables', 'views', 'matviews'] as const) {
      expect(pgBatch({ database: 'shop', schema: 'public', group })).toBe(0)
    }
    for (const group of ['functions', 'procedures', 'sequences', 'types', 'triggers'] as const) {
      expect(pgBatch({ database: 'shop', schema: 'public', group })).toBe(1)
    }
    expect(pgBatch({ database: 'shop', group: 'extensions' })).toBe(1)
    expect(pgBatch({ group: 'roles' })).toBe(1)
    // 根不在其中
    expect(pg({})).toBeNull()
  })

  it('各库的层归它所在的库那次读取，根下的角色、用户归第一次读取', () => {
    expect(pg({ database: 'crm' })).toEqual({ database: 'crm', batch: 0 })
    expect(pg({ database: 'crm', schema: 'public' })).toEqual({ database: 'crm', batch: 0 })
    expect(pg({ database: 'crm', schema: 'public', group: 'tables' })).toEqual({
      database: 'crm',
      batch: 0
    })
    expect(pg({ database: 'crm', schema: 'public', group: 'functions' })).toEqual({
      database: 'crm',
      batch: 1
    })
    expect(pg({ database: 'crm', group: 'extensions' })).toEqual({ database: 'crm', batch: 1 })
    expect(pg({ group: 'roles' })).toEqual({ database: 'shop', batch: 1 })
    expect(catalogBulkBatchOf('mysql', 'shop', { group: 'users' })).toEqual({
      database: 'shop',
      batch: 1
    })
  })

  it('MySQL / MariaDB：各库的分组与表、视图在第一批，存储过程、函数、触发器、事件与用户在第二批', () => {
    for (const kind of ['mysql', 'mariadb'] as const) {
      const read = (path: CatalogPath): { database: string; batch: number } | null =>
        catalogBulkBatchOf(kind, 'shop', path)
      const batch = (path: CatalogPath): number | null => read(path)?.batch ?? null
      expect(batch({ database: 'shop' })).toBe(0)
      expect(batch({ database: 'shop', group: 'tables' })).toBe(0)
      expect(batch({ database: 'crm', group: 'views' })).toBe(0)
      for (const group of ['procedures', 'functions', 'triggers', 'events'] as const) {
        expect(batch({ database: 'shop', group })).toBe(1)
      }
      expect(batch({ group: 'users' })).toBe(1)
      // 各库的层归它所在的库（一起读的各库在同一次读取里）
      expect(read({ database: 'crm', group: 'views' })?.database).toBe('crm')
      // 根不在其中
      expect(read({})).toBeNull()
    }
  })

  it('SQLite：根与表、视图在第一批，索引、触发器在第二批，都归那一次读取', () => {
    const batch = (path: CatalogPath): number | null =>
      catalogBulkBatchOf('sqlite', '', path)?.batch ?? null
    expect(batch({})).toBe(0)
    expect(batch({ group: 'tables' })).toBe(0)
    expect(batch({ group: 'views' })).toBe(0)
    expect(batch({ group: 'indexes' })).toBe(1)
    expect(batch({ group: 'triggers' })).toBe(1)
    expect(catalogBulkBatchOf('sqlite', '', { group: 'tables' })?.database).toBe('')
  })

  it('各批整理出的各层都在那一批里', () => {
    const pathOf = (schema: string): CatalogPath => ({ database: 'shop', schema })
    const object = (name: string): CatalogQueryRow => ({ name, s: 'public' })
    const first = [
      ...catalogBulkGroupLayers(
        ['public'],
        pathOf,
        ['tables', 'views', 'matviews', 'functions', 'triggers'],
        [
          { g: 'tables', s: 'public', n: '1' },
          { g: 'views', s: 'public', n: '1' },
          { g: 'matviews', s: 'public', n: '1' },
          { g: 'functions', s: 'public', n: '1' },
          { g: 'triggers', s: 'public', n: '1' }
        ]
      ),
      ...catalogBulkObjectLayers(
        pathOf,
        new Map([
          ['tables', [object('t')]],
          ['views', [object('v')]],
          ['matviews', [object('m')]]
        ])
      )
    ]
    // 第二批另有这个库的扩展与根下的角色（同逐层读，见 pgBulk）
    const second: { path: CatalogPath }[] = [
      ...catalogBulkObjectLayers(
        pathOf,
        new Map([
          ['functions', [object('f')]],
          ['triggers', [{ ...object('tg'), detail: 't' }]]
        ])
      ),
      { path: { database: 'shop', group: 'extensions' } },
      { path: { group: 'roles' } }
    ]
    expect(first).toHaveLength(4)
    expect(second).toHaveLength(4)
    for (const { path } of first) expect(pg(path)).toEqual({ database: 'shop', batch: 0 })
    for (const { path } of second) expect(pg(path)).toEqual({ database: 'shop', batch: 1 })
  })
})

describe('catalogBulkReads', () => {
  it('PostgreSQL：显示的库各读一次，连接所在的库显示时排在最前，其余按显示的先后', () => {
    expect(catalogBulkReads('postgresql', 'shop', ['shop'])).toEqual([['shop']])
    expect(catalogBulkReads('postgresql', 'shop', ['crm', 'shop', 'hr'])).toEqual([
      ['shop'],
      ['crm'],
      ['hr']
    ])
    expect(catalogBulkReads('postgresql', 'shop', ['crm', 'hr'])).toEqual([['crm'], ['hr']])
    expect(catalogBulkReads('postgresql', 'shop', [])).toEqual([])
  })

  it('MySQL / MariaDB：一次读完显示的库；没有显示的库时不读', () => {
    for (const kind of ['mysql', 'mariadb'] as const) {
      expect(catalogBulkReads(kind, '', ['shop', 'crm'])).toEqual([['shop', 'crm']])
      expect(catalogBulkReads(kind, '', [])).toEqual([])
    }
  })

  it('SQLite：读一次', () => {
    expect(catalogBulkReads('sqlite', '', [])).toEqual([['']])
  })
})

describe('catalogShownDatabases', () => {
  it('设置过的照记下的，一个都不勾也算', () => {
    expect(catalogShownDatabases(['crm', 'shop'], 'shop')).toEqual(['crm', 'shop'])
    expect(catalogShownDatabases([], 'shop')).toEqual([])
  })

  it('从没设置过为默认库，没有默认库时一个都没有', () => {
    expect(catalogShownDatabases(undefined, 'shop')).toEqual(['shop'])
    expect(catalogShownDatabases(undefined, '')).toEqual([])
  })
})

describe('catalogDatabases / catalogListedDatabases / catalogShownRoot', () => {
  const roles: CatalogNode = { kind: 'group', group: 'roles', count: 3 }
  const root: CatalogNode[] = [db('crm'), db('shop'), roles]

  it('根这一层列出的库，分组不算', () => {
    expect(catalogDatabases(root)).toEqual(['crm', 'shop'])
    expect(catalogDatabases([roles])).toEqual([])
  })

  it('还列着的留下、先后不变，不再列出的去掉；同名的分组不算列出了库', () => {
    expect(catalogListedDatabases(['shop', 'hr', 'crm'], root)).toEqual(['shop', 'crm'])
    expect(catalogListedDatabases([], root)).toEqual([])
    expect(catalogListedDatabases(['roles'], [roles])).toEqual([])
  })

  it('根下只留显示的库，分组照留；读不出来的原样', () => {
    expect(catalogShownRoot({ nodes: root }, ['shop'])).toEqual({ nodes: [db('shop'), roles] })
    expect(catalogShownRoot({ nodes: root }, [])).toEqual({ nodes: [roles] })
    expect(catalogShownRoot({ nodes: root }, ['hr'])).toEqual({ nodes: [roles] })
    const denied: CatalogResult = { denied: true }
    expect(catalogShownRoot(denied, ['shop'])).toBe(denied)
  })
})

describe('catalogPathShown', () => {
  it('显示的库里的层算，没显示的库里的不算', () => {
    expect(catalogPathShown({ database: 'shop' }, ['shop'])).toBe(true)
    expect(
      catalogPathShown({ database: 'shop', schema: 'public', group: 'tables' }, ['shop'])
    ).toBe(true)
    expect(catalogPathShown({ database: 'crm' }, ['shop'])).toBe(false)
    expect(catalogPathShown({ database: 'crm', group: 'extensions' }, [])).toBe(false)
  })

  it('根与根下的分组都算；没有显示的库（SQLite）时都算', () => {
    expect(catalogPathShown({}, [])).toBe(true)
    expect(catalogPathShown({ group: 'roles' }, [])).toBe(true)
    expect(catalogPathShown({ database: 'crm' }, undefined)).toBe(true)
    expect(catalogPathShown({ group: 'tables' }, undefined)).toBe(true)
  })
})
