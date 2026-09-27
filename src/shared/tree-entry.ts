// 左树条目：Project 或 Server（术语见 CONTEXT.md）。二者共用排序、Pin、拖拽与名称筛选，
// 也都能挂 Tab（Terminal / SSH Terminal）。条目键：Project 为其绝对路径，Server 为 `server:<id>`
// ——绝对路径不可能以 `server:` 开头，两类键同处一个命名空间不会撞车（同 Tab 键的前缀约定）。

import type { ServerNode } from './server'
import type { ProjectNode, RunConfig } from './types'

const SERVER_KEY_PREFIX = 'server:'

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

/** 配置所属的左树条目：服务器上的命令型属于其 Server，其余属于其 Project。 */
export function configOwnerKey(config: RunConfig): string {
  return config.kind === 'remote' ? serverEntryKey(config.serverId) : config.projectPath
}

export type TreeEntry =
  | { kind: 'project'; key: string; node: ProjectNode }
  | { kind: 'server'; key: string; node: ServerNode }

/** 排序 / Pin / 筛选关心的公共字段（Project 与 Server 同名同义）。 */
export interface TreeEntryItem {
  name: string
  addedAt: number
  lastOpenedAt: number | null
  pinned: boolean
  order: number
}

export function entryItem(entry: TreeEntry): TreeEntryItem {
  return entry.kind === 'project' ? entry.node.project : entry.node.server
}

/** 把项目树与服务器列表拼成左树条目（顺序无意义，展示序由 sortTreeEntries 决定）。 */
export function buildTreeEntries(tree: ProjectNode[], servers: ServerNode[]): TreeEntry[] {
  return [
    ...tree.map((node): TreeEntry => ({ kind: 'project', key: node.project.path, node })),
    ...servers.map((node): TreeEntry => ({
      kind: 'server',
      key: serverEntryKey(node.server.id),
      node
    }))
  ]
}
