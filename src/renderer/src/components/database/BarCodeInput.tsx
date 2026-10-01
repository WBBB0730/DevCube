// 栏里的单行编辑器（表数据顶栏的 WHERE / ORDER BY）：CodeMirror 单行编辑，调用方给语言（高亮与补全）；外观与按键同
// BarInput 的提交模式——透明底、聚焦时才压 `--bg-row-hover` 底，前面是等宽标签（13px 等宽，与文字正好隔一个字符宽，点它即
// 聚焦），有内容时末尾依次出「提交」与「清空」（按下时不抢编辑器的焦点）。回车提交；Esc 清空并离开编辑器，焦点交给下面的
// 表格（这一刻不在就只失焦），拦下不再冒泡给外层；补全浮层开着时回车接受补全、Esc 先关浮层。粘贴进来的换行换成空格，
// 始终一行。
import { useMemo, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { autocompletion } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { EditorState, type ChangeSpec, type Extension } from '@codemirror/state'
import { keymap, type EditorView } from '@codemirror/view'
import { BAR_INPUT_FRAME, BarInputActions, leaveBarInput } from '@renderer/components/ui/bar-input'
import { barEditorTheme, filesHighlighting } from '@renderer/lib/cm6-setup'
import { useApp } from '@renderer/store'

/** 始终一行：改动里带进来的换行（如粘贴）各换成一个空格。 */
const singleLine = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.newDoc.lines === 1) return tr
  const breaks: ChangeSpec[] = []
  for (let n = 1; n < tr.newDoc.lines; n++) {
    const { to } = tr.newDoc.line(n)
    breaks.push({ from: to, to: to + 1, insert: ' ' })
  }
  return [tr, { changes: breaks, sequential: true }]
})

/**
 * 单行编辑的基本功能：始终一行、撤销、补全（它的按键——回车接受、Esc 关浮层——优先级最高，浮层开着时先于组件的回车与
 * Esc）与常用的编辑按键。
 */
const SINGLE_LINE_BASICS: Extension = [
  singleLine,
  history(),
  autocompletion(),
  keymap.of([...defaultKeymap, ...historyKeymap])
]

export function BarCodeInput({
  value,
  onChange,
  onSubmit,
  submitTitle,
  onClear,
  escapeFocusRef,
  label,
  labelColor,
  extensions
}: {
  value: string
  onChange: (value: string) => void
  /** 回车（补全浮层没开时）或点末尾「提交」钮：交回编辑器里此刻的文字 */
  onSubmit: (value: string) => void
  /** 提交钮的悬停说明 */
  submitTitle: string
  /** Esc（补全浮层没开时）或点「清空」：调用方自己把值清空，再做连带的事（同 BarInput 的 onClear） */
  onClear: () => void
  /** Esc（补全浮层没开时）后焦点交给它：下面的表格（可聚焦的滚动容器）；这一刻不在时编辑器只失焦 */
  escapeFocusRef: React.RefObject<HTMLElement | null>
  /** 前置的等宽标签（如 SQL 子句关键字） */
  label: string
  /** 标签颜色（CSS 颜色值）；不给为 muted */
  labelColor?: string
  /** 语言（高亮与补全） */
  extensions: Extension
}): React.JSX.Element {
  const theme = useApp((s) => s.theme)
  const viewRef = useRef<EditorView | null>(null)

  // 回车与 Esc 的闭包直接引用调用方的回调，回调变了 extensions 换新、编辑器走一次 reconfigure（同 useEditorFind）；
  // 放在单行编辑的基本功能之前，先于其中的回车（换行）与 Esc（收起选区）
  const allExtensions = useMemo(
    () => [
      barEditorTheme[theme],
      filesHighlighting[theme],
      // eslint-disable-next-line react-hooks/refs -- 按键命令只在按下时调用，那时才读 escapeFocusRef，渲染时不读
      keymap.of([
        {
          key: 'Enter',
          run: (view) => {
            onSubmit(view.state.doc.toString())
            return true
          }
        },
        {
          key: 'Escape',
          run: (view) => {
            onClear()
            leaveBarInput(view.contentDOM, escapeFocusRef.current)
            return true
          }
        }
      ]),
      SINGLE_LINE_BASICS,
      extensions
    ],
    [theme, onSubmit, onClear, escapeFocusRef, extensions]
  )

  /** 点标签：聚焦编辑器，光标放到末尾（同点输入框的标签；已聚焦时不动光标） */
  const focusEditor = (e: React.MouseEvent): void => {
    const view = viewRef.current
    if (view === null) return
    e.preventDefault()
    if (view.hasFocus) return
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    view.focus()
  }

  return (
    <div
      className={BAR_INPUT_FRAME}
      // Esc 不再冒泡给外层（关补全浮层时也是）
      onKeyDown={(e) => {
        if (e.key === 'Escape') e.stopPropagation()
      }}
    >
      {/* 标签与编辑器之间只隔标签的 1ch（不吃外框的 gap） */}
      <div className="flex h-full min-w-0 flex-1 items-center">
        <span
          className="mr-[1ch] shrink-0 font-mono text-[13px] text-muted-foreground"
          style={{ color: labelColor }}
          onMouseDown={focusEditor}
        >
          {label}
        </span>
        <CodeMirror
          value={value}
          theme="none"
          basicSetup={false}
          // Tab 照常移走焦点
          indentWithTab={false}
          extensions={allExtensions}
          onChange={onChange}
          onCreateEditor={(view) => {
            viewRef.current = view
          }}
          className="min-w-0 flex-1 text-foreground"
        />
      </div>
      {value !== '' && (
        <BarInputActions
          onSubmit={() => onSubmit(value)}
          submitTitle={submitTitle}
          onClear={onClear}
        />
      )}
    </div>
  )
}
