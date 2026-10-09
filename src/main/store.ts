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
import { normalizeCompressOptions } from '../shared/compress'
import type { Server } from '../shared/server'
import type { DataSource } from '../shared/data-source'
import type { SavedConsoleContext } from '../shared/data-source-context'
import {
  DEFAULT_DATA_SOURCE_TAB_UI,
  type DataSourceOpened,
  type DataSourceTabUi
} from '../shared/data-source-ui'
import { isPageSize, type CompletionUsage } from '../shared/data-source-query'
import type { RunParams } from '../shared/run-params'
import type { TerminalShell, WorkspaceUiState } from '../shared/workspace'
import { DEFAULT_WORKSPACE_UI, migrateLegacyWorkspaceUi } from '../shared/workspace'
import { normalizePanelSizes, type PanelSizes } from '../shared/panel-sizes'
import {
  normalizeWindowPlacements,
  type WindowPlacement,
  type WindowPlacementKey
} from '../shared/window-placement'
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
      keyPassphrases: {},
      dataSources: [],
      dataSourceSecrets: {},
      dataSourceConsoles: {},
      dataSourceTabUi: {},
      dataSourceConsoleContexts: {},
      dataSourceRecents: {},
      dataSourceCompletionUsage: {},
      configs: [],
      runParams: {},
      gitSettings: {},
      gitViewPrefs: DEFAULT_GIT_VIEW_PREFS,
      projectSortPrefs: DEFAULT_PROJECT_SORT_PREFS,
      appPrefs: DEFAULT_APP_PREFS,
      filesUi: {},
      workspaceUi: DEFAULT_WORKSPACE_UI,
      windowPlacements: {},
      panelSizes: {}
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

/** 记住的密文（safeStorage 输出的 base64）存在哪一份：服务器密码、私钥口令、数据源密码。 */
type SecretField = 'serverSecrets' | 'keyPassphrases' | 'dataSourceSecrets'

/** 按键（id、路径或 Tab 键）一项记一条的字段。 */
type KeyedField =
  | SecretField
  | 'dataSourceConsoles'
  | 'dataSourceTabUi'
  | 'dataSourceConsoleContexts'
  | 'dataSourceRecents'
  | 'dataSourceCompletionUsage'
  | 'runParams'
  | 'gitSettings'
  | 'filesUi'

/** 按键删掉字段里的几条；一条都没有时不写盘。 */
function deleteEntries(field: KeyedField, keys: readonly string[]): void {
  const all = { ...store.get(field) }
  if (!keys.some((key) => Object.hasOwn(all, key))) return
  for (const key of keys) delete all[key]
  store.set(field, all)
}

function getSecretIn(field: SecretField, key: string): string | null {
  return store.get(field)[key] ?? null
}

/** 记下或删掉（secret 为 null）一条密文。 */
function setSecretIn(field: SecretField, key: string, secret: string | null): void {
  if (secret === null) deleteEntries(field, [key])
  else store.set(field, { ...store.get(field), [key]: secret })
}

/** 记住的密码密文（safeStorage 输出的 base64）；没有返回 null。 */
export function getServerSecret(serverId: string): string | null {
  return getSecretIn('serverSecrets', serverId)
}

export function setServerSecret(serverId: string, secret: string | null): void {
  setSecretIn('serverSecrets', serverId, secret)
}

/** 记住的私钥口令密文（同 getServerSecret）；键为私钥文件的绝对路径。 */
export function getKeyPassphraseSecret(file: string): string | null {
  return getSecretIn('keyPassphrases', file)
}

export function setKeyPassphraseSecret(file: string, secret: string | null): void {
  setSecretIn('keyPassphrases', file, secret)
}

export function getDataSources(): DataSource[] {
  return store.get('dataSources')
}

export function setDataSources(dataSources: DataSource[]): void {
  store.set('dataSources', dataSources)
}

/** 记住的数据源密码密文（同 getServerSecret）；没有返回 null。 */
export function getDataSourceSecret(dataSourceId: string): string | null {
  return getSecretIn('dataSourceSecrets', dataSourceId)
}

export function setDataSourceSecret(dataSourceId: string, secret: string | null): void {
  setSecretIn('dataSourceSecrets', dataSourceId, secret)
}

/**
 * 已删掉另存内容的 Data Source Tab 键（Tab 关闭、所在项目或数据源移除）：之后对它们的写入一律忽略。主进程先删内容，
 * 渲染端随后才卸载控制台，卸载时会把防抖中还没写盘的内容写掉（见 useConsoleText），不拦下就留下一条没人用的记录。
 * Tab 键不会复用（另开的是 uuid，常驻的随数据源 id，也是 uuid），只记在内存里即可：重启后不再有写它们的 Tab。
 */
const deletedTabKeys = new Set<string>()

/** 某个 Data Source Tab 控制台里写的内容；没写过为空串。 */
export function getDataSourceConsole(tabKey: string): string {
  return store.get('dataSourceConsoles')[tabKey] ?? ''
}

export function setDataSourceConsole(tabKey: string, text: string): void {
  if (deletedTabKeys.has(tabKey)) return
  if (text === '') deleteEntries('dataSourceConsoles', [tabKey])
  else store.set('dataSourceConsoles', { ...store.get('dataSourceConsoles'), [tabKey]: text })
}

/** 某个 Data Source Tab 记住的界面状态（停在哪一格、上次打开的、目录的展开）；没记过为默认。 */
export function getDataSourceTabUi(tabKey: string): DataSourceTabUi {
  return {
    ...DEFAULT_DATA_SOURCE_TAB_UI,
    ...pickKnownKeys(DEFAULT_DATA_SOURCE_TAB_UI, store.get('dataSourceTabUi')[tabKey])
  }
}

export function setDataSourceTabUi(tabKey: string, patch: Partial<DataSourceTabUi>): void {
  if (deletedTabKeys.has(tabKey)) return
  const merged = { ...getDataSourceTabUi(tabKey), ...patch }
  store.set('dataSourceTabUi', { ...store.get('dataSourceTabUi'), [tabKey]: merged })
}

/** 某个 Data Source Tab 记住的控制台上下文（在哪个库上执行，见 shared/data-source-context）；没记过为 null。 */
export function getSavedConsoleContext(tabKey: string): SavedConsoleContext | null {
  return store.get('dataSourceConsoleContexts')[tabKey] ?? null
}

/** 记下（context 为 null 即删掉）Tab 的控制台上下文；已删掉的 Tab 的写入不再收。 */
export function setSavedConsoleContext(tabKey: string, context: SavedConsoleContext | null): void {
  if (deletedTabKeys.has(tabKey)) return
  if (context === null) {
    deleteEntries('dataSourceConsoleContexts', [tabKey])
  } else {
    store.set('dataSourceConsoleContexts', {
      ...store.get('dataSourceConsoleContexts'),
      [tabKey]: context
    })
  }
}

/**
 * Tab 关闭、所在项目或数据源移除时删掉这些 Tab 另存的：控制台里写的内容、记住的界面状态与控制台上下文。此后不再收
 * 它们的写入。
 */
export function deleteDataSourceTabState(tabKeys: string[]): void {
  for (const key of tabKeys) deletedTabKeys.add(key)
  deleteEntries('dataSourceConsoles', tabKeys)
  deleteEntries('dataSourceTabUi', tabKeys)
  deleteEntries('dataSourceConsoleContexts', tabKeys)
}

/**
 * 数据源的连接信息被改（连到的可能已是别的库）时，忘掉这些 Tab 记住的位置：上次打开的对象或键、目录的展开与控制台
 * 上下文。停在哪一格与控制台里写的内容不动。
 */
export function forgetDataSourceTabPlaces(tabKeys: string[]): void {
  const ui = { ...store.get('dataSourceTabUi') }
  for (const key of tabKeys) {
    if (Object.hasOwn(ui, key)) ui[key] = { ...ui[key]!, opened: null, expanded: [] }
  }
  store.set('dataSourceTabUi', ui)
  deleteEntries('dataSourceConsoleContexts', tabKeys)
}

/** 某个数据源最近打开的对象或键（新→旧）；没有为空。 */
export function getDataSourceRecents(dataSourceId: string): DataSourceOpened[] {
  return store.get('dataSourceRecents')[dataSourceId] ?? []
}

export function setDataSourceRecents(dataSourceId: string, recents: DataSourceOpened[]): void {
  store.set('dataSourceRecents', { ...store.get('dataSourceRecents'), [dataSourceId]: recents })
}

/** 数据源移除时删掉它的最近打开。 */
export function deleteDataSourceRecents(dataSourceId: string): void {
  deleteEntries('dataSourceRecents', [dataSourceId])
}

/** 某个数据源补全的使用次数；没有为空。 */
export function getDataSourceCompletionUsage(dataSourceId: string): CompletionUsage {
  return store.get('dataSourceCompletionUsage')[dataSourceId] ?? { keywords: {}, names: {} }
}

export function setDataSourceCompletionUsage(dataSourceId: string, usage: CompletionUsage): void {
  store.set('dataSourceCompletionUsage', {
    ...store.get('dataSourceCompletionUsage'),
    [dataSourceId]: usage
  })
}

/** 数据源移除时删掉它补全的使用次数。 */
export function deleteDataSourceCompletionUsage(dataSourceId: string): void {
  deleteEntries('dataSourceCompletionUsage', [dataSourceId])
}

export function getConfigs(): RunConfig[] {
  return store.get('configs')
}

export function setConfigs(configs: RunConfig[]): void {
  store.set('configs', configs)
}

/** 命令型配置上次运行时填的参数值；没填过为空对象。 */
export function getRunParams(configId: string): RunParams {
  return store.get('runParams')[configId] ?? {}
}

/** 记下这次运行填的参数值（整份替换：只留这次用到的参数）。 */
export function setRunParams(configId: string, params: RunParams): void {
  store.set('runParams', { ...store.get('runParams'), [configId]: params })
}

/** 配置被删掉（删除配置、移除它所在的条目）时删掉它记住的参数值。 */
export function deleteRunParams(configIds: string[]): void {
  deleteEntries('runParams', configIds)
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
  deleteEntries('gitSettings', [projectPath])
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

function normalizePageSize(value: unknown): number {
  return isPageSize(value) ? value : DEFAULT_APP_PREFS.dataPageSize
}

export function getAppPrefs(): AppPrefs {
  const stored = store.get('appPrefs')
  return {
    ...DEFAULT_APP_PREFS,
    ...pickKnownKeys(DEFAULT_APP_PREFS, stored),
    windowsShell: normalizeWindowsShell(stored?.windowsShell ?? DEFAULT_APP_PREFS.windowsShell),
    theme: normalizeTheme(stored?.theme ?? DEFAULT_APP_PREFS.theme),
    dataPageSize: normalizePageSize(stored?.dataPageSize),
    compressOptions: normalizeCompressOptions(stored?.compressOptions)
  }
}

export function setAppPrefs(patch: Partial<AppPrefs>): AppPrefs {
  const current = getAppPrefs()
  const merged: AppPrefs = {
    ...current,
    ...patch,
    windowsShell: normalizeWindowsShell(patch.windowsShell ?? current.windowsShell),
    theme: normalizeTheme(patch.theme ?? current.theme),
    dataPageSize: normalizePageSize(patch.dataPageSize ?? current.dataPageSize),
    compressOptions: normalizeCompressOptions(patch.compressOptions ?? current.compressOptions)
  }
  store.set('appPrefs', merged)
  return merged
}

export function getWindowPlacements(): Partial<Record<WindowPlacementKey, WindowPlacement>> {
  return normalizeWindowPlacements(store.get('windowPlacements'))
}

export function setWindowPlacements(
  placements: Partial<Record<WindowPlacementKey, WindowPlacement>>
): void {
  store.set('windowPlacements', placements)
}

export function getPanelSizes(): PanelSizes {
  return normalizePanelSizes(store.get('panelSizes'))
}

export function setPanelSizes(sizes: PanelSizes): void {
  store.set('panelSizes', sizes)
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
  deleteEntries('filesUi', [entryKey])
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

/** 条目（Project / Server / Data Source）移除时清掉它的激活 Tab / 终端壳；若当前条目或选中落在它上面则清空。 */
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

/** 清掉各条目（含 Project）下符合条件的终端组 Tab 壳（服务器移除时连到它的 SSH Terminal，数据源移除时连到它的 Data Source Tab）。 */
export function deleteTerminalShells(match: (shell: TerminalShell) => boolean): void {
  const cur = getWorkspaceUi()
  const terminalsByEntry: Record<string, TerminalShell[]> = {}
  for (const [entryKey, shells] of Object.entries(cur.terminalsByEntry)) {
    terminalsByEntry[entryKey] = shells.filter((s) => !match(s))
  }
  setWorkspaceUi({ ...cur, terminalsByEntry })
}
