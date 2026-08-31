import { compareFilesDirEntries, type FilesDirEntry } from './files'

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
 * 从扁平相对文件名单构建过滤树（文件名索引的内存匹配端，ADR-0027）：
 * 路径包含匹配；目录命中时子孙路径天然包含目录名、整支自然纳入；
 * 结果含命中文件的全部祖先目录并全展开。名单只含文件，空目录不出现。
 */
export function filterFilesListTree(
  rootPath: string,
  relFiles: readonly string[],
  query: string
): FilesTreeFilterResult {
  const q = query.trim()
  const childrenByDir: Record<string, FilesDirEntry[]> = { [rootPath]: [] }
  const seen = new Set<string>()

  for (const rel of relFiles) {
    if (!matchesFilesTreeFilter(rel, q)) continue
    const segs = rel.split('/')
    let parent = rootPath
    for (let i = 0; i < segs.length; i++) {
      const logical = `${parent}/${segs[i]}`
      const isDirectory = i < segs.length - 1
      if (!seen.has(logical)) {
        seen.add(logical)
        childrenByDir[parent].push({ name: segs[i], path: logical, isDirectory })
        if (isDirectory) childrenByDir[logical] = []
      }
      parent = logical
    }
  }

  for (const entries of Object.values(childrenByDir)) {
    entries.sort(compareFilesDirEntries)
  }
  return { childrenByDir, expandedPaths: Object.keys(childrenByDir) }
}
