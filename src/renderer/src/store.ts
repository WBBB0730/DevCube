import { create } from 'zustand'
import type { CommandRunConfig, ProjectNode, RunTarget, SessionState } from '@shared/types'

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

/** 生成某项目下新终端的默认名：「终端 / 终端 2 / 终端 3」，取现有默认名最大序号 +1。 */
function nextTerminalName(terminals: TerminalTab[], projectPath: string): string {
  let max = 0
  for (const t of terminals) {
    if (t.projectPath !== projectPath) continue
    const n = t.name === '终端' ? 1 : Number(/^终端 (\d+)$/.exec(t.name)?.[1] ?? 0)
    if (n > max) max = n
  }
  const next = max + 1
  return next === 1 ? '终端' : `终端 ${next}`
}

/** 某项目「实际显示」的 Tab 解析结果（Console / cycleTab / 关闭快捷键共用同一规则，避免三处不一致）。 */
export interface ResolvedTabs {
  projTerminals: TerminalTab[]
  /** 运行控制台 Tab 1 是否有内容可显示（选中配置且已有会话） */
  runShown: boolean
  /** 当前是否显示运行控制台（Tab 1 激活） */
  showRun: boolean
  /** 当前显示的终端 key；null 表示显示运行控制台或占位 */
  activeTermKey: string | null
}

/**
 * 解析某项目当前显示哪个 Tab：显式选中的（仍存在的）终端 > 运行控制台（有内容时）> 回落首个终端。
 * activeTerminalByProject 里的原值可能已失效（终端被关）或为 null，必须经此解析后才是「界面真正显示的」。
 */
export function resolveTabs(
  s: {
    terminals: TerminalTab[]
    selectedKey: string | null
    sessions: Record<string, SessionState>
    activeTerminalByProject: Record<string, string | null>
  },
  projectPath: string
): ResolvedTabs {
  const projTerminals = s.terminals.filter((t) => t.projectPath === projectPath)
  const runShown = !!(s.selectedKey && s.sessions[s.selectedKey])
  let stored = s.activeTerminalByProject[projectPath] ?? null
  if (stored !== null && !projTerminals.some((t) => t.key === stored)) stored = null
  let showRun = false
  let activeTermKey: string | null = null
  if (stored !== null) activeTermKey = stored
  else if (runShown) showRun = true
  else activeTermKey = projTerminals[0]?.key ?? null
  return { projTerminals, runShown, showRun, activeTermKey }
}

interface AppState {
  tree: ProjectNode[]
  sessions: Record<string, SessionState>
  /**
   * 选中的可运行项（驱动左树配置行蓝底高亮与运行控制台内容）；
   * 为 null 表示「选中的是项目本身」（此时高亮项目行、不显示运行控制台 Tab）。
   */
  selectedKey: string | null
  /** 右侧显示哪个项目的 Tab 栏；null 时右侧为全局占位。总等于 selectedKey 所属项目（selectedKey 非空时） */
  currentProjectPath: string | null
  /** 各项目的终端 Tab（跨项目扁平存放，按项目过滤后渲染各自 Tab 栏） */
  terminals: TerminalTab[]
  /** 每项目当前活动的终端 key，或 null / 缺省 = 运行控制台（Tab 1） */
  activeTerminalByProject: Record<string, string | null>
  /** 运行/重跑时 +1，驱动运行控制台自动聚焦（重跑当前项时 selectedKey 不变，靠它触发） */
  focusNonce: number
  dialog: DialogState
  setTree: (tree: ProjectNode[]) => void
  setSession: (s: SessionState) => void
  /** 会话被销毁：终端→删 Tab 并修活动 Tab；运行会话→清其状态 */
  handleSessionRemoved: (key: string) => void
  /** 选中一个可运行项：切到其项目、回到运行控制台 Tab */
  select: (key: string, projectPath: string) => void
  /** 选中「项目本身」（点项目行）：设为当前项目、清空可运行项选中 */
  selectProject: (projectPath: string) => void
  init: () => Promise<void>
  addProject: () => Promise<void>
  addProjectByPath: (path: string) => Promise<void>
  removeProject: (path: string) => Promise<void>
  run: (target: RunTarget, key: string, projectPath: string) => Promise<void>
  stop: (key: string) => Promise<void>
  newTerminal: (projectPath: string) => Promise<void>
  selectTerminal: (key: string) => void
  activateRunConsole: (projectPath: string) => void
  closeTerminal: (key: string) => Promise<void>
  renameTerminal: (key: string, name: string) => void
  openCreateDialog: (projectPath: string) => void
  openEditDialog: (config: CommandRunConfig) => void
  closeDialog: () => void
  saveCommandConfig: (input: CommandInput, id?: string) => Promise<void>
  deleteConfig: (id: string) => Promise<void>
  reorderConfigs: (projectPath: string, orderedIds: string[]) => Promise<void>
}

export const useApp = create<AppState>((set) => ({
  tree: [],
  sessions: {},
  selectedKey: null,
  currentProjectPath: null,
  terminals: [],
  activeTerminalByProject: {},
  focusNonce: 0,
  dialog: { open: false },
  setTree: (tree) => set({ tree }),
  setSession: (s) => set((state) => ({ sessions: { ...state.sessions, [s.key]: s } })),
  handleSessionRemoved: (key) =>
    set((state) => {
      const sessions = { ...state.sessions }
      delete sessions[key]
      const tab = state.terminals.find((t) => t.key === key)
      if (!tab) return { sessions } // 运行会话被销毁：仅清状态（沿用原行为）
      // 终端被销毁（用户关闭 / shell 自行退出）：删 Tab；若正是活动 Tab，落到左邻，否则运行控制台。
      const activeTerminalByProject = { ...state.activeTerminalByProject }
      if (activeTerminalByProject[tab.projectPath] === key) {
        const projTabs = state.terminals.filter((t) => t.projectPath === tab.projectPath)
        const idx = projTabs.findIndex((t) => t.key === key)
        const neighbor = projTabs[idx - 1] ?? projTabs[idx + 1]
        activeTerminalByProject[tab.projectPath] = neighbor ? neighbor.key : null
      }
      return {
        sessions,
        terminals: state.terminals.filter((t) => t.key !== key),
        activeTerminalByProject
      }
    }),
  select: (key, projectPath) =>
    set((state) => ({
      selectedKey: key,
      currentProjectPath: projectPath,
      // 选中配置即切回运行控制台 Tab。
      activeTerminalByProject: { ...state.activeTerminalByProject, [projectPath]: null }
    })),
  selectProject: (projectPath) => set({ selectedKey: null, currentProjectPath: projectPath }),
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
      return { key: t.key, projectPath: t.projectPath, name: n === 1 ? '终端' : `终端 ${n}` }
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
    // 该项目的会话/终端已由 main 销毁（逐个 sessionRemoved）；这里清掉指向它的当前项目与每项目状态。
    set((state) => {
      const activeTerminalByProject = { ...state.activeTerminalByProject }
      delete activeTerminalByProject[path]
      const clearCurrent = state.currentProjectPath === path
      return {
        tree,
        activeTerminalByProject,
        currentProjectPath: clearCurrent ? null : state.currentProjectPath,
        selectedKey: clearCurrent ? null : state.selectedKey
      }
    })
  },
  run: async (target, key, projectPath) => {
    // 运行即切到该项、回到运行控制台并 +1 焦点信号（重跑当前项时 selectedKey 不变，靠此触发）。
    set((state) => ({
      selectedKey: key,
      currentProjectPath: projectPath,
      activeTerminalByProject: { ...state.activeTerminalByProject, [projectPath]: null },
      focusNonce: state.focusNonce + 1
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
      activeTerminalByProject: { ...state.activeTerminalByProject, [projectPath]: key }
    }))
  },
  selectTerminal: (key) =>
    set((state) => {
      const tab = state.terminals.find((t) => t.key === key)
      if (!tab) return {}
      return {
        currentProjectPath: tab.projectPath,
        activeTerminalByProject: { ...state.activeTerminalByProject, [tab.projectPath]: key }
      }
    }),
  activateRunConsole: (projectPath) =>
    set((state) => ({
      currentProjectPath: projectPath,
      activeTerminalByProject: { ...state.activeTerminalByProject, [projectPath]: null }
    })),
  // 关闭仅发请求；实际删 Tab 由 main 的 sessionRemoved 事件统一走 handleSessionRemoved。
  closeTerminal: async (key) => window.api.closeTerminal(key),
  renameTerminal: (key, name) =>
    set((state) => ({
      terminals: state.terminals.map((t) => (t.key === key ? { ...t, name } : t))
    })),
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
  reorderConfigs: async (projectPath, orderedIds) =>
    set({ tree: await window.api.reorderConfigs(projectPath, orderedIds) })
}))
