import type { FilesDirEntry } from './files'
import { FILES_OPEN_WITH_EXTS, classifyFilesOpenKind, isPptxPath } from './files-kind'

/**
 * 树顶类型筛选（docs/prd/file-preview-window.md）：只按扩展名归类，不读魔数；
 * 图片含 svg（与「文件打开方式」分组一致）；无扩展名 / 未知扩展名归「其他」。
 */
export const FILES_TYPE_CATEGORIES = ['image', 'pdf', 'pptx', 'av', 'text', 'other'] as const

export type FilesTypeCategory = (typeof FILES_TYPE_CATEGORIES)[number]

export const FILES_TYPE_CATEGORY_LABELS: Record<FilesTypeCategory, string> = {
  image: '图片',
  pdf: 'PDF',
  pptx: 'PPT',
  av: '音视频',
  text: '文本',
  other: '其他'
}

/** 树顶筛选把音频与视频并作「音视频」一类（「文件打开方式」里两者分开设默认）。 */
const AV_EXT: ReadonlySet<string> = new Set([
  ...FILES_OPEN_WITH_EXTS.audio,
  ...FILES_OPEN_WITH_EXTS.video
])

export function filesTypeCategory(fileName: string): FilesTypeCategory {
  const base = fileName.split(/[/\\]/).pop() ?? fileName
  const lower = base.toLowerCase()
  const dot = lower.lastIndexOf('.')
  const ext = dot >= 0 ? lower.slice(dot + 1) : ''
  if (ext === 'svg') return 'image'
  if (ext === 'pdf') return 'pdf'
  if (isPptxPath(lower)) return 'pptx'
  if (AV_EXT.has(ext)) return 'av'
  const kind = classifyFilesOpenKind(base)
  if (kind === 'image' || kind === 'text') return kind
  return 'other'
}

/** 全选 = 未筛选。 */
export function isFilesTypeFilterActive(selected: ReadonlySet<FilesTypeCategory>): boolean {
  return selected.size < FILES_TYPE_CATEGORIES.length
}

/**
 * 按类别过滤一层目录条目：目录恒保留，文件只留勾选类别。
 * 未筛选（全选）时原样返回同一引用，避免无谓重渲染。
 */
export function filterFilesEntriesByType(
  entries: readonly FilesDirEntry[],
  selected: ReadonlySet<FilesTypeCategory>
): readonly FilesDirEntry[] {
  if (!isFilesTypeFilterActive(selected)) return entries
  return entries.filter((e) => e.isDirectory || selected.has(filesTypeCategory(e.name)))
}

/** 对整棵目录映射逐层套用类别过滤；未筛选时返回原映射引用。 */
export function filterFilesTreeByType(
  childrenByDir: Record<string, FilesDirEntry[]>,
  selected: ReadonlySet<FilesTypeCategory>
): Record<string, FilesDirEntry[]> {
  if (!isFilesTypeFilterActive(selected)) return childrenByDir
  const out: Record<string, FilesDirEntry[]> = {}
  for (const [dir, entries] of Object.entries(childrenByDir)) {
    out[dir] = filterFilesEntriesByType(entries, selected) as FilesDirEntry[]
  }
  return out
}
