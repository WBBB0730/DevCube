// Files 编辑器选区层：用官方 layer() 扩展点逐行画选区矩形，替代 drawSelection 的选区层
// （其层经主题置透明，光标层仍用官方）。相对官方画法的差异：矩形按**整行块高度**画
// （行距平摊进矩形、多行连续无缝）、跨行时行末**并入一格空格宽**代表换行符、圆角按
// 外轮廓合成（VS Code selections.ts 同款）——相邻行边缘先做亚像素吸附，每个角三态：
// 对齐接缝平直（flat）、轮廓外露角圆（round）、凹角以「反圆角补丁」出内圆弧（intern：
// 选区色小片垫底 + 编辑器底色带单角圆角的小片覆盖，露出的弧即内圆）。层画在文字之下，
// 补丁不遮字；活动行的等效半透明叠色（cm6-setup）盖在整层之上，观感均匀。
import type { Extension, SelectionRange } from '@codemirror/state'
import { Direction, EditorView, RectangleMarker, layer } from '@codemirror/view'

const RECT_CLASS = 'cm-filesSelectionRect'
const NOTCH_CLASS = 'cm-filesSelectionNotch'
/** 轮廓角半径（px）。等宽字体下台阶至少一格字宽，恒放得下圆弧。 */
const RADIUS = 3
/** 反圆角补丁宽度：只需 ≥ 半径，取 2 倍留余量。 */
const NOTCH_W = RADIUS * 2
/** 相邻行边缘吸附阈值（px）：行高非整数导致的亚像素差齐平成同一条直边。 */
const SNAP = 1

/** 角三态：外露圆角 / 对齐平直 / 凹角内圆（对齐 VS Code CornerStyle EXTERN/FLAT/INTERN）。 */
export type SelectionCorner = 'round' | 'flat' | 'intern'

export interface SelectionRectLayout {
  left: number
  right: number
  tl: SelectionCorner
  tr: SelectionCorner
  bl: SelectionCorner
  br: SelectionCorner
}

/**
 * 相邻行边缘吸附 + 角三态归类（纯函数，供测试）。凹角（intern）要求与相邻行**水平重叠**——
 * 行中起选、下一行又极短等不重叠场景按外露圆角处理（VS Code 同款守卫）。
 */
export function layoutSelectionEdges(
  edges: readonly { left: number; right: number }[],
  snap = SNAP
): SelectionRectLayout[] {
  const snapped = edges.map((e) => ({ ...e }))
  for (let i = 1; i < snapped.length; i++) {
    if (Math.abs(snapped[i].left - snapped[i - 1].left) < snap)
      snapped[i].left = snapped[i - 1].left
    if (Math.abs(snapped[i].right - snapped[i - 1].right) < snap)
      snapped[i].right = snapped[i - 1].right
  }
  return snapped.map((cur, i) => {
    const prev = i > 0 ? snapped[i - 1] : null
    const next = i < snapped.length - 1 ? snapped[i + 1] : null
    const left = (nb: { left: number; right: number } | null): SelectionCorner =>
      nb === null
        ? 'round'
        : cur.left === nb.left
          ? 'flat'
          : cur.left > nb.left && cur.left < nb.right
            ? 'intern'
            : 'round'
    const right = (nb: { left: number; right: number } | null): SelectionCorner =>
      nb === null
        ? 'round'
        : cur.right === nb.right
          ? 'flat'
          : cur.right < nb.right && cur.right > nb.left
            ? 'intern'
            : 'round'
    return {
      left: cur.left,
      right: cur.right,
      tl: left(prev),
      tr: right(prev),
      bl: left(next),
      br: right(next)
    }
  })
}

/**
 * 层坐标基准（对齐 drawSelection 的 getBase）：滚动容器客户端原点折算滚动量。
 * 不处理 CSS transform 缩放（应用内编辑器不缩放）。
 */
function layerBase(view: EditorView): { left: number; top: number } {
  const rect = view.scrollDOM.getBoundingClientRect()
  const left =
    view.textDirection === Direction.LTR ? rect.left : rect.right - view.scrollDOM.clientWidth
  return {
    left: left - view.scrollDOM.scrollLeft,
    top: rect.top - view.scrollDOM.scrollTop
  }
}

/** 一个选区在视口内的逐行矩形；换行符在选区内的行，右缘并入一格空格宽。 */
function rectanglesForRange(view: EditorView, range: SelectionRange): RectangleMarker[] {
  const from = Math.max(range.from, view.viewport.from)
  const to = Math.min(range.to, view.viewport.to)
  if (from > to) return []
  const base = layerBase(view)
  const rows: Array<{ left: number; right: number; top: number; height: number }> = []
  const doc = view.state.doc
  let pos = from
  for (;;) {
    const line = doc.lineAt(pos)
    const start = view.coordsAtPos(Math.max(range.from, line.from), 1)
    const end = view.coordsAtPos(Math.min(range.to, line.to), -1)
    if (start && end) {
      const block = view.lineBlockAt(line.from)
      const includesBreak = range.to > line.to
      rows.push({
        left: start.left - base.left,
        right: end.right - base.left + (includesBreak ? view.defaultCharacterWidth : 0),
        top: block.top + view.documentTop - base.top,
        height: block.height
      })
    }
    if (line.to >= to) break
    pos = line.to + 1
  }
  return layoutSelectionEdges(rows).flatMap((edge, i) => {
    const row = rows[i]
    const markers: RectangleMarker[] = []
    // 凹角反圆角补丁（VS Code 同款两层）：选区色垫底、编辑器底色带单角圆角覆盖，
    // 露出的弧即内圆。层在文字之下，补丁不遮字。
    if (edge.tl === 'intern' || edge.bl === 'intern') {
      const left = edge.left - NOTCH_W
      markers.push(new RectangleMarker(RECT_CLASS, left, row.top, NOTCH_W, row.height))
      const cls = [
        NOTCH_CLASS,
        ...(edge.tl === 'intern' ? ['cm-filesSelTR'] : []),
        ...(edge.bl === 'intern' ? ['cm-filesSelBR'] : [])
      ].join(' ')
      markers.push(new RectangleMarker(cls, left, row.top, NOTCH_W, row.height))
    }
    if (edge.tr === 'intern' || edge.br === 'intern') {
      markers.push(new RectangleMarker(RECT_CLASS, edge.right, row.top, NOTCH_W, row.height))
      const cls = [
        NOTCH_CLASS,
        ...(edge.tr === 'intern' ? ['cm-filesSelTL'] : []),
        ...(edge.br === 'intern' ? ['cm-filesSelBL'] : [])
      ].join(' ')
      markers.push(new RectangleMarker(cls, edge.right, row.top, NOTCH_W, row.height))
    }
    const main = [
      RECT_CLASS,
      ...(edge.tl === 'round' ? ['cm-filesSelTL'] : []),
      ...(edge.tr === 'round' ? ['cm-filesSelTR'] : []),
      ...(edge.bl === 'round' ? ['cm-filesSelBL'] : []),
      ...(edge.br === 'round' ? ['cm-filesSelBR'] : [])
    ].join(' ')
    markers.push(new RectangleMarker(main, edge.left, row.top, edge.right - edge.left, row.height))
    return markers
  })
}

const selectionLayer = layer({
  above: false,
  class: 'cm-filesSelectionLayer',
  update: (update) =>
    update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged,
  markers: (view) =>
    view.state.selection.ranges
      .filter((range) => !range.empty)
      .flatMap((range) => rectanglesForRange(view, range))
})

const selectionTheme = EditorView.baseTheme({
  '.cm-filesSelectionRect': {
    backgroundColor: 'var(--editor-selection)'
  },
  '.cm-filesSelectionNotch': {
    backgroundColor: 'var(--bg-deepest)'
  },
  '.cm-filesSelTL': { borderTopLeftRadius: `${RADIUS}px` },
  '.cm-filesSelTR': { borderTopRightRadius: `${RADIUS}px` },
  '.cm-filesSelBL': { borderBottomLeftRadius: `${RADIUS}px` },
  '.cm-filesSelBR': { borderBottomRightRadius: `${RADIUS}px` }
})

export const filesSelectionLayer: Extension = [selectionLayer, selectionTheme]
