import { create } from 'zustand'
import { normalizePath } from '@shared/files-path'
import { filesTabKey } from '@shared/runnable'
import { useApp } from '@renderer/store'

interface FilesStore {
  /** 外部请求打开的路径（Git「打开文件」等）；FilesPane 消费后清除 */
  pendingOpenByProject: Record<string, string | null>
  /** +1 驱动 FilesPane 聚焦文件树筛选框（⌥⌘F / Ctrl+Alt+F） */
  filterFocusNonceByProject: Record<string, number>
  /** 打开项目内文件：聚焦 Files Tab，并排队打开路径 */
  openInFiles: (projectPath: string, filePath: string) => void
  consumePendingOpen: (projectPath: string) => string | null
  /** 切到 Files Tab 并聚焦文件树筛选框（树若隐藏则先展开） */
  focusFilesFilter: (projectPath: string) => void
}

export const useFiles = create<FilesStore>((set, get) => ({
  pendingOpenByProject: {},
  filterFocusNonceByProject: {},
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
  },
  focusFilesFilter: (projectPath) => {
    set((s) => ({
      filterFocusNonceByProject: {
        ...s.filterFocusNonceByProject,
        [projectPath]: (s.filterFocusNonceByProject[projectPath] ?? 0) + 1
      }
    }))
    useApp.getState().activateTab(projectPath, filesTabKey(projectPath))
  }
}))
