/** Files Tab 相关共享类型（术语见 CONTEXT.md）。 */
import { childPathPrefix, normalizePath } from './files-path'
import {
  EMPTY_EDITOR_LAYOUT,
  normalizeEditorLayout,
  openEditor,
  type EditorLayout
} from './files-editor-tabs'

/**
 * 符号链接的指向（docs/prd/symlinks.md）：target 为目标的真实路径（落在树的根下时换成树上的写法）；
 * 断链（目标不存在或绕成了圈）时为链接里写的原文。
 */
export interface FilesSymlink {
  target: string
  broken: boolean
}

export interface FilesDirEntry {
  name: string
  /** 项目根内绝对逻辑路径（`/` 分隔） */
  path: string
  /** 符号链接按目标的类型；断链不是文件夹 */
  isDirectory: boolean
  /** 条目是符号链接时给出指向 */
  symlink?: FilesSymlink
}

/**
 * 「转到链接目标」的去处（树上的路径）：链接没断、目标在树的根下（不含根自身）时给出，否则为 null。
 * 名称后的箭头可点与右键菜单项同一条规则（docs/prd/symlinks.md）。
 */
export function symlinkJumpTarget(symlink: FilesSymlink | undefined, root: string): string | null {
  if (symlink === undefined || symlink.broken) return null
  return symlink.target.startsWith(childPathPrefix(root)) ? symlink.target : null
}

/** 条目信息（跟随符号链接）：本机与服务器同形（FilesBackend.stat） */
export interface FilesStat {
  isDirectory: boolean
  size: number
  mtimeMs: number
}

/** 树上的一个条目：路径、是不是文件夹、是不是符号链接（删除、下载等可一次处理多个） */
export type FilesEntryRef = Pick<FilesDirEntry, 'path' | 'isDirectory' | 'symlink'>

/**
 * 移动 / 复制一个条目的结果（docs/prd/files-tree-move-copy.md）：成功给落定的新路径；目标处已有同名条目、
 * 又没说替换时给 conflict——由渲染端问过「替换 / 跳过」再来。
 */
export type FilesTransferResult = { path: string } | { conflict: true }

/** 文本进编辑器的大小上限；超过即不打开（本机与服务器同一条线）。 */
export const FILES_TEXT_MAX_BYTES = 5 * 1024 * 1024

/** Excel 表格预览的大小上限：库在页面线程解析，文件太大会长时间卡住界面（本机与服务器同一条线）。 */
export const FILES_XLSX_PREVIEW_MAX_BYTES = 10 * 1024 * 1024

export type FilesReadResult =
  /** mtimeMs 与 size 一起判断文件是否被别处改过 */
  | { kind: 'text'; path: string; content: string; mtimeMs: number; size: number }
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
  | { kind: 'pptx'; path: string; mediaUrl: string }
  /** `size` 供渲染层判断是否超过预览上限（表格在页面线程解析，太大会卡住界面） */
  | { kind: 'xlsx'; path: string; mediaUrl: string; size: number }
  /** SQLite 数据库文件：正文区嵌入 Data Source Tab 的视图（本机的 Files 面板才有） */
  | { kind: 'sqlite'; path: string }
  | { kind: 'other'; path: string; size: number }

/** Files Tab 媒体预览自定义协议（主进程 stream，渲染层 `<img>` / `<audio>` / `<video>` / 瓦片 / PDF / PPT / Excel）。 */
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
/** 应用自带静态资源包名：表格预览解析用的 WebAssembly（ADR-0034）。 */
export const FILES_ASSET_XLSX = 'xlsx'
/** 表格资源包里唯一放行的文件（@dukelib/sheets-wasm 的 WebAssembly） */
export const FILES_XLSX_WASM = 'duke_sheets_wasm_bg.wasm'

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

/** 新建 / 重命名的名称硬约束（单段、非空、不含分隔符）；合法为 null，其余交给文件系统报错。 */
export function filesEntryNameError(name: string): string | null {
  return name === '' || name === '.' || name === '..' || /[/\\]/.test(name) ? '名称无效' : null
}

/** 树内同级排序：目录在前，名称大小写不敏感升序（listDir 与过滤树共用）。 */
export function compareFilesDirEntries(a: FilesDirEntry, b: FilesDirEntry): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

/** 每个 Project / Server 的 Files Tab UI 持久化（打开的 Editor Tab + 树展开 + 最近打开）。 */
export interface FilesUiState {
  /** 打开的 Editor Tab 与分栏（docs/prd/files-editor-tabs.md「持久化」）；偏好关着时只有一个，即上次打开的文件 */
  editors: EditorLayout
  /** 已展开目录的绝对逻辑路径 */
  expandedPaths: string[]
  /** 最近打开的文件（绝对逻辑路径，新→旧，最多 FILES_RECENT_MAX 条） */
  recentPaths: string[]
}

export const FILES_RECENT_MAX = 10

export const DEFAULT_FILES_UI: FilesUiState = {
  editors: EMPTY_EDITOR_LAYOUT,
  expandedPaths: [],
  recentPaths: []
}

function stringList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : []
}

/**
 * 读回落盘的 Files UI：形状不对的回到默认；旧版只记了上次打开的路径（openPath），读成一个临时 Tab。
 * 布局只按形状整理、不按上限截断——上限随偏好开关，由面板读入时定。
 */
export function normalizeFilesUi(stored: unknown): FilesUiState {
  const raw = (stored ?? {}) as Record<string, unknown>
  const unlimited = Number.POSITIVE_INFINITY
  const editors =
    raw.editors !== undefined
      ? normalizeEditorLayout(raw.editors, unlimited)
      : typeof raw.openPath === 'string'
        ? openEditor(EMPTY_EDITOR_LAYOUT, raw.openPath, { limit: unlimited })
        : EMPTY_EDITOR_LAYOUT
  return {
    editors,
    expandedPaths: stringList(raw.expandedPaths),
    recentPaths: stringList(raw.recentPaths)
  }
}

/** 将 path 插到最近打开列表头部并去重截断。 */
export function pushRecentPath(
  recent: readonly string[],
  path: string,
  max = FILES_RECENT_MAX
): string[] {
  return [path, ...recent.filter((p) => p !== path)].slice(0, max)
}
