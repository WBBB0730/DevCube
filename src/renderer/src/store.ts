import { create } from 'zustand'
import type { ProjectNode, RunTarget, SessionState } from '@shared/types'

interface AppState {
  tree: ProjectNode[]
  sessions: Record<string, SessionState>
  selectedKey: string | null
  setTree: (tree: ProjectNode[]) => void
  setSession: (s: SessionState) => void
  select: (key: string) => void
  init: () => Promise<void>
  addProject: () => Promise<void>
  removeProject: (path: string) => Promise<void>
  run: (target: RunTarget, key: string) => Promise<void>
  stop: (key: string) => Promise<void>
}

export const useApp = create<AppState>((set) => ({
  tree: [],
  sessions: {},
  selectedKey: null,
  setTree: (tree) => set({ tree }),
  setSession: (s) => set((state) => ({ sessions: { ...state.sessions, [s.key]: s } })),
  select: (key) => set({ selectedKey: key }),
  init: async () => {
    const [tree, sessions] = await Promise.all([window.api.getTree(), window.api.getSessions()])
    set({ tree, sessions: Object.fromEntries(sessions.map((s) => [s.key, s])) })
  },
  addProject: async () => set({ tree: await window.api.addProject() }),
  removeProject: async (path) => set({ tree: await window.api.removeProject(path) }),
  run: async (target, key) => {
    set({ selectedKey: key })
    await window.api.run(target)
  },
  stop: async (key) => window.api.stop(key)
}))
