import { create } from 'zustand'
import type {
  CommandRunConfig,
  ProjectNode,
  RunConfig,
  RunTarget,
  SessionState,
  SessionStatus
} from '@shared/types'
import { configKey } from '@shared/runnable'

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
  /** 运行会话 Tab（树序）：每条有会话的配置一个 */
  runTabs: RunTabInfo[]
  /** 终端 Tab（组内可拖拽排序） */
  termTabs: TerminalTab[]
  /** 当前激活的 Tab（运行会话键或终端键）；null = 占位（点了没跑过的配置 / 一个 Tab 都没有） */
  activeKey: string | null
}

/**
 * 解析某项目的 Tab 栏与激活 Tab。Tab = 活的会话：每条有会话的配置一个（树序），
 * 终端在其后。activeTabByProject：键 = 显式激活的 Tab；null = 占位（关到一个不剩）；
 * 缺省 = 未接触过 → 回落首个运行会话 Tab，再回落首个终端。
 * 显式值失效为瞬态（运行刚点下会话未建 / 刚被移除待修正），按占位处理。
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
  let activeKey: string | null
  if (stored === undefined) activeKey = runTabs[0]?.key ?? termTabs[0]?.key ?? null
  else if (
    stored !== null &&
    (runTabs.some((t) => t.key === stored) || termTabs.some((t) => t.key === stored))
  )
    activeKey = stored
  else activeKey = null
  return { runTabs, termTabs, activeKey }
}

interface AppState {
  tree: ProjectNode[]
  sessions: Record<string, SessionState>
  /**
   * 选中的可运行项（驱动左树配置行蓝底高亮）；为 null 表示「选中的是项目本身」。
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
  setTree: (tree: ProjectNode[]) => void
  setSession: (s: SessionState) => void
  /** 会话被销毁（关 Tab / shell 退出 / 删除配置或项目 / 对账）：清状态、删终端 Tab、修激活 Tab */
  handleSessionRemoved: (key: string) => void
  /** 选中一个可运行项：有会话则聚焦其 Tab，没有则不动当前激活 Tab */
  select: (key: string, projectPath: string) => void
  /** 选中一条探测脚本：立即晋升为引用型配置进入「我的配置」（不必等运行），并按普通可运行项选中 */
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
  removeProject: (path: string) => Promise<void>
  run: (target: RunTarget, key: string, projectPath: string) => Promise<void>
  stop: (key: string) => Promise<void>
  newTerminal: (projectPath: string) => Promise<void>
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

export const useApp = create<AppState>((set, get) => ({
  tree: [],
  sessions: {},
  selectedKey: null,
  currentProjectPath: null,
  terminals: [],
  activeTabByProject: {},
  runNonce: {},
  dialog: { open: false },
  setTree: (tree) => set({ tree }),
  setSession: (s) => set((state) => ({ sessions: { ...state.sessions, [s.key]: s } })),
  handleSessionRemoved: (key) =>
    set((state) => {
      const sessions = { ...state.sessions }
      delete sessions[key]
      const runNonce = { ...state.runNonce }
      delete runNonce[key]
      const terminals = state.terminals.filter((t) => t.key !== key)
      // 修正指向被移除 Tab 的激活项：按移除前的 Tab 顺序（运行会话树序 + 终端序）取左邻，
      // 其次右邻，一个不剩则 null（占位）。
      const activeTabByProject = { ...state.activeTabByProject }
      for (const [proj, act] of Object.entries(activeTabByProject)) {
        if (act !== key) continue
        const { runTabs, termTabs } = resolveTabs(state, proj) // 移除前的状态
        const ordered = [...runTabs.map((t) => t.key), ...termTabs.map((t) => t.key)]
        const idx = ordered.indexOf(key)
        const rest = ordered.filter((k) => k !== key)
        activeTabByProject[proj] =
          idx < 0 ? (rest[0] ?? null) : (rest[idx - 1] ?? rest[idx] ?? null)
      }
      return { sessions, runNonce, terminals, activeTabByProject }
    }),
  // 选中配置：有会话 → 聚焦其 Tab；没跑过 → 不动当前激活 Tab（正在看的内容保持原样）。
  select: (key, projectPath) =>
    set((state) => ({
      selectedKey: key,
      currentProjectPath: projectPath,
      activeTabByProject: state.sessions[key]
        ? { ...state.activeTabByProject, [projectPath]: key }
        : state.activeTabByProject
    })),
  // 选中探测脚本：先按普通可运行项选中（同步高亮），再晋升入列（引用型与脚本共用同一键，选中态无缝延续）。
  selectScript: async (projectPath, name, key) => {
    get().select(key, projectPath)
    set({ tree: await window.api.promoteScript(projectPath, name) })
  },
  // 选中项目本身：只切当前项目，保持该项目原激活 Tab。
  selectProject: (projectPath) => set({ selectedKey: null, currentProjectPath: projectPath }),
  activateTab: (projectPath, key) =>
    set((state) => ({
      currentProjectPath: projectPath,
      activeTabByProject: { ...state.activeTabByProject, [projectPath]: key }
    })),
  // 关闭仅发请求；实际移除由 main 的 sessionRemoved 事件统一走 handleSessionRemoved。
  closeTab: async (key) => window.api.closeSession(key),
  init: async () => {
    const [tree, sessions, terminals] = await Promise.all([
      window.api.getTree(),
      window.api.getSessions(),
      window.api.getTerminals()
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
      terminals: termTabs
    })
  },
  addProject: async () => set({ tree: await window.api.addProject() }),
  addProjectByPath: async (path) => set({ tree: await window.api.addProjectByPath(path) }),
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
  run: async (target, key, projectPath) => {
    // 运行即选中该配置、聚焦（即将出现的）其 Tab，并为该会话 +1 运行序号（重跑清屏回填与聚焦）。
    set((state) => ({
      selectedKey: key,
      currentProjectPath: projectPath,
      activeTabByProject: { ...state.activeTabByProject, [projectPath]: key },
      runNonce: { ...state.runNonce, [key]: (state.runNonce[key] ?? 0) + 1 }
    }))
    await window.api.run(target)
  },
  stop: async (key) => window.api.stop(key),
  newTerminal: async (projectPath) => {
    const key = await window.api.openTerminal(projectPath)
    set((state) => ({
      terminals: [
        ...state.terminals,
        { key, projectPath, name: nextTerminalName(state.terminals, projectPath) }
      ],
      currentProjectPath: projectPath,
      activeTabByProject: { ...state.activeTabByProject, [projectPath]: key }
    }))
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
