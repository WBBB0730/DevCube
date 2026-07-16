import type { FilesDirEntry } from './files'

/** 相对项目根路径是否匹配树顶过滤查询（大小写不敏感包含；空查询视为恒真，由调用方短路）。 */
export function matchesFilesTreeFilter(relPath: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return relPath.toLowerCase().includes(q)
}

export interface FilesTreeFilterResult {
  childrenByDir: Record<string, FilesDirEntry[]>
  /** 过滤态下应展开的目录（含根），便于一眼看到命中 */
  expandedPaths: string[]
}

/**
 * 在已加载的目录映射上做树顶过滤：保留结构；路径包含匹配；目录命中则整支纳入；自动展开至命中。
 * 空查询原样返回 `childrenByDir`，`expandedPaths` 为空（不改浏览展开态）。
 */
export function filterFilesTree(
  rootPath: string,
  childrenByDir: Record<string, FilesDirEntry[]>,
  query: string
): FilesTreeFilterResult {
  const q = query.trim()
  if (!q) {
    return { childrenByDir, expandedPaths: [] }
  }

  const out: Record<string, FilesDirEntry[]> = {}
  const expanded = new Set<string>()

  const relOf = (logical: string): string => {
    if (logical === rootPath) return ''
    if (logical.startsWith(rootPath + '/')) return logical.slice(rootPath.length + 1)
    return logical
  }

  const walk = (dirPath: string, forceInclude: boolean): FilesDirEntry[] => {
    const entries = childrenByDir[dirPath] ?? []
    const visible: FilesDirEntry[] = []

    for (const e of entries) {
      const rel = relOf(e.path)
      const selfMatch = matchesFilesTreeFilter(rel, q)
      const includeAll = forceInclude || (e.isDirectory && selfMatch)

      if (e.isDirectory) {
        const childForce = includeAll
        const childVisible = walk(e.path, childForce)
        if (includeAll || selfMatch || childVisible.length > 0) {
          visible.push(e)
          expanded.add(e.path)
        }
      } else if (includeAll || selfMatch) {
        visible.push(e)
      }
    }

    out[dirPath] = visible
    return visible
  }

  walk(rootPath, false)
  expanded.add(rootPath)

  return { childrenByDir: out, expandedPaths: [...expanded] }
}
