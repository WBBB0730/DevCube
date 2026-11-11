import { create } from 'zustand'
import type { AppShortcut } from '@shared/app-shortcut'
import { isAbsolutePath, normalizePath } from '@shared/files-path'
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
  /** 打开即固定（系统带来的文件，同预览窗口起手的那个） */
  pin?: boolean
}

/** Editor Tab 的键盘命令（docs/prd/files-editor-tabs.md「键位」）：⌘W 关闭、⇧⌘[ / ⇧⌘] 切换、⌘\ 向右分屏 */
export type FilesEditorCommand = 'close' | 'prev' | 'next' | 'split'

/** Editor Tab 的应用快捷键 → 交给 Files 面板的命令（主窗口与预览窗口壳共用） */
export const EDITOR_COMMAND_OF = {
  prevEditorTab: 'prev',
  nextEditorTab: 'next',
  splitEditor: 'split'
} as const satisfies Partial<Record<AppShortcut['id'], FilesEditorCommand>>

interface FilesStore {
  /** 外部请求打开的路径（Git「打开文件」/ 内容搜索 / 系统带进预览窗口的文件），按到达顺序排队；FilesPane 依次消费 */
  pendingOpenByProject: Record<string, readonly PendingFilesOpen[]>
  /**
   * +1 驱动 FilesPane 聚焦文件树顶的输入框（⌥⌘F / Ctrl+Alt+F；项目为筛选，服务器为「前往路径」）。
   * 键为条目键（项目路径或 `server:<id>`），预览窗口为其根路径
   */
  filterFocusNonceByKey: Record<string, number>
  /** +1 驱动 FilesPane 弹出「最近打开文件」下拉（⌘E / Ctrl+E）；键同上 */
  recentMenuNonceByKey: Record<string, number>
  /** 交给 FilesPane 的 Editor Tab 命令（nonce 每次 +1，同一命令连按也算新的）；键同上 */
  editorCommandByKey: Record<string, { command: FilesEditorCommand; nonce: number }>
  /** 打开项目内文件：聚焦 Files Tab，并排队打开路径（可带定位） */
  openInFiles: (projectPath: string, filePath: string, at?: FilesOpenPosition) => void
  /** 只排队打开、不碰 Tab（Preview Window 用：根路径即键） */
  queueOpen: (key: string, open: PendingFilesOpen) => void
  /** 取走排着的全部打开请求（按到达顺序） */
  consumePendingOpens: (key: string) => readonly PendingFilesOpen[]
  /** 切到条目的 Files Tab 并聚焦树顶输入框（树若隐藏则先展开） */
  focusFilesFilter: (entryKey: string) => void
  /** 只递增聚焦 nonce、不碰 Tab（Preview Window 用：根路径即键） */
  bumpFilesFilterFocus: (rootPath: string) => void
  /** 切到条目的 Files Tab 并弹出「最近打开文件」下拉 */
  openRecentMenu: (entryKey: string) => void
  /** 只递增下拉 nonce、不碰 Tab（Preview Window 用：根路径即键） */
  bumpRecentMenu: (rootPath: string) => void
  /** 把 Editor Tab 命令交给条目（或预览窗口根路径）的 Files 面板；调用方已确认 Files Tab 在前台 */
  sendEditorCommand: (key: string, command: FilesEditorCommand) => void
}

export const useFiles = create<FilesStore>((set, get) => ({
  pendingOpenByProject: {},
  filterFocusNonceByKey: {},
  recentMenuNonceByKey: {},
  editorCommandByKey: {},
  openInFiles: (projectPath, filePath, at) => {
    const logical = normalizePath(
      isAbsolutePath(filePath) ? filePath : `${projectPath}/${filePath}`
    )
    get().queueOpen(projectPath, { path: logical, at })
    useApp.getState().activateTab(projectPath, filesTabKey(projectPath))
  },
  queueOpen: (key, open) => {
    set((s) => ({
      pendingOpenByProject: {
        ...s.pendingOpenByProject,
        [key]: [...(s.pendingOpenByProject[key] ?? []), open]
      }
    }))
  },
  consumePendingOpens: (key) => {
    const pending = get().pendingOpenByProject[key] ?? []
    if (pending.length > 0) {
      set((s) => ({ pendingOpenByProject: { ...s.pendingOpenByProject, [key]: [] } }))
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
  },
  sendEditorCommand: (key, command) => {
    set((s) => ({
      editorCommandByKey: {
        ...s.editorCommandByKey,
        [key]: { command, nonce: (s.editorCommandByKey[key]?.nonce ?? 0) + 1 }
      }
    }))
  }
}))
