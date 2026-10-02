import { create } from 'zustand'
import type {
  AppPrefs,
  DiscoverSource,
  EditableRunConfig,
  EditableRunConfigInput,
  ProjectAddResult,
  ProjectCloneResult,
  ProjectNode,
  ProjectSortPrefs,
  RunConfig,
  RunTarget,
  SessionState,
  SessionStatus,
  TreeSnapshot
} from '@shared/types'
import { DEFAULT_APP_PREFS, DEFAULT_PROJECT_SORT_PREFS } from '@shared/types'
import type { GitCloneInput } from '@shared/git-clone'
import type {
  DataSourceConnectPassword,
  DataSourceInput,
  DataSourceNode
} from '@shared/data-source'
import { runConfigParamNames, type RunParams } from '@shared/run-params'
import { serverConnectionChanged, type ServerInput, type ServerNode } from '@shared/server'
import type { SshPromptRequest, SshPromptResponse } from '@shared/ssh-connect'
import type { TransferConflictRequest, TransferConflictResponse } from '@shared/server-files'
import type { ThemeMode } from '@shared/theme'
import {
  configKey,
  filesTabKey,
  gitTabKey,
  isResidentTabKey,
  newDataSourceTabKey,
  residentDataSourceTabKey,
  statusTabKey
} from '@shared/runnable'
import { cycleProjectSort } from '@shared/project-sort'
import {
  orderedTabKeysOf,
  resolveActiveTabKey,
  resolveNeighborAfterClose
} from '@shared/tab-activation'
import {
  configOwnerKey,
  dataSourceEntryKey,
  dataSourceIdOfEntryKey,
  entryKindOfKey,
  serverEntryKey,
  serverIdOfEntryKey,
  type TreeEntryKind
} from '@shared/tree-entry'
import { workspaceSliceFromBootstrap } from '@shared/renderer-bootstrap'
import {
  LOCAL_TERMINAL_NAME,
  nextTerminalName,
  renamedTerminalName,
  terminalsToShellsByEntry
} from '@shared/workspace'
import { dataSourceRunStatements } from '@renderer/lib/data-source-run'

/**
 * 首屏主题。主进程建窗前已按偏好把 nativeTheme.themeSource 钉死，页面加载时
 * prefers-color-scheme 即为正确值——CSS 与 JS 侧色源同源，不会不一致。
 */
function initialTheme(): ThemeMode {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    // vitest / 非 Electron 环境
    return 'dark'
  }
}

/**
 * 让 JS 侧色源跟随 prefers-color-scheme：主进程改 themeSource（任一窗口的设置弹窗都能改）后
 * 每个窗口的 CSS 即刻翻转，这里把 store.theme 也同步过去（CodeMirror / diff 面板等按 JS 取色）。
 */
export function syncThemeWithSystem(): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: light)')
  const sync = (): void => useApp.setState({ theme: mq.matches ? 'light' : 'dark' })
  mq.addEventListener('change', sync)
  return () => mq.removeEventListener('change', sync)
}

/** JS 侧读的应用偏好（自动获取开关、数据源表格每页行数）。 */
type JsAppPrefs = Pick<AppPrefs, 'gitAutoFetch' | 'dataPageSize'>

function jsAppPrefsOf(prefs: AppPrefs): JsAppPrefs {
  return { gitAutoFetch: prefs.gitAutoFetch, dataPageSize: prefs.dataPageSize }
}

/** 首帧的 JS 侧偏好：preload 快照同步带出（如 Git Tab 首次到前台即按真实设置决定是否 fetch）。 */
function initialJsAppPrefs(): JsAppPrefs {
  try {
    return jsAppPrefsOf(window.api.getBootstrap().appPrefs)
  } catch {
    // vitest / 非 Electron 环境
    return jsAppPrefsOf(DEFAULT_APP_PREFS)
  }
}

/** 任一窗口改了应用偏好，主进程推给全部窗口：把 JS 侧读的字段同步进本窗口 store。 */
export function syncAppPrefsAcrossWindows(): () => void {
  return window.api.onAppPrefsChanged((prefs) => useApp.setState(jsAppPrefsOf(prefs)))
}

function initialWorkspaceSlice(): ReturnType<typeof workspaceSliceFromBootstrap> {
  try {
    return workspaceSliceFromBootstrap(window.api.getBootstrap())
  } catch {
    // vitest / 非 Electron 环境
    return {
      tree: [],
      servers: [],
      dataSources: [],
      sessions: {},
      terminals: [],
      projectSortPrefs: DEFAULT_PROJECT_SORT_PREFS,
      currentEntryKey: null,
      selectedKey: null,
      activeTabByEntry: {}
    }
  }
}

/** 配置的新建 / 编辑对话框：config 缺省为新建，否则编辑它。 */
interface DialogState {
  /** 配置所属的左树条目（Project 路径、`server:<id>` 或 `datasource:<id>`） */
  ownerKey: string
  config?: EditableRunConfig
}

/** 连接类条目：Server 与 Data Source。两者的对话框、编辑与移除走同一套流程。 */
export type ConnectionEntryKind = Exclude<TreeEntryKind, 'project'>

/** 服务器或数据源的对话框：node 缺省为添加，否则编辑它。两者都是模态的，同一时刻只开一个。 */
export type ConnectionDialog =
  { kind: 'server'; node?: ServerNode } | { kind: 'dataSource'; node?: DataSourceNode }

/**
 * 终端组的一个 Tab 的渲染端状态：Tab 键 + 归属条目 + 可改的名字。
 * serverId 存在即 SSH Terminal，dataSourceId 存在即另开的 Data Source Tab，都缺省为本地 Terminal。
 */
export interface TerminalTab {
  key: string
  /** 所属左树条目（Project 路径、`server:<id>` 或 `datasource:<id>`） */
  ownerKey: string
  name: string
  serverId?: string
  dataSourceId?: string
}

/** 运行会话 Tab：一条有会话（运行中/已退出未关闭）的配置。顺序跟随树中配置顺序。 */
export interface RunTabInfo {
  key: string
  label: string
  status: SessionStatus
}

/** 连接对象改名：连到它的 Tab 的默认名跟着改（序号保留；用户改过的 Tab 名不动）。 */
function renameTabsOf(
  terminals: TerminalTab[],
  belongs: (t: TerminalTab) => boolean,
  before: string | undefined,
  after: string | undefined
): TerminalTab[] {
  if (before === undefined || after === undefined || before === after) return terminals
  return terminals.map((t) => {
    const renamed = belongs(t) ? renamedTerminalName(t.name, before, after) : null
    return renamed === null ? t : { ...t, name: renamed }
  })
}

function persistWorkspace(get: () => AppState): void {
  const s = get()
  void window.api.setWorkspaceUi({
    currentEntryKey: s.currentEntryKey,
    selectedKey: s.selectedKey,
    activeTabByEntry: s.activeTabByEntry,
    terminalsByEntry: terminalsToShellsByEntry(s.terminals)
  })
}

/**
 * 激活的终端壳若尚无会话，则用既有 id 建会话：本地 Terminal 拉起 shell；
 * SSH Terminal 只建会话、提示按回车连接（跨重启恢复的壳不自动连接）。Data Source Tab 没有会话，点「连接」才连。
 */
async function ensureTerminalSpawned(
  get: () => AppState,
  ownerKey: string,
  key: string | null
): Promise<void> {
  if (key === null || get().sessions[key]) return
  const tab = get().terminals.find((t) => t.key === key && t.ownerKey === ownerKey)
  if (!tab || tab.dataSourceId !== undefined) return
  if (tab.serverId === undefined) await window.api.openTerminal(ownerKey, key)
  else await window.api.openSshTerminal(ownerKey, tab.serverId, key)
}

/** 某条目「实际显示」的 Tab 解析结果（Console / cycleTab / 关闭快捷键共用同一规则，避免三处不一致）。 */
export interface ResolvedTabs {
  /**
   * 常驻非会话 Tab 的键，按 Tab 序（不可关闭）：Project 为 Git（`git:<path>`，ADR-0005）、
   * Files（`files:<path>`）；Server 为 Status（`status:server:<id>`）、Files（`files:server:<id>`）；
   * Data Source 为它的 Data Source Tab（`db:datasource:<id>`）
   */
  residentKeys: string[]
  /** 运行会话 Tab（树序）：每条有会话的配置一个 */
  runTabs: RunTabInfo[]
  /** 终端组的 Tab（Terminal、SSH Terminal 与另开的 Data Source Tab，组内可拖拽排序） */
  termTabs: TerminalTab[]
  /** 终端组排在运行会话之前（Data Source 条目）；否则运行会话在前 */
  termTabsFirst: boolean
  /** 当前激活的 Tab；每个条目都有常驻 Tab，解析结果不会是 null（类型沿用激活规则的返回） */
  activeKey: string | null
}

type TabState = Pick<
  AppState,
  'tree' | 'servers' | 'dataSources' | 'sessions' | 'terminals' | 'activeTabByEntry'
>

/** 某左树条目下的配置（Project 的，或 Server、Data Source 上的命令型），按用户排的顺序。 */
export function entryConfigs(
  s: Pick<AppState, 'tree' | 'servers' | 'dataSources'>,
  entryKey: string
): RunConfig[] {
  switch (entryKindOfKey(entryKey)) {
    case 'project':
      return s.tree.find((n) => n.project.path === entryKey)?.configs ?? []
    case 'server':
      return s.servers.find((n) => serverEntryKey(n.server.id) === entryKey)?.configs ?? []
    case 'dataSource':
      return (
        s.dataSources.find((n) => dataSourceEntryKey(n.dataSource.id) === entryKey)?.configs ?? []
      )
  }
}

/** 运行目标若是命令型配置即那条配置；其余目标（探测脚本、引用型、已不在的配置）为 undefined。 */
function editableConfigOf(
  s: Pick<AppState, 'tree' | 'servers' | 'dataSources'>,
  target: RunTarget,
  entryKey: string
): EditableRunConfig | undefined {
  if (target.type !== 'config') return undefined
  const config = entryConfigs(s, entryKey).find((c) => c.id === target.id)
  return config === undefined || config.kind === 'referenced' ? undefined : config
}

/**
 * 命令型配置交给主进程的运行目标。本机、服务器上的配置带上填的参数值，由主进程换进配置（ADR-0048）。数据源上的配置
 * 带上换好参数、按数据源当前类型切好的各条语句（Redis 为各行命令），以及运行会话正文的密码框交上来的密码（没出密码框
 * 时为 null）；数据源已不在时不带这些，由主进程说明无法运行。
 */
function runTargetOf(
  s: Pick<AppState, 'dataSources'>,
  config: EditableRunConfig,
  params: RunParams,
  password?: DataSourceConnectPassword
): RunTarget {
  if (config.kind !== 'dataSource') return { type: 'config', id: config.id, params }
  const node = s.dataSources.find((n) => n.dataSource.id === config.dataSourceId)
  if (node === undefined) return { type: 'config', id: config.id }
  return {
    type: 'config',
    id: config.id,
    dataSource: {
      statements: dataSourceRunStatements(node.dataSource.target.kind, config.script, params),
      password: password ?? null
    }
  }
}

/** 各类条目的常驻 Tab（按 Tab 序）。 */
function residentTabKeysOf(entryKey: string): string[] {
  switch (entryKindOfKey(entryKey)) {
    case 'project':
      return [gitTabKey(entryKey), filesTabKey(entryKey)]
    case 'server':
      return [statusTabKey(entryKey), filesTabKey(entryKey)]
    case 'dataSource':
      return [residentDataSourceTabKey(entryKey)]
  }
}

/**
 * 解析某条目的 Tab 栏与激活 Tab。
 * Tab 顺序 = 常驻 Tab（Project：Git → Files；Server：Status → Files；Data Source：它的 Data Source Tab）
 * → 运行会话（树序）→ 终端；Data Source 条目为常驻 Data Source Tab → 另开的 Data Source Tab → 运行会话（树序）。
 * 默认激活：有运行中的 Run Session → 第一个运行中的；否则 Tab 序首位（ADR-0005）。
 */
export function resolveTabs(s: TabState, entryKey: string): ResolvedTabs {
  const residentKeys = residentTabKeysOf(entryKey)
  const termTabsFirst = entryKindOfKey(entryKey) === 'dataSource'
  const runTabs: RunTabInfo[] = []
  for (const c of entryConfigs(s, entryKey)) {
    const key = configKey(c)
    const session = s.sessions[key]
    if (session) {
      runTabs.push({
        key,
        label: c.kind === 'referenced' ? c.scriptName : c.name,
        status: session.status
      })
    }
  }
  const termTabs = s.terminals.filter((t) => t.ownerKey === entryKey)
  const stored = s.activeTabByEntry[entryKey]
  const activeKey = resolveActiveTabKey({ residentKeys, runTabs, termTabs, termTabsFirst, stored })
  return { residentKeys, runTabs, termTabs, termTabsFirst, activeKey }
}

/** Tab 栏从左到右的键序（与 cycleTab / ⌘1–9 共用）。 */
export function orderedTabKeys(s: TabState, entryKey: string): string[] {
  return orderedTabKeysOf(resolveTabs(s, entryKey))
}

interface AppState {
  tree: ProjectNode[]
  servers: ServerNode[]
  dataSources: DataSourceNode[]
  sessions: Record<string, SessionState>
  /**
   * 选中的配置（驱动左树配置行蓝底高亮）；为 null 表示「选中的是条目本身」。
   * 树选择与 Tab 激活解耦：点 Tab 不改树选择，点树配置只在其有会话时聚焦对应 Tab。
   */
  selectedKey: string | null
  /** 右侧显示哪个左树条目（Project 路径、`server:<id>` 或 `datasource:<id>`）的 Tab 栏；null 时右侧为全局占位 */
  currentEntryKey: string | null
  /** 各条目的终端 Tab（跨条目扁平存放，按条目过滤后渲染各自 Tab 栏） */
  terminals: TerminalTab[]
  /** 每条目激活的 Tab：运行会话键 / 终端键；null = 占位；缺省 = 回落首 Tab（见 resolveTabs） */
  activeTabByEntry: Record<string, string | null>
  /** 每会话的运行序号：重跑 +1，驱动对应运行面板清屏回填与聚焦（面板只订阅自己的键） */
  runNonce: Record<string, number>
  /** 配置的对话框；null 为没开 */
  dialog: DialogState | null
  /** 服务器或数据源的对话框；null 为没开 */
  connectionDialog: ConnectionDialog | null
  /** 等用户回答的 SSH 提问（先到先答，一次只弹一个） */
  sshPromptQueue: SshPromptRequest[]
  /** 等用户回答的传输同名询问（先到先答，一次只弹一个） */
  transferConflictQueue: TransferConflictRequest[]
  /**
   * 服务器上有未保存修改的文件：服务器 id → 文件名与保存动作（服务器上的文件手动保存，由其 Files 面板登记，
   * 见 docs/prd/server-files.md）。断开、编辑（连接信息变了才断开）或移除服务器前据此先问
   */
  unsavedServerFiles: Record<string, UnsavedServerFile>
  /** 等用户选「保存 / 不保存 / 取消」的未保存提示（同一时刻一个） */
  unsavedPrompt: { name: string; resolve: (choice: UnsavedChoice) => void } | null
  /** 等用户填的运行参数（命令型配置有参数时，运行前弹参数框；同一时刻一个） */
  runParamsPrompt: RunParamsPrompt | null
  /** 左树排序偏好（落盘） */
  projectSortPrefs: ProjectSortPrefs
  /**
   * 应用主题（落盘）。CSS 全部走 prefers-color-scheme，无需读这里；此值供吃不了 CSS 变量的
   * 四处 JS 侧色源使用：xterm 调色板、终端搜索装饰、CodeMirror 主题与语法高亮、
   * diff 面板的 data-theme。
   */
  theme: ThemeMode
  /** 自动获取远程更新（落盘）：Git Tab 到前台与定时刷新是否 fetch */
  gitAutoFetch: boolean
  /** 数据源表格每页行数（落盘，所有 Data Source Tab 共用） */
  dataPageSize: number
  /** 左树名称搜索（纯内存） */
  projectFilter: string
  /** +1 驱动左树聚焦筛选框（⌥⌘P / Ctrl+Alt+P） */
  projectFilterFocusNonce: number
  /** 添加条目后待滚入视口的条目键；滚完即清 */
  scrollToEntryKey: string | null
  /** 内容搜索面板开关（⌘⇧F / Ctrl+Shift+F；作用于当前项目） */
  contentSearchOpen: boolean
  /** 「从 Git 仓库克隆」对话框开关（同一时刻只允许一个克隆，故对话框亦单例） */
  cloneDialogOpen: boolean
  setTree: (tree: ProjectNode[]) => void
  setServers: (servers: ServerNode[]) => void
  setDataSources: (dataSources: DataSourceNode[]) => void
  setSession: (s: SessionState) => void
  /** 会话被销毁（关 Tab / shell 退出 / 删除配置或条目 / 对账）：清状态、删终端 Tab、修激活 Tab */
  handleSessionRemoved: (key: string) => void
  /** 选中一条配置：有会话则聚焦其 Tab，没有则不动当前激活 Tab */
  select: (key: string, entryKey: string) => void
  /** 选中一条探测脚本：立即晋升为引用型配置进入「我的配置」（不必等运行），并按普通配置选中 */
  selectScript: (
    projectPath: string,
    source: DiscoverSource,
    name: string,
    key: string
  ) => Promise<void>
  /** 选中左树条目本身（点项目、服务器或数据源行）：切当前条目，保持该条目原激活 Tab */
  selectEntry: (entryKey: string) => void
  /** 激活一个 Tab（运行会话或终端通用）；不动树选择 */
  activateTab: (entryKey: string, key: string) => void
  /** 关闭一个 Tab（运行中则温和停止）；实际移除由 sessionRemoved 事件统一回流 */
  closeTab: (key: string) => Promise<void>
  init: () => Promise<void>
  addProject: () => Promise<void>
  addProjectByPath: (path: string) => Promise<void>
  /** External Open：主进程已登记，选中并滚入视口（收尾同 addProjectByPath） */
  openExternalProject: (focusPath: string) => Promise<void>
  createProject: () => Promise<void>
  /** 克隆仓库并登记；成功后收尾同 addProjectByPath。终局原样返回给对话框展示 */
  cloneProject: (input: GitCloneInput) => Promise<ProjectCloneResult>
  removeProject: (path: string) => Promise<void>
  /** 重排左树条目（Project、Server 与 Data Source 混排的自定义序落盘） */
  reorderEntries: (orderedKeys: string[]) => Promise<void>
  /** 设置左树条目的 Pin */
  setEntryPinned: (entryKey: string, pinned: boolean) => Promise<void>
  /** 点选排序方式：同项翻转方向，换项取默认方向 */
  cycleSortMode: (mode: ProjectSortPrefs['mode']) => Promise<void>
  /** 排序偏好里的开关（固定置顶、按类型显示） */
  setSortPrefs: (
    patch: Partial<
      Pick<ProjectSortPrefs, 'pinSticky' | 'showProjects' | 'showServers' | 'showDataSources'>
    >
  ) => Promise<void>
  /** 切换主题：本地即时生效，主进程随后同步 themeSource 与窗口色（CSS 由此翻） */
  setTheme: (theme: ThemeMode) => Promise<void>
  /** 开关自动获取：本地即时生效并落盘 */
  setGitAutoFetch: (enabled: boolean) => Promise<void>
  /** 改数据源表格每页行数：本地即时生效并落盘 */
  setDataPageSize: (size: number) => Promise<void>
  setProjectFilter: (query: string) => void
  /** 聚焦左树筛选框 */
  focusProjectFilter: () => void
  setContentSearchOpen: (open: boolean) => void
  setCloneDialogOpen: (open: boolean) => void
  clearScrollToEntryKey: () => void
  /**
   * 运行（运行、重跑都经这里）：命令型配置有参数时先弹参数框，取消即不运行。password：数据源上的配置等密码时，
   * 运行会话正文的密码框交上来的（带着它重跑）；这时取消参数框即停止这次运行
   */
  run: (
    target: RunTarget,
    key: string,
    entryKey: string,
    password?: DataSourceConnectPassword
  ) => Promise<void>
  stop: (key: string) => Promise<void>
  /** 清空某运行会话的控制台输出（进程继续；+1 runNonce 驱动面板清屏回填） */
  clearOutput: (key: string) => Promise<void>
  /** 新建终端并聚焦；返回其会话键（供 Git 交互式 rebase 等向其写入命令） */
  /** cwd 缺省为项目根；Files 树「在终端中打开」传项目内目录 */
  newTerminal: (projectPath: string, cwd?: string) => Promise<string>
  /** 在 Project 或 Server 条目下新建一个连到 serverId 的 SSH Terminal 并立即连接（Data Source 条目下不开终端） */
  /** cwd：登录后进入服务器上的这个目录（Files Tab「在 SSH 终端中打开」；不随壳持久化） */
  newSshTerminal: (ownerKey: string, serverId: string, cwd?: string) => Promise<void>
  renameTerminal: (key: string, name: string) => void
  /** 重排某条目终端 Tab 的顺序（落盘） */
  reorderTerminals: (ownerKey: string, orderedKeys: string[]) => void
  /** 在 Project、Server 或 Data Source 条目下新建命令型配置 */
  openCreateDialog: (ownerKey: string) => void
  openEditDialog: (config: EditableRunConfig) => void
  closeDialog: () => void
  saveCommandConfig: (input: EditableRunConfigInput, id?: string) => Promise<void>
  deleteConfig: (id: string) => Promise<void>
  reorderConfigs: (ownerKey: string, orderedIds: string[]) => Promise<void>
  /** 打开服务器或数据源的对话框（添加，或编辑其中的 node） */
  openConnectionDialog: (dialog: ConnectionDialog) => void
  closeConnectionDialog: () => void
  /** 登记服务器（每项都新增一台，连接目标与已登记的重复也照样登记）并选中新登记的第一台 */
  addServers: (inputs: ServerInput[]) => Promise<void>
  updateServer: (id: string, input: ServerInput) => Promise<void>
  removeServer: (id: string) => Promise<void>
  /** 登记数据源（总是新增一个，连接目标与已登记的重复也照样登记）并选中它 */
  addDataSource: (input: DataSourceInput) => Promise<void>
  updateDataSource: (id: string, input: DataSourceInput) => Promise<void>
  /** 记下数据源显示的库（目录根行的勾选，它的各个 Tab 一样） */
  setDataSourceShownDatabases: (id: string, databases: string[]) => Promise<void>
  removeDataSource: (id: string) => Promise<void>
  /** 在 Project 或 Data Source 条目下另开一个连到 dataSourceId 的 Data Source Tab，聚焦并立即连接 */
  newDataSourceTab: (ownerKey: string, dataSourceId: string) => void
  enqueueSshPrompt: (request: SshPromptRequest) => void
  dismissSshPrompt: (id: string) => void
  answerSshPrompt: (response: SshPromptResponse) => void
  enqueueTransferConflict: (request: TransferConflictRequest) => void
  dismissTransferConflict: (id: string) => void
  answerTransferConflict: (response: TransferConflictResponse) => void
  /** Files 面板登记 / 撤销某台服务器上未保存的文件（null = 已保存或已关闭） */
  setUnsavedServerFile: (serverId: string, file: UnsavedServerFile | null) => void
  /** 弹「保存 / 不保存 / 取消」，等用户选 */
  askUnsaved: (name: string) => Promise<UnsavedChoice>
  /** 某台服务器上有未保存的文件就先问：保存（存成才继续）/ 不保存（继续）/ 取消（不继续）；返回是否继续 */
  resolveServerUnsaved: (serverId: string) => Promise<boolean>
}

/** 未保存提示的选择。 */
export type UnsavedChoice = 'save' | 'discard' | 'cancel'

/** 命令型配置运行前的参数框：每个参数一行，预填这条配置上次用的值。 */
export interface RunParamsPrompt {
  configId: string
  /** 配置名（提示语里用） */
  configName: string
  /** 参数名：去重，按第一次出现的顺序 */
  names: string[]
  /** 预填的值：这条配置上次运行时填的（没填过的参数为空） */
  initial: RunParams
  /** 填好了交上各参数的值；取消为 null */
  resolve: (params: RunParams | null) => void
}

/** 服务器上一个有未保存修改的文件：名字用于提示，save 存成返回 true。 */
export interface UnsavedServerFile {
  name: string
  save: () => Promise<boolean>
}

/** 记一次打开：更新该条目的 lastOpenedAt，并回写它所在的列表。 */
async function touchEntry(
  set: (partial: Partial<AppState>) => void,
  entryKey: string
): Promise<void> {
  const serverId = serverIdOfEntryKey(entryKey)
  const dataSourceId = dataSourceIdOfEntryKey(entryKey)
  if (serverId !== null) {
    set({ servers: await window.api.touchServer(serverId) })
  } else if (dataSourceId !== null) {
    set({ dataSources: await window.api.touchDataSource(dataSourceId) })
  } else {
    set({ tree: await window.api.touchProject(entryKey) })
  }
}

/**
 * 切到某条目并滚入视口（新登记 / 命中已登记 / External Open 的统一收尾）：
 * 等 touch 回写的列表里已有该条目，再请求滚动。
 */
async function focusEntry(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  entryKey: string
): Promise<void> {
  set({ selectedKey: null, currentEntryKey: entryKey })
  await touchEntry(set, entryKey)
  set({ scrollToEntryKey: entryKey })
  persistWorkspace(get)
  void ensureTerminalSpawned(get, entryKey, resolveTabs(get(), entryKey).activeKey)
}

/**
 * 登记项目后的统一收尾：有 focusPath（新建或已存在）则选中并滚入视口；
 * 取消 / 无效路径不动 store，避免无谓刷新把列表滚走。
 */
async function applyAddedProject(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  fetch: () => Promise<ProjectAddResult>
): Promise<void> {
  const { focusPath } = await fetch()
  if (!focusPath) return
  await focusEntry(set, get, focusPath)
}

/** 条目被移除后清掉指向它的当前条目、激活项与终端 Tab。 */
function forgetEntry(state: AppState, entryKey: string): Partial<AppState> {
  const activeTabByEntry = { ...state.activeTabByEntry }
  delete activeTabByEntry[entryKey]
  const clearCurrent = state.currentEntryKey === entryKey
  return {
    terminals: state.terminals.filter((t) => t.ownerKey !== entryKey),
    activeTabByEntry,
    currentEntryKey: clearCurrent ? null : state.currentEntryKey,
    selectedKey: clearCurrent ? null : state.selectedKey
  }
}

type SetApp = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void

/** 移除一个 Tab 所改动的状态。 */
type TabRemoval = Pick<AppState, 'sessions' | 'runNonce' | 'terminals' | 'activeTabByEntry'>

/**
 * 移除一个 Tab（会话被销毁；尚无会话的终端壳、Data Source Tab 被关掉或随所连的服务器、数据源移除）：清会话状态、
 * 删终端组 Tab；指向它的激活项按移除前的 Tab 顺序回落到左邻，其次右邻（不套用默认激活）。
 */
function withoutTab(state: AppState, key: string): TabRemoval {
  const sessions = { ...state.sessions }
  delete sessions[key]
  const runNonce = { ...state.runNonce }
  delete runNonce[key]
  const activeTabByEntry = { ...state.activeTabByEntry }
  for (const [entryKey, act] of Object.entries(activeTabByEntry)) {
    if (act !== key) continue
    activeTabByEntry[entryKey] = resolveNeighborAfterClose(orderedTabKeys(state, entryKey), key)
  }
  return {
    sessions,
    runNonce,
    terminals: state.terminals.filter((t) => t.key !== key),
    activeTabByEntry
  }
}

/**
 * 在某条目下新开一个终端组的 Tab 并切过去（本地 Terminal、SSH Terminal 与另开的 Data Source Tab 共用）：
 * 按同系列取默认名追加到组末、切到该条目并激活它、落盘；换了条目记一次打开时间。
 */
function openTerminalTab(
  set: SetApp,
  get: () => AppState,
  tab: Omit<TerminalTab, 'name'>,
  base: string
): void {
  const switched = get().currentEntryKey !== tab.ownerKey
  set((state) => ({
    terminals: [...state.terminals, { ...tab, name: nextTerminalName(state.terminals, tab, base) }],
    currentEntryKey: tab.ownerKey,
    activeTabByEntry: { ...state.activeTabByEntry, [tab.ownerKey]: tab.key }
  }))
  persistWorkspace(get)
  if (switched) void touchEntry(set, tab.ownerKey)
}

/** 编辑、移除服务器或数据源后主进程交回的最新列表。 */
type ConnectionList = Pick<AppState, 'servers'> | Pick<AppState, 'dataSources'>

function connectionEntryKey(kind: ConnectionEntryKind, id: string): string {
  return kind === 'server' ? serverEntryKey(id) : dataSourceEntryKey(id)
}

function connectionName(
  s: Pick<AppState, 'servers' | 'dataSources'>,
  kind: ConnectionEntryKind,
  id: string
): string | undefined {
  return kind === 'server'
    ? s.servers.find((n) => n.server.id === id)?.server.name
    : s.dataSources.find((n) => n.dataSource.id === id)?.dataSource.name
}

/** 连到某台服务器的 SSH Terminal、连到某个数据源的另开的 Data Source Tab（含开在别的条目里的）。 */
function connectedTo(kind: ConnectionEntryKind, id: string): (t: TerminalTab) => boolean {
  return kind === 'server' ? (t) => t.serverId === id : (t) => t.dataSourceId === id
}

/**
 * 编辑服务器或数据源：保存后换上新列表、关掉对话框；改了名，连到它的 Tab 的默认名跟着改（序号保留；用户改过的
 * Tab 名不动）。旧名在请求前取：等待期间可能收到列表推送，那时 store 里已是新名。
 */
async function saveConnectionEdit(
  set: SetApp,
  get: () => AppState,
  kind: ConnectionEntryKind,
  id: string,
  save: () => Promise<ConnectionList>
): Promise<void> {
  const before = connectionName(get(), kind, id)
  const list = await save()
  const after = connectionName({ ...get(), ...list }, kind, id)
  set((state) => ({
    ...list,
    connectionDialog: null,
    terminals: renameTabsOf(state.terminals, connectedTo(kind, id), before, after)
  }))
  persistWorkspace(get)
}

/**
 * 移除服务器或数据源：换上新列表；连到它的 Tab（含开在别的条目里的）逐个照关 Tab 的规则移除（激活的回落到左邻），
 * 再忘掉它的条目。有会话的 SSH Terminal 已由主进程销毁（逐个 sessionRemoved，走同一条规则），这里清的是尚无会话的
 * 壳与 Data Source Tab（连接已由主进程断开）。
 */
async function removeConnection(
  set: SetApp,
  get: () => AppState,
  kind: ConnectionEntryKind,
  id: string,
  remove: () => Promise<ConnectionList>
): Promise<void> {
  const list = await remove()
  set((state) => {
    const rest = state.terminals
      .filter(connectedTo(kind, id))
      .reduce<AppState>((s, t) => ({ ...s, ...withoutTab(s, t.key) }), state)
    return {
      ...list,
      sessions: rest.sessions,
      runNonce: rest.runNonce,
      ...forgetEntry(rest, connectionEntryKey(kind, id))
    }
  })
  persistWorkspace(get)
}

/**
 * 命令型配置有参数，运行前先问：弹参数框，交上来即记下（按配置记，跨重启保留）；取消为 null。
 * 数据源上的配置等密码时，密码框交上来的重跑是同一次运行的继续：刚填的值都还在就沿用，不再问。
 */
async function askRunParams(
  set: SetApp,
  get: () => AppState,
  config: EditableRunConfig,
  names: string[],
  password: DataSourceConnectPassword | undefined
): Promise<RunParams | null> {
  const last = await window.api.getRunParams(config.id)
  if (password !== undefined && names.every((name) => Object.hasOwn(last, name))) return last
  // 同一时刻只问一次：还有没答的就当取消
  get().runParamsPrompt?.resolve(null)
  const params = await new Promise<RunParams | null>((resolve) =>
    set({
      runParamsPrompt: {
        configId: config.id,
        configName: config.name,
        names,
        initial: last,
        resolve: (answer) => {
          set({ runParamsPrompt: null })
          resolve(answer)
        }
      }
    })
  )
  if (params !== null) await window.api.setRunParams(config.id, params)
  return params
}

export const useApp = create<AppState>((set, get) => ({
  ...initialWorkspaceSlice(),
  theme: initialTheme(),
  ...initialJsAppPrefs(),
  runNonce: {},
  dialog: null,
  connectionDialog: null,
  sshPromptQueue: [],
  transferConflictQueue: [],
  unsavedServerFiles: {},
  unsavedPrompt: null,
  runParamsPrompt: null,
  projectFilter: '',
  projectFilterFocusNonce: 0,
  scrollToEntryKey: null,
  contentSearchOpen: false,
  cloneDialogOpen: false,
  setTree: (tree) => set({ tree }),
  setServers: (servers) => set({ servers }),
  setDataSources: (dataSources) => set({ dataSources }),
  setSession: (s) => set((state) => ({ sessions: { ...state.sessions, [s.key]: s } })),
  handleSessionRemoved: (key) => {
    set((state) => withoutTab(state, key))
    persistWorkspace(get)
  },
  // 选中配置：有会话 → 聚焦其 Tab；没跑过 → 不动当前激活 Tab（正在看的内容保持原样）。
  // 切到另一条目时记一次打开时间。
  select: (key, entryKey) => {
    const switched = get().currentEntryKey !== entryKey
    set((state) => ({
      selectedKey: key,
      currentEntryKey: entryKey,
      activeTabByEntry: state.sessions[key]
        ? { ...state.activeTabByEntry, [entryKey]: key }
        : state.activeTabByEntry
    }))
    persistWorkspace(get)
    if (switched) {
      void touchEntry(set, entryKey)
      void ensureTerminalSpawned(get, entryKey, resolveTabs(get(), entryKey).activeKey)
    }
  },
  // 选中探测脚本：先按普通配置选中（同步高亮），再晋升入列（引用型与脚本共用同一键，选中态无缝延续）。
  selectScript: async (projectPath, source, name, key) => {
    get().select(key, projectPath)
    set({ tree: await window.api.promoteScript(projectPath, source, name) })
  },
  // 选中条目本身：只切当前条目，保持该条目原激活 Tab；并记录打开时间。
  selectEntry: (entryKey) => {
    set({ selectedKey: null, currentEntryKey: entryKey })
    persistWorkspace(get)
    void touchEntry(set, entryKey)
    void ensureTerminalSpawned(get, entryKey, resolveTabs(get(), entryKey).activeKey)
  },
  activateTab: (entryKey, key) => {
    const switched = get().currentEntryKey !== entryKey
    set((state) => ({
      currentEntryKey: entryKey,
      activeTabByEntry: { ...state.activeTabByEntry, [entryKey]: key }
    }))
    persistWorkspace(get)
    if (switched) void touchEntry(set, entryKey)
    void ensureTerminalSpawned(get, entryKey, key)
  },
  // 关闭仅发请求；实际移除由 main 的 sessionRemoved 事件统一走 handleSessionRemoved。
  // 常驻非会话 Tab（Git / Files / Status / 数据源条目的 Data Source Tab）不可关闭。尚无会话的终端壳主进程无会话，本地移除并落盘；
  // Data Source Tab 没有会话，另让主进程断开它的连接。
  closeTab: async (key) => {
    if (isResidentTabKey(key)) return
    const tab = get().terminals.find((t) => t.key === key)
    if (tab && !get().sessions[key]) {
      if (tab.dataSourceId !== undefined) void window.api.closeDataSourceTab(key)
      get().handleSessionRemoved(key)
      return
    }
    return window.api.closeSession(key)
  },
  // 首屏已由 preload bootstrap 灌入；此处只做打开对账（touch / 懒 spawn）。HMR 时再拉一遍快照。
  init: async () => {
    if (import.meta.env.DEV) {
      const [
        tree,
        servers,
        dataSources,
        sessions,
        terminals,
        projectSortPrefs,
        workspace,
        appPrefs
      ] = await Promise.all([
        window.api.getTree(),
        window.api.getServers(),
        window.api.getDataSources(),
        window.api.getSessions(),
        window.api.getTerminals(),
        window.api.getProjectSortPrefs(),
        window.api.getWorkspaceUi(),
        window.api.getAppPrefs()
      ])
      set({
        ...workspaceSliceFromBootstrap({
          tree,
          servers,
          dataSources,
          sessions,
          terminals,
          projectSortPrefs,
          workspace
        }),
        ...jsAppPrefsOf(appPrefs)
      })
    }
    const currentEntryKey = get().currentEntryKey
    if (currentEntryKey) {
      await touchEntry(set, currentEntryKey)
      await ensureTerminalSpawned(
        get,
        currentEntryKey,
        resolveTabs(get(), currentEntryKey).activeKey
      )
    }
    persistWorkspace(get)
  },
  // 添加成功或命中已有项目：选中并滚入视口；取消 / 无效路径则只刷新树。
  addProject: async () => {
    await applyAddedProject(set, get, () => window.api.addProject())
  },
  addProjectByPath: async (path) => {
    await applyAddedProject(set, get, () => window.api.addProjectByPath(path))
  },
  // External Open：main 已登记并对齐 watcher，这里只走同一套选中收尾（树经 touchProject 重拉）。
  openExternalProject: async (focusPath) => {
    await applyAddedProject(set, get, async () => ({ tree: get().tree, focusPath }))
  },
  createProject: async () => {
    await applyAddedProject(set, get, () => window.api.createProject())
  },
  cloneProject: async (input) => {
    const result = await window.api.cloneProject(input)
    if (result.status === 'ok') {
      await applyAddedProject(set, get, async () => ({
        tree: result.tree,
        focusPath: result.focusPath
      }))
    }
    return result
  },
  removeProject: async (path) => {
    const tree = await window.api.removeProject(path)
    // 该项目的会话/终端已由 main 销毁（逐个 sessionRemoved）；这里清掉指向它的当前条目与激活项。
    set((state) => ({ tree, ...forgetEntry(state, path) }))
    persistWorkspace(get)
  },
  reorderEntries: async (orderedKeys) => {
    // 乐观更新：松手即本地按新序改写 order，避免等 IPC 回跳。
    const rank = new Map(orderedKeys.map((key, i) => [key, i]))
    set((state) => ({
      tree: state.tree.map((n) => ({
        ...n,
        project: { ...n.project, order: rank.get(n.project.path) ?? n.project.order }
      })),
      servers: state.servers.map((n) => ({
        ...n,
        server: { ...n.server, order: rank.get(serverEntryKey(n.server.id)) ?? n.server.order }
      })),
      dataSources: state.dataSources.map((n) => ({
        ...n,
        dataSource: {
          ...n.dataSource,
          order: rank.get(dataSourceEntryKey(n.dataSource.id)) ?? n.dataSource.order
        }
      }))
    }))
    const snapshot: TreeSnapshot = await window.api.reorderEntries(orderedKeys)
    set(snapshot)
  },
  setEntryPinned: async (entryKey, pinned) => {
    set(await window.api.setEntryPinned(entryKey, pinned))
  },
  cycleSortMode: async (mode) => {
    const next = cycleProjectSort(get().projectSortPrefs, mode)
    set({ projectSortPrefs: next })
    set({ projectSortPrefs: await window.api.setProjectSortPrefs(next) })
  },
  setSortPrefs: async (patch) => {
    set((state) => ({ projectSortPrefs: { ...state.projectSortPrefs, ...patch } }))
    set({ projectSortPrefs: await window.api.setProjectSortPrefs(patch) })
  },
  setTheme: async (theme) => {
    set({ theme })
    await window.api.setAppPrefs({ theme })
  },
  setGitAutoFetch: async (enabled) => {
    set({ gitAutoFetch: enabled })
    await window.api.setAppPrefs({ gitAutoFetch: enabled })
  },
  setDataPageSize: async (size) => {
    set({ dataPageSize: size })
    await window.api.setAppPrefs({ dataPageSize: size })
  },
  setProjectFilter: (query) => set({ projectFilter: query }),
  focusProjectFilter: () =>
    set((state) => ({ projectFilterFocusNonce: state.projectFilterFocusNonce + 1 })),
  clearScrollToEntryKey: () => set({ scrollToEntryKey: null }),
  setContentSearchOpen: (open) => set({ contentSearchOpen: open }),
  setCloneDialogOpen: (open) => set({ cloneDialogOpen: open }),
  run: async (target, key, entryKey, password) => {
    // 命令型配置有参数：先填参数，取消即什么都不动；没有参数照旧直接运行
    const config = editableConfigOf(get(), target, entryKey)
    const names = config === undefined ? [] : runConfigParamNames(config)
    let params: RunParams = {}
    if (config !== undefined && names.length > 0) {
      const answer = await askRunParams(set, get, config, names, password)
      if (answer === null) {
        // 密码框交上来的是等密码的这次运行的继续：不填参数即停止（以「已取消」结束），免得一直停在连接中
        if (password !== undefined) await get().stop(key)
        return
      }
      params = answer
    }
    // 运行即选中该配置、聚焦（即将出现的）其 Tab，并为该会话 +1 运行序号（重跑清屏回填与聚焦）。
    const switched = get().currentEntryKey !== entryKey
    set((state) => ({
      selectedKey: key,
      currentEntryKey: entryKey,
      activeTabByEntry: { ...state.activeTabByEntry, [entryKey]: key },
      runNonce: { ...state.runNonce, [key]: (state.runNonce[key] ?? 0) + 1 }
    }))
    persistWorkspace(get)
    if (switched) void touchEntry(set, entryKey)
    // 数据源上的配置的语句取自问参数时的同一份配置（参数框开着时配置可能被推送更新）
    await window.api.run(
      config === undefined ? target : runTargetOf(get(), config, params, password)
    )
  },
  stop: async (key) => window.api.stop(key),
  clearOutput: async (key) => {
    await window.api.clearSessionOutput(key)
    // 与重跑同路：+1 runNonce 驱动面板 reset + 回填空快照（新 sid）。
    set((state) => ({
      runNonce: { ...state.runNonce, [key]: (state.runNonce[key] ?? 0) + 1 }
    }))
  },
  newTerminal: async (projectPath, cwd) => {
    const key = await window.api.openTerminal(projectPath, undefined, cwd)
    openTerminalTab(set, get, { key, ownerKey: projectPath }, LOCAL_TERMINAL_NAME)
    return key
  },
  newSshTerminal: async (ownerKey, serverId, cwd) => {
    const server = get().servers.find((n) => n.server.id === serverId)?.server
    if (!server) return
    // 不带 key 即新开并立即连接：主进程起完 ssh 就返回（不等登录完成），提问弹窗与报错都会落在随即出现的 Tab 里
    const key = await window.api.openSshTerminal(ownerKey, serverId, undefined, cwd)
    openTerminalTab(set, get, { key, ownerKey, serverId }, server.name)
  },
  renameTerminal: (key, name) => {
    set((state) => ({
      terminals: state.terminals.map((t) => (t.key === key ? { ...t, name } : t))
    }))
    persistWorkspace(get)
  },
  reorderTerminals: (ownerKey, orderedKeys) => {
    set((state) => {
      const byKey = new Map(
        state.terminals.filter((t) => t.ownerKey === ownerKey).map((t) => [t.key, t])
      )
      const reordered = orderedKeys.map((k) => byKey.get(k)).filter((t): t is TerminalTab => !!t)
      return {
        terminals: [...state.terminals.filter((t) => t.ownerKey !== ownerKey), ...reordered]
      }
    })
    persistWorkspace(get)
  },
  openCreateDialog: (ownerKey) => set({ dialog: { ownerKey } }),
  openEditDialog: (config) => set({ dialog: { ownerKey: configOwnerKey(config), config } }),
  closeDialog: () => set({ dialog: null }),
  saveCommandConfig: async (input, id) => {
    const snapshot: TreeSnapshot = id
      ? await window.api.updateCommandConfig({ ...input, id })
      : await window.api.createCommandConfig(input)
    set({ ...snapshot, dialog: null })
  },
  deleteConfig: async (id) => set(await window.api.deleteConfig(id)),
  reorderConfigs: async (ownerKey, orderedIds) => {
    // 乐观更新：松手即本地排好序。dnd-kit 在 drag end 就撤销位移并按当前顺序落位，
    // 若等 IPC 往返（落盘 + 重建树）才换新序，元素会先弹回旧位再跳到新位（偶发跳动）。
    // 本地排序与主进程 reorderConfigs 语义一致（严格按 orderedIds），返回的权威树不会再变序。
    const reorder = <T extends RunConfig>(configs: T[]): T[] => {
      const byId = new Map(configs.map((c) => [c.id, c]))
      return orderedIds.map((id) => byId.get(id)).filter((c): c is T => !!c)
    }
    set((state) => ({
      tree: state.tree.map((n) =>
        n.project.path === ownerKey ? { ...n, configs: reorder(n.configs) } : n
      ),
      servers: state.servers.map((n) =>
        serverEntryKey(n.server.id) === ownerKey ? { ...n, configs: reorder(n.configs) } : n
      ),
      dataSources: state.dataSources.map((n) =>
        dataSourceEntryKey(n.dataSource.id) === ownerKey ? { ...n, configs: reorder(n.configs) } : n
      )
    }))
    set(await window.api.reorderConfigs(ownerKey, orderedIds))
  },
  openConnectionDialog: (dialog) => set({ connectionDialog: dialog }),
  closeConnectionDialog: () => set({ connectionDialog: null }),
  addServers: async (inputs) => {
    const { servers, focusIds } = await window.api.addServers(inputs)
    set({ servers, connectionDialog: null })
    const first = focusIds[0]
    if (first !== undefined) await focusEntry(set, get, serverEntryKey(first))
  },
  updateServer: async (id, input) => {
    // 连接信息变了，保存即断开它的文件连接：有未保存的文件先问，取消则对话框留着。只改名、改密码不断开，直接保存
    const server = get().servers.find((n) => n.server.id === id)?.server
    if (
      server !== undefined &&
      serverConnectionChanged(server, input) &&
      !(await get().resolveServerUnsaved(id))
    ) {
      return
    }
    await saveConnectionEdit(set, get, 'server', id, async () => ({
      servers: await window.api.updateServer(id, input)
    }))
  },
  removeServer: async (id) => {
    if (!(await get().resolveServerUnsaved(id))) return
    await removeConnection(set, get, 'server', id, async () => ({
      servers: await window.api.removeServer(id)
    }))
  },
  addDataSource: async (input) => {
    const { dataSources, focusId } = await window.api.addDataSource(input)
    set({ dataSources, connectionDialog: null })
    await focusEntry(set, get, dataSourceEntryKey(focusId))
  },
  updateDataSource: (id, input) =>
    saveConnectionEdit(set, get, 'dataSource', id, async () => ({
      dataSources: await window.api.updateDataSource(id, input)
    })),
  setDataSourceShownDatabases: async (id, databases) => {
    set({ dataSources: await window.api.setDataSourceShownDatabases(id, databases) })
  },
  removeDataSource: (id) =>
    removeConnection(set, get, 'dataSource', id, async () => ({
      dataSources: await window.api.removeDataSource(id)
    })),
  newDataSourceTab: (ownerKey, dataSourceId) => {
    const dataSource = get().dataSources.find((n) => n.dataSource.id === dataSourceId)?.dataSource
    if (!dataSource) return
    const key = newDataSourceTabKey()
    openTerminalTab(set, get, { key, ownerKey, dataSourceId }, dataSource.name)
    // 新开即连接（同 SSH Terminal）：有记住的密码就用它；没记住的也先直接连（有的库不需要密码），要密码时页面里再问
    void window.api.connectDataSourceSession(key, dataSourceId, null)
  },
  enqueueSshPrompt: (request) =>
    set((state) => ({ sshPromptQueue: [...state.sshPromptQueue, request] })),
  dismissSshPrompt: (id) =>
    set((state) => ({ sshPromptQueue: state.sshPromptQueue.filter((r) => r.id !== id) })),
  answerSshPrompt: (response) => {
    window.api.respondSshPrompt(response)
    get().dismissSshPrompt(response.id)
  },
  enqueueTransferConflict: (request) =>
    set((state) => ({ transferConflictQueue: [...state.transferConflictQueue, request] })),
  dismissTransferConflict: (id) =>
    set((state) => ({
      transferConflictQueue: state.transferConflictQueue.filter((r) => r.id !== id)
    })),
  answerTransferConflict: (response) => {
    window.api.respondTransferConflict(response)
    get().dismissTransferConflict(response.id)
  },
  setUnsavedServerFile: (serverId, file) => {
    const current = get().unsavedServerFiles
    if (file === null && !(serverId in current)) return
    const next = { ...current }
    if (file === null) delete next[serverId]
    else next[serverId] = file
    set({ unsavedServerFiles: next })
    window.api.reportUnsavedServerFiles(Object.keys(next).length)
  },
  askUnsaved: (name) =>
    new Promise((resolve) => {
      // 同一时刻只问一件事：还有没答的就当取消
      get().unsavedPrompt?.resolve('cancel')
      set({
        unsavedPrompt: {
          name,
          resolve: (choice) => {
            set({ unsavedPrompt: null })
            resolve(choice)
          }
        }
      })
    }),
  resolveServerUnsaved: async (serverId) => {
    const file = get().unsavedServerFiles[serverId]
    if (!file) return true
    const choice = await get().askUnsaved(file.name)
    if (choice === 'cancel') return false
    return choice === 'discard' || (await file.save())
  }
}))
