/** Files Tab 打开条目时的类型分流（见 docs/prd/files-tab.md）。 */
export type FilesOpenKind = 'text' | 'image' | 'audio' | 'video' | 'other'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'])

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
 * - 非媒体/非图片 → null（交给扩展名或文本嗅探）
 */
export function filesOpenKindFromMime(mime: string): FilesOpenKind | null {
  const primary = primaryMime(mime)
  if (primary === 'image/svg+xml') return 'text'
  if (IMAGE_MIME.has(primary)) return 'image'
  if (primary.startsWith('audio/')) {
    return PLAYABLE_AUDIO_MIME.has(primary) ? 'audio' : 'other'
  }
  if (primary.startsWith('video/')) {
    return PLAYABLE_VIDEO_MIME.has(primary) ? 'video' : 'other'
  }
  return null
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
