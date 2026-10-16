/**
 * Files 文件树的选中（docs/prd/files-tree-move-copy.md「选中」「键盘」）：可多选，另有一个焦点行
 * （最近点选或键盘停留的行），⇧ 连选从锚点起算。纯函数，行序由调用方给（可见行、不含提示行）。
 */

export interface TreeSelection {
  paths: ReadonlySet<string>
  /** 焦点行：键盘从它出发、跟随滚动的目标 */
  focus: string | null
  /** ⇧ 连选的起点 */
  anchor: string | null
}

export const EMPTY_SELECTION: TreeSelection = { paths: new Set(), focus: null, anchor: null }

/** 只选中这一行（单击、从别处打开文件、右键没选中的行） */
export function selectOnly(path: string): TreeSelection {
  return { paths: new Set([path]), focus: path, anchor: path }
}

/** 选中一批（移动、复制、粘贴落定的条目）：锚点在第一个、焦点在最后一个 */
export function selectPaths(paths: readonly string[]): TreeSelection {
  return { paths: new Set(paths), focus: paths.at(-1) ?? null, anchor: paths[0] ?? null }
}

/** ⌘ / Ctrl 点选：切换这一行，焦点与锚点落到它 */
export function toggleSelected(selection: TreeSelection, path: string): TreeSelection {
  const paths = new Set(selection.paths)
  if (paths.has(path)) paths.delete(path)
  else paths.add(path)
  return { paths, focus: path, anchor: path }
}

/** ⇧ 点选 / ⇧ 方向键：选中锚点到 path 之间的行（锚点不在了就从 path 起），锚点不动 */
export function selectRange(
  selection: TreeSelection,
  rows: readonly string[],
  path: string
): TreeSelection {
  const to = rows.indexOf(path)
  if (to < 0) return selection
  const anchor =
    selection.anchor !== null && rows.includes(selection.anchor) ? selection.anchor : path
  const from = rows.indexOf(anchor)
  const [lo, hi] = from <= to ? [from, to] : [to, from]
  return { paths: new Set(rows.slice(lo, hi + 1)), focus: path, anchor }
}

/** 全选看得见的行 */
export function selectAll(selection: TreeSelection, rows: readonly string[]): TreeSelection {
  return { paths: new Set(rows), focus: selection.focus, anchor: selection.anchor }
}

/**
 * 原本看得见、现在看不见的（父文件夹被收起、被筛掉、已删除）移出选中；焦点与锚点同理。
 * 本来就还没出现的不动：打开别处的文件时，先选中再展开到它，行要稍后才出现。
 */
export function dropHidden(
  selection: TreeSelection,
  before: ReadonlySet<string>,
  after: ReadonlySet<string>
): TreeSelection {
  const hidden = (p: string): boolean => before.has(p) && !after.has(p)
  const paths = [...selection.paths].filter((p) => !hidden(p))
  const focus = selection.focus !== null && hidden(selection.focus) ? null : selection.focus
  const anchor = selection.anchor !== null && hidden(selection.anchor) ? null : selection.anchor
  if (
    paths.length === selection.paths.size &&
    focus === selection.focus &&
    anchor === selection.anchor
  ) {
    return selection
  }
  return { paths: new Set(paths), focus, anchor }
}

/** 路径整体换了（重命名、移动）：选中、焦点与锚点跟着换 */
export function remapSelection(
  selection: TreeSelection,
  remap: (path: string) => string
): TreeSelection {
  return {
    paths: new Set([...selection.paths].map(remap)),
    focus: selection.focus === null ? null : remap(selection.focus),
    anchor: selection.anchor === null ? null : remap(selection.anchor)
  }
}

/** 选中的行按树上自上而下的顺序（操作逐项执行、复制路径按这个顺序） */
export function selectedInOrder(selection: TreeSelection, rows: readonly string[]): string[] {
  return rows.filter((p) => selection.paths.has(p))
}

/** 树里一行的情况（方向键要看） */
export interface TreeKeyRow {
  path: string
  isDirectory: boolean
  expanded: boolean
}

/** 方向键的去向（同 WebStorm 的树） */
export type TreeArrowAction =
  | { kind: 'move'; path: string }
  | { kind: 'expand'; path: string }
  | { kind: 'collapse'; path: string }
  | null

/**
 * ↑ / ↓ 上一行 / 下一行（没有焦点行时从头 / 从尾起）；→ 在收起的文件夹上展开，其余同 ↓；
 * ← 在展开的文件夹上收起，其余跳到所在文件夹（所在文件夹是根时不动）。
 */
export function treeArrowAction(
  rows: readonly TreeKeyRow[],
  focus: string | null,
  key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight',
  parentOf: (path: string) => string
): TreeArrowAction {
  if (rows.length === 0) return null
  const index = focus === null ? -1 : rows.findIndex((r) => r.path === focus)
  const row = index < 0 ? null : rows[index]
  const step = (delta: 1 | -1): TreeArrowAction => {
    if (index < 0) return { kind: 'move', path: rows[delta === 1 ? 0 : rows.length - 1].path }
    const next = rows[index + delta]
    return next === undefined ? null : { kind: 'move', path: next.path }
  }
  if (key === 'ArrowDown') return step(1)
  if (key === 'ArrowUp') return step(-1)
  if (key === 'ArrowRight') {
    if (row?.isDirectory && !row.expanded) return { kind: 'expand', path: row.path }
    return step(1)
  }
  if (row === null) return step(-1)
  if (row.isDirectory && row.expanded) return { kind: 'collapse', path: row.path }
  const parent = parentOf(row.path)
  return rows.some((r) => r.path === parent) ? { kind: 'move', path: parent } : null
}
