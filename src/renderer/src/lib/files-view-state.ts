/**
 * Files 按文件记的阅读位置（docs/prd/files-tab.md「阅读位置」）：切走再切回来、在编辑与预览之间切换时据此恢复。
 * FilesPane 按文件路径各记一份（只在本次运行中，改名跟着走、删除即丢）交给正文视图；视图打开文件时读出自己那一格、
 * 看的过程中随时写回。
 */
import type { EditorSelection } from '@codemirror/state'
import type { MediaCamera, MediaFitMode } from './files-media-zoom'

/** 阅读位置里各视图记的那几格 */
export interface FilesViewStateFields {
  /** 视口顶边所在的源码行（0 起，小数部分是行内进度）：编辑器、Markdown 预览、CSV 表格共用，两态切换据此对齐 */
  line?: number
  /** 编辑器的选区 */
  selection?: EditorSelection
  /** 看图（位图与 SVG 预览）：所处的档（null = 自由倍率）、相机，及当时图的像素尺寸（尺寸变了即不再套用） */
  media?: { fit: MediaFitMode | null; camera: MediaCamera; width: number; height: number }
  /** PDF：PDF.js 的位置参数（页、档或倍率、页内坐标，即 `page=…&zoom=…`，同其阅读器的 URL 片段） */
  pdf?: string
  /** PPT：所处的档（null = 自由倍率，取 scale）、视口顶边所在的页（0 起，带页内比例）与横向位置（页面原尺寸单位） */
  pptx?: { fit: MediaFitMode | null; scale: number; page: number; left: number }
  /** 表格：工作表、倍率与视口左上角所在的列（0 起，带列内进度）；Excel 另记行（同上），CSV 的纵向记在 line 上 */
  sheet?: { tab: number; zoom: number; col: number; row?: number }
}

/**
 * 一个文件的阅读位置：可变、不参与渲染（同 ref），视图在挂载或载入时读出自己那一格、看的过程中随时写回。
 * 改名时整份挪到新路径，视图手里拿着的仍是同一份。
 */
export class FilesViewState {
  #fields: FilesViewStateFields = {}

  get<K extends keyof FilesViewStateFields>(key: K): FilesViewStateFields[K] {
    return this.#fields[key]
  }

  set<K extends keyof FilesViewStateFields>(key: K, value: FilesViewStateFields[K]): void {
    this.#fields[key] = value
  }

  /** 另起一份同样的（另一栏第一次打开这个文件时，从这一栏的位置开始，之后各记各的） */
  clone(): FilesViewState {
    const copy = new FilesViewState()
    copy.#fields = { ...this.#fields }
    return copy
  }
}

/**
 * 按「栏 + 文件」记的阅读位置：FilesPane 持有，键见 paneScopeKey（docs/prd/files-editor-tabs.md「按栏各一份的视图状态」）
 */
export type FilesViewMemory = Map<string, FilesViewState>

/** 这一份阅读位置，没有就建一份（同一个键恒为同一份） */
export function viewStateOf(memory: FilesViewMemory, key: string): FilesViewState {
  let state = memory.get(key)
  if (!state) {
    state = new FilesViewState()
    memory.set(key, state)
  }
  return state
}

/** 按栏各记一份的键：栏标识 + 文件路径（路径里不会有换行） */
export function paneScopeKey(paneId: string, path: string): string {
  return `${paneId}\n${path}`
}

/** 按栏记的键里的文件路径 */
function scopePath(key: string): string {
  return key.slice(key.indexOf('\n') + 1)
}

/**
 * 某栏第一次打开某文件时，取它在另一栏里记着的那份（阅读位置另起一份，查找原样沿用）；本栏已有或另一栏也没有时不动。
 */
export function seedPaneScope<V>(
  memory: Map<string, V>,
  paneId: string,
  path: string,
  otherPaneIds: readonly string[],
  copy: (value: V) => V
): void {
  const key = paneScopeKey(paneId, path)
  if (memory.has(key)) return
  for (const other of otherPaneIds) {
    const found = memory.get(paneScopeKey(other, path))
    if (found !== undefined) {
      memory.set(key, copy(found))
      return
    }
  }
}

/** 按「栏 + 文件」记的状态在改名时跟到新路径（`remap` 把改名范围内的路径换成新的，其余原样），栏不变 */
export function remapScopedKeys<V>(memory: Map<string, V>, remap: (path: string) => string): void {
  for (const [key, value] of [...memory]) {
    const path = scopePath(key)
    const moved = remap(path)
    if (moved === path) continue
    memory.delete(key)
    memory.set(paneScopeKey(key.slice(0, key.indexOf('\n')), moved), value)
  }
}

/** 按「栏 + 文件」记的状态在删除时丢掉 */
export function dropScopedKeys<V>(memory: Map<string, V>, gone: (path: string) => boolean): void {
  for (const key of [...memory.keys()]) if (gone(scopePath(key))) memory.delete(key)
}

/**
 * 源码行与视图位置的一个对应点。位置因视图而异：Markdown 预览是块顶边在滚动内容里的高度，CSV 表格是表格行号。
 */
export type LinePoint = { line: number; pos: number }

/**
 * 按文档顺序给出的对应点里，只留源码行与位置都严格递增的：同一行上嵌套的块留最外层，
 * 不按源码顺序排的（GFM 脚注区排在文末，源码却可能在中间）跳过。
 */
export function monotonicLinePoints(points: Iterable<LinePoint>): LinePoint[] {
  const kept: LinePoint[] = []
  for (const p of points) {
    const last = kept.at(-1)
    if (!last || (p.line > last.line && p.pos > last.pos)) kept.push(p)
  }
  return kept
}

/** 分段线性换算：在 `from` 坐标上落到两点之间按比例插值，超出两端贴边 */
function interpolate(
  points: readonly LinePoint[],
  value: number,
  from: keyof LinePoint,
  to: keyof LinePoint
): number {
  if (points.length === 0) return 0
  if (value <= points[0][from]) return points[0][to]
  const last = points[points.length - 1]
  if (value >= last[from]) return last[to]
  // 最后一个 from 不超过 value 的点（对半找）
  let lo = 0
  let hi = points.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (points[mid][from] <= value) lo = mid
    else hi = mid
  }
  const a = points[lo]
  const b = points[hi]
  return a[to] + ((value - a[from]) / (b[from] - a[from])) * (b[to] - a[to])
}

/** 源码行 → 视图位置（`points` 须经 monotonicLinePoints） */
export function posAtLine(points: readonly LinePoint[], line: number): number {
  return interpolate(points, line, 'line', 'pos')
}

/** 视图位置 → 源码行（`points` 须经 monotonicLinePoints） */
export function lineAtPos(points: readonly LinePoint[], pos: number): number {
  return interpolate(points, pos, 'pos', 'line')
}
