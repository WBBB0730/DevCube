/** Files Tab 相关共享类型（术语见 CONTEXT.md）。 */
import { normalizePath } from './files-path'

export interface FilesDirEntry {
  name: string
  /** 项目根内绝对逻辑路径（`/` 分隔） */
  path: string
  isDirectory: boolean
}

export type FilesReadResult =
  | { kind: 'text'; path: string; content: string; mtimeMs: number }
  | {
      kind: 'image'
      path: string
      mediaUrl: string
      mime: string
      width?: number
      height?: number
      /** 超大位图：走瓦片金字塔（`needsImageTiles`），渲染层先取预览图再叠瓦片 */
      tiled?: boolean
    }
  | { kind: 'audio'; path: string; mediaUrl: string; mime: string }
  | { kind: 'video'; path: string; mediaUrl: string; mime: string }
  | { kind: 'pdf'; path: string; mediaUrl: string }
  | { kind: 'other'; path: string; size: number }

/** Files Tab 媒体预览自定义协议（主进程 stream，渲染层 `<img>` / `<audio>` / `<video>` / 瓦片 / PDF）。 */
export const FILES_MEDIA_SCHEME = 'dc-media'

/** 构建仅限本应用渲染层使用的媒体 URL（项目根、文件路径、MIME）；主进程协议只放行登记项目内路径。 */
export function buildFilesMediaUrl(projectPath: string, filePath: string, mime: string): string {
  const u = new URL(`${FILES_MEDIA_SCHEME}://local/`)
  u.searchParams.set('p', normalizePath(projectPath))
  u.searchParams.set('f', normalizePath(filePath))
  u.searchParams.set('m', mime)
  return u.toString()
}

/** 应用自带静态资源包名：PDF.js 的字体映射表 / 标准字体 / wasm（ADR-0030）。 */
export const FILES_ASSET_PDFJS = 'pdfjs'

/**
 * 构建应用自带静态资源的 URL（`a=资源包&f=相对路径`）。`f` 必须是最后一个参数，且 `/` 不编码：
 * PDF.js 把它当前缀直接拼文件名（`…&f=cmaps/` + `UniGB-UCS2-H.bcmap`），并要求前缀以 `/` 结尾。
 */
export function buildFilesAssetUrl(asset: string, rel: string): string {
  const f = encodeURIComponent(rel).replace(/%2F/g, '/')
  return `${FILES_MEDIA_SCHEME}://local/?a=${encodeURIComponent(asset)}&f=${f}`
}

/** 瓦片金字塔缓存目录键（sha1 hex）；协议只放行形状合法的键。 */
export function isFilesTileKey(key: string): boolean {
  return /^[0-9a-f]{40}$/.test(key)
}

/** 构建金字塔缓存内文件（预览图 / 瓦片）的 URL；`rel` 相对该键目录。 */
export function buildFilesTileUrl(key: string, rel: string, mime: string): string {
  const u = new URL(`${FILES_MEDIA_SCHEME}://local/`)
  u.searchParams.set('t', key)
  u.searchParams.set('f', rel)
  u.searchParams.set('m', mime)
  return u.toString()
}

/** 树内同级排序：目录在前，名称大小写不敏感升序（listDir 与过滤树共用）。 */
export function compareFilesDirEntries(a: FilesDirEntry, b: FilesDirEntry): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

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
