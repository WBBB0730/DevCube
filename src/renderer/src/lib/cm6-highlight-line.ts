// 编辑器外的单行语法着色（内容搜索结果列表）：用文件对应的 Lezer parser 就地解析
// 该行文本，套用编辑器同源的裸 HighlightStyle 类名。脱离全文的单行解析是近似——
// 跨行结构（块注释 / 模板串内部行）会按普通代码着色，可接受的取舍。
import { highlightCode } from '@lezer/highlight'
import { StyleModule } from 'style-mod'
import type { ThemeMode } from '@shared/theme'
import { filesHighlightStyle, languageSupportForPath } from './cm6-setup'

export interface HighlightedSeg {
  text: string
  className: string | null
}

// 裸样式的 CSS 由编辑器外使用方自行挂载（编辑器只挂 themeType 版）；一次挂两套主题
let stylesMounted = false
function ensureStylesMounted(): void {
  if (stylesMounted) return
  stylesMounted = true
  for (const style of Object.values(filesHighlightStyle)) {
    if (style.module) StyleModule.mount(document, style.module)
  }
}

/**
 * 把一行文本切成带高亮类名的连续片段（覆盖全行，无语言时整行无类名）。
 * 解析成本为亚毫秒级（行文本已截断），调用方应按行 memo。
 */
export function highlightLineSegments(
  text: string,
  filePath: string,
  theme: ThemeMode
): HighlightedSeg[] {
  const support = languageSupportForPath(filePath)
  if (!support) return [{ text, className: null }]
  ensureStylesMounted()
  const segs: HighlightedSeg[] = []
  highlightCode(
    text,
    support.language.parser.parse(text),
    filesHighlightStyle[theme],
    (code, classes) => segs.push({ text: code, className: classes || null }),
    () => segs.push({ text: '\n', className: null })
  )
  return segs
}
