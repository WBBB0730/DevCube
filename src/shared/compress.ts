import { childPathPrefix, lastPathSegment, logicalParentPath, normalizePath } from './files-path'
import { numberedName } from './numbered-name'

/**
 * 压缩（docs/prd/compress.md）的纯逻辑：默认名称与位置、重名递增、名称校验、Mac 专属文件匹配、
 * 勾选框的出现条件，以及主进程 ↔ 压缩窗口之间用 URL 查询串传递的启动参数。路径一律是规范化逻辑路径（`/`）。
 */

export const COMPRESS_QUERY_MODE = 'compress'

export const ARCHIVE_EXT = '.zip'

/** 压缩窗口的三个勾选项；记住上次的选择（全局，不分路径）。 */
export interface CompressOptions {
  /** 排除被 Git 忽略的文件：只对仓库里的内容生效，规则与 Git 一致 */
  excludeIgnored: boolean
  /** 排除 `.git`（仓库历史，含子模块的 gitlink 文件） */
  excludeGit: boolean
  /** 排除 Mac 专属文件（`.DS_Store`、`._` 开头的 AppleDouble 文件、`__MACOSX`） */
  excludeMacJunk: boolean
}

export type CompressOptionKey = keyof CompressOptions

/** 首次的默认值：三项都排除。 */
export const DEFAULT_COMPRESS_OPTIONS: CompressOptions = {
  excludeIgnored: true,
  excludeGit: true,
  excludeMacJunk: true
}

/** 存储里读回的勾选：缺项或类型不对的取默认值。 */
export function normalizeCompressOptions(stored: unknown): CompressOptions {
  const raw = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<
    string,
    unknown
  >
  const pick = (key: CompressOptionKey): boolean =>
    typeof raw[key] === 'boolean' ? raw[key] : DEFAULT_COMPRESS_OPTIONS[key]
  return {
    excludeIgnored: pick('excludeIgnored'),
    excludeGit: pick('excludeGit'),
    excludeMacJunk: pick('excludeMacJunk')
  }
}

/** 扫描时发现的内容特征（只看所选文件夹的内容，所选条目本身不算）：决定各勾选框是否出现。 */
export interface CompressContentFlags {
  /** 内容在仓库里，或里面有仓库 */
  hasRepo: boolean
  /** 内容里有 `.git` */
  hasDotGit: boolean
  /** 内容里有 Mac 专属文件 */
  hasMacJunk: boolean
}

/** 预览：将装入的文件（含符号链接）个数与文件总字节数。 */
export interface CompressPreview {
  files: number
  bytes: number
}

export interface CompressScanResult {
  flags: CompressContentFlags
  preview: CompressPreview
}

/** 预览请求的回复：读不了（如没有权限）时带上原因。 */
export type CompressScanResponse =
  ({ ok: true } & CompressScanResult) | { ok: false; message: string }

/**
 * 压缩窗口的尺寸：固定不变——按内容最多时（名称、位置、三个勾选框、底栏）定好，
 * 勾选框按内容出现、统计中的加载都在这块地方里进行，窗口建好即显示、之后不再改尺寸。
 */
export const COMPRESS_WINDOW_SIZE = { width: 480, height: 334 } as const

/** 主进程建窗前算好、经查询串交给压缩窗口的首帧内容（上次的勾选从启动快照的偏好里取）。 */
export interface CompressLaunch {
  /** 窗口标题里的名字：单个条目为它的名字，多选为「N 项」 */
  subject: string
  /** 默认位置（系统路径） */
  dir: string
  /** 默认名称（不含 `.zip`），已避开位置里同名的包 */
  name: string
}

export interface CompressStartRequest {
  /** 存放位置（系统路径） */
  dir: string
  /** 名称（不含 `.zip`） */
  name: string
  options: CompressOptions
}

export type CompressResult =
  { status: 'done' } | { status: 'canceled' } | { status: 'error'; message: string }

/** 各勾选框是否出现：内容里确实有可排除的东西才出现，所以不出现的那项勾不勾都一样。 */
export function visibleCompressOptions(
  flags: CompressContentFlags
): Record<CompressOptionKey, boolean> {
  return {
    excludeIgnored: flags.hasRepo,
    excludeGit: flags.hasDotGit,
    excludeMacJunk: flags.hasMacJunk
  }
}

function isFsRoot(p: string): boolean {
  return p === '/' || /^[A-Z]:\/$/.test(p)
}

/**
 * 所选条目的共同上层文件夹：单个条目为它所在的文件夹；Finder 列表视图可以跨子文件夹多选，
 * 所以多选取各自所在文件夹的最长公共前缀。也是默认位置与包内路径的起点。
 */
export function commonParentPath(paths: readonly string[]): string {
  const parents = paths.map((p) => logicalParentPath(normalizePath(p)))
  let common = parents[0] ?? '/'
  for (const parent of parents.slice(1)) {
    while (common !== parent && !parent.startsWith(childPathPrefix(common))) {
      if (isFsRoot(common)) break
      common = logicalParentPath(common)
    }
  }
  return common
}

/** 默认名称（不含 `.zip`）：单个条目取它的名字（文件保留扩展名），多选取共同上层文件夹的名字。 */
export function defaultArchiveName(paths: readonly string[], parent: string): string {
  if (paths.length === 1) return lastPathSegment(normalizePath(paths[0]))
  return isFsRoot(parent) ? '归档' : lastPathSegment(parent)
}

/**
 * 避开位置里已有的同名包：`名称.zip` 被占用则依次试「名称 (2)」「名称 (3)」……（编号格式全应用统一，见 numberedName）。
 * taken 为位置里已有的文件名；按不区分大小写比较（macOS、Windows 默认的文件系统都不区分）。
 */
export function nextFreeArchiveName(base: string, taken: Iterable<string>): string {
  const lower = new Set([...taken].map((n) => n.toLowerCase()))
  for (let seq = 1; ; seq++) {
    const candidate = numberedName(base, seq)
    if (!lower.has(`${candidate}${ARCHIVE_EXT}`.toLowerCase())) return candidate
  }
}

/** 名称不能用时的原因（禁用「压缩」钮时作悬停说明）；能用为 null。 */
export function archiveNameError(name: string, platform: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return '请输入名称'
  if (trimmed === '.' || trimmed === '..') return '名称不合法'
  if (platform === 'win32') {
    // eslint-disable-next-line no-control-regex -- Windows 文件名不允许控制字符
    if (/[<>:"/\\|?*\u0000-\u001f]/.test(trimmed)) return '名称不能包含 \\ / : * ? " < > |'
  } else if (trimmed.includes('/')) {
    return '名称不能包含 /'
  }
  return null
}

/** Mac 专属的文件夹：Finder 压缩包解开后留下的 `__MACOSX`，按名字认（只有 Mac 的压缩工具会生成这个名字）。 */
export function isMacJunkDirName(name: string): boolean {
  return name === '__MACOSX'
}

export type MacJunkFileKind = 'dsStore' | 'appleDouble'

/** 名字像 Mac 专属文件的：Finder 的 `.DS_Store`、AppleDouble 的 `._*`；是不是还要看文件头（isMacJunkHeader）。 */
export function macJunkFileKind(name: string): MacJunkFileKind | null {
  if (name === '.DS_Store') return 'dsStore'
  if (name.startsWith('._')) return 'appleDouble'
  return null
}

/** 判断要读的文件头字节数。 */
export const MAC_JUNK_HEADER_BYTES = 8

const APPLE_DOUBLE_MAGIC = [0x00, 0x05, 0x16, 0x07]
const DS_STORE_MAGIC = [0x00, 0x00, 0x00, 0x01, 0x42, 0x75, 0x64, 0x31] // 00 00 00 01 "Bud1"

/**
 * 文件头对得上才算 Mac 专属文件：AppleDouble 以 00 05 16 07 开头（RFC 1740），`.DS_Store` 以 00 00 00 01 "Bud1" 开头。
 * 名字像、内容不对的（如自己起名叫 `._notes.txt` 的普通文件）照常装进包里。
 */
export function isMacJunkHeader(kind: MacJunkFileKind, header: Uint8Array): boolean {
  const magic = kind === 'appleDouble' ? APPLE_DOUBLE_MAGIC : DS_STORE_MAGIC
  return header.length >= magic.length && magic.every((byte, i) => header[i] === byte)
}

/** 包内路径：相对共同上层文件夹（单个文件夹时顶层就是它本身，多选时各项并列在顶层）。 */
export function archiveEntryName(parent: string, path: string): string {
  return normalizePath(path).slice(childPathPrefix(parent).length)
}

/** 压缩窗口标题里的名字。 */
export function compressSubject(paths: readonly string[]): string {
  return paths.length === 1 ? lastPathSegment(normalizePath(paths[0])) : `${paths.length} 项`
}

export function buildCompressQuery(launch: CompressLaunch): Record<string, string> {
  return { mode: COMPRESS_QUERY_MODE, ...launch }
}

/** 渲染层从 `location.search` 解析；非压缩模式或缺项为 null。 */
export function parseCompressLaunch(search: string): CompressLaunch | null {
  const params = new URLSearchParams(search)
  if (params.get('mode') !== COMPRESS_QUERY_MODE) return null
  const subject = params.get('subject')
  const dir = params.get('dir')
  const name = params.get('name')
  if (!subject || !dir || name === null) return null
  return { subject, dir, name }
}
