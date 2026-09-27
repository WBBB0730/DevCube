// 左树条目（Project 与 Server 混排）的排序 / 筛选 / Pin / 重排纯函数（可单测，main / renderer 共用）。

import { entryItem, type TreeEntry, type TreeEntryItem } from './tree-entry'
import type { ProjectSortDirection, ProjectSortMode, ProjectSortPrefs } from './types'

/** 各排序模式首次切入时的默认方向。 */
function defaultDirectionFor(mode: ProjectSortMode): ProjectSortDirection {
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
 * 按偏好排序左树条目。任意 mode 下先按 Pin 分区（置顶在前），再在各区内排序；
 * 自定义 = 各区内按 order 升序（同值保持传入相对序）。
 */
export function sortTreeEntries(entries: TreeEntry[], prefs: ProjectSortPrefs): TreeEntry[] {
  const pinned = entries.filter((e) => entryItem(e).pinned)
  const unpinned = entries.filter((e) => !entryItem(e).pinned)
  const mode = prefs.mode
  const dir = prefs.direction === 'asc' ? 1 : -1
  const sortGroup = (group: TreeEntry[]): TreeEntry[] =>
    [...group].sort((a, b) => compareItems(entryItem(a), entryItem(b), mode, dir))
  return [...sortGroup(pinned), ...sortGroup(unpinned)]
}

function compareItems(
  a: TreeEntryItem,
  b: TreeEntryItem,
  mode: ProjectSortMode,
  dir: number
): number {
  if (mode === 'custom') return a.order - b.order
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

/** 按类型（排序菜单的「项目」「服务器」勾选）与名称（大小写不敏感包含）筛选；空查询不按名称筛。 */
export function filterTreeEntries(
  entries: TreeEntry[],
  query: string,
  prefs: Pick<ProjectSortPrefs, 'showProjects' | 'showServers'>
): TreeEntry[] {
  const q = query.trim().toLowerCase()
  return entries.filter((e) => {
    if (e.kind === 'project' ? !prefs.showProjects : !prefs.showServers) return false
    return q === '' || entryItem(e).name.toLowerCase().includes(q)
  })
}

/**
 * 置顶 / 取消置顶后该条目的新 order：进入目标区块开头（比目标区块现有最小 order 还小 1）。
 * 目标区块没有别的条目时保留原 order（它独占该区块，位置无所谓）。
 */
export function pinnedEntryOrder(
  items: ReadonlyArray<{ key: string; pinned: boolean; order: number }>,
  key: string,
  pinned: boolean
): number | null {
  const self = items.find((i) => i.key === key)
  if (!self) return null
  const group = items.filter((i) => i.key !== key && i.pinned === pinned)
  if (group.length === 0) return self.order
  return Math.min(...group.map((i) => i.order)) - 1
}
