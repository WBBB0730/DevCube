import { create } from 'zustand'
import type { ProjectNode } from '@shared/types'

interface AppState {
  tree: ProjectNode[]
  setTree: (tree: ProjectNode[]) => void
  init: () => Promise<void>
  addProject: () => Promise<void>
  removeProject: (path: string) => Promise<void>
}

export const useApp = create<AppState>((set) => ({
  tree: [],
  setTree: (tree) => set({ tree }),
  init: async () => set({ tree: await window.api.getTree() }),
  addProject: async () => set({ tree: await window.api.addProject() }),
  removeProject: async (path) => set({ tree: await window.api.removeProject(path) })
}))
