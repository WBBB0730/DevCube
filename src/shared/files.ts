/** Files Tab 相关共享类型（术语见 CONTEXT.md）。 */

export interface FilesDirEntry {
  name: string
  /** 项目根内绝对逻辑路径（`/` 分隔） */
  path: string
  isDirectory: boolean
}

export type FilesReadResult =
  | { kind: 'text'; path: string; content: string; mtimeMs: number }
  | { kind: 'image'; path: string; dataUrl: string }
  | { kind: 'audio'; path: string; mediaUrl: string; mime: string }
  | { kind: 'video'; path: string; mediaUrl: string; mime: string }
  | { kind: 'other'; path: string; size: number }

/** Files Tab 音视频预览自定义协议（主进程 stream，渲染层 `<audio>`/`<video>`）。 */
export const FILES_MEDIA_SCHEME = 'dc-media'

/** 每项目 Files Tab UI 持久化（上次打开路径 + 树展开 + 最近打开）。 */
export interface FilesUiState {
  openPath: string | null
  /** 已展开目录的绝对逻辑路径 */
  expandedPaths: string[]
  /** 最近打开的文件（绝对逻辑路径，新→旧，最多 FILES_RECENT_MAX 条） */
  recentPaths: string[]
}

export const FILES_RECENT_MAX = 10

export const DEFAULT_FILES_UI: FilesUiState = {
  openPath: null,
  expandedPaths: [],
  recentPaths: []
}

/** 将 path 插到最近打开列表头部并去重截断。 */
export function pushRecentPath(
  recent: readonly string[],
  path: string,
  max = FILES_RECENT_MAX
): string[] {
  return [path, ...recent.filter((p) => p !== path)].slice(0, max)
}
