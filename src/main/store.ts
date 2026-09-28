import type ElectronStore from 'electron-store'
import type { FilesUiState } from '../shared/files'
import { DEFAULT_FILES_UI } from '../shared/files'
import type {
  AppPrefs,
  PersistedState,
  Project,
  ProjectSortPrefs,
  RunConfig,
  WindowsShell
} from '../shared/types'
import { DEFAULT_APP_PREFS, DEFAULT_PROJECT_SORT_PREFS, WINDOWS_SHELLS } from '../shared/types'
import { THEME_MODES, type ThemeMode } from '../shared/theme'
import type { Server } from '../shared/server'
import type { TerminalShell, WorkspaceUiState } from '../shared/workspace'
import { DEFAULT_WORKSPACE_UI, migrateLegacyWorkspaceUi } from '../shared/workspace'
import {
  DEFAULT_GIT_REPO_SETTINGS,
  DEFAULT_GIT_VIEW_PREFS,
  type GitRepoSettings,
  type GitViewPrefs
} from '../shared/git'

// electron-store 是纯 ESM，从 CJS 主进程用动态 import 加载；落盘为 userData/devcube.json（ADR-0002）。
let store: ElectronStore<PersistedState>

export async function initStore(): Promise<void> {
  const { default: Store } = await import('electron-store')
  store = new Store<PersistedState>({
    name: 'devcube',
    defaults: {
      projects: [],
      servers: [],
      serverSecrets: {},
      configs: [],
      gitSettings: {},
      gitViewPrefs: DEFAULT_GIT_VIEW_PREFS,
      projectSortPrefs: DEFAULT_PROJECT_SORT_PREFS,
      appPrefs: DEFAULT_APP_PREFS,
      filesUi: {},
      workspaceUi: DEFAULT_WORKSPACE_UI
    }
  })
}

/**
 * 老档案缺 addedAt / lastOpenedAt / pinned / order 时补齐；首次读到脏数据即回写，避免每次 Date.now() 抖动。
 * order 缺省取数组下标——条目化之前自定义序就是数组序，原样保住。
 */
export function getProjects(): Project[] {
  const raw = store.get('projects')
  const now = Date.now()
  let dirty = false
  const projects = raw.map((p, index) => {
    const addedAt = typeof p.addedAt === 'number' ? p.addedAt : now
    const lastOpenedAt = typeof p.lastOpenedAt === 'number' ? p.lastOpenedAt : null
    const pinned = p.pinned === true
    const order = typeof p.order === 'number' ? p.order : index
    if (
      addedAt !== p.addedAt ||
      lastOpenedAt !== (p.lastOpenedAt ?? null) ||
      p.pinned !== pinned ||
      p.order !== order
    ) {
      dirty = true
    }
    return { path: p.path, name: p.name, addedAt, lastOpenedAt, pinned, order }
  })
  if (dirty) store.set('projects', projects)
  return projects
}

export function setProjects(projects: Project[]): void {
  store.set('projects', projects)
}

/** 老档案里的 Server 没有 direct（绕开代理直连）：按未打开补齐。 */
export function getServers(): Server[] {
  return store.get('servers').map((s) => ({ ...s, direct: s.direct === true }))
}

export function setServers(servers: Server[]): void {
  store.set('servers', servers)
}

/** 记住的密码密文（safeStorage 输出的 base64）；没有返回 null。 */
export function getServerSecret(serverId: string): string | null {
  return store.get('serverSecrets')[serverId] ?? null
}

export function setServerSecret(serverId: string, secret: string | null): void {
  const all = { ...store.get('serverSecrets') }
  if (secret === null) delete all[serverId]
  else all[serverId] = secret
  store.set('serverSecrets', all)
}

export function getConfigs(): RunConfig[] {
  return store.get('configs')
}

export function setConfigs(configs: RunConfig[]): void {
  store.set('configs', configs)
}

// —— Git 设置（每项目）与视图偏好 ——
// 读取时与默认值合并：老档案缺新字段也能得到完整形状，写入只存合并后的快照。
// 合并前先按当前类型的已知键挑拣一次：产品演进删过字段（name / issueLinkingConfig /
// globalIssueLinkingConfig 等），老 JSON 里残留的未知键若直接展开会混进快照并被再次写盘。

/** 从持久化对象里只挑拣 defaults 声明的已知键（丢弃老档案残留的未知键）。 */
function pickKnownKeys<T extends object>(defaults: T, stored: Partial<T> | undefined): Partial<T> {
  const out: Partial<T> = {}
  if (stored === undefined) return out
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    if (key in stored) out[key] = stored[key]
  }
  return out
}

export function getGitSettings(projectPath: string): GitRepoSettings {
  return {
    ...DEFAULT_GIT_REPO_SETTINGS,
    ...pickKnownKeys(DEFAULT_GIT_REPO_SETTINGS, store.get('gitSettings')[projectPath])
  }
}

export function setGitSettings(
  projectPath: string,
  patch: Partial<GitRepoSettings>
): GitRepoSettings {
  const merged = { ...getGitSettings(projectPath), ...patch }
  store.set('gitSettings', { ...store.get('gitSettings'), [projectPath]: merged })
  return merged
}

/** 项目移除时清掉它的 git 设置，避免残留。 */
export function deleteGitSettings(projectPath: string): void {
  const all = { ...store.get('gitSettings') }
  delete all[projectPath]
  store.set('gitSettings', all)
}

export function getGitViewPrefs(): GitViewPrefs {
  return {
    ...DEFAULT_GIT_VIEW_PREFS,
    ...pickKnownKeys(DEFAULT_GIT_VIEW_PREFS, store.get('gitViewPrefs'))
  }
}

export function setGitViewPrefs(patch: Partial<GitViewPrefs>): GitViewPrefs {
  const merged = { ...getGitViewPrefs(), ...patch }
  store.set('gitViewPrefs', merged)
  return merged
}

export function getProjectSortPrefs(): ProjectSortPrefs {
  return {
    ...DEFAULT_PROJECT_SORT_PREFS,
    ...pickKnownKeys(DEFAULT_PROJECT_SORT_PREFS, store.get('projectSortPrefs'))
  }
}

export function setProjectSortPrefs(patch: Partial<ProjectSortPrefs>): ProjectSortPrefs {
  const merged = { ...getProjectSortPrefs(), ...patch }
  store.set('projectSortPrefs', merged)
  return merged
}

function normalizeWindowsShell(value: unknown): WindowsShell {
  return typeof value === 'string' && (WINDOWS_SHELLS as readonly string[]).includes(value)
    ? (value as WindowsShell)
    : DEFAULT_APP_PREFS.windowsShell
}

function normalizeTheme(value: unknown): ThemeMode {
  return typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value)
    ? (value as ThemeMode)
    : DEFAULT_APP_PREFS.theme
}

export function getAppPrefs(): AppPrefs {
  const stored = store.get('appPrefs')
  return {
    ...DEFAULT_APP_PREFS,
    ...pickKnownKeys(DEFAULT_APP_PREFS, stored),
    windowsShell: normalizeWindowsShell(stored?.windowsShell ?? DEFAULT_APP_PREFS.windowsShell),
    theme: normalizeTheme(stored?.theme ?? DEFAULT_APP_PREFS.theme)
  }
}

export function setAppPrefs(patch: Partial<AppPrefs>): AppPrefs {
  const current = getAppPrefs()
  const merged: AppPrefs = {
    ...current,
    ...patch,
    windowsShell: normalizeWindowsShell(patch.windowsShell ?? current.windowsShell),
    theme: normalizeTheme(patch.theme ?? current.theme)
  }
  store.set('appPrefs', merged)
  return merged
}

export function getFilesUi(entryKey: string): FilesUiState {
  const all = store.get('filesUi') ?? {}
  const stored = all[entryKey]
  return {
    ...DEFAULT_FILES_UI,
    ...pickKnownKeys(DEFAULT_FILES_UI, stored)
  }
}

export function setFilesUi(entryKey: string, patch: Partial<FilesUiState>): FilesUiState {
  const merged = { ...getFilesUi(entryKey), ...patch }
  store.set('filesUi', { ...(store.get('filesUi') ?? {}), [entryKey]: merged })
  return merged
}

/** 项目或服务器移除时清掉 Files UI，避免残留。 */
export function deleteFilesUi(entryKey: string): void {
  const all = { ...(store.get('filesUi') ?? {}) }
  delete all[entryKey]
  store.set('filesUi', all)
}

function normalizeWorkspaceUi(raw: Partial<WorkspaceUiState> | undefined): WorkspaceUiState {
  const migrated = migrateLegacyWorkspaceUi(raw as Record<string, unknown> | undefined) as
    Partial<WorkspaceUiState> | undefined
  const base = { ...DEFAULT_WORKSPACE_UI, ...pickKnownKeys(DEFAULT_WORKSPACE_UI, migrated) }
  return {
    currentEntryKey: typeof base.currentEntryKey === 'string' ? base.currentEntryKey : null,
    selectedKey: typeof base.selectedKey === 'string' ? base.selectedKey : null,
    activeTabByEntry:
      base.activeTabByEntry && typeof base.activeTabByEntry === 'object'
        ? { ...base.activeTabByEntry }
        : {},
    terminalsByEntry:
      base.terminalsByEntry && typeof base.terminalsByEntry === 'object'
        ? { ...base.terminalsByEntry }
        : {}
  }
}

export function getWorkspaceUi(): WorkspaceUiState {
  return normalizeWorkspaceUi(store.get('workspaceUi'))
}

export function setWorkspaceUi(state: WorkspaceUiState): WorkspaceUiState {
  const normalized = normalizeWorkspaceUi(state)
  store.set('workspaceUi', normalized)
  return normalized
}

/** 条目（Project / Server）移除时清掉它的激活 Tab / 终端壳；若当前条目或选中落在它上面则清空。 */
export function deleteWorkspaceUiForEntry(entryKey: string): void {
  const cur = getWorkspaceUi()
  const activeTabByEntry = { ...cur.activeTabByEntry }
  delete activeTabByEntry[entryKey]
  const terminalsByEntry = { ...cur.terminalsByEntry }
  delete terminalsByEntry[entryKey]
  const clearCurrent = cur.currentEntryKey === entryKey
  setWorkspaceUi({
    currentEntryKey: clearCurrent ? null : cur.currentEntryKey,
    selectedKey: clearCurrent ? null : cur.selectedKey,
    activeTabByEntry,
    terminalsByEntry
  })
}

/** 服务器移除时清掉各条目（含 Project）下连到它的 SSH Terminal 壳。 */
export function deleteSshShellsForServer(serverId: string): void {
  const cur = getWorkspaceUi()
  const terminalsByEntry: Record<string, TerminalShell[]> = {}
  for (const [entryKey, shells] of Object.entries(cur.terminalsByEntry)) {
    terminalsByEntry[entryKey] = shells.filter((s) => s.serverId !== serverId)
  }
  setWorkspaceUi({ ...cur, terminalsByEntry })
}
