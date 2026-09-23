import { FILES_OPEN_WITH_EXTS, classifyFilesOpenKind, isPptxPath } from './files-kind'

/**
 * 文件树里文件行的图标种类（docs/prd/files-tab.md）：按扩展名归到一组「文件 + 角标」的 lucide 图标，
 * PDF 用自绘的「文件 + PDF 字样」。只看名字不读盘；粒度取「一眼分得清大类」，不做逐语言图标。
 */
export type FilesTreeIconKind =
  | 'image'
  | 'pdf'
  | 'slides'
  | 'audio'
  | 'video'
  | 'text'
  | 'code'
  | 'json'
  | 'sheet'
  | 'shell'
  | 'archive'
  | 'file'

const AUDIO_EXT: ReadonlySet<string> = new Set(FILES_OPEN_WITH_EXTS.audio)
const VIDEO_EXT: ReadonlySet<string> = new Set(FILES_OPEN_WITH_EXTS.video)
/** 散文类文本：不是代码 */
const PROSE_EXT: ReadonlySet<string> = new Set(['md', 'markdown', 'txt', 'log'])
const JSON_EXT: ReadonlySet<string> = new Set(['json', 'jsonc'])
const SHEET_EXT: ReadonlySet<string> = new Set(['csv', 'tsv'])
const SHELL_EXT: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'fish', 'ps1'])
const ARCHIVE_EXT: ReadonlySet<string> = new Set([
  'zip',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'xz',
  '7z',
  'rar'
])

export function filesTreeIconKind(fileName: string): FilesTreeIconKind {
  const base = fileName.split(/[/\\]/).pop() ?? fileName
  const lower = base.toLowerCase()
  const dot = lower.lastIndexOf('.')
  const ext = dot >= 0 ? lower.slice(dot + 1) : ''
  if (ext === 'svg') return 'image'
  if (ext === 'pdf') return 'pdf'
  if (isPptxPath(lower)) return 'slides'
  if (AUDIO_EXT.has(ext)) return 'audio'
  if (VIDEO_EXT.has(ext)) return 'video'
  if (ARCHIVE_EXT.has(ext)) return 'archive'
  if (PROSE_EXT.has(ext)) return 'text'
  if (JSON_EXT.has(ext)) return 'json'
  if (SHEET_EXT.has(ext)) return 'sheet'
  if (SHELL_EXT.has(ext)) return 'shell'
  const kind = classifyFilesOpenKind(base)
  if (kind === 'image') return 'image'
  // 剩下的文本白名单（源码、配置、无扩展名的 Dockerfile / Makefile 等）一律当代码
  if (kind === 'text') return 'code'
  return 'file'
}
