import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { describe, expect, it } from 'vitest'
import {
  buildMarkdownFindIndex,
  markdownFindSpans,
  rehypeSourceLines,
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

describe('rehypeSourceLines', () => {
  /** 经预览同一条渲染链（react-markdown + GFM）出 HTML */
  const render = (source: string): string =>
    renderToStaticMarkup(
      createElement(
        Markdown,
        { remarkPlugins: [remarkGfm], rehypePlugins: [rehypeSourceLines] },
        source
      )
    )

  it('块元素标上源码起始行（0 起），行内元素不标', () => {
    expect(render('# 标题\n\n一段 **粗体** 与 `代码`\n\n- 甲\n- 乙')).toBe(
      '<h1 data-line="0">标题</h1>\n' +
        '<p data-line="2">一段 <strong>粗体</strong> 与 <code>代码</code></p>\n' +
        '<ul data-line="4">\n<li data-line="4">甲</li>\n<li data-line="5">乙</li>\n</ul>'
    )
  })

  it('代码块标在 pre 上，表格逐行标', () => {
    const html = render('```js\nx\n```\n\n| a |\n| - |\n| 1 |')
    expect(html).toContain('<pre data-line="0"><code class="language-js">x\n</code></pre>')
    expect(html).toContain('<table data-line="4">')
    expect(html).toContain('<tr data-line="6"><td data-line="6">1</td></tr>')
  })
})
