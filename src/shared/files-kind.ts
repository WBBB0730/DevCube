/** Files Tab 打开条目时的类型分流（见 docs/prd/files-tab.md）。 */
export type FilesOpenKind = 'text' | 'image' | 'other'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'])

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

/**
 * 按文件名（含扩展名）判定打开分流。
 * `.svg` 走文本（可编辑）；位图走图片预览。
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

/** 扩展名 unknown 时结合嗅探得到最终分流。 */
export function resolveFilesOpenKind(fileName: string, buf: Uint8Array | null): FilesOpenKind {
  const byName = classifyFilesOpenKind(fileName)
  if (byName !== 'other') return byName
  if (buf && sniffTextBuffer(buf)) return 'text'
  return 'other'
}
