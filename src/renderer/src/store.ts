import { create } from 'zustand'
import type {
  CommandRunConfig,
  ProjectAddResult,
  ProjectNode,
  ProjectSortPrefs,
  RunConfig,
  RunTarget,
  SessionState,
  SessionStatus
} from '@shared/types'
import { DEFAULT_PROJECT_SORT_PREFS } from '@shared/types'
import { configKey, filesTabKey, gitTabKey, isResidentTabKey } from '@shared/runnable'
import { cycleProjectSort } from '@shared/project-sort'
import {
  resolveActiveTabKey,
  resolveNeighborAfterClose
} from '@shared/tab-activation'

type CommandInput = Omit<CommandRunConfig, 'id' | 'kind'>

interface DialogState {
  open: boolean
  projectPath?: string
  config?: CommandRunConfig
}

/** 一个终端 Tab（Terminal）的渲染端状态：会话键 + 归属项目 + 可改的名字（纯内存）。 */
export interface TerminalTab {
  key: string
  projectPath: string
  name: string
}

/** 运行会话 Tab：一条有会话（运行中/已退出未关闭）的配置。顺序跟随树中配置顺序。 */
export interface RunTabInfo {
  key: string
  label: string
  status: SessionStatus
}

/** 生成某项目下新终端的默认名：「终端 / 终端 (2) / 终端 (3)」，取现有默认名最大序号 +1。 */
function nextTerminalName(terminals: TerminalTab[], projectPath: string): string {
  let max = 0
  for (const t of terminals) {
    if (t.projectPath !== projectPath) continue
    const n = t.name === '终端' ? 1 : Number(/^终端 \((\d+)\)$/.exec(t.name)?.[1] ?? 0)
    if (n > max) max = n
  }
  const next = max + 1
  return next === 1 ? '终端' : `终端 (${next})`
}

/** 某项目「实际显示」的 Tab 解析结果（Console / cycleTab / 关闭快捷键共用同一规则，避免三处不一致）。 */
export interface ResolvedTabs {
  /** 常驻 Git Tab 的键（`git:<projectPath>`，恒排最前、不可关闭，ADR-0005） */
  gitKey: string
  /** 常驻 Files Tab 的键（`files:<projectPath>`，排第二、不可关闭） */
  filesKey: string
  /** 运行会话 Tab（树序）：每条有会话的配置一个 */
  runTabs: RunTabInfo[]
  /** 终端 Tab（组内可拖拽排序） */
  termTabs: TerminalTab[]
  /** 当前激活的 Tab；常驻 Tab 存在，故恒非 null */
  activeKey: string
}

/**
 * 解析某项目的 Tab 栏与激活 Tab。
 * Tab 顺序 = Git → Files → 运行会话（树序）→ 终端。
 * 默认激活：有运行中的 Run Session → 第一个运行中的；否则 Git（ADR-0005）。
 */
export function resolveTabs(
  s: {
    tree: ProjectNode[]
    sessions: Record<string, SessionState>
    terminals: TerminalTab[]
    activeTabByProject: Record<string, string | null>
  },
  projectPath: string
): ResolvedTabs {
  const gitKey = gitTabKey(projectPath)
  const filesKey = filesTabKey(projectPath)
  const node = s.tree.find((n) => n.project.path === projectPath)
  const runTabs: RunTabInfo[] = []
  for (const c of node?.configs ?? []) {
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
  const termTabs = s.terminals.filter((t) => t.projectPath === projectPath)
  const stored = s.activeTabByProject[projectPath]
  const activeKey = resolveActiveTabKey({
    gitKey,
    filesKey,
    runTabs,
    termTabs,
    stored
  })
  return { gitKey, filesKey, runTabs, termTabs, activeKey }
}

interface AppState {
  tree: ProjectNode[]
  sessions: Record<string, SessionState>
  /**
   * 选中的配置（驱动左树配置行蓝底高亮）；为 null 表示「选中的是项目本身」。
   * 树选择与 Tab 激活解耦：点 Tab 不改树选择，点树配置只在其有会话时聚焦对应 Tab。
   */
  selectedKey: string | null
  /** 右侧显示哪个项目的 Tab 栏；null 时右侧为全局占位。总等于 selectedKey 所属项目（selectedKey 非空时） */
  currentProjectPath: string | null
  /** 各项目的终端 Tab（跨项目扁平存放，按项目过滤后渲染各自 Tab 栏） */
  terminals: TerminalTab[]
  /** 每项目激活的 Tab：运行会话键 / 终端键；null = 占位；缺省 = 回落首 Tab（见 resolveTabs） */
  activeTabByProject: Record<string, string | null>
  /** 每会话的运行序号：重跑 +1，驱动对应运行面板清屏回填与聚焦（面板只订阅自己的键） */
  runNonce: Record<string, number>
  dialog: DialogState
  /** 左树项目排序偏好（落盘） */
  projectSortPrefs: ProjectSortPrefs
  /** 左树项目名搜索（纯内存） */
  projectFilter: string
  /** 添加项目后待滚入视口的路径；滚完即清 */
  scrollToProjectPath: string | null
  setTree: (tree: ProjectNode[]) => void
  setSession: (s: SessionState) => void
  /** 会话被销毁（关 Tab / shell 退出 / 删除配置或项目 / 对账）：清状态、删终端 Tab、修激活 Tab */
  handleSessionRemoved: (key: string) => void
  /** 选中一条配置：有会话则聚焦其 Tab，没有则不动当前激活 Tab */
  select: (key: string, projectPath: string) => void
  /** 选中一条探测脚本：立即晋升为引用型配置进入「我的配置」（不必等运行），并按普通配置选中 */
  selectScript: (projectPath: string, name: string, key: string) => Promise<void>
  /** 选中「项目本身」（点项目行）：切当前项目，保持该项目原激活 Tab */
  selectProject: (projectPath: string) => void
  /** 激活一个 Tab（运行会话或终端通用）；不动树选择 */
  activateTab: (projectPath: string, key: string) => void
  /** 关闭一个 Tab（运行中则温和停止）；实际移除由 sessionRemoved 事件统一回流 */
  closeTab: (key: string) => Promise<void>
  init: () => Promise<void>
  addProject: () => Promise<void>
  addProjectByPath: (path: string) => Promise<void>
  createProject: () => Promise<void>
  removeProject: (path: string) => Promise<void>
  /** 重排项目列表（自定义排序落盘） */
  reorderProjects: (orderedPaths: string[]) => Promise<void>
  /** 设置 Project 的 Pin */
  setProjectPinned: (path: string, pinned: boolean) => Promise<void>
  /** 点选排序方式：同项翻转方向，换项取默认方向 */
  cycleSortMode: (mode: ProjectSortPrefs['mode']) => Promise<void>
  /** 开关已 Pin 项目行滚动吸顶 */
  setPinSticky: (pinSticky: boolean) => Promise<void>
  setProjectFilter: (query: string) => void
  clearScrollToProjectPath: () => void
  run: (target: RunTarget, key: string, projectPath: string) => Promise<void>
  stop: (key: string) => Promise<void>
  /** 清空某运行会话的控制台输出（进程继续；+1 runNonce 驱动面板清屏回填） */
  clearOutput: (key: string) => Promise<void>
  /** 新建终端并聚焦；返回其会话键（供 Git 交互式 rebase 等向其写入命令） */
  newTerminal: (projectPath: string) => Promise<string>
  renameTerminal: (key: string, name: string) => void
  /** 重排某项目终端 Tab 的顺序（纯内存，与终端本身一样不持久化） */
  reorderTerminals: (projectPath: string, orderedKeys: string[]) => void
  openCreateDialog: (projectPath: string) => void
  openEditDialog: (config: CommandRunConfig) => void
  closeDialog: () => void
  saveCommandConfig: (input: CommandInput, id?: string) => Promise<void>
  deleteConfig: (id: string) => Promise<void>
  reorderConfigs: (projectPath: string, orderedIds: string[]) => Promise<void>
}

/**
 * 登记项目后的统一收尾：有 focusPath（新建或已存在）则选中并滚入视口；
 * 取消 / 无效路径不动 store，避免无谓刷新把列表滚走。
 */
async function applyAddedProject(
  set: (partial: Partial<AppState>) => void,
  fetch: () => Promise<ProjectAddResult>
): Promise<void> {
  const { focusPath } = await fetch()
  if (!focusPath) return
  set({ selectedKey: null, currentProjectPath: focusPath })
  set({ tree: await window.api.touchProject(focusPath), scrollToProjectPath: focusPath })
}

export const useApp = create<AppState>((set, get) => ({
  tree: [],
  sessions: {},
  selectedKey: null,
  currentProjectPath: null,
  terminals: [],
  activeTabByProject: {},
  runNonce: {},
  dialog: { open: false },
  projectSortPrefs: DEFAULT_PROJECT_SORT_PREFS,
  projectFilter: '',
  scrollToProjectPath: null,
  setTree: (tree) => set({ tree }),
  setSession: (s) => set((state) => ({ sessions: { ...state.sessions, [s.key]: s } })),
  handleSessionRemoved: (key) =>
    set((state) => {
      const sessions = { ...state.sessions }
      delete sessions[key]
      const runNonce = { ...state.runNonce }
      delete runNonce[key]
      const terminals = state.terminals.filter((t) => t.key !== key)
      // 修正指向被移除 Tab 的激活项：按移除前的 Tab 顺序取左邻，其次右邻（不套用默认激活）。
      const activeTabByProject = { ...state.activeTabByProject }
      for (const [proj, act] of Object.entries(activeTabByProject)) {
        if (act !== key) continue
        const { gitKey, filesKey, runTabs, termTabs } = resolveTabs(state, proj)
        const ordered = [
          gitKey,
          filesKey,
          ...runTabs.map((t) => t.key),
          ...termTabs.map((t) => t.key)
        ]
        activeTabByProject[proj] = resolveNeighborAfterClose(ordered, key)
      }
      return { sessions, runNonce, terminals, activeTabByProject }
    }),
  // 选中配置：有会话 → 聚焦其 Tab；没跑过 → 不动当前激活 Tab（正在看的内容保持原样）。
  // 切到另一项目时记一次打开时间。
  select: (key, projectPath) => {
    const switched = get().currentProjectPath !== projectPath
    set((state) => ({
      selectedKey: key,
      currentProjectPath: projectPath,
      activeTabByProject: state.sessions[key]
        ? { ...state.activeTabByProject, [projectPath]: key }
        : state.activeTabByProject
    }))
    if (switched) void window.api.touchProject(projectPath).then((tree) => set({ tree }))
  },
  // 选中探测脚本：先按普通配置选中（同步高亮），再晋升入列（引用型与脚本共用同一键，选中态无缝延续）。
  selectScript: async (projectPath, name, key) => {
    get().select(key, projectPath)
    set({ tree: await window.api.promoteScript(projectPath, name) })
  },
  // 选中项目本身：只切当前项目，保持该项目原激活 Tab；并记录打开时间。
  selectProject: (projectPath) => {
    set({ selectedKey: null, currentProjectPath: projectPath })
    void window.api.touchProject(projectPath).then((tree) => set({ tree }))
  },
  activateTab: (projectPath, key) => {
    const switched = get().currentProjectPath !== projectPath
    set((state) => ({
      currentProjectPath: projectPath,
      activeTabByProject: { ...state.activeTabByProject, [projectPath]: key }
    }))
    if (switched) void window.api.touchProject(projectPath).then((tree) => set({ tree }))
  },
  // 关闭仅发请求；实际移除由 main 的 sessionRemoved 事件统一走 handleSessionRemoved。
  // 常驻非会话 Tab（Git / Files）不可关闭。
  closeTab: async (key) => {
    if (isResidentTabKey(key)) return
    return window.api.closeSession(key)
  },
  init: async () => {
    const [tree, sessions, terminals, projectSortPrefs] = await Promise.all([
      window.api.getTree(),
      window.api.getSessions(),
      window.api.getTerminals(),
      window.api.getProjectSortPrefs()
    ])
    // 重建终端 Tab（如 dev 热重载后 main 仍有 shell 存活）；名字按项目内出现顺序回落默认名。
    const seq: Record<string, number> = {}
    const termTabs: TerminalTab[] = terminals.map((t) => {
      const n = (seq[t.projectPath] = (seq[t.projectPath] ?? 0) + 1)
      return { key: t.key, projectPath: t.projectPath, name: n === 1 ? '终端' : `终端 (${n})` }
    })
    set({
      tree,
      sessions: Object.fromEntries(sessions.map((s) => [s.key, s])),
      terminals: termTabs,
      projectSortPrefs
    })
  },
  // 添加成功或命中已有项目：选中并滚入视口；取消 / 无效路径则只刷新树。
  addProject: async () => {
    await applyAddedProject(set, () => window.api.addProject())
  },
  addProjectByPath: async (path) => {
    await applyAddedProject(set, () => window.api.addProjectByPath(path))
  },
  createProject: async () => {
    await applyAddedProject(set, () => window.api.createProject())
  },
  removeProject: async (path) => {
    const tree = await window.api.removeProject(path)
    // 该项目的会话/终端已由 main 销毁（逐个 sessionRemoved）；这里清掉指向它的当前项目与激活项。
    set((state) => {
      const activeTabByProject = { ...state.activeTabByProject }
      delete activeTabByProject[path]
      const clearCurrent = state.currentProjectPath === path
      return {
        tree,
        activeTabByProject,
        currentProjectPath: clearCurrent ? null : state.currentProjectPath,
        selectedKey: clearCurrent ? null : state.selectedKey
      }
    })
  },
  reorderProjects: async (orderedPaths) => {
    // 乐观更新：松手即本地排好序，避免等 IPC 回跳。
    set((state) => {
      const byPath = new Map(state.tree.map((n) => [n.project.path, n]))
      const tree = orderedPaths
        .map((p) => byPath.get(p))
        .filter((n): n is ProjectNode => !!n)
      return { tree }
    })
    set({ tree: await window.api.reorderProjects(orderedPaths) })
  },
  setProjectPinned: async (path, pinned) => {
    set({ tree: await window.api.setProjectPinned(path, pinned) })
  },
  cycleSortMode: async (mode) => {
    const next = cycleProjectSort(get().projectSortPrefs, mode)
    set({ projectSortPrefs: next })
    set({ projectSortPrefs: await window.api.setProjectSortPrefs(next) })
  },
  setPinSticky: async (pinSticky) => {
    const next = { ...get().projectSortPrefs, pinSticky }
    set({ projectSortPrefs: next })
    set({ projectSortPrefs: await window.api.setProjectSortPrefs({ pinSticky }) })
  },
  setProjectFilter: (query) => set({ projectFilter: query }),
  clearScrollToProjectPath: () => set({ scrollToProjectPath: null }),
  run: async (target, key, projectPath) => {
    // 运行即选中该配置、聚焦（即将出现的）其 Tab，并为该会话 +1 运行序号（重跑清屏回填与聚焦）。
    const switched = get().currentProjectPath !== projectPath
    set((state) => ({
      selectedKey: key,
      currentProjectPath: projectPath,
      activeTabByProject: { ...state.activeTabByProject, [projectPath]: key },
      runNonce: { ...state.runNonce, [key]: (state.runNonce[key] ?? 0) + 1 }
    }))
    if (switched) void window.api.touchProject(projectPath).then((tree) => set({ tree }))
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
  newTerminal: async (projectPath) => {
    const key = await window.api.openTerminal(projectPath)
    const switched = get().currentProjectPath !== projectPath
    set((state) => ({
      terminals: [
        ...state.terminals,
        { key, projectPath, name: nextTerminalName(state.terminals, projectPath) }
      ],
      currentProjectPath: projectPath,
      activeTabByProject: { ...state.activeTabByProject, [projectPath]: key }
    }))
    if (switched) void window.api.touchProject(projectPath).then((tree) => set({ tree }))
    return key
  },
  renameTerminal: (key, name) =>
    set((state) => ({
      terminals: state.terminals.map((t) => (t.key === key ? { ...t, name } : t))
    })),
  reorderTerminals: (projectPath, orderedKeys) =>
    set((state) => {
      const byKey = new Map(
        state.terminals.filter((t) => t.projectPath === projectPath).map((t) => [t.key, t])
      )
      const reordered = orderedKeys.map((k) => byKey.get(k)).filter((t): t is TerminalTab => !!t)
      return {
        terminals: [...state.terminals.filter((t) => t.projectPath !== projectPath), ...reordered]
      }
    }),
  openCreateDialog: (projectPath) => set({ dialog: { open: true, projectPath } }),
  openEditDialog: (config) =>
    set({ dialog: { open: true, projectPath: config.projectPath, config } }),
  closeDialog: () => set({ dialog: { open: false } }),
  saveCommandConfig: async (input, id) => {
    const tree = id
      ? await window.api.updateCommandConfig({ ...input, id, kind: 'command' })
      : await window.api.createCommandConfig(input)
    set({ tree, dialog: { open: false } })
  },
  deleteConfig: async (id) => set({ tree: await window.api.deleteConfig(id) }),
  reorderConfigs: async (projectPath, orderedIds) => {
    // 乐观更新：松手即本地排好序。dnd-kit 在 drag end 就撤销位移并按当前顺序落位，
    // 若等 IPC 往返（落盘 + 重建树）才换新序，元素会先弹回旧位再跳到新位（偶发跳动）。
    // 本地排序与主进程 reorderConfigs 语义一致（严格按 orderedIds），返回的权威树不会再变序。
    set((state) => ({
      tree: state.tree.map((n) => {
        if (n.project.path !== projectPath) return n
        const byId = new Map(n.configs.map((c) => [c.id, c]))
        const configs = orderedIds.map((id) => byId.get(id)).filter((c): c is RunConfig => !!c)
        return { ...n, configs }
      })
    }))
    set({ tree: await window.api.reorderConfigs(projectPath, orderedIds) })
  }
}))
