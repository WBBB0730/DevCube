/**
 * Files Tab Markdown 预览的纯逻辑（docs/prd/files-markdown-preview.md）。
 * - 查找换算：预览正文按块（段落、标题、列表项、表格格子、代码块……）分段，块内依次相邻的文字节点连成一串来找，
 *   命中可以跨行内元素（粗体、链接、行内代码）；块与块之间不相连。找的是页面上显示的样子：代码块外连续的空格、
 *   制表与换行（源码里的折行、CRLF）显示为一个空格。同表格 / PPT：打开查找（或正文变了）时建一次索引，之后每次输入只在索引里匹配。
 * - 源码行标注：块元素标上源码起始行，预览与编辑器据此按内容对齐阅读位置。
 * - 原始 HTML：照 GitHub 的白名单渲染（`<br>`、`<details>`、`<kbd>`、`<img width>` 等），脚本、事件属性与 `style` 去掉。
 * - 代码块复制：复制的是代码原文。
 * - frontmatter：文首 `---` 围起的 YAML 画成表，每行一个键一个值，列表与嵌套的键值对画成嵌套的表；
 *   写错的 YAML 或不是键值对的原样显示成 YAML 代码块，空的不显示。
 */
import type { Element, ElementContent, Root } from 'hast'
import { phrasing } from 'hast-util-phrasing'
import { toString } from 'hast-util-to-string'
import type { Yaml } from 'mdast'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import type { Options } from 'react-markdown'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import { visit } from 'unist-util-visit'
import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml'
import { locateTextOffset } from './text-find'

/**
 * 行内元素（HTML 的 phrasing content：a、br、code、kbd、img……）；其余元素都是块。
 * 只按标签名判，语法树与页面上的元素共用这一个判定。
 */
export function isInlineTag(tagName: string): boolean {
  return phrasing({ type: 'element', tagName, properties: {}, children: [] })
}

/**
 * rehype 插件：给每个块元素标上它在源码里的起始行（`data-line`，0 起），同 VS Code 的 Markdown 预览。
 * 行内元素与生成出来、没有源码位置的元素（如 GFM 脚注区的标题）不标。
 */
export function rehypeSourceLines(): (tree: Root) => void {
  return (tree: Root): void => {
    visit(tree, 'element', (node) => {
      const line = node.position?.start.line
      if (line !== undefined && !isInlineTag(node.tagName)) {
        node.properties.dataLine = line - 1
      }
    })
  }
}

/** 预览的 remark 链：GFM，加上文首的 YAML frontmatter */
export const MARKDOWN_REMARK_PLUGINS: NonNullable<Options['remarkPlugins']> = [
  remarkGfm,
  remarkFrontmatter
]

function hastElement(tagName: string, children: ElementContent[]): Element {
  return { type: 'element', tagName, properties: {}, children }
}

/** 一行一项的表；没有项不画 */
function yamlTable(rows: Element[][]): ElementContent[] {
  if (rows.length === 0) return []
  return [
    hastElement('table', [
      hastElement(
        'tbody',
        rows.map((cells) => hastElement('tr', cells))
      )
    ])
  ]
}

/**
 * frontmatter 里的一个 YAML 值：键值对每行一个键（行表头）一个值，列表每行一项；
 * 标量显示写下的字面（`1.10`、`0x1F`、`~` 不换算），别名写作 `*名字`、不展开
 */
function yamlToHast(node: unknown): ElementContent[] {
  if (isMap(node)) {
    return yamlTable(
      node.items.map(({ key, value }) => [
        hastElement('th', yamlToHast(key)),
        hastElement('td', yamlToHast(value))
      ])
    )
  }
  if (isSeq(node)) return yamlTable(node.items.map((item) => [hastElement('td', yamlToHast(item))]))
  // 解析出的标量都带着字面
  if (isScalar(node)) return [{ type: 'text', value: node.source! }]
  if (isAlias(node)) return [{ type: 'text', value: `*${node.source}` }]
  return []
}

/** Markdown 语法树转元素：frontmatter 按文件头的规则转，带着它的源码位置 */
export const MARKDOWN_REMARK_REHYPE_OPTIONS: NonNullable<Options['remarkRehypeOptions']> = {
  handlers: {
    yaml(state, node: Yaml, parent) {
      const { contents, errors } = parseDocument(node.value)
      if (errors.length === 0 && (contents === null || isMap(contents))) {
        const [table] = yamlToHast(contents)
        if (table === undefined) return undefined
        state.patch(node, table)
        return state.applyData(node, table)
      }
      // 与围栏代码块同一个转换
      return state.one(
        { type: 'code', lang: 'yaml', value: node.value, position: node.position },
        parent
      )
    }
  }
}

/**
 * 预览的 rehype 链：先把原始 HTML 解析成元素，再按 GitHub 的白名单净化（之后的步骤不再引入外来内容），
 * 最后标源码行（净化会去掉不认识的属性，所以放在它之后）。解析与净化都保留源码位置。
 */
export const MARKDOWN_REHYPE_PLUGINS: NonNullable<Options['rehypePlugins']> = [
  rehypeRaw,
  rehypeSanitize,
  rehypeSourceLines
]

/** 代码块（`pre`）的复制文本：代码原文。Markdown 的代码块转成元素时末尾补了一个换行（页面上不显示），去掉，同 GitHub */
export function markdownCodeText(pre: Element): string {
  return toString(pre).replace(/\n$/, '')
}

/** 一块正文：块内依次相邻的文字节点内容；`pre` = 代码块，空白原样显示 */
export type MarkdownFindBlock = { texts: readonly string[]; pre: boolean }

/** 索引里的一块：显示文字，及其每个字在原文（块内文字节点连起来）里的偏移（末尾多一项为原文长度；代码块原样为 null） */
export type MarkdownFindIndexBlock = {
  texts: readonly string[]
  shown: string
  at: number[] | null
}

/** 一处命中：所在块下标，起止落在块内的 [节点下标, 节点内偏移] */
export type MarkdownFindSpan = { block: number; start: [number, number]; end: [number, number] }

const COLLAPSIBLE = /[ \t\r\n]/

/** 按 CSS 的空白折叠显示文字（连续空白只留一个空格），并记下显示文字每个字在原文里的偏移 */
function collapseWhitespace(text: string): { shown: string; at: number[] } {
  const chars: string[] = []
  const at: number[] = []
  for (let i = 0; i < text.length; i++) {
    if (COLLAPSIBLE.test(text[i])) {
      if (i > 0 && COLLAPSIBLE.test(text[i - 1])) continue
      chars.push(' ')
    } else chars.push(text[i])
    at.push(i)
  }
  at.push(text.length)
  return { shown: chars.join(''), at }
}

/** 建查找索引：各块的显示文字与偏移换算 */
export function buildMarkdownFindIndex(
  blocks: readonly MarkdownFindBlock[]
): MarkdownFindIndexBlock[] {
  return blocks.map(({ texts, pre }) => {
    const raw = texts.join('')
    return pre ? { texts, shown: raw, at: null } : { texts, ...collapseWhitespace(raw) }
  })
}

/** 索引里的全部命中（按块序、块内自左向右）；`find` 是 compileTextFind 编出的查找器 */
export function markdownFindSpans(
  index: readonly MarkdownFindIndexBlock[],
  find: (text: string) => [number, number][]
): MarkdownFindSpan[] {
  const spans: MarkdownFindSpan[] = []
  index.forEach(({ texts, shown, at }, i) => {
    for (const [from, to] of find(shown)) {
      const start = locateTextOffset(texts, at ? at[from] : from, false)
      const end = locateTextOffset(texts, at ? at[to - 1] + 1 : to, true)
      if (start && end) spans.push({ block: i, start, end })
    }
  })
  return spans
}
