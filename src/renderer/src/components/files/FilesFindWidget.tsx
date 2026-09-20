// Files 编辑器查找栏（Cmd+F）：外壳为 FindBar（与 PDF 预览共用）；引擎为 @codemirror/search 的
// SearchQuery，高亮 / 计数 / 导航经 cm6-find 的积木；命中色走既有 .cm-searchMatch 主题
//（WebStorm TEXT_SEARCH_RESULT）。
import { useEffect, useMemo, useState } from 'react'
import { SearchQuery } from '@codemirror/search'
import type { EditorView } from '@codemirror/view'
import {
  collectFindMatches,
  currentFindIndex,
  FIND_MATCH_LIMIT,
  gotoFindMatch,
  setFindQuery
} from '@renderer/lib/cm6-find'
import { FindBar } from './FindBar'

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

  const searchQuery = useMemo(
    () => new SearchQuery({ search: query, caseSensitive, wholeWord, regexp }),
    [query, caseSensitive, wholeWord, regexp]
  )

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

  return (
    <FindBar
      query={query}
      onQueryChange={setQuery}
      focusNonce={focusNonce}
      countLabel={countLabel}
      invalidMessage={invalidRegex ? '无效的正则表达式' : null}
      caseSensitive={caseSensitive}
      onToggleCaseSensitive={() => setCaseSensitive((v) => !v)}
      wholeWord={wholeWord}
      onToggleWholeWord={() => setWholeWord((v) => !v)}
      regexp={regexp}
      onToggleRegexp={() => setRegexp((v) => !v)}
      canNavigate={matches.length > 0}
      onNavigate={navigate}
      onClose={close}
    />
  )
}
