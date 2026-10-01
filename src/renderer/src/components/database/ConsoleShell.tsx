// 数据源控制台的外壳（SQL 与 Redis 共用，docs/prd/database.md「控制台」「Redis」）：顶部工具栏——「执行」（能取消的执行中换成
// 「取消」，否则转圈并置灰；正在切换控制台上下文时置灰）与调用方的钮，其后上次执行的摘要，右端为调用方给的上下文（如「库」
// 「模式」）；其下编辑器（开补全）与结果上下两块约 2:3。⌘↵ 执行；还没执行时结果区留空。停在「控制台」一格时正文是编辑器，
// 结果区里的表格不登记正文焦点（见 useContentFocus）。
import { useMemo, useState } from 'react'
import { Prec, type Extension } from '@codemirror/state'
import { keymap, type EditorView } from '@codemirror/view'
import { Play, Square } from 'lucide-react'
import { BUSY_TRANSITION, BusyIcon, TOOLBAR_BTN } from '@renderer/components/ui/toolbar'
import { ContentFocusContext } from '@renderer/lib/data-source-content-focus'
import { shortcutTitle } from '@renderer/lib/shortcut-label'
import { useSpinUntilRest } from '@renderer/lib/use-spin-until-rest'
import { cn } from '@renderer/lib/utils'
import { SHORTCUT } from '@shared/shortcut-label'
import { CodeEditor } from './CodeEditor'

export function ConsoleShell({
  viewRef,
  text,
  onChange,
  language,
  running,
  disabled,
  onRun,
  onCancel,
  actions,
  summary,
  context,
  children
}: {
  viewRef: React.RefObject<EditorView | null>
  /** 控制台里写的内容（读到之前为 null，编辑器先不建） */
  text: string | null
  onChange: (value: string) => void
  /** 编辑器的语言（高亮与补全） */
  language: Extension
  running: boolean
  /** 另有原因不能执行（正在切换控制台上下文）：「执行」置灰，⌘↵ 不执行 */
  disabled: boolean
  /** 执行（⌘↵ 或点「执行」；执行中、不能执行时不会调） */
  onRun: () => void
  /** 给了则执行中「执行」换成「取消」，否则「执行」转圈并置灰；叫停有了结果才返回 */
  onCancel?: () => Promise<void>
  /** 「执行」之后的钮 */
  actions?: React.ReactNode
  /** 上次执行的摘要（执行中照旧显示上一次的） */
  summary: string | null
  /** 工具栏右端（如「库」「模式」） */
  context?: React.ReactNode
  /** 结果区；还没有结果时不给，留空 */
  children?: React.ReactNode
}): React.JSX.Element {
  // ⌘↵ 走 CodeMirror 的 keymap，放到最高优先级（默认 keymap 把它当插入空行）；闭包直接引用 running、disabled 与 onRun，
  // 变了 extensions 走一次 reconfigure（同 Files 编辑器的查找快捷键）
  const extensions = useMemo(
    () => [
      language,
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              if (!running && !disabled) onRun()
              return true
            }
          }
        ])
      )
    ],
    [language, running, disabled, onRun]
  )

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-[var(--separator)] bg-panel px-2">
        <div className="flex shrink-0 items-center gap-0.5">
          {running && onCancel !== undefined ? (
            <CancelButton onCancel={onCancel} />
          ) : (
            <RunButton running={running} disabled={disabled} onRun={onRun} />
          )}
          {actions}
        </div>
        <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{summary}</span>
        {context}
      </div>
      <div className="min-h-0 flex-[2] overflow-hidden border-b border-[var(--separator)] bg-deepest">
        {text !== null && (
          <CodeEditor
            viewRef={viewRef}
            value={text}
            onChange={onChange}
            completion
            extensions={extensions}
          />
        )}
      </div>
      <div className="relative min-h-0 flex-[3]">
        <ContentFocusContext.Provider value={null}>{children}</ContentFocusContext.Provider>
      </div>
    </div>
  )
}

/**
 * 「执行」钮：执行中（不能取消时）钮本身转圈并置灰、不可再点，执行完转回原位才恢复（同「刷新」钮，见 useSpinUntilRest）；
 * 另有原因不能执行时只置灰。
 */
function RunButton({
  running,
  disabled,
  onRun
}: {
  running: boolean
  disabled: boolean
  onRun: () => void
}): React.JSX.Element {
  const spin = useSpinUntilRest(running)
  return (
    <button
      type="button"
      title={shortcutTitle('执行', SHORTCUT.runStatement)}
      disabled={disabled || spin.spinning}
      className={cn(TOOLBAR_BTN, BUSY_TRANSITION)}
      onClick={() => onRun()}
    >
      <BusyIcon icon={Play} iconClassName="text-[color:var(--run-glyph)]" {...spin} />
    </button>
  )
}

/**
 * 「取消」钮（同运行会话的停止钮：实心红底、白色图标）：叫停进行中钮本身转圈并置灰、不可再点，叫停有了结果才恢复
 * （同「刷新」钮，见 useSpinUntilRest）。随执行中挂载，执行一结束就换回「执行」。
 */
function CancelButton({ onCancel }: { onCancel: () => Promise<void> }): React.JSX.Element {
  const [canceling, setCanceling] = useState(false)
  const spin = useSpinUntilRest(canceling)

  const cancel = async (): Promise<void> => {
    setCanceling(true)
    await onCancel()
    setCanceling(false)
  }

  return (
    <button
      type="button"
      title="取消"
      disabled={spin.spinning}
      className={cn(
        TOOLBAR_BTN,
        'bg-[var(--stop-active-bg)] text-white hover:bg-[var(--stop-active-bg-hover)] hover:text-white',
        BUSY_TRANSITION
      )}
      onClick={() => void cancel()}
    >
      <BusyIcon icon={Square} {...spin} />
    </button>
  )
}
