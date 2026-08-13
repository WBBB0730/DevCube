// Files 编辑器选区层：用官方 layer() 扩展点逐行画选区矩形，替代 drawSelection 的选区层
// （其层经主题置透明，光标层仍用官方）。相对官方画法的三点差异：矩形按**整行块高度**画
// （行距平摊进矩形、多行连续无缝）、跨行时行末**并入一格空格宽**代表换行符、矩形带 2px
// 圆角（逐行圆角，非外轮廓合成）。活动行背景为等效半透明叠色（cm6-setup），选区从其下透出。
import type { Extension, SelectionRange } from '@codemirror/state'
import { Direction, EditorView, RectangleMarker, layer } from '@codemirror/view'

const RECT_CLASS = 'cm-filesSelectionRect'

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
  const markers: RectangleMarker[] = []
  const doc = view.state.doc
  let pos = from
  for (;;) {
    const line = doc.lineAt(pos)
    const start = view.coordsAtPos(Math.max(range.from, line.from), 1)
    const end = view.coordsAtPos(Math.min(range.to, line.to), -1)
    if (start && end) {
      const block = view.lineBlockAt(line.from)
      const includesBreak = range.to > line.to
      markers.push(
        new RectangleMarker(
          RECT_CLASS,
          start.left - base.left,
          block.top + view.documentTop - base.top,
          end.right - start.left + (includesBreak ? view.defaultCharacterWidth : 0),
          block.height
        )
      )
    }
    if (line.to >= to) return markers
    pos = line.to + 1
  }
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
    backgroundColor: 'var(--editor-selection)',
    borderRadius: '2px'
  }
})

export const filesSelectionLayer: Extension = [selectionLayer, selectionTheme]
