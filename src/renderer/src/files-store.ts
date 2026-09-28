import { create } from 'zustand'
import { normalizePath } from '@shared/files-path'
import { filesTabKey } from '@shared/runnable'
import { useApp } from '@renderer/store'

/** 打开后定位到的位置（内容搜索跳转用）：1 起行号 + 行内字符区间。 */
export interface FilesOpenPosition {
  line: number
  col?: number
  endCol?: number
}

export interface PendingFilesOpen {
  path: string
  at?: FilesOpenPosition
}

interface FilesStore {
  /** 外部请求打开的路径（Git「打开文件」/ 内容搜索等）；FilesPane 消费后清除 */
  pendingOpenByProject: Record<string, PendingFilesOpen | null>
  /**
   * +1 驱动 FilesPane 聚焦文件树顶的输入框（⌥⌘F / Ctrl+Alt+F；项目为筛选，服务器为「前往路径」）。
   * 键为条目键（项目路径或 `server:<id>`），预览窗口为其根路径
   */
  filterFocusNonceByKey: Record<string, number>
  /** +1 驱动 FilesPane 弹出「最近打开文件」下拉（⌘E / Ctrl+E）；键同上 */
  recentMenuNonceByKey: Record<string, number>
  /** 打开项目内文件：聚焦 Files Tab，并排队打开路径（可带定位） */
  openInFiles: (projectPath: string, filePath: string, at?: FilesOpenPosition) => void
  consumePendingOpen: (projectPath: string) => PendingFilesOpen | null
  /** 切到条目的 Files Tab 并聚焦树顶输入框（树若隐藏则先展开） */
  focusFilesFilter: (entryKey: string) => void
  /** 只递增聚焦 nonce、不碰 Tab（Preview Window 用：根路径即键） */
  bumpFilesFilterFocus: (rootPath: string) => void
  /** 切到条目的 Files Tab 并弹出「最近打开文件」下拉 */
  openRecentMenu: (entryKey: string) => void
  /** 只递增下拉 nonce、不碰 Tab（Preview Window 用：根路径即键） */
  bumpRecentMenu: (rootPath: string) => void
}

export const useFiles = create<FilesStore>((set, get) => ({
  pendingOpenByProject: {},
  filterFocusNonceByKey: {},
  recentMenuNonceByKey: {},
  openInFiles: (projectPath, filePath, at) => {
    const logical = normalizePath(
      filePath.startsWith('/') || /^[a-zA-Z]:/.test(filePath)
        ? filePath
        : `${projectPath}/${filePath}`
    )
    set((s) => ({
      pendingOpenByProject: { ...s.pendingOpenByProject, [projectPath]: { path: logical, at } }
    }))
    useApp.getState().activateTab(projectPath, filesTabKey(projectPath))
  },
  consumePendingOpen: (projectPath) => {
    const pending = get().pendingOpenByProject[projectPath] ?? null
    if (pending) {
      set((s) => ({
        pendingOpenByProject: { ...s.pendingOpenByProject, [projectPath]: null }
      }))
    }
    return pending
  },
  focusFilesFilter: (entryKey) => {
    get().bumpFilesFilterFocus(entryKey)
    useApp.getState().activateTab(entryKey, filesTabKey(entryKey))
  },
  bumpFilesFilterFocus: (rootPath) => {
    set((s) => ({
      filterFocusNonceByKey: {
        ...s.filterFocusNonceByKey,
        [rootPath]: (s.filterFocusNonceByKey[rootPath] ?? 0) + 1
      }
    }))
  },
  openRecentMenu: (entryKey) => {
    get().bumpRecentMenu(entryKey)
    useApp.getState().activateTab(entryKey, filesTabKey(entryKey))
  },
  bumpRecentMenu: (rootPath) => {
    set((s) => ({
      recentMenuNonceByKey: {
        ...s.recentMenuNonceByKey,
        [rootPath]: (s.recentMenuNonceByKey[rootPath] ?? 0) + 1
      }
    }))
  }
}))
