// 数据源的表格（ADR-0042）：TanStack Table 9 管区域选择与列宽，TanStack Virtual 做行列双向虚拟化，只画视口里的格子。
// 「当前对象」的表数据、对象信息表与控制台结果共用。选中：点、拖选一片、按住 Shift 扩展、⌘A 全选、方向键移动；
// 复制为 TSV（可直接贴进 Excel）。表头可点排序（交给调用方查）、可拖右缘改列宽。
// ⌘F 查找（同 Files 的表格预览，useSheetFind）：只查交来的这些行，格子的显示文字含查询即命中；命中格叠黄、当前命中叠橙，
// 并选中当前命中、滚入视口；Enter / Shift+Enter 下一个 / 上一个，Esc 关闭；换了数据（翻页、改排序、重读）即从头找。
// 在「当前对象 / 当前键」一格里时是正文的焦点（见 useContentFocus）。
import { useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import Papa from 'papaparse'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  cellSelectionFeature,
  columnResizingFeature,
  columnSizingFeature,
  createColumnHelper,
  tableFeatures,
  useTable,
  type CellSelectionDirection
} from '@tanstack/react-table'
import { FindBar } from '@renderer/components/files/FindBar'
import { useContentFocus } from '@renderer/lib/data-source-content-focus'
import type { SheetCellText } from '@renderer/lib/files-sheet'
import { isPrimaryModifierEvent } from '@renderer/lib/shortcut-label'
import { useSheetFind } from '@renderer/lib/use-sheet-find'
import { cn } from '@renderer/lib/utils'
import { resultValueText } from '@shared/data-source-export'
import {
  cellText,
  type ResultColumn,
  type ResultValue,
  type TableSort
} from '@shared/data-source-query'

type Row = ResultValue[]

const features = tableFeatures({ cellSelectionFeature, columnSizingFeature, columnResizingFeature })
const helper = createColumnHelper<typeof features, Row>()

const ROW_H = 28
const HEADER_H = 32
/** 行号列宽 */
const GUTTER_W = 56
const MIN_COL_W = 60
const MAX_INITIAL_COL_W = 360
/** 等宽 12px 的字宽约 7.3px；初始列宽按表头与前 50 行的最长内容估 */
const CHAR_W = 7.3

const ARROW_DIRECTIONS: Record<string, CellSelectionDirection> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right'
}

function initialWidth(column: ResultColumn, rows: Row[], index: number): number {
  let chars = column.name.length + 3
  for (const row of rows.slice(0, 50)) {
    chars = Math.max(chars, cellText(row[index] ?? null).length)
  }
  return Math.min(MAX_INITIAL_COL_W, Math.max(MIN_COL_W, Math.ceil(chars * CHAR_W) + 20))
}

/** 悬停显示的完整内容（太长的截断，避免巨大的 tooltip）。 */
function titleOf(value: ResultValue): string {
  const text = cellText(value)
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text
}

export function DataGrid({
  ref,
  columns,
  rows,
  rowOffset = 0,
  sort,
  onSort
}: {
  /** 交出表格的滚动容器（可聚焦）：表数据顶栏的 WHERE / ORDER BY 框按 Esc 后把焦点交给它 */
  ref?: React.Ref<HTMLDivElement>
  columns: ResultColumn[]
  rows: Row[]
  /** 行号从这里往后数（翻页时为前面各页的行数） */
  rowOffset?: number
  sort?: TableSort | null
  /** 点表头：不传则表头不可点 */
  onSort?: (column: string) => void
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => scrollRef.current!, [])
  const tableColumns = useMemo(
    () =>
      helper.columns(
        columns.map((column, i) =>
          helper.accessor((row) => row[i], {
            id: String(i),
            header: column.name,
            size: initialWidth(column, rows, i),
            minSize: MIN_COL_W
          })
        )
      ),
    // 列宽只在列变了（换了结果）时重估；翻页不动用户拖过的列宽
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns]
  )
  const table = useTable({
    features,
    columns: tableColumns,
    data: rows,
    getRowId: (_row, index) => String(index),
    columnResizeMode: 'onChange'
  })
  const leafColumns = table.getAllLeafColumns()
  const tableRows = table.getRowModel().rows

  // eslint-disable-next-line react-hooks/incompatible-library -- tanstack virtual 实例天然可变，React Compiler 跳过本组件 memo 是预期行为
  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 20,
    // 行画在吸顶表头之下（下移 HEADER_H）：滚入视口时底边多留这一截，才不落在视口外
    scrollPaddingEnd: HEADER_H
  })
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: leafColumns.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => leafColumns[i]!.getSize(),
    overscan: 4,
    // 同上：列画在吸左的行号列之右
    scrollPaddingEnd: GUTTER_W
  })
  // 拖列宽后按新宽度重排列
  const sizing = table.state.columnSizing
  useLayoutEffect(() => columnVirtualizer.measure(), [sizing, columnVirtualizer])

  /** 焦点格的位置（列 id 即列序号）；没有焦点格为 null */
  const focusedCell = (): { row: number; col: number } | null => {
    const focused = table.getFocusedCell()
    return focused ? { row: focused.row.index, col: Number(focused.column.id) } : null
  }

  /** 焦点格滚入视口（方向键移动后）。 */
  const revealFocused = (): void => {
    const focused = focusedCell()
    if (!focused) return
    rowVirtualizer.scrollToIndex(focused.row)
    columnVirtualizer.scrollToIndex(focused.col)
  }

  /** 焦点回表格（关查找后；在「当前对象 / 当前键」一格里时也是正文的焦点） */
  const focusGrid = useCallback(() => scrollRef.current?.focus({ preventScroll: true }), [])
  useContentFocus(focusGrid)

  // —— 查找 ——
  /** 各格的显示文字（行优先） */
  const buildCells = useCallback(
    (): SheetCellText[] =>
      rows.flatMap((row, r) =>
        columns.map((_, c) => ({ row: r, col: c, text: cellText(row[c] ?? null) }))
      ),
    [rows, columns]
  )
  /** 选中命中的那一格并滚入视口 */
  const revealCell = useCallback(
    (cell: { row: number; col: number }) => {
      table.setFocusedCell(String(cell.row), String(cell.col))
      rowVirtualizer.scrollToIndex(cell.row)
      columnVirtualizer.scrollToIndex(cell.col)
    },
    [table, rowVirtualizer, columnVirtualizer]
  )
  const find = useSheetFind({
    buildCells,
    origin: focusedCell(),
    reveal: revealCell,
    scope: rows,
    onClose: focusGrid
  })

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const direction = ARROW_DIRECTIONS[e.key]
    if (direction !== undefined) {
      e.preventDefault()
      if (e.shiftKey) table.extendCellSelection(direction)
      else table.moveCellSelection(direction)
      revealFocused()
    } else if (e.key === 'a' && isPrimaryModifierEvent(e.nativeEvent)) {
      e.preventDefault()
      table.selectAllCells()
    } else if (e.key === 'Escape') {
      // 查找开着时先关查找（焦点在表格上），否则取消选中
      if (find.open) find.closeFind()
      else table.resetCellSelection(true)
    }
  }

  const onCopy = (e: React.ClipboardEvent): void => {
    // 选中的各块（按显示顺序的行列下标）：表格不在本地排序、不调列序，即 rows 与 columns 的下标
    const ranges = table.getCellSelectionBounds()
    if (ranges.length === 0) return
    e.preventDefault()
    const tsv = ranges
      .map((range) =>
        Papa.unparse(
          rows
            .slice(range.minRowIndex, range.maxRowIndex + 1)
            .map((row) =>
              row.slice(range.minColumnIndex, range.maxColumnIndex + 1).map(resultValueText)
            ),
          { delimiter: '\t', newline: '\n' }
        )
      )
      .join('\n\n')
    e.clipboardData.setData('text/plain', tsv)
  }

  const totalWidth = GUTTER_W + columnVirtualizer.getTotalSize()
  const virtualColumns = columnVirtualizer.getVirtualItems()
  const header = table.getHeaderGroups()[0]

  return (
    // ⌘F 在表格或查找栏里都接：已开时再按即重新聚焦查找框
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(e) => {
        if (
          e.key.toLowerCase() !== 'f' ||
          !isPrimaryModifierEvent(e.nativeEvent) ||
          e.altKey ||
          e.shiftKey
        )
          return
        e.preventDefault()
        e.stopPropagation()
        find.openFind()
      }}
    >
      {find.open && <FindBar {...find.bar} />}
      <div
        ref={scrollRef}
        tabIndex={0}
        className="relative min-h-0 flex-1 select-none overflow-auto bg-deepest font-mono text-[12px] outline-none"
        onKeyDown={onKeyDown}
        onCopy={onCopy}
      >
        <div
          className="relative"
          style={{ width: totalWidth, height: HEADER_H + rowVirtualizer.getTotalSize() }}
        >
          {/* 表头：吸顶；左上角与行号列吸左 */}
          <div
            className="sticky top-0 z-20 border-b border-[var(--separator)] bg-panel"
            style={{ width: totalWidth, height: HEADER_H }}
          >
            <div
              className="sticky left-0 z-10 h-full border-r border-[var(--separator)] bg-panel"
              style={{ width: GUTTER_W }}
            />
            {header &&
              virtualColumns.map((vc) => {
                const h = header.headers[vc.index]!
                const name = columns[vc.index]!.name
                const sorted = sort?.column === name ? sort.direction : null
                return (
                  <div
                    key={h.id}
                    className={cn(
                      'absolute top-0 flex h-full items-center gap-1 border-r border-[var(--separator)] px-2 font-sans text-[13px] font-medium text-foreground',
                      onSort && 'cursor-pointer hover:bg-[var(--bg-row-hover)]'
                    )}
                    style={{ left: GUTTER_W + vc.start, width: vc.size }}
                    title={name}
                    onClick={onSort ? () => onSort(name) : undefined}
                  >
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    {sorted === 'asc' && (
                      <ArrowUp className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    {sorted === 'desc' && (
                      <ArrowDown className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    {/* 拖右缘改列宽；双击回到初始宽度 */}
                    <div
                      className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize"
                      onMouseDown={h.getResizeHandler()}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={() => h.column.resetSize()}
                    />
                  </div>
                )
              })}
          </div>
          {rowVirtualizer.getVirtualItems().map((vr) => {
            const row = tableRows[vr.index]!
            const cells = row.getAllCells()
            return (
              <div
                key={vr.key}
                className="absolute left-0"
                style={{ top: HEADER_H + vr.start, width: totalWidth, height: ROW_H }}
              >
                <div
                  className="sticky left-0 z-10 flex h-full items-center justify-end border-b border-r border-[var(--separator)] bg-panel px-2 text-muted-foreground"
                  style={{ width: GUTTER_W }}
                >
                  {rowOffset + vr.index + 1}
                </div>
                {virtualColumns.map((vc) => {
                  const cell = cells[vc.index]!
                  const value = row.original[vc.index]!
                  const selected = cell.getIsSelected()
                  return (
                    <div
                      key={cell.id}
                      className={cn(
                        'absolute top-0 h-full truncate border-b border-r border-[var(--separator)] px-2 leading-[27px]',
                        columns[vc.index]!.type === 'number' && 'text-right',
                        value === null ? 'italic text-muted-foreground' : 'text-foreground',
                        selected && 'bg-[var(--selection-row)]',
                        cell.getIsFocused() &&
                          'outline outline-1 -outline-offset-1 outline-[color:var(--primary)]'
                      )}
                      style={{
                        left: GUTTER_W + vc.start,
                        width: vc.size,
                        backgroundImage: find.layerOf?.(vr.index, vc.index)
                      }}
                      title={titleOf(value)}
                      onMouseDown={cell.getSelectionStartHandler()}
                      onMouseEnter={cell.getSelectionExtendHandler()}
                    >
                      {cellText(value)}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
