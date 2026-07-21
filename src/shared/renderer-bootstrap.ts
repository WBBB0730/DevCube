/** 主进程在 preload 阶段同步注入的首屏快照，避免首帧空树。 */

import type { ProjectNode, ProjectSortPrefs, SessionState, TerminalInfo } from './types'
import { configKey } from './runnable'
import {
  mergeTerminalTabs,
  resolvePersistedProjectPath,
  resolvePersistedSelectedKey,
  type WorkspaceUiState
} from './workspace'

export type RendererBootstrap = {
  tree: ProjectNode[]
  sessions: SessionState[]
  terminals: TerminalInfo[]
  projectSortPrefs: ProjectSortPrefs
  workspace: WorkspaceUiState
}

/** 由 bootstrap 快照得到工作台首屏字段（与历史 init 对齐）。 */
export function workspaceSliceFromBootstrap(boot: RendererBootstrap): {
  tree: ProjectNode[]
  sessions: Record<string, SessionState>
  terminals: ReturnType<typeof mergeTerminalTabs>
  projectSortPrefs: ProjectSortPrefs
  currentProjectPath: string | null
  selectedKey: string | null
  activeTabByProject: Record<string, string | null>
} {
  const sessions = Object.fromEntries(boot.sessions.map((s) => [s.key, s]))
  const terminals = mergeTerminalTabs(boot.terminals, boot.workspace.terminalsByProject)
  const projectPaths = new Set(boot.tree.map((n) => n.project.path))
  const configKeys = new Set(boot.tree.flatMap((n) => n.configs.map((c) => configKey(c))))
  const currentProjectPath = resolvePersistedProjectPath(
    boot.workspace.currentProjectPath,
    projectPaths
  )
  let selectedKey = resolvePersistedSelectedKey(boot.workspace.selectedKey, configKeys)
  if (!currentProjectPath) {
    selectedKey = null
  } else if (selectedKey) {
    const owner = boot.tree.find((n) => n.configs.some((c) => configKey(c) === selectedKey))
    if (!owner || owner.project.path !== currentProjectPath) selectedKey = null
  }
  const activeTabByProject = { ...boot.workspace.activeTabByProject }
  for (const p of Object.keys(activeTabByProject)) {
    if (!projectPaths.has(p)) delete activeTabByProject[p]
  }
  return {
    tree: boot.tree,
    sessions,
    terminals,
    projectSortPrefs: boot.projectSortPrefs,
    currentProjectPath,
    selectedKey,
    activeTabByProject
  }
}
