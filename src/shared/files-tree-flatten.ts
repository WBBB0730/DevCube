import type { FilesDirEntry } from './files'

/** 文件树的一个可见行（按展开态拍平后的虚拟滚动渲染单元）。 */
export interface FilesTreeRow {
  path: string
  name: string
  /** 内容缩进层级：根的直接子级为 0 */
  depth: number
  isDirectory: boolean
  /** 提示行（如展开的目录读不出来时的「没有权限」）：name 即提示文字，不对应任何条目 */
  notice?: true
  /** 提示行是「正在读取…」：稍等才出现，读得快时不闪（见 TreeNoticeRow） */
  loading?: true
}

/** 提示行的键：目录路径后接 NUL，不会与任何条目路径撞上。 */
export function filesTreeNoticePath(dirPath: string): string {
  return `${dirPath}\0notice`
}

const NOTHING_LOADING: ReadonlySet<string> = new Set()

/**
 * 把「目录映射 + 展开集合」按展开态拍平成可见行数组（树行虚拟化用）：
 * 根自身不产行、其子级恒可见；其余目录仅展开时其子级进入结果；
 * 读不出来的目录（notices 里有它）在子级位置出一条提示行；正在读、还没读到的目录（loading 里有它）在子级位置出一条
 * 「正在读取…」；顺序即树自上而下的视觉序。
 */
export function flattenFilesTree(
  rootPath: string,
  childrenByDir: Record<string, FilesDirEntry[]>,
  expanded: ReadonlySet<string>,
  notices: Readonly<Record<string, string>> = {},
  loading: ReadonlySet<string> = NOTHING_LOADING
): FilesTreeRow[] {
  const rows: FilesTreeRow[] = []
  const walk = (dirPath: string, depth: number): void => {
    const notice = notices[dirPath]
    if (notice !== undefined) {
      rows.push({
        path: filesTreeNoticePath(dirPath),
        name: notice,
        depth,
        isDirectory: false,
        notice: true
      })
      return
    }
    const children = childrenByDir[dirPath]
    if (children === undefined && loading.has(dirPath)) {
      rows.push({
        path: filesTreeNoticePath(dirPath),
        name: '正在读取…',
        depth,
        isDirectory: false,
        notice: true,
        loading: true
      })
      return
    }
    for (const e of children ?? []) {
      rows.push({ path: e.path, name: e.name, depth, isDirectory: e.isDirectory })
      if (e.isDirectory && expanded.has(e.path)) walk(e.path, depth + 1)
    }
  }
  walk(rootPath, 0)
  return rows
}
