// 左树条目：Project、Server 或 Data Source（术语见 CONTEXT.md）。三者共用排序、Pin、拖拽与名称筛选，
// 也都能挂 Tab。条目键：Project 为其绝对路径，Server 为 `server:<id>`，Data Source 为 `datasource:<id>`
// ——绝对路径不可能以这两个前缀开头，三类键同处一个命名空间不会撞车（同 Tab 键的前缀约定）。

import type { DataSourceNode } from './data-source'
import type { ServerNode } from './server'
import type { ProjectNode, RunConfig } from './types'

const SERVER_KEY_PREFIX = 'server:'
const DATA_SOURCE_KEY_PREFIX = 'datasource:'

export function serverEntryKey(serverId: string): string {
  return `${SERVER_KEY_PREFIX}${serverId}`
}

export function isServerEntryKey(key: string): boolean {
  return key.startsWith(SERVER_KEY_PREFIX)
}

/** Server 条目键 → 服务器 id；不是 Server 条目键返回 null。 */
export function serverIdOfEntryKey(key: string): string | null {
  return isServerEntryKey(key) ? key.slice(SERVER_KEY_PREFIX.length) : null
}

export function dataSourceEntryKey(dataSourceId: string): string {
  return `${DATA_SOURCE_KEY_PREFIX}${dataSourceId}`
}

export function isDataSourceEntryKey(key: string): boolean {
  return key.startsWith(DATA_SOURCE_KEY_PREFIX)
}

/** Data Source 条目键 → 数据源 id；不是 Data Source 条目键返回 null。 */
export function dataSourceIdOfEntryKey(key: string): string | null {
  return isDataSourceEntryKey(key) ? key.slice(DATA_SOURCE_KEY_PREFIX.length) : null
}

/** 条目键属于哪一类。 */
export function entryKindOfKey(key: string): TreeEntryKind {
  if (isServerEntryKey(key)) return 'server'
  if (isDataSourceEntryKey(key)) return 'dataSource'
  return 'project'
}

/** 配置所属的左树条目：服务器上的命令型属于其 Server，数据源上的属于其 Data Source，其余属于其 Project。 */
export function configOwnerKey(config: RunConfig): string {
  switch (config.kind) {
    case 'remote':
      return serverEntryKey(config.serverId)
    case 'dataSource':
      return dataSourceEntryKey(config.dataSourceId)
    case 'referenced':
    case 'command':
      return config.projectPath
  }
}

export type TreeEntry =
  | { kind: 'project'; key: string; node: ProjectNode }
  | { kind: 'server'; key: string; node: ServerNode }
  | { kind: 'dataSource'; key: string; node: DataSourceNode }

export type TreeEntryKind = TreeEntry['kind']

/** 排序 / Pin / 筛选关心的公共字段（三类条目同名同义）。 */
export interface TreeEntryItem {
  name: string
  addedAt: number
  lastOpenedAt: number | null
  pinned: boolean
  order: number
}

export function entryItem(entry: TreeEntry): TreeEntryItem {
  switch (entry.kind) {
    case 'project':
      return entry.node.project
    case 'server':
      return entry.node.server
    case 'dataSource':
      return entry.node.dataSource
  }
}

/** 把项目树、服务器与数据源列表拼成左树条目（顺序无意义，展示序由 sortTreeEntries 决定）。 */
export function buildTreeEntries(
  tree: ProjectNode[],
  servers: ServerNode[],
  dataSources: DataSourceNode[]
): TreeEntry[] {
  return [
    ...tree.map((node): TreeEntry => ({ kind: 'project', key: node.project.path, node })),
    ...servers.map((node): TreeEntry => ({
      kind: 'server',
      key: serverEntryKey(node.server.id),
      node
    })),
    ...dataSources.map((node): TreeEntry => ({
      kind: 'dataSource',
      key: dataSourceEntryKey(node.dataSource.id),
      node
    }))
  ]
}
