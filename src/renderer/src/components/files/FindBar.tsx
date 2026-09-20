// Files 查找栏外壳（编辑器与 PDF 预览共用）：正文顶部整宽一条、占位压下正文（对齐 WebStorm
// 编辑器查找栏形态，非悬浮层）；控件样式与终端搜索框 / 内容搜索面板同族。引擎由调用方提供。
import { useEffect, useRef } from 'react'
import { CaseSensitive, ChevronDown, ChevronUp, Regex, Search, WholeWord, X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

// 方形开关钮（同内容搜索面板）；导航钮同 Git 查找部件
const TOGGLE_BTN = 'flex size-6 shrink-0 items-center justify-center rounded transition-colors'
const NAV_BTN =
  'flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)] disabled:pointer-events-none disabled:opacity-50'

export function FindBar({
  query,
  onQueryChange,
  focusNonce,
  countLabel,
  invalidMessage = null,
  caseSensitive,
  onToggleCaseSensitive,
  wholeWord,
  onToggleWholeWord,
  regexp = null,
  onToggleRegexp,
  canNavigate,
  onNavigate,
  onClose
}: {
  query: string
  onQueryChange: (query: string) => void
  /** +1 重新聚焦输入框（已开时再按 Cmd+F） */
  focusNonce: number
  /** 计数文案（如 `2/17`、`无结果`）；null 不显示 */
  countLabel: string | null
  /** 优先于计数显示的错误文案（如无效正则） */
  invalidMessage?: string | null
  caseSensitive: boolean
  onToggleCaseSensitive: () => void
  wholeWord: boolean
  onToggleWholeWord: () => void
  /** null = 不提供正则开关（PDF 文字层不支持正则） */
  regexp?: boolean | null
  onToggleRegexp?: () => void
  canNavigate: boolean
  onNavigate: (dir: 1 | -1) => void
  onClose: () => void
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusNonce])

  const toggleCls = (active: boolean): string =>
    cn(
      TOGGLE_BTN,
      active
        ? 'bg-[var(--selection-row)] text-foreground'
        : 'text-muted-foreground hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]'
    )

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-[var(--separator)] bg-panel px-2">
      <Search className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') {
            e.preventDefault()
            onNavigate(e.shiftKey ? -1 : 1)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}
        placeholder="查找"
        className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
      />
      {invalidMessage !== null ? (
        <span className="shrink-0 text-[11px] text-[color:var(--status-failed)]">
          {invalidMessage}
        </span>
      ) : (
        countLabel !== null && (
          <span className="shrink-0 text-right text-[11px] text-muted-foreground">
            {countLabel}
          </span>
        )
      )}
      <button
        type="button"
        title="区分大小写"
        onClick={onToggleCaseSensitive}
        className={toggleCls(caseSensitive)}
      >
        <CaseSensitive className="size-4" />
      </button>
      <button
        type="button"
        title="全词匹配"
        onClick={onToggleWholeWord}
        className={toggleCls(wholeWord)}
      >
        <WholeWord className="size-4" />
      </button>
      {regexp !== null && (
        <button
          type="button"
          title="使用正则表达式"
          onClick={onToggleRegexp}
          className={toggleCls(regexp)}
        >
          <Regex className="size-4" />
        </button>
      )}
      <button
        type="button"
        title="上一个匹配 (Shift+Enter)"
        disabled={!canNavigate}
        onClick={() => onNavigate(-1)}
        className={NAV_BTN}
      >
        <ChevronUp className="size-4" />
      </button>
      <button
        type="button"
        title="下一个匹配 (Enter)"
        disabled={!canNavigate}
        onClick={() => onNavigate(1)}
        className={NAV_BTN}
      >
        <ChevronDown className="size-4" />
      </button>
      <button type="button" title="关闭 (Esc)" onClick={onClose} className={NAV_BTN}>
        <X className="size-4" />
      </button>
    </div>
  )
}
