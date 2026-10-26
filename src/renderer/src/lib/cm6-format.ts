// 编辑器里的格式化（Files 编辑器、数据源的控制台与配置对话框共用，docs/prd/files-tab.md「格式化」）：格式化选中的部分
// （没选中为全文），只改真正变了的地方，不整篇替换——光标、选区与滚动位置跟着改动走，一次撤销回到格式化之前。
import {
  ChangeSet,
  type EditorState,
  type Extension,
  type TransactionSpec
} from '@codemirror/state'
import { keymap, type EditorView } from '@codemirror/view'

/** 一处修改：把原文 [offset, offset + length) 换成 content（同 jsonc-parser 的 Edit）。 */
export type FormatEdit = { offset: number; length: number; content: string }

const SPACE = /\s/

/**
 * before 与 after 只差空白时，二者之间的逐处修改：非空白字符逐个对应，相邻两个之间（及首尾）的空白不同即为一处；
 * 非空白字符对不上为 null。
 */
export function whitespaceEdits(before: string, after: string): FormatEdit[] | null {
  const edits: FormatEdit[] = []
  let i = 0
  let j = 0
  for (;;) {
    const beforeFrom = i
    const afterFrom = j
    while (i < before.length && SPACE.test(before[i])) i++
    while (j < after.length && SPACE.test(after[j])) j++
    const space = after.slice(afterFrom, j)
    if (before.slice(beforeFrom, i) !== space) {
      edits.push({ offset: beforeFrom, length: i - beforeFrom, content: space })
    }
    if (i === before.length || j === after.length) {
      return i === before.length && j === after.length ? edits : null
    }
    if (before[i] !== after[j]) return null
    i++
    j++
  }
}

/** 选中的部分（多个选区取主选区），没选中为全文。 */
function selectedRange(state: EditorState): { from: number; to: number } {
  const { main } = state.selection
  return main.empty ? { from: 0, to: state.doc.length } : main
}

/** 要排的一段：选中的部分（没选中为全文）去掉首尾空白，首尾的空白（如文末换行）原样留着；全是空白时为 null。 */
export function formatRange(state: EditorState): { from: number; to: number } | null {
  const { from, to } = selectedRange(state)
  const text = state.sliceDoc(from, to)
  const start = text.length - text.trimStart().length
  const end = text.trimEnd().length
  return start < end ? { from: from + start, to: from + end } : null
}

/**
 * 用排整段文字的 format（如 sql-formatter）格式化选中的部分（没选中为全文），换算成逐处修改。交给 format 的文字从选中处
 * （没选中为文首）起，它报错里的行列与之对应；排出来的首尾空白不要，只换 formatRange 那一段。只差空白时按非空白字符对齐，
 * 对不上（format 改了空白以外的字符）就整段换。format 排不了时抛出。
 */
export function textFormatEdits(
  state: EditorState,
  format: (text: string) => string
): FormatEdit[] {
  const range = formatRange(state)
  if (range === null) return []
  const before = state.sliceDoc(range.from, range.to)
  const after = format(state.sliceDoc(selectedRange(state).from, range.to)).trim()
  const edits = whitespaceEdits(before, after) ?? [
    { offset: 0, length: before.length, content: after }
  ]
  return edits.map((edit) => ({ ...edit, offset: edit.offset + range.from }))
}

/**
 * 逐处修改（offset 递增、互不重叠）写成一次事务。光标与选区按逐处修改映射；交给 CodeMirror 的改动则按行合并——同一行起头的
 * 并成一处：它每处改动都要重拼所在的行，压成一行的大 JSON 有几十万处修改，逐处交给它耗时随修改数平方增长（400 KB 约 9.5 万处
 * 就要十几秒），按行合并后与文字长度成正比。
 */
export function formatTransaction(
  state: EditorState,
  edits: readonly FormatEdit[]
): TransactionSpec {
  const doc = state.doc
  const changes: { from: number; to: number; insert: string }[] = []
  let lineEnd = -1
  for (const { offset, length, content } of edits) {
    const last = changes.at(-1)
    if (last !== undefined && offset <= lineEnd) {
      last.insert += doc.sliceString(last.to, offset) + content
      last.to = offset + length
    } else {
      changes.push({ from: offset, to: offset + length, insert: content })
      lineEnd = doc.lineAt(offset).to
    }
  }
  const exact = ChangeSet.of(
    edits.map(({ offset, length, content }) => ({
      from: offset,
      to: offset + length,
      insert: content
    })),
    doc.length
  )
  return { changes, selection: state.selection.map(exact), userEvent: 'format' }
}

/**
 * 格式化不了的原因，只取第一行：sql-formatter 的报错第一行说错在哪（第几行第几列、哪个记号），其后附着方言提示或语法分析的
 * 调试输出（可达几万字）。
 */
export function formatFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.split('\n', 1)[0]
}

/** 格式化编辑器：算出逐处修改写回。算不出（SQL 认不出）时不改，交回原因（formatFailure）；否则为 null。 */
export function formatInEditor(
  view: EditorView,
  edits: (state: EditorState) => readonly FormatEdit[]
): string | null {
  let computed: readonly FormatEdit[]
  try {
    computed = edits(view.state)
  } catch (error) {
    return formatFailure(error)
  }
  if (computed.length > 0) view.dispatch(formatTransaction(view.state, computed))
  return null
}

/** 格式化的快捷键 ⌥⌘L / Ctrl+Alt+L（SHORTCUT.format，对齐 WebStorm 的 Reformat Code），焦点在编辑器时。 */
export function formatKeymap(format: (view: EditorView) => void): Extension {
  return keymap.of([
    {
      key: 'Mod-Alt-l',
      run: (view) => {
        format(view)
        return true
      }
    }
  ])
}
