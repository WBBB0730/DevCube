// 左树项目列表的排序 / 筛选纯函数（可单测，main / renderer 共用）。

import type {
  Project,
  ProjectNode,
  ProjectSortDirection,
  ProjectSortMode,
  ProjectSortPrefs
} from './types'

/** 各排序模式首次切入时的默认方向。 */
export function defaultDirectionFor(mode: ProjectSortMode): ProjectSortDirection {
  return mode === 'name' ? 'asc' : 'desc'
}

/**
 * 点选某排序方式：同 mode 则翻转方向；换 mode 则切到该 mode 的默认方向。
 * 自定义无方向，始终 direction 无关。
 */
export function cycleProjectSort(
  current: ProjectSortPrefs,
  nextMode: ProjectSortMode
): ProjectSortPrefs {
  if (nextMode === 'custom') return { mode: 'custom', direction: 'asc' }
  if (current.mode === nextMode) {
    return { mode: nextMode, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  }
  return { mode: nextMode, direction: defaultDirectionFor(nextMode) }
}

/** 按偏好排序项目节点；自定义 = 保持传入顺序（即落盘数组序）。 */
export function sortProjectNodes(
  nodes: ProjectNode[],
  prefs: ProjectSortPrefs
): ProjectNode[] {
  if (prefs.mode === 'custom') return nodes
  const mode = prefs.mode
  const dir = prefs.direction === 'asc' ? 1 : -1
  return [...nodes].sort((a, b) => compareProjects(a.project, b.project, mode, dir))
}

function compareProjects(
  a: Project,
  b: Project,
  mode: Exclude<ProjectSortMode, 'custom'>,
  dir: number
): number {
  if (mode === 'name') {
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * dir
  }
  if (mode === 'addedAt') {
    return (a.addedAt - b.addedAt) * dir
  }
  // lastOpenedAt：null 永远排最后（与方向无关）
  const aT = a.lastOpenedAt
  const bT = b.lastOpenedAt
  if (aT === null && bT === null) return 0
  if (aT === null) return 1
  if (bT === null) return -1
  return (aT - bT) * dir
}

/** 按项目名大小写不敏感包含筛选；空查询原样返回。 */
export function filterProjectNodes(nodes: ProjectNode[], query: string): ProjectNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return nodes
  return nodes.filter((n) => n.project.name.toLowerCase().includes(q))
}
