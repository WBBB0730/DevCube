// 左树项目列表的排序 / 筛选 / Pin 落盘纯函数（可单测，main / renderer 共用）。

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
 * 自定义无方向；打开时间（lastOpenedAt）固定降序（最近在前），再点也不翻转。
 */
export function cycleProjectSort(
  current: ProjectSortPrefs,
  nextMode: ProjectSortMode
): ProjectSortPrefs {
  // 保留 pinSticky 等非排序字段。
  if (nextMode === 'custom') return { ...current, mode: 'custom', direction: 'asc' }
  // 打开时间只有「最近→最远」一种语义，不提供升序。
  if (nextMode === 'lastOpenedAt') return { ...current, mode: 'lastOpenedAt', direction: 'desc' }
  if (current.mode === nextMode) {
    return {
      ...current,
      mode: nextMode,
      direction: current.direction === 'asc' ? 'desc' : 'asc'
    }
  }
  return { ...current, mode: nextMode, direction: defaultDirectionFor(nextMode) }
}

/**
 * 按偏好排序项目节点。任意 mode 下先按 Pin 分区（置顶在前），再在各区内排序；
 * 自定义 = 各区内保持传入相对序（即落盘数组序）。
 */
export function sortProjectNodes(nodes: ProjectNode[], prefs: ProjectSortPrefs): ProjectNode[] {
  const pinned = nodes.filter((n) => n.project.pinned)
  const unpinned = nodes.filter((n) => !n.project.pinned)
  if (prefs.mode === 'custom') return [...pinned, ...unpinned]
  const mode = prefs.mode
  const dir = prefs.direction === 'asc' ? 1 : -1
  const sortGroup = (group: ProjectNode[]): ProjectNode[] =>
    [...group].sort((a, b) => compareProjects(a.project, b.project, mode, dir))
  return [...sortGroup(pinned), ...sortGroup(unpinned)]
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
  // lastOpenedAt：固定最近→最远；null 永远排最后（prefs.direction 忽略）
  const aT = a.lastOpenedAt
  const bT = b.lastOpenedAt
  if (aT === null && bT === null) return 0
  if (aT === null) return 1
  if (bT === null) return -1
  return bT - aT
}

/** 按项目名大小写不敏感包含筛选；空查询原样返回。 */
export function filterProjectNodes(nodes: ProjectNode[], query: string): ProjectNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return nodes
  return nodes.filter((n) => n.project.name.toLowerCase().includes(q))
}

/**
 * 设置某项目的 Pin，并把它移到目标区块开头（置顶区 / 未置顶区）。
 * 路径不存在则原样返回；状态未变也仍移到目标区开头（与「再点一次置顶」可预期）。
 */
export function applyProjectPinned(projects: Project[], path: string, pinned: boolean): Project[] {
  const i = projects.findIndex((p) => p.path === path)
  if (i < 0) return projects
  const updated: Project = { ...projects[i], pinned }
  const rest = projects.filter((p) => p.path !== path)
  if (pinned) {
    const firstPinned = rest.findIndex((p) => p.pinned)
    if (firstPinned < 0) return [updated, ...rest]
    return [...rest.slice(0, firstPinned), updated, ...rest.slice(firstPinned)]
  }
  const firstUnpinned = rest.findIndex((p) => !p.pinned)
  if (firstUnpinned < 0) return [...rest, updated]
  return [...rest.slice(0, firstUnpinned), updated, ...rest.slice(firstUnpinned)]
}
