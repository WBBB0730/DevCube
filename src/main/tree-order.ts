// 左树条目（Project 与 Server）共用的一条自定义序：每个条目自带 order，小的在前。
// 新登记插到最前、拖拽按全量键序重写、Pin 进入目标区块开头——三处都要跨两类条目取值。

import { pinnedEntryOrder } from '../shared/project-sort'
import { serverEntryKey } from '../shared/tree-entry'
import { getProjects, getServers, setProjects, setServers } from './store'

/** 新登记条目的 order：比现有全部条目都小（插到自定义序最前）。 */
export function headOrder(): number {
  const orders = [...getProjects().map((p) => p.order), ...getServers().map((s) => s.order)]
  return orders.length === 0 ? 0 : Math.min(...orders) - 1
}

/** 按条目键顺序重写 order（0..n-1）；未列出的条目排在其后、保持原相对序。 */
export function reorderEntries(orderedKeys: string[]): void {
  const rank = new Map(orderedKeys.map((key, i) => [key, i]))
  const projects = getProjects()
  const servers = getServers()
  const unlisted = [
    ...projects.map((p) => ({ key: p.path, order: p.order })),
    ...servers.map((s) => ({ key: serverEntryKey(s.id), order: s.order }))
  ]
    .filter((e) => !rank.has(e.key))
    .sort((a, b) => a.order - b.order)
  unlisted.forEach((e, i) => rank.set(e.key, orderedKeys.length + i))
  setProjects(projects.map((p) => ({ ...p, order: rank.get(p.path)! })))
  setServers(servers.map((s) => ({ ...s, order: rank.get(serverEntryKey(s.id))! })))
}

/** 设置条目的 Pin，并把它移到目标区块开头（置顶区 / 未置顶区）；键不存在则不动。 */
export function setEntryPinned(key: string, pinned: boolean): void {
  const projects = getProjects()
  const servers = getServers()
  const order = pinnedEntryOrder(
    [
      ...projects.map((p) => ({ key: p.path, pinned: p.pinned, order: p.order })),
      ...servers.map((s) => ({ key: serverEntryKey(s.id), pinned: s.pinned, order: s.order }))
    ],
    key,
    pinned
  )
  if (order === null) return
  if (projects.some((p) => p.path === key)) {
    setProjects(projects.map((p) => (p.path === key ? { ...p, pinned, order } : p)))
  } else {
    setServers(servers.map((s) => (serverEntryKey(s.id) === key ? { ...s, pinned, order } : s)))
  }
}
