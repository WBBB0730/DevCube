// Files 编辑器查找栏（Cmd+F）：编辑器顶部整宽一条、占位压下正文（对齐 WebStorm
// 编辑器查找栏形态，非悬浮层）；控件样式与终端搜索框 / 内容搜索面板同族。
// 引擎为 @codemirror/search 的 SearchQuery，高亮 / 计数 / 导航经 cm6-find 的积木；
// 命中色走既有 .cm-searchMatch 主题（WebStorm TEXT_SEARCH_RESULT）。
import { useEffect, useMemo, useRef, useState } from 'react'
import { SearchQuery } from '@codemirror/search'
import type { EditorView } from '@codemirror/view'
import { CaseSensitive, ChevronDown, ChevronUp, Regex, Search, WholeWord, X } from 'lucide-react'
import {
  collectFindMatches,
  currentFindIndex,
  FIND_MATCH_LIMIT,
  gotoFindMatch,
  setFindQuery
} from '@renderer/lib/cm6-find'
import { cn } from '@renderer/lib/utils'

// 方形开关钮（同内容搜索面板）；导航钮同 Git 查找部件
const TOGGLE_BTN = 'flex size-6 shrink-0 items-center justify-center rounded transition-colors'
const NAV_BTN =
  'flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)] disabled:pointer-events-none disabled:opacity-50'

export function FilesFindWidget({
  viewRef,
  content,
  focusNonce,
  onClose
}: {
  viewRef: React.RefObject<EditorView | null>
  /** 当前文档内容（编辑后据此重算命中） */
  content: string
  /** +1 重新聚焦输入框（浮层已开时再按 Cmd+F） */
  focusNonce: number
  onClose: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regexp, setRegexp] = useState(false)
  const [matches, setMatches] = useState<{ from: number; to: number }[]>([])
  /** 当前命中序号（1 起；0 = 未定位）；跳转后更新 */
  const [current, setCurrent] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const searchQuery = useMemo(
    () => new SearchQuery({ search: query, caseSensitive, wholeWord, regexp }),
    [query, caseSensitive, wholeWord, regexp]
  )

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusNonce])

  // 查询 / 选项 / 文档变化：下发高亮并重算命中与当前序号
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: setFindQuery.of(query === '' ? null : searchQuery) })
    const next = query === '' ? [] : collectFindMatches(view.state, searchQuery)
    setMatches(next)
    setCurrent(currentFindIndex(view.state, next))
  }, [searchQuery, query, content, viewRef])

  // 关闭 / 卸载时的高亮清理由父级（FilesTextEditor 的 findOpen effect）统一负责

  const navigate = (dir: 1 | -1): void => {
    const view = viewRef.current
    if (!view) return
    if (gotoFindMatch(view, matches, dir)) setCurrent(currentFindIndex(view.state, matches))
  }

  const close = (): void => {
    onClose()
    viewRef.current?.focus()
  }

  const invalidRegex = regexp && query !== '' && !searchQuery.valid
  const totalLabel = matches.length >= FIND_MATCH_LIMIT ? '999+' : String(matches.length)
  const countLabel =
    query === '' ? null : matches.length === 0 ? '无结果' : `${current || 1}/${totalLabel}`

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
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') {
            e.preventDefault()
            navigate(e.shiftKey ? -1 : 1)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            close()
          }
        }}
        placeholder="查找"
        className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
      />
      {invalidRegex ? (
        <span className="shrink-0 text-[11px] text-[color:var(--status-failed)]">
          无效的正则表达式
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
        onClick={() => setCaseSensitive((v) => !v)}
        className={toggleCls(caseSensitive)}
      >
        <CaseSensitive className="size-4" />
      </button>
      <button
        type="button"
        title="全词匹配"
        onClick={() => setWholeWord((v) => !v)}
        className={toggleCls(wholeWord)}
      >
        <WholeWord className="size-4" />
      </button>
      <button
        type="button"
        title="使用正则表达式"
        onClick={() => setRegexp((v) => !v)}
        className={toggleCls(regexp)}
      >
        <Regex className="size-4" />
      </button>
      <button
        type="button"
        title="上一个匹配 (Shift+Enter)"
        disabled={matches.length === 0}
        onClick={() => navigate(-1)}
        className={NAV_BTN}
      >
        <ChevronUp className="size-4" />
      </button>
      <button
        type="button"
        title="下一个匹配 (Enter)"
        disabled={matches.length === 0}
        onClick={() => navigate(1)}
        className={NAV_BTN}
      >
        <ChevronDown className="size-4" />
      </button>
      <button type="button" title="关闭 (Esc)" onClick={close} className={NAV_BTN}>
        <X className="size-4" />
      </button>
    </div>
  )
}
