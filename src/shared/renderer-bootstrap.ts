/** 主进程在 preload 阶段同步注入的首屏快照，避免首帧空树。 */

import type { ServerNode } from './server'
import { buildTreeEntries, configOwnerKey } from './tree-entry'
import type { AppPrefs, ProjectNode, ProjectSortPrefs, SessionState, TerminalInfo } from './types'
import { configKey } from './runnable'
import {
  mergeTerminalTabs,
  resolvePersistedEntryKey,
  resolvePersistedSelectedKey,
  type WorkspaceUiState
} from './workspace'

export type RendererBootstrap = {
  tree: ProjectNode[]
  servers: ServerNode[]
  sessions: SessionState[]
  terminals: TerminalInfo[]
  projectSortPrefs: ProjectSortPrefs
  workspace: WorkspaceUiState
  /** 首帧即需的应用偏好（如自动获取开关：Git Tab 首次到前台就要按它决定是否 fetch） */
  appPrefs: AppPrefs
}

/** 由 bootstrap 快照得到工作台首屏字段（与历史 init 对齐）。 */
export function workspaceSliceFromBootstrap(boot: Omit<RendererBootstrap, 'appPrefs'>): {
  tree: ProjectNode[]
  servers: ServerNode[]
  sessions: Record<string, SessionState>
  terminals: ReturnType<typeof mergeTerminalTabs>
  projectSortPrefs: ProjectSortPrefs
  currentEntryKey: string | null
  selectedKey: string | null
  activeTabByEntry: Record<string, string | null>
} {
  const sessions = Object.fromEntries(boot.sessions.map((s) => [s.key, s]))
  const serverNames = new Map(boot.servers.map((n) => [n.server.id, n.server.name]))
  const terminals = mergeTerminalTabs(boot.terminals, boot.workspace.terminalsByEntry, (id) =>
    serverNames.get(id)
  )
  const entryKeys = new Set(buildTreeEntries(boot.tree, boot.servers).map((e) => e.key))
  // Project 与 Server 下的配置都可能是上次的选中项
  const configs = [
    ...boot.tree.flatMap((n) => n.configs),
    ...boot.servers.flatMap((n) => n.configs)
  ]
  const configKeys = new Set(configs.map((c) => configKey(c)))
  const currentEntryKey = resolvePersistedEntryKey(boot.workspace.currentEntryKey, entryKeys)
  let selectedKey = resolvePersistedSelectedKey(boot.workspace.selectedKey, configKeys)
  if (!currentEntryKey) {
    selectedKey = null
  } else if (selectedKey) {
    const owner = configs.find((c) => configKey(c) === selectedKey)
    if (!owner || configOwnerKey(owner) !== currentEntryKey) selectedKey = null
  }
  const activeTabByEntry = { ...boot.workspace.activeTabByEntry }
  for (const k of Object.keys(activeTabByEntry)) {
    if (!entryKeys.has(k)) delete activeTabByEntry[k]
  }
  return {
    tree: boot.tree,
    servers: boot.servers,
    sessions,
    terminals,
    projectSortPrefs: boot.projectSortPrefs,
    currentEntryKey,
    selectedKey,
    activeTabByEntry
  }
}
