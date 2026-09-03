import { describe, expect, it } from 'vitest'
import { buildRgSearchArgs, parseRgMatchLine } from './content-search'

function matchLine(data: object): string {
  return JSON.stringify({ type: 'match', data })
}

describe('buildRgSearchArgs', () => {
  it('默认：忽略大小写 + 固定串 + 隐藏文件 + 剪枝 .git', () => {
    expect(
      buildRgSearchArgs('todo', {
        caseSensitive: false,
        wholeWord: false,
        regex: false,
        fileMask: ''
      })
    ).toEqual(['--json', '--hidden', '-g', '!**/.git', '-i', '-F', '--', 'todo', '.'])
  })

  it('大小写 / 全词 / 正则开关与文件掩码', () => {
    const args = buildRgSearchArgs('foo.*bar', {
      caseSensitive: true,
      wholeWord: true,
      regex: true,
      fileMask: '*.ts, *.tsx ,'
    })
    expect(args).toContain('-s')
    expect(args).toContain('-w')
    expect(args).not.toContain('-F')
    expect(args.join(' ')).toContain('-g *.ts')
    expect(args.join(' ')).toContain('-g *.tsx')
  })

  it('查询以 - 开头时被 -- 保护', () => {
    const args = buildRgSearchArgs('-x', {
      caseSensitive: false,
      wholeWord: false,
      regex: false,
      fileMask: ''
    })
    expect(args.slice(-3)).toEqual(['--', '-x', '.'])
  })
})

describe('parseRgMatchLine', () => {
  it('match 事件解析出相对路径、行号与文本', () => {
    const m = parseRgMatchLine(
      matchLine({
        path: { text: 'src/app.ts' },
        lines: { text: 'const hello = 1\n' },
        line_number: 3,
        submatches: [{ start: 6, end: 11 }]
      })
    )
    expect(m).toEqual({
      rel: 'src/app.ts',
      line: 3,
      text: 'const hello = 1',
      ranges: [[6, 11]],
      col: 6,
      endCol: 11
    })
  })

  it('submatch 字节偏移换算为 UTF-16 字符偏移（多字节字符前置）', () => {
    // "hello 世界 hello"：第二个 hello 字节偏移 13、字符偏移 9
    const m = parseRgMatchLine(
      matchLine({
        path: { text: 'a.txt' },
        lines: { text: 'hello 世界 hello\n' },
        line_number: 1,
        submatches: [
          { start: 0, end: 5 },
          { start: 13, end: 18 }
        ]
      })
    )
    expect(m?.ranges).toEqual([
      [0, 5],
      [9, 14]
    ])
    expect(m?.col).toBe(0)
  })

  it('展示文本去首缩进且区间同步平移，跳转列保留原始偏移', () => {
    const m = parseRgMatchLine(
      matchLine({
        path: { text: 'a.ts' },
        lines: { text: '    foo()\n' },
        line_number: 2,
        submatches: [{ start: 4, end: 7 }]
      })
    )
    expect(m?.text).toBe('foo()')
    expect(m?.ranges).toEqual([[0, 3]])
    expect(m?.col).toBe(4)
    expect(m?.endCol).toBe(7)
  })

  it('超长行按首个命中开窗并加省略号', () => {
    const long = 'x'.repeat(400) + 'NEEDLE' + 'y'.repeat(100)
    const m = parseRgMatchLine(
      matchLine({
        path: { text: 'a.min.js' },
        lines: { text: long + '\n' },
        line_number: 1,
        submatches: [{ start: 400, end: 406 }]
      })
    )
    expect(m?.text.startsWith('…')).toBe(true)
    expect(m?.text.length).toBeLessThanOrEqual(301)
    const [s, e] = m!.ranges[0]
    expect(m!.text.slice(s, e)).toBe('NEEDLE')
    expect(m!.col).toBe(400)
  })

  it('非 match 事件与坏行返回 null', () => {
    expect(parseRgMatchLine(JSON.stringify({ type: 'begin', data: {} }))).toBeNull()
    expect(parseRgMatchLine(JSON.stringify({ type: 'summary', data: {} }))).toBeNull()
    expect(parseRgMatchLine('not json')).toBeNull()
  })

  it('base64 形态（非 UTF-8 / 二进制）跳过', () => {
    expect(
      parseRgMatchLine(
        matchLine({
          path: { text: 'bin.dat' },
          lines: { bytes: 'AAAA' },
          line_number: 1,
          submatches: [{ start: 0, end: 1 }]
        })
      )
    ).toBeNull()
  })
})
