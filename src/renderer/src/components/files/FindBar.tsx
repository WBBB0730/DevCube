// Files 查找栏外壳（编辑器与 PDF 预览共用）：正文顶部整宽一条、占位压下正文（对齐 WebStorm
// 编辑器查找栏形态，非悬浮层）；控件样式与终端搜索框 / 内容搜索面板同族。引擎由调用方提供。
import { useEffect, useRef } from 'react'
import { CaseSensitive, ChevronDown, ChevronUp, Regex, Search, WholeWord, X } from 'lucide-react'
import { SHORTCUT } from '@shared/shortcut-label'
import { keepFocusOnPress, TOOLBAR_BTN_SM } from '@renderer/components/ui/toolbar'
import { shortcutTitle } from '@renderer/lib/shortcut-label'
import { cn } from '@renderer/lib/utils'

// 方形开关钮（同内容搜索面板）；导航钮（上 / 下一个、关闭）用工具栏小图标钮，同 Git 查找部件
const TOGGLE_BTN = 'flex size-6 shrink-0 items-center justify-center rounded transition-colors'

export function FindBar({
  query,
  onQueryChange,
  focusPending,
  onFocusHandled,
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
  /** 有一次待办的聚焦（打开查找、已开时再按 Cmd+F）：聚焦输入框并全选后调 onFocusHandled；恢复出来、切换编辑 / 预览时不抢焦点 */
  focusPending: boolean
  onFocusHandled: () => void
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
  /** 查找框拿走焦点之前焦点在哪（null 为哪儿都不在）：关掉查找时还回去 */
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!focusPending) return
    const input = inputRef.current
    const before = document.activeElement
    if (before !== input) {
      returnFocusRef.current =
        before instanceof HTMLElement && before !== document.body ? before : null
    }
    input?.focus()
    input?.select()
    onFocusHandled()
  }, [focusPending, onFocusHandled])

  /**
   * 从查找框关掉查找（Esc、关闭钮）：焦点回到打开查找之前的地方——原在正文里的回正文，原在文件树上的回文件树，原本哪儿都
   * 不在（或那个元素已经不在了）的就不落在任何地方。不因为查了一下就换了按键的归属（docs/prd/files-tab.md「按键归属」）。
   */
  const close = (): void => {
    const input = inputRef.current
    const fromInput = document.activeElement === input
    onClose()
    if (!fromInput) return
    const back = returnFocusRef.current
    if (back?.isConnected) back.focus({ preventScroll: true })
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }

  const toggleCls = (active: boolean): string =>
    cn(
      TOGGLE_BTN,
      active
        ? 'bg-[var(--selection-row)] text-foreground'
        : 'text-muted-foreground hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]'
    )

  return (
    <div
      className="flex h-9 shrink-0 items-center gap-1 border-b border-[var(--separator)] bg-panel px-2"
      // 点开关与上 / 下一个不抢焦点：焦点留在查找框里，回车接着找
      onMouseDown={keepFocusOnPress}
    >
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
            close()
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
        title={shortcutTitle('上一个匹配', SHORTCUT.findPrev)}
        disabled={!canNavigate}
        onClick={() => onNavigate(-1)}
        className={TOOLBAR_BTN_SM}
      >
        <ChevronUp className="size-4" />
      </button>
      <button
        type="button"
        title={shortcutTitle('下一个匹配', SHORTCUT.findNext)}
        disabled={!canNavigate}
        onClick={() => onNavigate(1)}
        className={TOOLBAR_BTN_SM}
      >
        <ChevronDown className="size-4" />
      </button>
      <button type="button" title="关闭 (Esc)" onClick={close} className={TOOLBAR_BTN_SM}>
        <X className="size-4" />
      </button>
    </div>
  )
}
