// Data Source Tab 记住的界面状态与最近打开（docs/prd/database.md「记住上次打开的」「最近打开」）：登记的数据源的每个 Tab
// 记住停在哪一格、上次打开的对象（Redis 为键，连同它所在的库编号）与目录展开着的节点，跨重启、连上后恢复；每个数据源记
// 最近打开的 DATA_SOURCE_RECENT_MAX 个，它的各个 Tab 共用。

import { catalogObjectKey, type CatalogObject, type CatalogPath } from './data-source-catalog'
import { redisDatabaseLabel } from './data-source-context'

/** Data Source Tab 左侧的两格：当前对象（Redis 为当前键）与控制台。 */
export type DataSourceSlot = 'current' | 'console'

/** 在左格里打开过的：SQL 数据库为目录里的对象，Redis 为键（连同所在的库编号；库编号未知时记下的没有）。 */
export type DataSourceOpened =
  ({ kind: 'object' } & CatalogObject) | { kind: 'key'; key: string; database?: number }

/** 一个 Data Source Tab 记住的界面状态。 */
export interface DataSourceTabUi {
  slot: DataSourceSlot
  /** 上次打开的对象或键；没打开过为 null */
  opened: DataSourceOpened | null
  /** 目录展开着的节点：节点键与它下一层的位置，按展开的先后（Redis 不用） */
  expanded: [string, CatalogPath][]
}

export const DEFAULT_DATA_SOURCE_TAB_UI: DataSourceTabUi = {
  slot: 'current',
  opened: null,
  expanded: []
}

/** 每个数据源最近打开的最多记这么多个（同 Files 的最近打开文件）。 */
export const DATA_SOURCE_RECENT_MAX = 10

/**
 * 认同一个对象或键用的键：对象为它在目录里的节点键，键为库编号与键名（不同库里的同名键是两个；前面加上类别免得撞上）。
 */
export function openedKey(opened: DataSourceOpened): string {
  return opened.kind === 'object'
    ? `object\0${catalogObjectKey(opened)}`
    : `key\0${opened.database ?? ''}\0${opened.key}`
}

/** 打开了 opened：放到最近打开的最前，去掉同一个的旧项，最多留 DATA_SOURCE_RECENT_MAX 个。 */
export function pushRecentOpened(
  recent: readonly DataSourceOpened[],
  opened: DataSourceOpened
): DataSourceOpened[] {
  const key = openedKey(opened)
  return [opened, ...recent.filter((o) => openedKey(o) !== key)].slice(0, DATA_SOURCE_RECENT_MAX)
}

/** 从最近打开里去掉 opened（已不在的）。 */
export function dropRecentOpened(
  recent: readonly DataSourceOpened[],
  opened: DataSourceOpened
): DataSourceOpened[] {
  const key = openedKey(opened)
  return recent.filter((o) => openedKey(o) !== key)
}

/**
 * 最近打开里名称后面淡色的位置：对象所在的「库.模式」（没有的省掉，SQLite 为空串）；键为所在的库（db0、db1……，库编号
 * 未知时记下的没有，为空串）。
 */
export function openedLocation(opened: DataSourceOpened): string {
  if (opened.kind === 'key') {
    return opened.database === undefined ? '' : redisDatabaseLabel(opened.database)
  }
  const { database, schema } = opened.path
  return [database, schema].filter((part) => part !== undefined).join('.')
}
