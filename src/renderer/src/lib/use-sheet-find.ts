import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  SHEET_FIND_CURRENT_LAYER,
  SHEET_FIND_MATCH_LAYER,
  sheetFindMatches,
  sheetFirstMatchFrom,
  type SheetCellText
} from './files-sheet'

/** 格子的位置：行、列序号 */
type Cell = { row: number; col: number }

const cellKey = (row: number, col: number): string => `${row}:${col}`

/** 交给查找栏（FindBar）的：查询、选项、计数与各回调。 */
export interface SheetFindBar {
  query: string
  onQueryChange: (query: string) => void
  focusNonce: number
  countLabel: string | null
  caseSensitive: boolean
  onToggleCaseSensitive: () => void
  wholeWord: boolean
  onToggleWholeWord: () => void
  canNavigate: boolean
  onNavigate: (dir: 1 | -1) => void
  onClose: () => void
}

/**
 * 表格的 ⌘F 查找（Files 的表格预览与数据源的表格共用；命中规则见 files-sheet，查找栏是 FindBar）：格子的显示文字含
 * 查询即命中，命中格叠黄、当前命中叠橙（调用方按 layerOf 叠底色）；首个命中取起点格（打开查找、改查询或选项时的焦点格 /
 * 活动格）及之后的第一个，Enter / Shift+Enter 下一个 / 上一个。当前命中一变即交 reveal 选中并滚入视口（其他重渲染不再
 * 动选区与滚动）。scope 变了（换了数据、换了工作表）即作废查找进度，在新的范围里从头找。
 */
export function useSheetFind({
  buildCells,
  origin,
  reveal,
  scope,
  onClose
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
}): {
  open: boolean
  openFind: () => void
  closeFind: () => void
  /** 格子要叠的查找底色（CSS background-image 值）；没有要叠的为 null */
  layerOf: ((row: number, col: number) => string | undefined) | null
  bar: SheetFindBar
} {
  const [open, setOpen] = useState(false)
  const [focusNonce, setFocusNonce] = useState(0)
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  /** 这次查找从哪一格起，首个命中取它及之后的第一个；null = 从头 */
  const [from, setFrom] = useState<Cell | null>(null)
  /** 上一个 / 下一个选中的命中下标；null = 取 `from` 起的首个 */
  const [active, setActive] = useState<number | null>(null)

  // 换了范围即从头找：渲染期比对上一次的范围（React「渲染中调整 state」模式，非 effect）
  const [seenScope, setSeenScope] = useState(scope)
  if (scope !== seenScope) {
    setSeenScope(scope)
    setFrom(null)
    setActive(null)
  }

  const cells = useMemo(() => (open ? buildCells() : []), [open, buildCells])
  const matches = useMemo(
    () => sheetFindMatches(cells, query, { caseSensitive, wholeWord }),
    [cells, query, caseSensitive, wholeWord]
  )
  const current =
    active !== null && active < matches.length ? active : sheetFirstMatchFrom(matches, from)
  const currentMatch = current >= 0 ? matches[current]! : null

  // 当前命中一变就选中并滚入视口（拖列宽、缩放等重渲染不再动选区与滚动）
  const revealedFor = useRef<SheetCellText | null>(null)
  useEffect(() => {
    if (revealedFor.current === currentMatch) return
    revealedFor.current = currentMatch
    if (currentMatch) reveal(currentMatch)
  }, [currentMatch, reveal])

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

  /** 新一轮查找（打开 / 改查询 / 改选项）：从起点格找 */
  const restart = useCallback((): void => {
    setActive(null)
    setFrom(origin)
  }, [origin])

  const openFind = useCallback(() => {
    setOpen(true)
    setFocusNonce((n) => n + 1)
    restart()
  }, [restart])

  const closeFind = useCallback(() => {
    setOpen(false)
    onClose()
  }, [onClose])

  return {
    open,
    openFind,
    closeFind,
    layerOf,
    bar: {
      query,
      onQueryChange: (q) => {
        setQuery(q)
        restart()
      },
      focusNonce,
      countLabel:
        !open || query === ''
          ? null
          : matches.length === 0
            ? '无结果'
            : `${current + 1}/${matches.length}`,
      caseSensitive,
      onToggleCaseSensitive: () => {
        setCaseSensitive((v) => !v)
        restart()
      },
      wholeWord,
      onToggleWholeWord: () => {
        setWholeWord((v) => !v)
        restart()
      },
      canNavigate: matches.length > 0,
      onNavigate: (dir) => setActive((current + dir + matches.length) % matches.length),
      onClose: closeFind
    }
  }
}
