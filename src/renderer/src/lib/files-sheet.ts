/**
 * Files Tab 表格预览（Excel / CSV）的纯逻辑（docs/prd/files-xlsx-preview.md、ADR-0034）：
 * CSV 转工作簿、查找命中、缩放倍率。倍率是库的整数百分比（100 = 原大），库里每个尺寸都乘同一个倍率。
 */
import Papa from 'papaparse'
import { Workbook } from '@dukelib/sheets-wasm'
import { MEDIA_ZOOM_STEP } from './files-media-zoom'

/** 超过这个大小的 Excel 不在此预览：库在页面线程解析，文件太大会长时间卡住界面 */
export const XLSX_PREVIEW_MAX_BYTES = 10 * 1024 * 1024

/** CSV 列宽估算的下限 / 上限（Excel 列宽单位，约等于字符数）：下限是 Excel 默认列宽，上限免得一格长文把整列撑满一屏 */
const CSV_COL_MIN_WIDTH = 8.43
const CSV_COL_MAX_WIDTH = 50

/** 列号（0 起）→ 列名：0 → A、25 → Z、26 → AA */
export function sheetColumnName(col: number): string {
  let name = ''
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  return name
}

/**
 * 解析 CSV / TSV 为行：格子一律保持原文（不转数字、日期，前导零与长数字不丢）。
 * .tsv 固定按制表符分，.csv 自动识别分隔符（逗号 / 分号 / 制表符等）；文件末尾换行产生的空行不算一行。
 */
export function parseCsv(text: string, tsv: boolean): string[][] {
  const rows = Papa.parse<string[]>(text, { delimiter: tsv ? '\t' : '' }).data
  const last = rows.at(-1)
  if (last && last.length === 1 && last[0] === '') rows.pop()
  return rows
}

/** 显示宽度：中日韩等全角字符按两个字符算（估列宽用，不求精确） */
function displayWidth(line: string): number {
  let width = 0
  for (const ch of line) width += ch.codePointAt(0)! >= 0x2e80 ? 2 : 1
  return width
}

/** 按每列最长的一行文字估列宽（多行格子取最长那行），夹在默认列宽与上限之间 */
export function csvColumnWidths(rows: readonly string[][]): number[] {
  const widths: number[] = []
  for (const row of rows) {
    row.forEach((cell, col) => {
      let longest = 0
      for (const line of cell.split('\n')) longest = Math.max(longest, displayWidth(line))
      widths[col] = Math.max(widths[col] ?? 0, longest)
    })
  }
  // 加一个字符的留白，同 Excel 自动列宽
  return Array.from(widths, (w = 0) =>
    Math.min(CSV_COL_MAX_WIDTH, Math.max(CSV_COL_MIN_WIDTH, w + 1))
  )
}

/**
 * CSV / TSV 文本 → xlsx 字节，交表格预览显示。格子按原文写入（不按 Excel 规则转类型，`=` 开头也不当公式），
 * 列宽按内容估算。调用前须已初始化 WebAssembly（react-xlsx 的 `initWasm`）。
 */
export function csvToXlsxBytes(text: string, tsv: boolean): Uint8Array {
  const rows = parseCsv(text, tsv)
  // 新工作簿自带一张空表；WebAssembly 对象的内存交给垃圾回收释放（同 react-xlsx）
  const workbook = new Workbook()
  const sheet = workbook.getSheet(0)
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell === '') return
      const address = `${sheetColumnName(c)}${r + 1}`
      sheet.setCell(address, cell)
      // 引号里带换行的格子自动换行显示（同 Excel 打开 CSV），否则多行挤成一行
      if (cell.includes('\n')) sheet.setCellStyle(address, { alignment: { wrapText: true } })
    })
  })
  csvColumnWidths(rows).forEach((width, col) => {
    if (width > CSV_COL_MIN_WIDTH) sheet.setColumnWidth(col, width)
  })
  return workbook.saveXlsxBytes()
}

/** 一个有内容的格子及其显示文字（同表格里看到的） */
export type SheetCellText = { row: number; col: number; text: string }

export type SheetFindOptions = { caseSensitive: boolean; wholeWord: boolean }

const WORD_START = /^[\p{L}\p{N}_]/u
const WORD_END = /[\p{L}\p{N}_]$/u

/** `text` 里 [from, to) 两端是否落在词界上（同编辑器查找：查询自身两端不是词字符时不要求） */
function atWordBoundary(text: string, from: number, to: number): boolean {
  const before = text.slice(Math.max(0, from - 2), from)
  const after = text.slice(to, to + 2)
  const match = text.slice(from, to)
  const startOk = !WORD_END.test(before) || !WORD_START.test(match)
  const endOk = !WORD_START.test(after) || !WORD_END.test(match)
  return startOk && endOk
}

/** 查找命中的格子：显示文字含查询即命中，一格只算一次，保持传入的顺序（行优先） */
export function sheetFindMatches(
  cells: readonly SheetCellText[],
  query: string,
  { caseSensitive, wholeWord }: SheetFindOptions
): SheetCellText[] {
  if (query === '') return []
  const needle = caseSensitive ? query : query.toLowerCase()
  return cells.filter(({ text }) => {
    const hay = caseSensitive ? text : text.toLowerCase()
    for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
      if (!wholeWord || atWordBoundary(hay, at, at + needle.length)) return true
    }
    return false
  })
}

/** 从 `from`（打开查找 / 改查询时的活动格）起的第一个命中；其后没有则回到第一个 */
export function sheetFirstMatchFrom(
  matches: readonly SheetCellText[],
  from: { row: number; col: number } | null
): number {
  if (matches.length === 0) return -1
  if (!from) return 0
  const i = matches.findIndex((m) => m.row > from.row || (m.row === from.row && m.col >= from.col))
  return i >= 0 ? i : 0
}

function clampZoom(zoom: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, zoom))
}

/** 键盘逐档，同 PDF / PPT：乘 1.1 后按 10% 取整（放大向上、缩小向下），落在整齐倍率上 */
export function sheetStepZoom(zoom: number, steps: 1 | -1, min: number, max: number): number {
  const round = steps > 0 ? Math.ceil : Math.floor
  const delta = steps > 0 ? MEDIA_ZOOM_STEP : 1 / MEDIA_ZOOM_STEP
  return clampZoom(round(Number((zoom * delta).toFixed(0)) / 10) * 10, min, max)
}

/** Cmd/Ctrl+滚轮与捏合：连续倍率（调用方累积，提交给库时取整），夹在上下限之内 */
export function sheetWheelZoom(zoom: number, factor: number, min: number, max: number): number {
  return clampZoom(zoom * factor, min, max)
}

/** 换倍率后的滚动位置：表格整体按倍率缩放，让 `anchor`（视口内坐标）下的内容仍在 `anchor` 处 */
export function sheetScrollAfterZoom(
  scroll: { left: number; top: number },
  anchor: { x: number; y: number },
  from: number,
  to: number
): { left: number; top: number } {
  const ratio = to / from
  return {
    left: Math.max(0, (scroll.left + anchor.x) * ratio - anchor.x),
    top: Math.max(0, (scroll.top + anchor.y) * ratio - anchor.y)
  }
}
