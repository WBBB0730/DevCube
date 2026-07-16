/** 工作台 Tab 现场（每项目激活 Tab、Terminal 壳、当前项目与选中）。术语见 CONTEXT.md / ADR-0008。 */

/** 落盘的 Terminal 壳（无进程）；id 即会话键 `terminal:<uuid>`。 */
export interface TerminalShell {
  id: string
  name: string
}

/** 跨重启的工作台 UI 快照。 */
export interface WorkspaceUiState {
  currentProjectPath: string | null
  selectedKey: string | null
  /** 每项目激活的 Tab 键；缺省项目走默认激活 */
  activeTabByProject: Record<string, string | null>
  /** 每项目 Terminal 壳列表（数组序 = Tab 序） */
  terminalsByProject: Record<string, TerminalShell[]>
}

export const DEFAULT_WORKSPACE_UI: WorkspaceUiState = {
  currentProjectPath: null,
  selectedKey: null,
  activeTabByProject: {},
  terminalsByProject: {}
}

/** 渲染端终端 Tab 形状（与 store 对齐，供合并纯函数使用）。 */
export interface TerminalTabLike {
  key: string
  projectPath: string
  name: string
}

/**
 * 活会话优先合并终端 Tab：盘上的名字/顺序为骨架；主进程仍活着的 key 必须出现；
 * 仅盘上有的壳保留（待懒 spawn）；仅活着的（无盘记录）按活列表顺序追加并给回落名。
 */
export function mergeTerminalTabs(
  live: readonly { key: string; projectPath: string }[],
  shellsByProject: Record<string, TerminalShell[]>
): TerminalTabLike[] {
  const liveByProject = new Map<string, { key: string; projectPath: string }[]>()
  for (const t of live) {
    const list = liveByProject.get(t.projectPath) ?? []
    list.push(t)
    liveByProject.set(t.projectPath, list)
  }

  const projectPaths = new Set<string>([
    ...Object.keys(shellsByProject),
    ...liveByProject.keys()
  ])

  const out: TerminalTabLike[] = []
  for (const projectPath of projectPaths) {
    const shells = shellsByProject[projectPath] ?? []
    const liveList = liveByProject.get(projectPath) ?? []
    const seen = new Set<string>()

    for (const s of shells) {
      seen.add(s.id)
      out.push({ key: s.id, projectPath, name: s.name })
    }
    let seq = shells.length
    for (const t of liveList) {
      if (seen.has(t.key)) continue
      seq += 1
      out.push({
        key: t.key,
        projectPath,
        name: seq === 1 ? '终端' : `终端 (${seq})`
      })
      seen.add(t.key)
    }
  }
  return out
}

/** 从终端 Tab 列表导出落盘壳表（按项目分组、保留相对序）。 */
export function terminalsToShellsByProject(
  terminals: readonly TerminalTabLike[]
): Record<string, TerminalShell[]> {
  const out: Record<string, TerminalShell[]> = {}
  for (const t of terminals) {
    const list = out[t.projectPath] ?? (out[t.projectPath] = [])
    list.push({ id: t.key, name: t.name })
  }
  return out
}

/**
 * 校验左树选中：配置键仍存在则保留，否则 null（项目行）。
 * selectedKey 为配置会话键（与 configKey 一致）。
 */
export function resolvePersistedSelectedKey(
  selectedKey: string | null | undefined,
  configKeys: ReadonlySet<string>
): string | null {
  if (selectedKey == null || selectedKey === '') return null
  return configKeys.has(selectedKey) ? selectedKey : null
}

/** 当前项目路径仍在树中才保留。 */
export function resolvePersistedProjectPath(
  path: string | null | undefined,
  projectPaths: ReadonlySet<string>
): string | null {
  if (path == null || path === '') return null
  return projectPaths.has(path) ? path : null
}
