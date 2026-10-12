/**
 * Files Tab Markdown 预览的查找换算（docs/prd/files-markdown-preview.md）：预览正文按块（段落、标题、列表项、
 * 表格格子、代码块……）分段，块内依次相邻的文字节点连成一串来找，命中可以跨行内元素（粗体、链接、行内代码）；
 * 块与块之间不相连。找的是页面上显示的样子：代码块外连续的空格、制表与换行（源码里的折行、CRLF）显示为一个空格。
 * 同表格 / PPT：打开查找（或正文变了）时建一次索引，之后每次输入只在索引里匹配。
 */
import { locateTextOffset } from './text-find'

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
