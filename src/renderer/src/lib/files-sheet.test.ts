import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import { initSync, Workbook } from '@dukelib/sheets-wasm'
import {
  csvColumnWidths,
  csvToXlsxBytes,
  parseCsv,
  sheetColumnName,
  sheetFindMatches,
  sheetFirstMatchFrom,
  sheetScrollAfterZoom,
  sheetStepZoom,
  sheetWheelZoom,
  type SheetCellText
} from './files-sheet'

beforeAll(() => {
  const require = createRequire(import.meta.url)
  const wasm = require.resolve('@dukelib/sheets-wasm/duke_sheets_wasm_bg.wasm')
  initSync({ module: readFileSync(wasm) })
})

describe('sheetColumnName', () => {
  it('0 起的列号换成 Excel 列名', () => {
    expect(sheetColumnName(0)).toBe('A')
    expect(sheetColumnName(25)).toBe('Z')
    expect(sheetColumnName(26)).toBe('AA')
    expect(sheetColumnName(701)).toBe('ZZ')
    expect(sheetColumnName(702)).toBe('AAA')
  })
})

describe('parseCsv', () => {
  it('.csv 自动识别分隔符，引号里的逗号与换行留在格内', () => {
    expect(parseCsv('a;b\n1;2', false)).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
    expect(parseCsv('a,"x, y"\n1,"多\n行"', false)).toEqual([
      ['a', 'x, y'],
      ['1', '多\n行']
    ])
  })

  it('.tsv 固定按制表符分，逗号只是普通字符', () => {
    expect(parseCsv('a,x\tb\n1\t2', true)).toEqual([
      ['a,x', 'b'],
      ['1', '2']
    ])
  })

  it('去掉 BOM 与末尾换行产生的空行，中间的空行保留', () => {
    expect(parseCsv('﻿a,b\n\n1,2\n', false)).toEqual([['a', 'b'], [''], ['1', '2']])
  })
})

describe('csvColumnWidths', () => {
  it('按最长一行估宽、全角算两个字符，夹在默认列宽与上限之间', () => {
    const widths = csvColumnWidths([
      ['id', '名字', 'x'.repeat(200)],
      ['1', '很长的中文名字', '']
    ])
    expect(widths[0]).toBe(8.43)
    expect(widths[1]).toBe(15)
    expect(widths[2]).toBe(50)
  })

  it('多行格子取最长那行', () => {
    expect(csvColumnWidths([['short\n' + 'y'.repeat(20)]])).toEqual([21])
  })
})

describe('csvToXlsxBytes', () => {
  it('格子按原文写入：不转数字 / 日期 / 布尔，= 开头不当公式', () => {
    const raw = ['00123', '1e5', '12345678901234567890', 'TRUE', '2026-09-23', '=SUM(1,2)', '50%']
    const bytes = csvToXlsxBytes(raw.map((v) => `"${v}"`).join('\n'), false)
    const sheet = Workbook.fromBytes(bytes).getSheet(0)
    raw.forEach((v, row) => {
      expect(sheet.getFormattedValueAt(row, 0)).toBe(v)
      expect(sheet.getFormulaAt(row, 0)).toBeUndefined()
    })
  })

  it('带换行的格子自动换行，其余格子不加样式', () => {
    const sheet = Workbook.fromBytes(csvToXlsxBytes('"多\n行",x', false)).getSheet(0)
    expect(sheet.getCellStyleAt(0, 0)?.alignment?.wrapText).toBe(true)
    expect(sheet.getCellStyleAt(0, 1)?.alignment?.wrapText ?? false).toBe(false)
  })

  it('列宽按内容估算，窄列保持默认', () => {
    const sheet = Workbook.fromBytes(
      csvToXlsxBytes('id,description\n1,' + 'd'.repeat(30), false)
    ).getSheet(0)
    expect(sheet.getColumnWidth(0)).toBeUndefined()
    expect(sheet.getColumnWidth(1)).toBe(31)
  })
})

describe('sheetFindMatches', () => {
  const cells: SheetCellText[] = [
    { row: 0, col: 0, text: 'Total' },
    { row: 0, col: 1, text: 'subtotal' },
    { row: 1, col: 0, text: 'total total' },
    { row: 2, col: 3, text: '合计：total_1' },
    { row: 3, col: 0, text: '-5 元' }
  ]

  it('默认不分大小写，一格只算一次，保持行优先顺序', () => {
    expect(sheetFindMatches(cells, 'total', { caseSensitive: false, wholeWord: false })).toEqual(
      cells.slice(0, 4)
    )
  })

  it('区分大小写', () => {
    expect(
      sheetFindMatches(cells, 'Total', { caseSensitive: true, wholeWord: false }).map((c) => c.text)
    ).toEqual(['Total'])
  })

  it('全词：两侧不能紧挨词字符（字母 / 数字 / 下划线，含中文）', () => {
    expect(
      sheetFindMatches(cells, 'total', { caseSensitive: false, wholeWord: true }).map((c) => c.text)
    ).toEqual(['Total', 'total total'])
    expect(
      sheetFindMatches(cells, '合计', { caseSensitive: false, wholeWord: true }).map((c) => c.text)
    ).toEqual(['合计：total_1'])
  })

  it('全词：查询两端不是词字符时那一端不要求词界', () => {
    expect(
      sheetFindMatches(cells, '-5', { caseSensitive: false, wholeWord: true }).map((c) => c.text)
    ).toEqual(['-5 元'])
  })

  it('空查询没有命中', () => {
    expect(sheetFindMatches(cells, '', { caseSensitive: false, wholeWord: false })).toEqual([])
  })
})

describe('sheetFirstMatchFrom', () => {
  const matches = [
    { row: 0, col: 2, text: 'a' },
    { row: 4, col: 1, text: 'a' },
    { row: 4, col: 5, text: 'a' }
  ]

  it('活动格及之后的第一个（行优先），之后没有则回到第一个', () => {
    expect(sheetFirstMatchFrom(matches, null)).toBe(0)
    expect(sheetFirstMatchFrom(matches, { row: 4, col: 1 })).toBe(1)
    expect(sheetFirstMatchFrom(matches, { row: 4, col: 2 })).toBe(2)
    expect(sheetFirstMatchFrom(matches, { row: 9, col: 0 })).toBe(0)
    expect(sheetFirstMatchFrom([], { row: 0, col: 0 })).toBe(-1)
  })
})

describe('缩放', () => {
  it('逐档：乘 1.1 后按 10% 取整，放大向上、缩小向下，夹在上下限', () => {
    expect(sheetStepZoom(100, 1, 10, 400)).toBe(110)
    expect(sheetStepZoom(110, 1, 10, 400)).toBe(130)
    expect(sheetStepZoom(100, -1, 10, 400)).toBe(90)
    expect(sheetStepZoom(87, -1, 10, 400)).toBe(70)
    expect(sheetStepZoom(390, 1, 10, 400)).toBe(400)
    expect(sheetStepZoom(10, -1, 10, 400)).toBe(10)
  })

  it('滚轮：连续倍率，夹在上下限', () => {
    expect(sheetWheelZoom(100, 1.004, 10, 400)).toBeCloseTo(100.4)
    expect(sheetWheelZoom(390, 1.1, 10, 400)).toBe(400)
  })

  it('换倍率后锚点下的内容留在原处', () => {
    expect(sheetScrollAfterZoom({ left: 100, top: 50 }, { x: 200, y: 100 }, 100, 200)).toEqual({
      left: 400,
      top: 200
    })
    expect(sheetScrollAfterZoom({ left: 0, top: 0 }, { x: 200, y: 100 }, 100, 50)).toEqual({
      left: 0,
      top: 0
    })
  })
})
