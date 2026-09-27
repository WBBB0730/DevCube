import { create } from 'zustand'
import type {
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
import type { AskpassRequest, AskpassResponse, ServerInput, ServerNode } from '@shared/server'
import type { ThemeMode } from '@shared/theme'
import { configKey, filesTabKey, gitTabKey, isResidentTabKey } from '@shared/runnable'
import { cycleProjectSort } from '@shared/project-sort'
import {
  orderedTabKeysOf,
  resolveActiveTabKey,
  resolveNeighborAfterClose
} from '@shared/tab-activation'
import {
  configOwnerKey,
  isServerEntryKey,
  serverEntryKey,
  serverIdOfEntryKey
} from '@shared/tree-entry'
import { workspaceSliceFromBootstrap } from '@shared/renderer-bootstrap'
import {
  LOCAL_TERMINAL_NAME,
  nextNumberedTerminalName,
  renamedTerminalName,
  terminalsToShellsByEntry
} from '@shared/workspace'

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

/** 首帧自动获取开关：preload 快照同步带出，Git Tab 首次到前台即按真实设置决定是否 fetch。 */
function initialGitAutoFetch(): boolean {
  try {
    return window.api.getBootstrap().appPrefs.gitAutoFetch
  } catch {
    // vitest / 非 Electron 环境
    return DEFAULT_APP_PREFS.gitAutoFetch
  }
}

/** 任一窗口改了应用偏好，主进程推给全部窗口：把 JS 侧读的字段（自动获取开关）同步进本窗口 store。 */
export function syncAppPrefsAcrossWindows(): () => void {
  return window.api.onAppPrefsChanged((prefs) =>
    useApp.setState({ gitAutoFetch: prefs.gitAutoFetch })
  )
}

function initialWorkspaceSlice(): ReturnType<typeof workspaceSliceFromBootstrap> {
  try {
    return workspaceSliceFromBootstrap(window.api.getBootstrap())
  } catch {
    // vitest / 非 Electron 环境
    return {
      tree: [],
      servers: [],
      sessions: {},
      terminals: [],
      projectSortPrefs: DEFAULT_PROJECT_SORT_PREFS,
      currentEntryKey: null,
      selectedKey: null,
      activeTabByEntry: {}
    }
  }
}

interface DialogState {
  open: boolean
  /** 配置所属的左树条目（Project 路径或 `server:<id>`） */
  ownerKey?: string
  config?: EditableRunConfig
}

/** 服务器对话框：server 缺省为添加，否则编辑该服务器。 */
interface ServerDialogState {
  open: boolean
  server?: ServerNode
}

/**
 * 一个终端 Tab 的渲染端状态：会话键 + 归属条目 + 可改的名字。
 * serverId 存在即 SSH Terminal（本地 Terminal 缺省）。
 */
export interface TerminalTab {
  key: string
  /** 所属左树条目（Project 路径或 `server:<id>`） */
  ownerKey: string
  name: string
  serverId?: string
}

/** 运行会话 Tab：一条有会话（运行中/已退出未关闭）的配置。顺序跟随树中配置顺序。 */
export interface RunTabInfo {
  key: string
  label: string
  status: SessionStatus
}

/**
 * 某条目下新终端的默认名，取同系列已有默认名的最大序号 +1：
 * 本地终端「终端 / 终端 (2) / …」；SSH Terminal 以服务器名为底「prod / prod (2) / …」。
 */
function nextTerminalName(
  terminals: TerminalTab[],
  ownerKey: string,
  server?: { id: string; name: string }
): string {
  const siblings = terminals.filter((t) => t.ownerKey === ownerKey && t.serverId === server?.id)
  return nextNumberedTerminalName(
    siblings.map((t) => t.name),
    server?.name ?? LOCAL_TERMINAL_NAME
  )
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
 * SSH Terminal 只建会话、提示按回车连接（跨重启恢复的壳不自动连接）。
 */
async function ensureTerminalSpawned(
  get: () => AppState,
  ownerKey: string,
  key: string | null
): Promise<void> {
  if (key === null || get().sessions[key]) return
  const tab = get().terminals.find((t) => t.key === key && t.ownerKey === ownerKey)
  if (!tab) return
  if (tab.serverId === undefined) await window.api.openTerminal(ownerKey, key)
  else await window.api.openSshTerminal(ownerKey, tab.serverId, key)
}

/** 某条目「实际显示」的 Tab 解析结果（Console / cycleTab / 关闭快捷键共用同一规则，避免三处不一致）。 */
export interface ResolvedTabs {
  /** 常驻 Git Tab 的键（`git:<projectPath>`，恒排最前、不可关闭，ADR-0005）；Server 条目为 null */
  gitKey: string | null
  /** 常驻 Files Tab 的键（`files:<projectPath>`，排第二、不可关闭）；Server 条目为 null */
  filesKey: string | null
  /** 运行会话 Tab（树序）：每条有会话的配置一个 */
  runTabs: RunTabInfo[]
  /** 终端 Tab（Terminal 与 SSH Terminal，组内可拖拽排序） */
  termTabs: TerminalTab[]
  /** 当前激活的 Tab；Project 有常驻 Tab 故恒非 null，一个 Tab 都没有的 Server 为 null */
  activeKey: string | null
}

type TabState = Pick<AppState, 'tree' | 'servers' | 'sessions' | 'terminals' | 'activeTabByEntry'>

/** 某左树条目下的配置（Project 的，或 Server 上的命令型），按用户排的顺序。 */
export function entryConfigs(s: Pick<AppState, 'tree' | 'servers'>, entryKey: string): RunConfig[] {
  const serverId = serverIdOfEntryKey(entryKey)
  if (serverId === null) return s.tree.find((n) => n.project.path === entryKey)?.configs ?? []
  return s.servers.find((n) => n.server.id === serverId)?.configs ?? []
}

/**
 * 解析某条目的 Tab 栏与激活 Tab。
 * Tab 顺序 = Git → Files → 运行会话（树序）→ 终端（Server 条目没有 Git / Files）。
 * 默认激活：有运行中的 Run Session → 第一个运行中的；否则 Tab 序首位（ADR-0005）。
 */
export function resolveTabs(s: TabState, entryKey: string): ResolvedTabs {
  const isServer = isServerEntryKey(entryKey)
  const gitKey = isServer ? null : gitTabKey(entryKey)
  const filesKey = isServer ? null : filesTabKey(entryKey)
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
  const activeKey = resolveActiveTabKey({ gitKey, filesKey, runTabs, termTabs, stored })
  return { gitKey, filesKey, runTabs, termTabs, activeKey }
}

/** Tab 栏从左到右的键序（与 cycleTab / ⌘1–9 共用）。 */
export function orderedTabKeys(s: TabState, entryKey: string): string[] {
  return orderedTabKeysOf(resolveTabs(s, entryKey))
}

interface AppState {
  tree: ProjectNode[]
  servers: ServerNode[]
  sessions: Record<string, SessionState>
  /**
   * 选中的配置（驱动左树配置行蓝底高亮）；为 null 表示「选中的是条目本身」。
   * 树选择与 Tab 激活解耦：点 Tab 不改树选择，点树配置只在其有会话时聚焦对应 Tab。
   */
  selectedKey: string | null
  /** 右侧显示哪个左树条目（Project 路径或 `server:<id>`）的 Tab 栏；null 时右侧为全局占位 */
  currentEntryKey: string | null
  /** 各条目的终端 Tab（跨条目扁平存放，按条目过滤后渲染各自 Tab 栏） */
  terminals: TerminalTab[]
  /** 每条目激活的 Tab：运行会话键 / 终端键；null = 占位；缺省 = 回落首 Tab（见 resolveTabs） */
  activeTabByEntry: Record<string, string | null>
  /** 每会话的运行序号：重跑 +1，驱动对应运行面板清屏回填与聚焦（面板只订阅自己的键） */
  runNonce: Record<string, number>
  dialog: DialogState
  serverDialog: ServerDialogState
  /** 等用户回答的 ssh 提问（先到先答，一次只弹一个） */
  askpassQueue: AskpassRequest[]
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
  /** 选中左树条目本身（点项目行 / 服务器行）：切当前条目，保持该条目原激活 Tab */
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
  /** 重排左树条目（Project 与 Server 混排的自定义序落盘） */
  reorderEntries: (orderedKeys: string[]) => Promise<void>
  /** 设置左树条目的 Pin */
  setEntryPinned: (entryKey: string, pinned: boolean) => Promise<void>
  /** 点选排序方式：同项翻转方向，换项取默认方向 */
  cycleSortMode: (mode: ProjectSortPrefs['mode']) => Promise<void>
  /** 排序偏好里的开关（固定置顶、按类型显示） */
  setSortPrefs: (
    patch: Partial<Pick<ProjectSortPrefs, 'pinSticky' | 'showProjects' | 'showServers'>>
  ) => Promise<void>
  /** 切换主题：本地即时生效，主进程随后同步 themeSource 与窗口色（CSS 由此翻） */
  setTheme: (theme: ThemeMode) => Promise<void>
  /** 开关自动获取：本地即时生效并落盘 */
  setGitAutoFetch: (enabled: boolean) => Promise<void>
  setProjectFilter: (query: string) => void
  /** 聚焦左树筛选框 */
  focusProjectFilter: () => void
  setContentSearchOpen: (open: boolean) => void
  setCloneDialogOpen: (open: boolean) => void
  clearScrollToEntryKey: () => void
  run: (target: RunTarget, key: string, entryKey: string) => Promise<void>
  stop: (key: string) => Promise<void>
  /** 清空某运行会话的控制台输出（进程继续；+1 runNonce 驱动面板清屏回填） */
  clearOutput: (key: string) => Promise<void>
  /** 新建终端并聚焦；返回其会话键（供 Git 交互式 rebase 等向其写入命令） */
  /** cwd 缺省为项目根；Files 树「在终端中打开」传项目内目录 */
  newTerminal: (projectPath: string, cwd?: string) => Promise<string>
  /** 在某条目（Project / Server）下新建一个连到 serverId 的 SSH Terminal 并立即连接 */
  newSshTerminal: (ownerKey: string, serverId: string) => Promise<void>
  renameTerminal: (key: string, name: string) => void
  /** 重排某条目终端 Tab 的顺序（落盘） */
  reorderTerminals: (ownerKey: string, orderedKeys: string[]) => void
  /** 在某左树条目（Project / Server）下新建命令型配置 */
  openCreateDialog: (ownerKey: string) => void
  openEditDialog: (config: EditableRunConfig) => void
  closeDialog: () => void
  saveCommandConfig: (input: EditableRunConfigInput, id?: string) => Promise<void>
  deleteConfig: (id: string) => Promise<void>
  reorderConfigs: (ownerKey: string, orderedIds: string[]) => Promise<void>
  openServerDialog: (server?: ServerNode) => void
  closeServerDialog: () => void
  /** 登记服务器并选中第一台（新登记或命中已登记的） */
  addServers: (inputs: ServerInput[]) => Promise<void>
  updateServer: (id: string, input: ServerInput) => Promise<void>
  removeServer: (id: string) => Promise<void>
  enqueueAskpass: (request: AskpassRequest) => void
  dismissAskpass: (id: string) => void
  answerAskpass: (response: AskpassResponse) => void
}

/** 记一次打开：Project 更新 lastOpenedAt 并回写树；Server 同理回写服务器列表。 */
async function touchEntry(
  set: (partial: Partial<AppState>) => void,
  entryKey: string
): Promise<void> {
  const serverId = serverIdOfEntryKey(entryKey)
  if (serverId === null) set({ tree: await window.api.touchProject(entryKey) })
  else set({ servers: await window.api.touchServer(serverId) })
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

export const useApp = create<AppState>((set, get) => ({
  ...initialWorkspaceSlice(),
  theme: initialTheme(),
  gitAutoFetch: initialGitAutoFetch(),
  runNonce: {},
  dialog: { open: false },
  serverDialog: { open: false },
  askpassQueue: [],
  projectFilter: '',
  projectFilterFocusNonce: 0,
  scrollToEntryKey: null,
  contentSearchOpen: false,
  cloneDialogOpen: false,
  setTree: (tree) => set({ tree }),
  setServers: (servers) => set({ servers }),
  setSession: (s) => set((state) => ({ sessions: { ...state.sessions, [s.key]: s } })),
  handleSessionRemoved: (key) => {
    set((state) => {
      const sessions = { ...state.sessions }
      delete sessions[key]
      const runNonce = { ...state.runNonce }
      delete runNonce[key]
      const terminals = state.terminals.filter((t) => t.key !== key)
      // 修正指向被移除 Tab 的激活项：按移除前的 Tab 顺序取左邻，其次右邻（不套用默认激活）。
      const activeTabByEntry = { ...state.activeTabByEntry }
      for (const [entryKey, act] of Object.entries(activeTabByEntry)) {
        if (act !== key) continue
        activeTabByEntry[entryKey] = resolveNeighborAfterClose(orderedTabKeys(state, entryKey), key)
      }
      return { sessions, runNonce, terminals, activeTabByEntry }
    })
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
  // 常驻非会话 Tab（Git / Files）不可关闭。尚无会话的终端壳主进程无会话，本地移除并落盘。
  closeTab: async (key) => {
    if (isResidentTabKey(key)) return
    if (get().terminals.some((t) => t.key === key) && !get().sessions[key]) {
      get().handleSessionRemoved(key)
      return
    }
    return window.api.closeSession(key)
  },
  // 首屏已由 preload bootstrap 灌入；此处只做打开对账（touch / 懒 spawn）。HMR 时再拉一遍快照。
  init: async () => {
    if (import.meta.env.DEV) {
      const [tree, servers, sessions, terminals, projectSortPrefs, workspace, appPrefs] =
        await Promise.all([
          window.api.getTree(),
          window.api.getServers(),
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
          sessions,
          terminals,
          projectSortPrefs,
          workspace
        }),
        gitAutoFetch: appPrefs.gitAutoFetch
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
  setProjectFilter: (query) => set({ projectFilter: query }),
  focusProjectFilter: () =>
    set((state) => ({ projectFilterFocusNonce: state.projectFilterFocusNonce + 1 })),
  clearScrollToEntryKey: () => set({ scrollToEntryKey: null }),
  setContentSearchOpen: (open) => set({ contentSearchOpen: open }),
  setCloneDialogOpen: (open) => set({ cloneDialogOpen: open }),
  run: async (target, key, entryKey) => {
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
    await window.api.run(target)
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
    const switched = get().currentEntryKey !== projectPath
    set((state) => ({
      terminals: [
        ...state.terminals,
        { key, ownerKey: projectPath, name: nextTerminalName(state.terminals, projectPath) }
      ],
      currentEntryKey: projectPath,
      activeTabByEntry: { ...state.activeTabByEntry, [projectPath]: key }
    }))
    persistWorkspace(get)
    if (switched) void touchEntry(set, projectPath)
    return key
  },
  newSshTerminal: async (ownerKey, serverId) => {
    const server = get().servers.find((n) => n.server.id === serverId)?.server
    if (!server) return
    // 主进程起完 ssh 就返回（不等登录完成），提问弹窗与报错都会落在随即出现的 Tab 里
    const key = await window.api.openSshTerminal(ownerKey, serverId)
    const switched = get().currentEntryKey !== ownerKey
    set((state) => ({
      terminals: [
        ...state.terminals,
        { key, ownerKey, name: nextTerminalName(state.terminals, ownerKey, server), serverId }
      ],
      currentEntryKey: ownerKey,
      activeTabByEntry: { ...state.activeTabByEntry, [ownerKey]: key }
    }))
    persistWorkspace(get)
    if (switched) void touchEntry(set, ownerKey)
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
  openCreateDialog: (ownerKey) => set({ dialog: { open: true, ownerKey } }),
  openEditDialog: (config) =>
    set({ dialog: { open: true, ownerKey: configOwnerKey(config), config } }),
  closeDialog: () => set({ dialog: { open: false } }),
  saveCommandConfig: async (input, id) => {
    const snapshot: TreeSnapshot = id
      ? await window.api.updateCommandConfig({ ...input, id })
      : await window.api.createCommandConfig(input)
    set({ ...snapshot, dialog: { open: false } })
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
      )
    }))
    set(await window.api.reorderConfigs(ownerKey, orderedIds))
  },
  openServerDialog: (server) => set({ serverDialog: { open: true, server } }),
  closeServerDialog: () => set({ serverDialog: { open: false } }),
  addServers: async (inputs) => {
    const { servers, focusIds } = await window.api.addServers(inputs)
    set({ servers, serverDialog: { open: false } })
    const first = focusIds[0]
    if (first !== undefined) await focusEntry(set, get, serverEntryKey(first))
  },
  updateServer: async (id, input) => {
    // 改名同步到连到它的 SSH Terminal 的默认名（序号保留；用户改过的 Tab 名不动）。
    // 旧名在请求前取：等待期间可能收到服务器列表推送，那时 store 里已是新名
    const before = get().servers.find((n) => n.server.id === id)?.server.name
    const servers = await window.api.updateServer(id, input)
    const after = servers.find((n) => n.server.id === id)?.server.name
    set((state) => ({
      servers,
      serverDialog: { open: false },
      terminals:
        before !== undefined && after !== undefined && before !== after
          ? state.terminals.map((t) => {
              const renamed = t.serverId === id ? renamedTerminalName(t.name, before, after) : null
              return renamed === null ? t : { ...t, name: renamed }
            })
          : state.terminals
    }))
    persistWorkspace(get)
  },
  removeServer: async (id) => {
    const servers = await window.api.removeServer(id)
    // 连到它的 SSH Terminal 已由 main 销毁（逐个 sessionRemoved）；尚无会话的壳（含开在项目里的）在这里一并清掉。
    set((state) => ({
      servers,
      ...forgetEntry(state, serverEntryKey(id)),
      terminals: state.terminals.filter((t) => t.serverId !== id)
    }))
    persistWorkspace(get)
  },
  enqueueAskpass: (request) => set((state) => ({ askpassQueue: [...state.askpassQueue, request] })),
  dismissAskpass: (id) =>
    set((state) => ({ askpassQueue: state.askpassQueue.filter((r) => r.id !== id) })),
  answerAskpass: (response) => {
    window.api.respondAskpass(response)
    get().dismissAskpass(response.id)
  }
}))
