// 运行配置的参数 `${{…}}` 的自动补全（docs/prd/run-config-params.md）：照代码编辑器补括号的通行规则（CodeMirror 的
// closeBrackets），输入 `${{` 时补上 `}}`、光标停在中间；在参数里输入 `}` 时跳过光标后已有的 `}`；刚补完、中间还空着
// 时按退格，连同补上的 `}}` 一起删掉。规则写成纯函数，命令配置的输入框（onParamInputKeyDown）与数据源上的配置的
// 编辑器（paramAutoClose）共用。
import { Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

/** 一次编辑：把 [from, to) 换成 insert，光标落到 cursor。 */
export interface ParamEdit {
  from: number
  to: number
  insert: string
  cursor: number
}

/** 光标后紧跟这类字符时不补：这时是在给已有文字加括号，补了会多出 `}}`。 */
const WORD_CHAR = /[\p{L}\p{N}_]/u

/** 光标在参数里：`${{` 之后，名称里没有花括号、不跨行，两个 `}` 还没写完。 */
const INSIDE_PARAM = /\$\{\{[^{}\r\n]*\}?$/

/**
 * 在 pos 处输入一个字符（光标没有选中文字）：归参数的规则管时交回要做的编辑，否则为 null（照常输入）。
 * `$` 之后的 `{` 照原样输入：编辑器自带的补括号会把它补成 `${}`，第二个 `{` 就补不对了。
 */
export function paramEditOnType(text: string, pos: number, ch: string): ParamEdit | null {
  const before = text.slice(0, pos)
  const next = text.charAt(pos)
  if (ch === '{') {
    if (before.endsWith('${')) {
      return WORD_CHAR.test(next) ? null : { from: pos, to: pos, insert: '{}}', cursor: pos + 1 }
    }
    if (before.endsWith('$')) return { from: pos, to: pos, insert: '{', cursor: pos + 1 }
    return null
  }
  if (ch === '}' && next === '}' && INSIDE_PARAM.test(before)) {
    return { from: pos, to: pos, insert: '', cursor: pos + 1 }
  }
  return null
}

/** 在 pos 处按退格（光标没有选中文字）：光标在空的 `${{` 与 `}}` 之间时，删掉刚输入的 `{` 与补上的 `}}`。 */
export function paramEditOnBackspace(text: string, pos: number): ParamEdit | null {
  if (text.slice(0, pos).endsWith('${{') && text.startsWith('}}', pos)) {
    return { from: pos - 1, to: pos + 2, insert: '', cursor: pos - 1 }
  }
  return null
}

/**
 * 命令配置里能写参数的输入框（命令、工作目录、环境变量的值）的 onKeyDown。改动经 execCommand 写入：这样会进入输入框
 * 原生的撤销记录，并照常触发 onChange；setRangeText、直接改 value 之后，⌘Z 撤不回更早的输入。
 */
export function onParamInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
  // 快捷键与输入法组字不管；Option 照常（有的键盘布局用它打出花括号）
  if (e.nativeEvent.isComposing || e.metaKey || e.ctrlKey) return
  const input = e.currentTarget
  const pos = input.selectionStart
  if (pos === null || pos !== input.selectionEnd) return
  const edit =
    e.key === 'Backspace'
      ? e.altKey
        ? null
        : paramEditOnBackspace(input.value, pos)
      : paramEditOnType(input.value, pos, e.key)
  if (edit === null) return
  e.preventDefault()
  if (edit.from !== edit.to || edit.insert !== '') {
    input.setSelectionRange(edit.from, edit.to)
    document.execCommand(edit.insert === '' ? 'delete' : 'insertText', false, edit.insert)
  }
  input.setSelectionRange(edit.cursor, edit.cursor)
}

/** 编辑器里只有一个光标、没有选中文字时，光标所在行与它在行里的位置；否则为 null。 */
function caretLine(view: EditorView): { text: string; base: number; pos: number } | null {
  const { ranges, main } = view.state.selection
  if (ranges.length > 1 || !main.empty) return null
  const line = view.state.doc.lineAt(main.head)
  return { text: line.text, base: line.from, pos: main.head - line.from }
}

function dispatchEdit(view: EditorView, base: number, edit: ParamEdit, userEvent: string): void {
  view.dispatch({
    changes: { from: base + edit.from, to: base + edit.to, insert: edit.insert },
    selection: { anchor: base + edit.cursor },
    scrollIntoView: true,
    userEvent
  })
}

/**
 * 数据源上的配置的编辑器：输入与退格先过参数的规则，优先于编辑器自带的补括号（closeBrackets），不归它管的照旧。
 * 参数不跨行，按光标所在行判断。
 */
export const paramAutoClose: Extension = Prec.high([
  EditorView.inputHandler.of((view, from, to, text) => {
    if (view.composing || text.length !== 1) return false
    const caret = caretLine(view)
    if (caret === null || from !== to || from !== caret.base + caret.pos) return false
    const edit = paramEditOnType(caret.text, caret.pos, text)
    if (edit === null) return false
    dispatchEdit(view, caret.base, edit, 'input.type')
    return true
  }),
  keymap.of([
    {
      key: 'Backspace',
      run: (view) => {
        const caret = caretLine(view)
        const edit = caret === null ? null : paramEditOnBackspace(caret.text, caret.pos)
        if (caret === null || edit === null) return false
        dispatchEdit(view, caret.base, edit, 'delete.backward')
        return true
      }
    }
  ])
])
