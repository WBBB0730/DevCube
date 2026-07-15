import { create } from 'zustand'
import { normalizePath } from '@shared/files-path'
import { filesTabKey } from '@shared/runnable'
import { useApp } from '@renderer/store'

interface FilesStore {
  /** 外部请求打开的路径（Git「打开文件」等）；FilesPane 消费后清除 */
  pendingOpenByProject: Record<string, string | null>
  /** 打开项目内文件：聚焦 Files Tab，并排队打开路径 */
  openInFiles: (projectPath: string, filePath: string) => void
  consumePendingOpen: (projectPath: string) => string | null
}

export const useFiles = create<FilesStore>((set, get) => ({
  pendingOpenByProject: {},
  openInFiles: (projectPath, filePath) => {
    const logical = normalizePath(
      filePath.startsWith('/') || /^[a-zA-Z]:/.test(filePath)
        ? filePath
        : `${projectPath}/${filePath}`
    )
    set((s) => ({
      pendingOpenByProject: { ...s.pendingOpenByProject, [projectPath]: logical }
    }))
    useApp.getState().activateTab(projectPath, filesTabKey(projectPath))
  },
  consumePendingOpen: (projectPath) => {
    const path = get().pendingOpenByProject[projectPath] ?? null
    if (path) {
      set((s) => ({
        pendingOpenByProject: { ...s.pendingOpenByProject, [projectPath]: null }
      }))
    }
    return path
  }
}))
