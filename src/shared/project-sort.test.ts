import { describe, expect, it } from 'vitest'
import {
  cycleProjectSort,
  filterTreeEntries,
  pinnedEntryOrder,
  sortTreeEntries
} from './project-sort'
import type { DataSourceNode } from './data-source'
import type { ServerNode } from './server'
import { dataSourceEntryKey, serverEntryKey, type TreeEntry } from './tree-entry'
import {
  DEFAULT_PROJECT_SORT_PREFS,
  type Project,
  type ProjectNode,
  type ProjectSortPrefs
} from './types'

function node(
  name: string,
  path: string,
  addedAt: number,
  lastOpenedAt: number | null = null,
  pinned = false,
  order = 0
): TreeEntry {
  const project: Project = { path, name, addedAt, lastOpenedAt, pinned, order }
  const n: ProjectNode = {
    project,
    packageManager: null,
    discovered: [],
    configs: [],
    worktreeOf: null
  }
  return { kind: 'project', key: path, node: n }
}

function server(name: string, id: string, order: number, pinned = false): TreeEntry {
  const n: ServerNode = {
    server: {
      id,
      name,
      target: { kind: 'config', alias: name },
      addedAt: 0,
      lastOpenedAt: null,
      pinned,
      order,
      direct: false
    },
    hasPassword: false,
    configs: []
  }
  return { kind: 'server', key: serverEntryKey(id), node: n }
}

function dataSource(name: string, id: string, order: number, pinned = false): TreeEntry {
  const n: DataSourceNode = {
    dataSource: {
      id,
      name,
      target: { kind: 'sqlite', file: `/data/${name}.db` },
      addedAt: 0,
      lastOpenedAt: null,
      pinned,
      order
    },
    hasPassword: false,
    configs: []
  }
  return { kind: 'dataSource', key: dataSourceEntryKey(id), node: n }
}

function prefs(partial: Partial<ProjectSortPrefs> = {}): ProjectSortPrefs {
  return { ...DEFAULT_PROJECT_SORT_PREFS, ...partial }
}

const keys = (entries: TreeEntry[]): string[] => entries.map((e) => e.key)

describe('cycleProjectSort', () => {
  it('切入自定义固定 asc', () => {
    expect(cycleProjectSort(prefs({ mode: 'name', direction: 'desc' }), 'custom')).toEqual(
      prefs({ mode: 'custom', direction: 'asc' })
    )
  })

  it('换 mode 取该 mode 默认方向', () => {
    expect(cycleProjectSort(prefs({ mode: 'custom', direction: 'asc' }), 'name')).toEqual(
      prefs({ mode: 'name', direction: 'asc' })
    )
    expect(cycleProjectSort(prefs({ mode: 'custom', direction: 'asc' }), 'addedAt')).toEqual(
      prefs({ mode: 'addedAt', direction: 'desc' })
    )
  })

  it('同 mode 再点翻转方向（打开时间除外）', () => {
    expect(cycleProjectSort(prefs({ mode: 'name', direction: 'asc' }), 'name')).toEqual(
      prefs({ mode: 'name', direction: 'desc' })
    )
    expect(cycleProjectSort(prefs({ mode: 'addedAt', direction: 'desc' }), 'addedAt')).toEqual(
      prefs({ mode: 'addedAt', direction: 'asc' })
    )
    expect(
      cycleProjectSort(prefs({ mode: 'lastOpenedAt', direction: 'desc' }), 'lastOpenedAt')
    ).toEqual(prefs({ mode: 'lastOpenedAt', direction: 'desc' }))
  })

  it('切入打开时间固定降序', () => {
    expect(cycleProjectSort(prefs({ mode: 'name', direction: 'asc' }), 'lastOpenedAt')).toEqual(
      prefs({ mode: 'lastOpenedAt', direction: 'desc' })
    )
  })

  it('切换排序保留 pinSticky 与类型筛选', () => {
    const next = cycleProjectSort(
      prefs({ mode: 'name', direction: 'asc', pinSticky: false, showServers: false }),
      'addedAt'
    )
    expect(next.pinSticky).toBe(false)
    expect(next.showServers).toBe(false)
  })
})

describe('DEFAULT_PROJECT_SORT_PREFS', () => {
  it('默认添加时间倒序、开启置顶吸顶、三类都显示', () => {
    expect(DEFAULT_PROJECT_SORT_PREFS).toEqual({
      mode: 'addedAt',
      direction: 'desc',
      pinSticky: true,
      showProjects: true,
      showServers: true,
      showDataSources: true
    })
  })
})

describe('sortTreeEntries', () => {
  const nodes = [
    node('zeta', '/z', 100, 50, false, 0),
    node('alpha', '/a', 300, null, false, 1),
    node('Beta', '/b', 200, 200, false, 2)
  ]

  it('自定义按 order 升序', () => {
    expect(keys(sortTreeEntries(nodes, prefs({ mode: 'custom', direction: 'asc' })))).toEqual([
      '/z',
      '/a',
      '/b'
    ])
    const reordered = [
      node('zeta', '/z', 100, 50, false, 5),
      node('alpha', '/a', 300, null, false, -1),
      node('Beta', '/b', 200, 200, false, 2)
    ]
    expect(keys(sortTreeEntries(reordered, prefs({ mode: 'custom' })))).toEqual(['/a', '/b', '/z'])
  })

  it('名称升序忽略大小写', () => {
    expect(keys(sortTreeEntries(nodes, prefs({ mode: 'name', direction: 'asc' })))).toEqual([
      '/a',
      '/b',
      '/z'
    ])
  })

  it('添加时间降序（新→旧）', () => {
    expect(keys(sortTreeEntries(nodes, prefs({ mode: 'addedAt', direction: 'desc' })))).toEqual([
      '/a',
      '/b',
      '/z'
    ])
  })

  it('打开时间：固定最近→最远，null 永远排最后（忽略 direction）', () => {
    expect(
      keys(sortTreeEntries(nodes, prefs({ mode: 'lastOpenedAt', direction: 'desc' })))
    ).toEqual(['/b', '/z', '/a'])
    expect(keys(sortTreeEntries(nodes, prefs({ mode: 'lastOpenedAt', direction: 'asc' })))).toEqual(
      ['/b', '/z', '/a']
    )
  })

  it('Pin 分区：已置顶整段在前，组内仍按当前排序', () => {
    const mixed = [
      node('zeta', '/z', 100, 50, false, 0),
      node('alpha', '/a', 300, null, true, 1),
      node('Beta', '/b', 200, 200, true, 2),
      node('gamma', '/g', 50, 10, false, 3)
    ]
    expect(keys(sortTreeEntries(mixed, prefs({ mode: 'name', direction: 'asc' })))).toEqual([
      '/a',
      '/b',
      '/g',
      '/z'
    ])
    expect(keys(sortTreeEntries(mixed, prefs({ mode: 'custom', direction: 'asc' })))).toEqual([
      '/a',
      '/b',
      '/z',
      '/g'
    ])
  })

  it('Project 与 Server 按同一条 order 混排', () => {
    const mixed = [node('web', '/web', 1, null, false, 2), server('prod', 's1', 1)]
    expect(keys(sortTreeEntries(mixed, prefs({ mode: 'custom' })))).toEqual([
      serverEntryKey('s1'),
      '/web'
    ])
  })

  it('三类按同一条 order 混排；置顶的数据源进置顶分区', () => {
    const mixed = [
      node('web', '/web', 1, null, false, 3),
      dataSource('shop', 'd1', 1),
      server('prod', 's1', 2),
      dataSource('cache', 'd2', 4, true)
    ]
    expect(keys(sortTreeEntries(mixed, prefs({ mode: 'custom', direction: 'asc' })))).toEqual([
      dataSourceEntryKey('d2'),
      dataSourceEntryKey('d1'),
      serverEntryKey('s1'),
      '/web'
    ])
  })

  it('连接子菜单只列一类时同样按左树的排序与置顶，不受左树的类型筛选影响', () => {
    const sources = [
      dataSource('b', 'd1', 2),
      dataSource('a', 'd2', 1),
      dataSource('c', 'd3', 3, true)
    ]
    const hidden = prefs({ mode: 'custom', direction: 'asc', showDataSources: false })
    expect(keys(sortTreeEntries(sources, hidden))).toEqual([
      dataSourceEntryKey('d3'),
      dataSourceEntryKey('d2'),
      dataSourceEntryKey('d1')
    ])
  })
})

describe('filterTreeEntries', () => {
  const all = { showProjects: true, showServers: true, showDataSources: true }
  const entries = [
    node('DevCube', '/a', 1),
    node('other', '/b', 2),
    server('dev-box', 's1', 3),
    dataSource('dev-db', 'd1', 4)
  ]

  it('空查询只按类型筛', () => {
    expect(keys(filterTreeEntries(entries, '  ', all))).toEqual([
      '/a',
      '/b',
      'server:s1',
      'datasource:d1'
    ])
  })

  it('名称大小写不敏感包含匹配，三类一起筛', () => {
    expect(keys(filterTreeEntries(entries, 'dev', all))).toEqual([
      '/a',
      'server:s1',
      'datasource:d1'
    ])
  })

  it('按类型只显示其中几类', () => {
    expect(keys(filterTreeEntries(entries, '', { ...all, showProjects: false }))).toEqual([
      'server:s1',
      'datasource:d1'
    ])
    expect(keys(filterTreeEntries(entries, '', { ...all, showServers: false }))).toEqual([
      '/a',
      '/b',
      'datasource:d1'
    ])
    expect(
      keys(filterTreeEntries(entries, '', { ...all, showProjects: false, showServers: false }))
    ).toEqual(['datasource:d1'])
  })

  it('筛选后仍可再套 Pin 分区排序', () => {
    const mixed = [
      node('alpha', '/a', 1, null, false, 0),
      node('alpine', '/p', 2, null, true, 1),
      node('beta', '/b', 3, null, false, 2)
    ]
    const filtered = filterTreeEntries(mixed, 'al', all)
    expect(keys(sortTreeEntries(filtered, prefs({ mode: 'custom', direction: 'asc' })))).toEqual([
      '/p',
      '/a'
    ])
  })
})

describe('pinnedEntryOrder', () => {
  const base = [
    { key: '/a', pinned: true, order: 0 },
    { key: '/b', pinned: true, order: 1 },
    { key: '/c', pinned: false, order: 2 },
    { key: 'server:s', pinned: false, order: 3 }
  ]

  it('置顶：进入置顶区开头', () => {
    expect(pinnedEntryOrder(base, 'server:s', true)).toBe(-1)
  })

  it('取消置顶：进入未置顶区开头', () => {
    expect(pinnedEntryOrder(base, '/b', false)).toBe(1)
  })

  it('键不存在返回 null', () => {
    expect(pinnedEntryOrder(base, '/nope', true)).toBeNull()
  })

  it('目标区块没有别的条目时保留原 order', () => {
    const none = base.map((i) => ({ ...i, pinned: false }))
    expect(pinnedEntryOrder(none, '/c', true)).toBe(2)
  })
})
