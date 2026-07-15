import { describe, expect, it } from 'vitest'
import {
  cycleProjectSort,
  defaultDirectionFor,
  filterProjectNodes,
  sortProjectNodes
} from './project-sort'
import { DEFAULT_PROJECT_SORT_PREFS, type Project, type ProjectNode, type ProjectSortPrefs } from './types'

function node(
  name: string,
  path: string,
  addedAt: number,
  lastOpenedAt: number | null = null
): ProjectNode {
  const project: Project = { path, name, addedAt, lastOpenedAt }
  return { project, packageManager: null, discovered: [], configs: [] }
}

describe('cycleProjectSort', () => {
  it('切入自定义固定 asc', () => {
    expect(cycleProjectSort({ mode: 'name', direction: 'desc' }, 'custom')).toEqual({
      mode: 'custom',
      direction: 'asc'
    })
  })

  it('换 mode 取该 mode 默认方向', () => {
    expect(cycleProjectSort({ mode: 'custom', direction: 'asc' }, 'name')).toEqual({
      mode: 'name',
      direction: 'asc'
    })
    expect(cycleProjectSort({ mode: 'custom', direction: 'asc' }, 'addedAt')).toEqual({
      mode: 'addedAt',
      direction: 'desc'
    })
  })

  it('同 mode 再点翻转方向（打开时间除外）', () => {
    expect(cycleProjectSort({ mode: 'name', direction: 'asc' }, 'name')).toEqual({
      mode: 'name',
      direction: 'desc'
    })
    expect(cycleProjectSort({ mode: 'addedAt', direction: 'desc' }, 'addedAt')).toEqual({
      mode: 'addedAt',
      direction: 'asc'
    })
    expect(cycleProjectSort({ mode: 'lastOpenedAt', direction: 'desc' }, 'lastOpenedAt')).toEqual({
      mode: 'lastOpenedAt',
      direction: 'desc'
    })
  })

  it('切入打开时间固定降序', () => {
    expect(cycleProjectSort({ mode: 'name', direction: 'asc' }, 'lastOpenedAt')).toEqual({
      mode: 'lastOpenedAt',
      direction: 'desc'
    })
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
  it('默认添加时间倒序', () => {
    expect(DEFAULT_PROJECT_SORT_PREFS).toEqual({ mode: 'addedAt', direction: 'desc' })
  })
})

describe('sortProjectNodes', () => {
  const nodes = [
    node('zeta', '/z', 100, 50),
    node('alpha', '/a', 300, null),
    node('Beta', '/b', 200, 200)
  ]

  it('自定义保持原序', () => {
    const prefs: ProjectSortPrefs = { mode: 'custom', direction: 'asc' }
    expect(sortProjectNodes(nodes, prefs).map((n) => n.project.name)).toEqual([
      'zeta',
      'alpha',
      'Beta'
    ])
  })

  it('名称升序忽略大小写', () => {
    const prefs: ProjectSortPrefs = { mode: 'name', direction: 'asc' }
    expect(sortProjectNodes(nodes, prefs).map((n) => n.project.name)).toEqual([
      'alpha',
      'Beta',
      'zeta'
    ])
  })

  it('添加时间降序（新→旧）', () => {
    const prefs: ProjectSortPrefs = { mode: 'addedAt', direction: 'desc' }
    expect(sortProjectNodes(nodes, prefs).map((n) => n.project.path)).toEqual(['/a', '/b', '/z'])
  })

  it('打开时间：固定最近→最远，null 永远排最后（忽略 direction）', () => {
    const prefs: ProjectSortPrefs = { mode: 'lastOpenedAt', direction: 'desc' }
    expect(sortProjectNodes(nodes, prefs).map((n) => n.project.path)).toEqual(['/b', '/z', '/a'])
    const ascIgnored: ProjectSortPrefs = { mode: 'lastOpenedAt', direction: 'asc' }
    expect(sortProjectNodes(nodes, ascIgnored).map((n) => n.project.path)).toEqual([
      '/b',
      '/z',
      '/a'
    ])
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
})
