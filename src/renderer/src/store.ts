import { create } from 'zustand'
import type { CommandRunConfig, ProjectNode, RunTarget, SessionState } from '@shared/types'

type CommandInput = Omit<CommandRunConfig, 'id' | 'kind'>

interface DialogState {
  open: boolean
  projectPath?: string
  config?: CommandRunConfig
}

interface AppState {
  tree: ProjectNode[]
  sessions: Record<string, SessionState>
  selectedKey: string | null
  dialog: DialogState
  setTree: (tree: ProjectNode[]) => void
  setSession: (s: SessionState) => void
  removeSession: (key: string) => void
  select: (key: string) => void
  init: () => Promise<void>
  addProject: () => Promise<void>
  addProjectByPath: (path: string) => Promise<void>
  removeProject: (path: string) => Promise<void>
  run: (target: RunTarget, key: string) => Promise<void>
  stop: (key: string) => Promise<void>
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
  dialog: { open: false },
  setTree: (tree) => set({ tree }),
  setSession: (s) => set((state) => ({ sessions: { ...state.sessions, [s.key]: s } })),
  removeSession: (key) =>
    set((state) => {
      const sessions = { ...state.sessions }
      delete sessions[key]
      return { sessions }
    }),
  select: (key) => set({ selectedKey: key }),
  init: async () => {
    const [tree, sessions] = await Promise.all([window.api.getTree(), window.api.getSessions()])
    set({ tree, sessions: Object.fromEntries(sessions.map((s) => [s.key, s])) })
  },
  addProject: async () => set({ tree: await window.api.addProject() }),
  addProjectByPath: async (path) => set({ tree: await window.api.addProjectByPath(path) }),
  removeProject: async (path) => set({ tree: await window.api.removeProject(path) }),
  run: async (target, key) => {
    set({ selectedKey: key })
    await window.api.run(target)
  },
  stop: async (key) => window.api.stop(key),
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
