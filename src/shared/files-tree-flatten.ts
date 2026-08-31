import type { FilesDirEntry } from './files'

/** 文件树的一个可见行（按展开态拍平后的虚拟滚动渲染单元）。 */
export interface FilesTreeRow {
  path: string
  name: string
  /** 内容缩进层级：根的直接子级为 0 */
  depth: number
  isDirectory: boolean
}

/**
 * 把「目录映射 + 展开集合」按展开态拍平成可见行数组（树行虚拟化用）：
 * 根自身不产行、其子级恒可见；其余目录仅展开时其子级进入结果；
 * 顺序即树自上而下的视觉序。
 */
export function flattenFilesTree(
  rootPath: string,
  childrenByDir: Record<string, FilesDirEntry[]>,
  expanded: ReadonlySet<string>
): FilesTreeRow[] {
  const rows: FilesTreeRow[] = []
  const walk = (dirPath: string, depth: number): void => {
    for (const e of childrenByDir[dirPath] ?? []) {
      rows.push({ path: e.path, name: e.name, depth, isDirectory: e.isDirectory })
      if (e.isDirectory && expanded.has(e.path)) walk(e.path, depth + 1)
    }
  }
  walk(rootPath, 0)
  return rows
}
