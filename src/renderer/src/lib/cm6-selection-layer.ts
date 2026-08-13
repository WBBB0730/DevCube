// Files 编辑器选区层：用官方 layer() 扩展点逐行画选区矩形，替代 drawSelection 的选区层
// （其层经主题置透明，光标层仍用官方）。相对官方画法的差异：矩形按**整行块高度**画
// （行距平摊进矩形、多行连续无缝）、跨行时行末**并入一格空格宽**代表换行符、圆角按
// **外轮廓角归属**（VS Code 式）——相邻行边缘先做亚像素吸附，对齐的接缝平直贯通，
// 只有暴露在轮廓外且台阶放得下半径的角才圆；凹角不做内圆弧。活动行背景为等效半透明
// 叠色（cm6-setup），选区从其下透出。
import type { Extension, SelectionRange } from '@codemirror/state'
import { Direction, EditorView, RectangleMarker, layer } from '@codemirror/view'

const RECT_CLASS = 'cm-filesSelectionRect'
/** 轮廓角半径（px）；台阶小于它的角不圆（否则圆弧探进上下行的接缝出缺口）。 */
const RADIUS = 3
/** 相邻行边缘吸附阈值（px）：行高非整数导致的亚像素差齐平成同一条直边。 */
const SNAP = 1

export interface SelectionRectLayout {
  left: number
  right: number
  tl: boolean
  tr: boolean
  bl: boolean
  br: boolean
}

/**
 * 相邻行边缘吸附 + 外轮廓角归属（纯函数，供测试）。
 * 每行只带左右边缘（上下天然相接）；角圆的条件：无相邻行，或相邻行在该侧
 * 缩进 ≥ minStep（台阶足够放下圆弧）。凹角（相邻行更宽）恒不圆。
 */
export function layoutSelectionEdges(
  edges: readonly { left: number; right: number }[],
  snap = SNAP,
  minStep = RADIUS
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
    return {
      left: cur.left,
      right: cur.right,
      tl: prev === null || prev.left - cur.left >= minStep,
      tr: prev === null || cur.right - prev.right >= minStep,
      bl: next === null || next.left - cur.left >= minStep,
      br: next === null || cur.right - next.right >= minStep
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
  return layoutSelectionEdges(rows).map((edge, i) => {
    const cls = [
      RECT_CLASS,
      ...(edge.tl ? ['cm-filesSelTL'] : []),
      ...(edge.tr ? ['cm-filesSelTR'] : []),
      ...(edge.bl ? ['cm-filesSelBL'] : []),
      ...(edge.br ? ['cm-filesSelBR'] : [])
    ].join(' ')
    return new RectangleMarker(cls, edge.left, rows[i].top, edge.right - edge.left, rows[i].height)
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
  '.cm-filesSelTL': { borderTopLeftRadius: `${RADIUS}px` },
  '.cm-filesSelTR': { borderTopRightRadius: `${RADIUS}px` },
  '.cm-filesSelBL': { borderBottomLeftRadius: `${RADIUS}px` },
  '.cm-filesSelBR': { borderBottomRightRadius: `${RADIUS}px` }
})

export const filesSelectionLayer: Extension = [selectionLayer, selectionTheme]
