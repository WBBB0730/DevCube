import { describe, expect, it } from 'vitest'
import {
  buildMarkdownFindIndex,
  markdownFindSpans,
  type MarkdownFindBlock,
  type MarkdownFindSpan
} from './files-markdown'
import { compileTextFind } from './text-find'

const find = (query: string): ((text: string) => [number, number][]) =>
  compileTextFind(query, { caseSensitive: false, wholeWord: false })!

/** 建索引后在其中找 `query` */
const spans = (blocks: MarkdownFindBlock[], query: string): MarkdownFindSpan[] =>
  markdownFindSpans(buildMarkdownFindIndex(blocks), find(query))

describe('markdownFindSpans', () => {
  it('命中可以跨块内的行内元素（粗体、链接、行内代码）', () => {
    // 「foo **bar** baz」渲染成三个文字节点
    expect(spans([{ texts: ['foo ', 'bar', ' baz'], pre: false }], 'o bar b')).toEqual([
      { block: 0, start: [0, 2], end: [2, 2] }
    ])
  })

  it('块与块之间不相连', () => {
    const blocks = [
      { texts: ['end'], pre: false },
      { texts: ['start'], pre: false }
    ]
    expect(spans(blocks, 'endstart')).toEqual([])
    expect(spans(blocks, 't')).toEqual([
      { block: 1, start: [0, 1], end: [0, 2] },
      { block: 1, start: [0, 4], end: [0, 5] }
    ])
  })

  it('代码块外的折行、CRLF 与连续空白按显示的一个空格找，区间落回原文', () => {
    expect(spans([{ texts: ['foo\r\nbar'], pre: false }], 'foo bar')).toEqual([
      { block: 0, start: [0, 0], end: [0, 8] }
    ])
    expect(spans([{ texts: ['a  \t b'], pre: false }], 'a b')).toEqual([
      { block: 0, start: [0, 0], end: [0, 6] }
    ])
    expect(spans([{ texts: ['x  y'], pre: false }], 'y')).toEqual([
      { block: 0, start: [0, 3], end: [0, 4] }
    ])
  })

  it('代码块里空白原样，不跨行', () => {
    expect(spans([{ texts: ['foo\nbar'], pre: true }], 'foo bar')).toEqual([])
    expect(spans([{ texts: ['a  b'], pre: true }], 'a b')).toEqual([])
    expect(spans([{ texts: ['a  b'], pre: true }], 'a  b')).toEqual([
      { block: 0, start: [0, 0], end: [0, 4] }
    ])
  })
})
