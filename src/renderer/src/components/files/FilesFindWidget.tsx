// 编辑器查找栏（Cmd+F，Files 编辑器与数据源的代码编辑器共用，键位见 lib/use-editor-find）：外壳为
// FindBar（与 PDF 预览共用），查询与选项来自查找会话（Files 里同一个文件的编辑与预览共用一份）；引擎为
// @codemirror/search 的 SearchQuery，高亮 / 计数 / 导航经 cm6-find 的积木；命中色走既有 .cm-searchMatch 主题
// （WebStorm TEXT_SEARCH_RESULT）。
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
import type { FindSession } from '@renderer/lib/use-find-session'
import { FindBar } from './FindBar'

export function FilesFindWidget({
  view,
  content,
  find
}: {
  /**
   * 编辑器；null = 还没建好。编辑器要等挂上之后的又一次渲染才建好，切回编辑、换文件的那一刻可能还是卸掉的旧实例，
   * 此时不算，等新的建好再算
   */
  view: EditorView | null
  /** 当前文档内容（编辑后据此重算命中） */
  content: string
  find: FindSession
}): React.JSX.Element {
  const { query, caseSensitive, wholeWord, regexp } = find.bar
  const [matches, setMatches] = useState<{ from: number; to: number }[]>([])
  /** 当前命中序号（1 起；0 = 未定位）；跳转后更新 */
  const [current, setCurrent] = useState(0)

  // literal：不开正则时按原字找（`\n` 等不当转义），与共用这份查询的预览、内容搜索一致
  const searchQuery = useMemo(
    () => new SearchQuery({ search: query, caseSensitive, wholeWord, regexp, literal: true }),
    [query, caseSensitive, wholeWord, regexp]
  )

  // 查询 / 选项 / 文档变化、编辑器建好：下发高亮并重算命中与当前序号
  useEffect(() => {
    if (!view?.dom.isConnected) return
    view.dispatch({ effects: setFindQuery.of(query === '' ? null : searchQuery) })
    const next = query === '' ? [] : collectFindMatches(view.state, searchQuery)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 与编辑器（外部系统）同步：下发查询后读回命中
    setMatches(next)
    setCurrent(currentFindIndex(view.state, next))
  }, [searchQuery, query, content, view])

  // 关闭 / 卸载时的高亮清理由父级的 useEditorFind 统一负责

  const navigate = (dir: 1 | -1): void => {
    if (!view) return
    if (gotoFindMatch(view, matches, dir)) setCurrent(currentFindIndex(view.state, matches))
  }

  const close = (): void => {
    find.closeFind()
    view?.focus()
  }

  const invalidRegex = regexp && query !== '' && !searchQuery.valid
  const totalLabel = matches.length >= FIND_MATCH_LIMIT ? '999+' : String(matches.length)
  const countLabel =
    query === '' ? null : matches.length === 0 ? '无结果' : `${current || 1}/${totalLabel}`

  return (
    <FindBar
      {...find.bar}
      countLabel={countLabel}
      invalidMessage={invalidRegex ? '无效的正则表达式' : null}
      canNavigate={matches.length > 0}
      onNavigate={navigate}
      onClose={close}
    />
  )
}
