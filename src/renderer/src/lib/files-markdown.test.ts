import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown, { type Components } from 'react-markdown'
import { describe, expect, it } from 'vitest'
import {
  buildMarkdownFindIndex,
  isInlineTag,
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS,
  MARKDOWN_REMARK_REHYPE_OPTIONS,
  markdownCodeText,
  markdownFindSpans,
  markdownTocCurrent,
  markdownTocDockWidth,
  markdownTocHoverNext,
  markdownTocLevels,
  markdownTocView,
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

describe('预览渲染链', () => {
  /** 经预览同一条渲染链（react-markdown + GFM + frontmatter + 原始 HTML 净化 + 源码行）出 HTML */
  const render = (source: string, components?: Components): string =>
    renderToStaticMarkup(
      createElement(
        Markdown,
        {
          remarkPlugins: MARKDOWN_REMARK_PLUGINS,
          remarkRehypeOptions: MARKDOWN_REMARK_REHYPE_OPTIONS,
          rehypePlugins: MARKDOWN_REHYPE_PLUGINS,
          components
        },
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

  it('源码里的标题（含原始 HTML 写的）标行，GFM 脚注区生成的读屏标题不标（目录据此只列写下的标题）', () => {
    const html = render('## 正文[^1]\n\n<h3>HTML 标题</h3>\n\n[^1]: 注')
    expect(html).toContain('<h2 data-line="0">')
    expect(html).toContain('<h3 data-line="2">HTML 标题</h3>')
    expect(html).toMatch(/<h2 class="sr-only" id="user-content-footnote-label">/)
  })

  it('代码块标在 pre 上，表格逐行标', () => {
    const html = render('```js\nx\n```\n\n| a |\n| - |\n| 1 |')
    expect(html).toContain('<pre data-line="0"><code class="language-js">x\n</code></pre>')
    expect(html).toContain('<table data-line="4">')
    expect(html).toContain('<tr data-line="6"><td data-line="6">1</td></tr>')
  })

  it('代码块复制代码原文：去掉转换时末尾补的换行，缩进与空行原样', () => {
    const copied: string[] = []
    render('```js\n  a\n\nb\n```\n\n```\n```\n\n<pre>raw</pre>', {
      pre: ({ node }) => {
        copied.push(markdownCodeText(node!))
        return null
      }
    })
    expect(copied).toEqual(['  a\n\nb', '', 'raw'])
  })

  it('原始 HTML 照白名单渲染：行内标签不标行，块标签标行', () => {
    const html = render(
      '甲<br>乙 <kbd>Ctrl</kbd> <sub>x</sub>\n\n<details>\n<summary>更多</summary>\n\n正文\n\n</details>\n\n' +
        '<p align="center"><img src="./a.png" width="100"></p>'
    )
    expect(html).toContain('<p data-line="0">甲<br/>乙 <kbd>Ctrl</kbd> <sub>x</sub></p>')
    expect(html).toContain('<details data-line="2">')
    expect(html).toContain('<summary data-line="3">更多</summary>')
    expect(html).toContain('<p data-line="5">正文</p>')
    expect(html).toContain('<p align="center" data-line="9"><img src="./a.png" width="100"/></p>')
  })

  it('脚本、事件属性与 style 去掉', () => {
    const html = render(
      '<script>alert(1)</script>\n\n<p style="color:red" onclick="x()">文字</p>\n\n<a href="javascript:x()">链</a>'
    )
    expect(html).not.toContain('script')
    expect(html).not.toContain('style')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('javascript')
    expect(html).toContain('<p data-line="2">文字</p>')
  })

  it('frontmatter 画成表：每行一个键一个值，标量照字面，表标在第 0 行，正文照常标行', () => {
    expect(render('---\ntitle: 示例\nversion: 1.10\nempty:\n---\n\n# 正文')).toBe(
      '<table data-line="0"><tbody>' +
        '<tr><th>title</th><td>示例</td></tr>' +
        '<tr><th>version</th><td>1.10</td></tr>' +
        '<tr><th>empty</th><td></td></tr>' +
        '</tbody></table>\n<h1 data-line="6">正文</h1>'
    )
  })

  it('frontmatter 的列表与嵌套键值对画成嵌套的表，空的留空，别名不展开', () => {
    expect(
      render('---\ntags: [a, b]\nauthor:\n  name: 张三\nnone: []\nref: &x 1\nalias: *x\n---')
    ).toBe(
      '<table data-line="0"><tbody>' +
        '<tr><th>tags</th><td><table><tbody><tr><td>a</td></tr><tr><td>b</td></tr></tbody></table></td></tr>' +
        '<tr><th>author</th><td><table><tbody><tr><th>name</th><td>张三</td></tr></tbody></table></td></tr>' +
        '<tr><th>none</th><td></td></tr>' +
        '<tr><th>ref</th><td>1</td></tr>' +
        '<tr><th>alias</th><td>*x</td></tr>' +
        '</tbody></table>'
    )
  })

  it.each([
    ['写错的 YAML', 'a: [1'],
    ['重复的键', 'a: 1\na: 2'],
    ['列表', '- x\n- y'],
    ['纯文字', 'just text']
  ])('frontmatter 是%s时原样显示成 YAML 代码块', (_, yaml) => {
    expect(render(`---\n${yaml}\n---`)).toBe(
      `<pre data-line="0"><code class="language-yaml">${yaml}\n</code></pre>`
    )
  })

  it('空的 frontmatter（含只有注释的）不显示', () => {
    expect(render('---\n---\n\n正文')).toBe('<p data-line="3">正文</p>')
    expect(render('---\n# 注释\n---\n\n正文')).toBe('<p data-line="4">正文</p>')
  })

  it('frontmatter 值里的 HTML 当文字', () => {
    expect(render('---\ntitle: <script>alert(1)</script>\n---')).toBe(
      '<table data-line="0"><tbody>' +
        '<tr><th>title</th><td>&lt;script&gt;alert(1)&lt;/script&gt;</td></tr>' +
        '</tbody></table>'
    )
  })
})

describe('isInlineTag', () => {
  it.each([
    ['a', true],
    ['br', true],
    ['kbd', true],
    ['span', true],
    ['img', true],
    ['code', true],
    ['p', false],
    ['div', false],
    ['details', false],
    ['summary', false],
    ['li', false],
    ['pre', false],
    ['section', false]
  ])('%s → %s', (tag, inline) => {
    expect(isInlineTag(tag)).toBe(inline)
  })
})

describe('markdownTocLevels', () => {
  it.each([
    ['逐级', [1, 2, 3], [0, 1, 2]],
    ['同级', [2, 2, 2], [0, 0, 0]],
    ['不从一级开始', [2, 3, 2], [0, 1, 0]],
    ['跳级只深一层，与之后的同级标题同层', [2, 4, 3], [0, 1, 1]],
    ['回到更高的级别', [1, 2, 3, 1, 3], [0, 1, 2, 0, 1]],
    ['开头的标题比后面的低', [3, 1, 2], [0, 0, 1]],
    ['没有标题', [], []]
  ])('%s', (_, depths, levels) => {
    expect(markdownTocLevels(depths)).toEqual(levels)
  })
})

describe('markdownTocDockWidth', () => {
  it.each([
    ['宽裕时目录最宽', 1200, 240],
    ['正文到最窄前目录不收窄', 720, 240],
    ['正文到最窄后目录收窄', 700, 220],
    ['目录与正文都到最窄', 640, 160],
    ['放不下侧边', 639, null]
  ])('%s', (_, width, dock) => {
    expect(markdownTocDockWidth(width)).toBe(dock)
  })
})

describe('markdownTocView', () => {
  it.each([
    ['开着、放得下：显示在侧边', true, true, false, 'docked'],
    ['侧边显示着时悬停不另浮出', true, true, true, 'docked'],
    ['开着、放不下：不显示（宽缩到窄只剩悬停）', true, false, false, null],
    ['开着、放不下时悬停：浮出抽屉', true, false, true, 'drawer'],
    ['收着、悬停：浮出抽屉', false, true, true, 'drawer'],
    ['收着、没悬停：不显示', false, true, false, null]
  ] as const)('%s', (_, open, dockable, peek, view) => {
    expect(markdownTocView(open, dockable, peek)).toBe(view)
  })
})

describe('markdownTocHoverNext', () => {
  it.each([
    ['侧边没显示：进来即浮出', 'idle', 'enter', false, 'peek'],
    ['浮出时从钮移到抽屉上：仍浮出', 'peek', 'enter', false, 'peek'],
    ['离开钮与抽屉：收起（在抽屉里点过标题也一样）', 'peek', 'leave', false, 'idle'],
    ['用鼠标点钮：锁住', 'peek', 'click', true, 'locked'],
    ['锁住时悬停不浮出', 'locked', 'enter', false, 'locked'],
    ['锁住后离开：解锁', 'locked', 'leave', false, 'idle'],
    ['键盘按钮：不锁', 'peek', 'key', false, 'idle'],
    ['侧边显示着：悬停不另浮出', 'idle', 'enter', true, 'idle']
  ] as const)('%s', (_, hover, event, docked, next) => {
    expect(markdownTocHoverNext(hover, event, docked)).toBe(next)
  })
})

describe('markdownTocCurrent', () => {
  const lines = [2, 10, 30]
  it.each([
    ['视口顶边在第一个标题之前', 0, -1],
    ['正好在标题行', 2, 0],
    ['在两个标题之间', 9.5, 0],
    ['过了下一个标题', 10, 1],
    ['最后一节', 100, 2]
  ])('%s', (_, topLine, current) => {
    expect(markdownTocCurrent(lines, topLine)).toBe(current)
  })

  it('没有标题', () => {
    expect(markdownTocCurrent([], 5)).toBe(-1)
  })
})
