// 左树条目（Project、Server 与 Data Source）共用的一条自定义序：每个条目自带 order，小的在前。
// 新登记插到最前、拖拽按全量键序重写、Pin 进入目标区块开头——三处都要跨三类条目取值。

import { pinnedEntryOrder } from '../shared/project-sort'
import { dataSourceEntryKey, serverEntryKey } from '../shared/tree-entry'
import {
  getDataSources,
  getProjects,
  getServers,
  setDataSources,
  setProjects,
  setServers
} from './store'

/** 三类条目的键、Pin 与自定义序。 */
function entryOrders(): { key: string; pinned: boolean; order: number }[] {
  return [
    ...getProjects().map((p) => ({ key: p.path, pinned: p.pinned, order: p.order })),
    ...getServers().map((s) => ({ key: serverEntryKey(s.id), pinned: s.pinned, order: s.order })),
    ...getDataSources().map((d) => ({
      key: dataSourceEntryKey(d.id),
      pinned: d.pinned,
      order: d.order
    }))
  ]
}

/** 按条目键改写 Pin 与自定义序（三类各自落盘）。 */
function patchEntries(patch: (key: string) => { pinned?: boolean; order?: number } | null): void {
  const apply = <T>(item: T, key: string): T => {
    const p = patch(key)
    return p === null ? item : { ...item, ...p }
  }
  setProjects(getProjects().map((p) => apply(p, p.path)))
  setServers(getServers().map((s) => apply(s, serverEntryKey(s.id))))
  setDataSources(getDataSources().map((d) => apply(d, dataSourceEntryKey(d.id))))
}

/** 新登记条目的 order：比现有全部条目都小（插到自定义序最前）。 */
export function headOrder(): number {
  const orders = entryOrders().map((e) => e.order)
  return orders.length === 0 ? 0 : Math.min(...orders) - 1
}

/** 按条目键顺序重写 order（0..n-1）；未列出的条目排在其后、保持原相对序。 */
export function reorderEntries(orderedKeys: string[]): void {
  const rank = new Map(orderedKeys.map((key, i) => [key, i]))
  const unlisted = entryOrders()
    .filter((e) => !rank.has(e.key))
    .sort((a, b) => a.order - b.order)
  unlisted.forEach((e, i) => rank.set(e.key, orderedKeys.length + i))
  patchEntries((key) => ({ order: rank.get(key)! }))
}

/** 设置条目的 Pin，并把它移到目标区块开头（置顶区 / 未置顶区）；键不存在则不动。 */
export function setEntryPinned(key: string, pinned: boolean): void {
  const order = pinnedEntryOrder(entryOrders(), key, pinned)
  if (order === null) return
  patchEntries((k) => (k === key ? { pinned, order } : null))
}
