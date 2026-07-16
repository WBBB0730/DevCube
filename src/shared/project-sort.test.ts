import { describe, expect, it } from 'vitest'
import {
  applyProjectPinned,
  cycleProjectSort,
  defaultDirectionFor,
  filterProjectNodes,
  sortProjectNodes
} from './project-sort'
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
  pinned = false
): ProjectNode {
  const project: Project = { path, name, addedAt, lastOpenedAt, pinned }
  return { project, packageManager: null, discovered: [], configs: [] }
}

function prefs(partial: Partial<ProjectSortPrefs> = {}): ProjectSortPrefs {
  return { ...DEFAULT_PROJECT_SORT_PREFS, ...partial }
}

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

  it('切换排序保留 pinSticky', () => {
    expect(
      cycleProjectSort(prefs({ mode: 'name', direction: 'asc', pinSticky: false }), 'addedAt')
        .pinSticky
    ).toBe(false)
  })
})

describe('defaultDirectionFor', () => {
  it('名称默认升序，时间默认降序', () => {
    expect(defaultDirectionFor('name')).toBe('asc')
    expect(defaultDirectionFor('addedAt')).toBe('desc')
    expect(defaultDirectionFor('lastOpenedAt')).toBe('desc')
  })
})

describe('DEFAULT_PROJECT_SORT_PREFS', () => {
  it('默认添加时间倒序且开启置顶吸顶', () => {
    expect(DEFAULT_PROJECT_SORT_PREFS).toEqual({
      mode: 'addedAt',
      direction: 'desc',
      pinSticky: true
    })
  })
})

describe('sortProjectNodes', () => {
  const nodes = [
    node('zeta', '/z', 100, 50),
    node('alpha', '/a', 300, null),
    node('Beta', '/b', 200, 200)
  ]

  it('自定义保持原序', () => {
    expect(
      sortProjectNodes(nodes, prefs({ mode: 'custom', direction: 'asc' })).map(
        (n) => n.project.name
      )
    ).toEqual(['zeta', 'alpha', 'Beta'])
  })

  it('名称升序忽略大小写', () => {
    expect(
      sortProjectNodes(nodes, prefs({ mode: 'name', direction: 'asc' })).map((n) => n.project.name)
    ).toEqual(['alpha', 'Beta', 'zeta'])
  })

  it('添加时间降序（新→旧）', () => {
    expect(
      sortProjectNodes(nodes, prefs({ mode: 'addedAt', direction: 'desc' })).map(
        (n) => n.project.path
      )
    ).toEqual(['/a', '/b', '/z'])
  })

  it('打开时间：固定最近→最远，null 永远排最后（忽略 direction）', () => {
    expect(
      sortProjectNodes(nodes, prefs({ mode: 'lastOpenedAt', direction: 'desc' })).map(
        (n) => n.project.path
      )
    ).toEqual(['/b', '/z', '/a'])
    expect(
      sortProjectNodes(nodes, prefs({ mode: 'lastOpenedAt', direction: 'asc' })).map(
        (n) => n.project.path
      )
    ).toEqual(['/b', '/z', '/a'])
  })

  it('Pin 分区：已置顶整段在前，组内仍按当前排序', () => {
    const mixed = [
      node('zeta', '/z', 100, 50, false),
      node('alpha', '/a', 300, null, true),
      node('Beta', '/b', 200, 200, true),
      node('gamma', '/g', 50, 10, false)
    ]
    expect(
      sortProjectNodes(mixed, prefs({ mode: 'name', direction: 'asc' })).map((n) => n.project.path)
    ).toEqual(['/a', '/b', '/g', '/z'])
    // 自定义：各区保持传入相对序 → 置顶 alpha,Beta；未置顶 zeta,gamma
    expect(
      sortProjectNodes(mixed, prefs({ mode: 'custom', direction: 'asc' })).map(
        (n) => n.project.path
      )
    ).toEqual(['/a', '/b', '/z', '/g'])
  })
})

describe('filterProjectNodes', () => {
  const nodes = [node('DevCube', '/a', 1), node('other', '/b', 2)]

  it('空查询原样返回', () => {
    expect(filterProjectNodes(nodes, '  ')).toBe(nodes)
  })

  it('大小写不敏感包含匹配', () => {
    expect(filterProjectNodes(nodes, 'dev').map((n) => n.project.name)).toEqual(['DevCube'])
  })

  it('筛选后仍可再套 Pin 分区排序', () => {
    const mixed = [
      node('alpha', '/a', 1, null, false),
      node('alpine', '/p', 2, null, true),
      node('beta', '/b', 3, null, false)
    ]
    const filtered = filterProjectNodes(mixed, 'al')
    expect(
      sortProjectNodes(filtered, prefs({ mode: 'custom', direction: 'asc' })).map(
        (n) => n.project.path
      )
    ).toEqual(['/p', '/a'])
  })
})

describe('applyProjectPinned', () => {
  const base: Project[] = [
    { path: '/a', name: 'a', addedAt: 1, lastOpenedAt: null, pinned: true },
    { path: '/b', name: 'b', addedAt: 2, lastOpenedAt: null, pinned: true },
    { path: '/c', name: 'c', addedAt: 3, lastOpenedAt: null, pinned: false },
    { path: '/d', name: 'd', addedAt: 4, lastOpenedAt: null, pinned: false }
  ]

  it('置顶：进入置顶区开头', () => {
    const next = applyProjectPinned(base, '/d', true)
    expect(next.map((p) => [p.path, p.pinned])).toEqual([
      ['/d', true],
      ['/a', true],
      ['/b', true],
      ['/c', false]
    ])
  })

  it('取消置顶：进入未置顶区开头', () => {
    const next = applyProjectPinned(base, '/b', false)
    expect(next.map((p) => [p.path, p.pinned])).toEqual([
      ['/a', true],
      ['/b', false],
      ['/c', false],
      ['/d', false]
    ])
  })

  it('路径不存在原样返回', () => {
    expect(applyProjectPinned(base, '/nope', true)).toBe(base)
  })

  it('全部未置顶时置顶第一个：移到数组头', () => {
    const none = base.map((p) => ({ ...p, pinned: false }))
    const next = applyProjectPinned(none, '/c', true)
    expect(next[0]).toMatchObject({ path: '/c', pinned: true })
  })
})
