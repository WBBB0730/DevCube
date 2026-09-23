/** Files Tab 打开条目时的类型分流（见 docs/prd/files-tab.md）。 */
export type FilesOpenKind = 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'pptx' | 'other'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'])

/**
 * PPT（OOXML 演示文稿）：.pptx 与同一格式的放映版 / 模板 / 带宏变体（宏不执行）。
 * 老二进制 .ppt 不在内（没有可靠的纯前端渲染，仍占位）。
 */
export const PPTX_EXTS = ['pptx', 'ppsx', 'potx', 'pptm', 'ppsm', 'potm'] as const

/** file-type 对上表六种给出的 MIME（带宏的三种带 `.12` 后缀）。 */
const PPTX_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  'application/vnd.openxmlformats-officedocument.presentationml.template',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  'application/vnd.ms-powerpoint.slideshow.macroenabled.12',
  'application/vnd.ms-powerpoint.template.macroenabled.12'
])

/**
 * 「文件打开方式」各类扩展名（无点、小写）：打包时的文件关联声明、设置里的设为默认、
 * 树顶类型筛选共用同一张表，保证「设成默认的类型」恒能在 Files 面板内嵌预览。
 * 图片含 svg（打开分流仍为 text，Files 编辑器另给编辑 ↔ 预览）；音视频只列 Chromium 可播的容器。
 */
export const FILES_OPEN_WITH_EXTS = {
  image: [...IMAGE_EXT].map((e) => e.slice(1)).concat('svg'),
  pdf: ['pdf'],
  pptx: PPTX_EXTS,
  audio: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga'],
  video: ['mp4', 'webm', 'ogv']
} as const satisfies Record<string, readonly string[]>

export type FilesOpenWithCategory = keyof typeof FILES_OPEN_WITH_EXTS

/**
 * 各类对应的 MIME（Linux desktop entry 声明与 xdg-mime 设默认用；与扩展名表同源维护）。
 * 写 freedesktop shared-mime-info 登记的原名（如 PPT 带宏的 `macroEnabled` 大小写），不是 file-type 识别出的写法。
 */
export const FILES_OPEN_WITH_MIME: Record<FilesOpenWithCategory, readonly string[]> = {
  image: [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/x-icon',
    'image/vnd.microsoft.icon',
    'image/svg+xml'
  ],
  pdf: ['application/pdf'],
  pptx: [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
    'application/vnd.openxmlformats-officedocument.presentationml.template',
    'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
    'application/vnd.ms-powerpoint.slideshow.macroEnabled.12',
    'application/vnd.ms-powerpoint.template.macroEnabled.12'
  ],
  audio: ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/x-wav', 'audio/flac', 'audio/ogg'],
  video: ['video/mp4', 'video/webm', 'video/ogg']
}

/**
 * Chromium / Electron 可直接用 `<audio>` / `<video>` 播放的 MIME（不含 `; codecs=`）。
 * 探测到音视频但不在此表 → `other`（直接占位，不尝试播放）。
 */
const PLAYABLE_AUDIO_MIME = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/aac',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/ogg',
  'audio/webm',
  'audio/flac',
  'audio/x-m4a',
  'audio/x-flac'
])

const PLAYABLE_VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/ogg'])

/** 走内嵌 `<img>` data URL 的位图 MIME（svg 仍走文本编辑）。 */
const IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/x-ms-bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon'
])

/** 常见文本 / 源码扩展名；未知扩展名由调用方再用内容嗅探补判。 */
const TEXT_EXT = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.jsonc',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.html',
  '.htm',
  '.xml',
  '.svg',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.env',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.kts',
  '.c',
  '.h',
  '.cpp',
  '.cc',
  '.hpp',
  '.cs',
  '.php',
  '.swift',
  '.sql',
  '.graphql',
  '.vue',
  '.svelte',
  '.astro',
  '.lock',
  '.log',
  '.csv',
  '.tsv',
  '.editorconfig',
  '.gitignore',
  '.gitattributes',
  '.dockerignore',
  '.npmrc',
  '.nvmrc',
  '.prettierrc',
  '.eslintrc',
  '.babelrc'
])

/** 无扩展名但常当文本打开的文件名（小写比较）。 */
const TEXT_BASENAME = new Set([
  'dockerfile',
  'makefile',
  'gemfile',
  'rakefile',
  'procfile',
  'license',
  'readme',
  'changelog',
  'authors',
  'copying'
])

/** 去掉 MIME 参数（如 `audio/ogg; codecs=vorbis` → `audio/ogg`）。 */
export function primaryMime(mime: string): string {
  return mime.split(';')[0]!.trim().toLowerCase()
}

/**
 * 由内容探测得到的 MIME 映射到打开分流。
 * - 可播音视频 → audio / video
 * - 不可播音视频（如 mkv/wmv）→ other（直接占位）
 * - 位图 → image；svg → text
 * - PDF → pdf（内嵌 PDF.js 预览）
 * - PPT（pptx 及其变体）→ pptx（内嵌 pptx-renderer 预览）
 * - 其余 → null（交给扩展名或文本嗅探）
 */
export function filesOpenKindFromMime(mime: string): FilesOpenKind | null {
  const primary = primaryMime(mime)
  if (primary === 'image/svg+xml') return 'text'
  if (IMAGE_MIME.has(primary)) return 'image'
  if (primary === 'application/pdf') return 'pdf'
  if (PPTX_MIME.has(primary)) return 'pptx'
  if (primary.startsWith('audio/')) {
    return PLAYABLE_AUDIO_MIME.has(primary) ? 'audio' : 'other'
  }
  if (primary.startsWith('video/')) {
    return PLAYABLE_VIDEO_MIME.has(primary) ? 'video' : 'other'
  }
  return null
}

/** Markdown 文件（Files 编辑器对其提供编辑 ↔ 预览两态）。 */
export function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.markdown')
}

/** SVG 文件（打开分流仍为 text；Files 编辑器另提供编辑 ↔ 预览）。 */
export function isSvgPath(path: string): boolean {
  return path.toLowerCase().endsWith('.svg')
}

/** Markdown / SVG：工具栏出现编辑 ↔ 预览切换。 */
export function isPreviewableSourcePath(path: string): boolean {
  return isMarkdownPath(path) || isSvgPath(path)
}

/**
 * 按文件名（含扩展名）判定打开分流。
 * `.svg` 走文本（可编辑）；位图走图片预览。音视频以内容 MIME 为准，不靠扩展名。
 */
export function classifyFilesOpenKind(fileName: string): FilesOpenKind {
  const base = fileName.split(/[/\\]/).pop() ?? fileName
  const lower = base.toLowerCase()
  const dot = lower.lastIndexOf('.')
  const ext = dot >= 0 ? lower.slice(dot) : ''
  const stem = dot >= 0 ? lower.slice(0, dot) : lower

  if (IMAGE_EXT.has(ext)) return 'image'
  if (ext && TEXT_EXT.has(ext)) return 'text'
  if (!ext && TEXT_BASENAME.has(stem)) return 'text'
  if (!ext && TEXT_BASENAME.has(lower)) return 'text'
  // 点文件如 `.env`：ext 为整个名字
  if (lower.startsWith('.') && TEXT_EXT.has(lower)) return 'text'
  if (ext) return 'other'
  // 无扩展名且不在白名单 → other（避免把二进制当文本）
  return 'other'
}

/** 看图组件可展示的路径：位图，或可切图形预览的 SVG。 */
export function isImagePreviewPath(path: string): boolean {
  return classifyFilesOpenKind(path) === 'image' || isSvgPath(path)
}

const AV_EXT: ReadonlySet<string> = new Set([
  ...FILES_OPEN_WITH_EXTS.audio,
  ...FILES_OPEN_WITH_EXTS.video
])

const PPTX_EXT: ReadonlySet<string> = new Set(PPTX_EXTS)

/** PPT 文件（pptx 及其变体，按扩展名）。 */
export function isPptxPath(path: string): boolean {
  const lower = path.toLowerCase()
  const dot = lower.lastIndexOf('.')
  return dot >= 0 && PPTX_EXT.has(lower.slice(dot + 1))
}

/** 正文可内嵌预览、可用方向键前后切换的媒体：位图 / SVG / PDF / PPT / 可播音视频（按扩展名）。 */
export function isMediaPreviewPath(path: string): boolean {
  if (isImagePreviewPath(path) || isPptxPath(path)) return true
  const lower = path.toLowerCase()
  const dot = lower.lastIndexOf('.')
  const ext = dot >= 0 ? lower.slice(dot + 1) : ''
  return ext === 'pdf' || AV_EXT.has(ext)
}

/**
 * 给定一串条目（同目录列表或树里拍平的可见行，皆已按树序排好），当前媒体文件的上一个 / 下一个。
 * 只计入 `isMediaPreviewPath` 的文件；到头返回 null（不回绕）。
 */
export function adjacentMediaPath(
  entries: readonly { path: string; isDirectory: boolean }[],
  currentPath: string,
  dir: -1 | 1
): string | null {
  const media = entries.filter((e) => !e.isDirectory && isMediaPreviewPath(e.path))
  const idx = media.findIndex((e) => e.path === currentPath)
  if (idx < 0) return null
  return media[idx + dir]?.path ?? null
}

/** 若扩展名未知，用缓冲区嗅探：含 NUL 或大量非文本字节则 other，否则 text。 */
export function sniffTextBuffer(buf: Uint8Array, sampleBytes = 8192): boolean {
  const n = Math.min(buf.length, sampleBytes)
  if (n === 0) return true
  let suspicious = 0
  for (let i = 0; i < n; i++) {
    const b = buf[i]!
    if (b === 0) return false
    // 允许常见空白与打印 ASCII / 高位（UTF-8）；控制字符除 \t\n\r 外计可疑
    if (b < 32 && b !== 9 && b !== 10 && b !== 13) suspicious++
  }
  return suspicious / n < 0.1
}

/** 扩展名 unknown 时结合嗅探得到最终分流（不含 MIME；MIME 由主进程 file-type 处理）。 */
export function resolveFilesOpenKind(fileName: string, buf: Uint8Array | null): FilesOpenKind {
  const byName = classifyFilesOpenKind(fileName)
  if (byName !== 'other') return byName
  if (buf && sniffTextBuffer(buf)) return 'text'
  return 'other'
}
