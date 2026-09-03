// Files 编辑器查找（Cmd+F 浮层）的 CM 侧积木：查询状态、命中高亮、计数与导航。
// 匹配引擎复用 @codemirror/search 的 SearchQuery（官方给自定义查找 UI 的积木）；
// 不用其自带面板——官方高亮插件与面板生命周期绑死（面板关即不画），浮层形态自持
// 一份同款高亮插件。命中色走既有 .cm-searchMatch / .cm-searchMatch-selected 主题
// （cm6-setup 已按 WebStorm TEXT_SEARCH_RESULT 配好）。
import { SearchQuery } from '@codemirror/search'
import {
  EditorSelection,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'

/** 更新（或清空）当前查找查询；查询无效（如坏正则）时等同清空高亮。 */
export const setFindQuery = StateEffect.define<SearchQuery | null>()

const findQueryField = StateField.define<SearchQuery | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setFindQuery)) value = e.value
    return value
  }
})

const matchMark = Decoration.mark({ class: 'cm-searchMatch' })
const selectedMark = Decoration.mark({ class: 'cm-searchMatch cm-searchMatch-selected' })

/** 视口外扩画一段，滚动时不露白（官方 searchHighlighter 同款取值）。 */
const HIGHLIGHT_MARGIN = 250

const findHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(readonly view: EditorView) {
      this.decorations = this.highlight()
    }

    update(u: ViewUpdate): void {
      if (
        u.docChanged ||
        u.selectionSet ||
        u.viewportChanged ||
        u.state.field(findQueryField) !== u.startState.field(findQueryField)
      ) {
        this.decorations = this.highlight()
      }
    }

    highlight(): DecorationSet {
      const query = this.view.state.field(findQueryField)
      if (!query || !query.valid) return Decoration.none
      const { state } = this.view
      const sel = state.selection.main
      const builder = new RangeSetBuilder<Decoration>()
      for (const { from, to } of this.view.visibleRanges) {
        const cursor = query.getCursor(
          state,
          Math.max(0, from - HIGHLIGHT_MARGIN),
          Math.min(state.doc.length, to + HIGHLIGHT_MARGIN)
        )
        let step = cursor.next()
        while (!step.done) {
          const m = step.value
          if (m.to > m.from) {
            const isCurrent = m.from === sel.from && m.to === sel.to
            builder.add(m.from, m.to, isCurrent ? selectedMark : matchMark)
          }
          step = cursor.next()
        }
      }
      return builder.finish()
    }
  },
  { decorations: (v) => v.decorations }
)

/** 查找扩展（状态 + 高亮）；Mod-F 打开浮层的 keymap 由集成方注入（需 React 回调）。 */
export const filesFindExtension = [findQueryField, findHighlighter]

/** 命中总数封顶（超长文档 / 泛匹配防失控；界面显示「999+」）。 */
export const FIND_MATCH_LIMIT = 1000

/** 收集全文命中（封顶截断）；查询无效或空返回空数组。 */
export function collectFindMatches(
  state: EditorState,
  query: SearchQuery
): { from: number; to: number }[] {
  if (!query.valid || query.search === '') return []
  const out: { from: number; to: number }[] = []
  const cursor = query.getCursor(state)
  let step = cursor.next()
  while (!step.done) {
    const m = step.value
    if (m.to > m.from) {
      out.push({ from: m.from, to: m.to })
      if (out.length >= FIND_MATCH_LIMIT) break
    }
    step = cursor.next()
  }
  return out
}

/** 当前命中序号（1 起；选区不落在任何命中上为 0）。 */
export function currentFindIndex(
  state: EditorState,
  matches: readonly { from: number; to: number }[]
): number {
  const sel = state.selection.main
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].from === sel.from && matches[i].to === sel.to) return i + 1
  }
  return 0
}

/**
 * 跳到下一个 / 上一个命中（回绕循环）：命中设为选区并滚至视口中部。
 * 返回是否发生了跳转。
 */
export function gotoFindMatch(
  view: EditorView,
  matches: readonly { from: number; to: number }[],
  dir: 1 | -1
): boolean {
  if (matches.length === 0) return false
  const sel = view.state.selection.main
  let target: { from: number; to: number } | undefined
  if (dir === 1) {
    target = matches.find((m) => m.from > sel.from || (m.from === sel.from && m.to > sel.to))
    target ??= matches[0]
  } else {
    for (const m of matches) {
      if (m.from < sel.from) target = m
      else break
    }
    target ??= matches[matches.length - 1]
  }
  view.dispatch({
    selection: EditorSelection.range(target.from, target.to),
    effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
    userEvent: 'select.search'
  })
  return true
}
