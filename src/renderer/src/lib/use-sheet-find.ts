import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  SHEET_FIND_CURRENT_LAYER,
  SHEET_FIND_MATCH_LAYER,
  sheetFindMatches,
  sheetFirstMatchFrom,
  type SheetCellText
} from './files-sheet'
import { compileTextFind } from './text-find'
import { useFindCursor } from './use-find-cursor'
import type { FindSession, FindSessionBar } from './use-find-session'

/** 格子的位置：行、列序号 */
type Cell = { row: number; col: number }

const cellKey = (row: number, col: number): string => `${row}:${col}`

/** 交给查找栏（FindBar）的：会话的查询与选项，加上计数、错误提示与导航。 */
export interface SheetFindBar extends Omit<FindSessionBar, 'regexp'> {
  /** null = 不提供正则开关 */
  regexp: boolean | null
  countLabel: string | null
  invalidMessage: string | null
  canNavigate: boolean
  onNavigate: (dir: 1 | -1) => void
  onClose: () => void
}

/**
 * 表格的 ⌘F 查找（Files 的表格预览与数据源的表格共用；命中规则见 text-find，查找栏是 FindBar）：格子的显示文字里有命中
 * 即算，命中格叠黄、当前命中叠橙（调用方按 layerOf 叠底色）；首个命中取起点格（每轮查找开始时的焦点格 / 活动格）及之后的
 * 第一个，Enter / Shift+Enter 下一个 / 上一个。当前命中一变即交 reveal 选中并滚入视口（其他重渲染不再动选区与滚动）。
 * scope 变了（换了数据、换了工作表）即作废查找进度，在新的范围里从头找。查找会话（开关、查询与选项）由调用方给：
 * Files 按文件记的那份（CSV 与编辑态共用），数据源表格自用一份。
 */
export function useSheetFind({
  buildCells,
  origin,
  reveal,
  scope,
  onClose,
  find,
  regexpToggle = false
}: {
  /** 各格的显示文字（行优先）：打开查找时建一次，之后每次输入只在其中搜；它变了（换了数据）重建。要保持同一个引用 */
  buildCells: () => SheetCellText[]
  /** 起点格：此刻的焦点格 / 活动格；没有为 null */
  origin: Cell | null
  /** 选中并滚入视口；要保持同一个引用 */
  reveal: (cell: Cell) => void
  /** 查找的范围：变了即从头找 */
  scope: unknown
  /** 关掉查找之后（焦点回表格）；要保持同一个引用 */
  onClose: () => void
  /** 查找会话 */
  find: FindSession
  /** 提供正则开关（与编辑态共用查找栏的 CSV 预览） */
  regexpToggle?: boolean
}): {
  open: boolean
  openFind: () => void
  closeFind: () => void
  /** 格子要叠的查找底色（CSS background-image 值）；没有要叠的为 null */
  layerOf: ((row: number, col: number) => string | undefined) | null
  bar: SheetFindBar
} {
  const { open, closeFind: closeSession } = find
  const { query, caseSensitive, wholeWord } = find.bar
  /** 开关藏起来时不按正则找 */
  const regexp = regexpToggle && find.bar.regexp
  /** 起点（`start`）= 本轮查找开始时的起点格，首个命中取它及之后的第一个；null = 从头 */
  const cursor = useFindCursor(find.round, origin)

  // 换了范围从头找：渲染期比对（React「渲染中调整 state」模式，非 effect）
  const [seenScope, setSeenScope] = useState(scope)
  if (scope !== seenScope) {
    setSeenScope(scope)
    cursor.restart(null)
  }

  const cells = useMemo(() => (open ? buildCells() : []), [open, buildCells])
  const finder = useMemo(
    () => compileTextFind(query, { caseSensitive, wholeWord, regexp }),
    [query, caseSensitive, wholeWord, regexp]
  )
  const matches = useMemo(() => (finder ? sheetFindMatches(cells, finder) : []), [cells, finder])
  const current = cursor.currentOf(matches.length, () => sheetFirstMatchFrom(matches, cursor.start))
  const currentMatch = current >= 0 ? matches[current]! : null

  // 首个命中一变、或按了上一个 / 下一个，就选中并滚入视口（拖列宽、缩放等重渲染不再动选区与滚动）
  const { claimReveal } = cursor
  useEffect(() => {
    if (claimReveal(currentMatch) && currentMatch) reveal(currentMatch)
  }, [claimReveal, currentMatch, reveal])

  const layerOf = useMemo(() => {
    if (!open || matches.length === 0) return null
    const all = new Set(matches.map((m) => cellKey(m.row, m.col)))
    const currentKey = currentMatch ? cellKey(currentMatch.row, currentMatch.col) : null
    return (row: number, col: number): string | undefined => {
      const key = cellKey(row, col)
      if (!all.has(key)) return undefined
      return key === currentKey ? SHEET_FIND_CURRENT_LAYER : SHEET_FIND_MATCH_LAYER
    }
  }, [open, matches, currentMatch])

  const closeFind = useCallback(() => {
    closeSession()
    onClose()
  }, [closeSession, onClose])

  return {
    open,
    openFind: find.openFind,
    closeFind,
    layerOf,
    bar: {
      ...find.bar,
      ...cursor.barOf(query, current, matches.length),
      regexp: regexpToggle ? find.bar.regexp : null,
      invalidMessage: finder === null ? '无效的正则表达式' : null,
      onClose: closeFind
    }
  }
}
