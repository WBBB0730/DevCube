// JSON 排版（docs/prd/database.md「Redis」：字符串值是 JSON 时排版显示）：用 jsonc-parser 的 format 只改 token 之间的
// 空白，token 原样保留——不经 JSON.parse 再 stringify，免得大整数丢精度、数字与转义的写法被改写。
import { format, type FormattingOptions } from 'jsonc-parser'

/** 缩进 2 个空格（同 JetBrains 的 JSON 代码风格默认值），首尾空白去掉 */
const FORMATTING: FormattingOptions = { tabSize: 2, insertSpaces: true, eol: '\n' }

/** text 是不是对象或数组的 JSON：按标准 JSON 判断（只拿来判断，解析出的值不用），前后可有空白。 */
function isJsonContainer(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null
  } catch {
    return false
  }
}

/** text 是对象或数组的 JSON 时返回排版后的文字，否则为 null（照旧显示原文）。 */
export function formatJsonText(text: string): string | null {
  if (!isJsonContainer(text)) return null
  // format 顺着扫描给出修改，互不重叠、offset 递增，按顺序一次拼好（同 vscode-languageserver-textdocument 的
  // applyEdits）；不用 jsonc-parser 的 applyEdits——它每条修改都重拼整段，耗时随大小平方增长，几百 KB 就卡几秒
  const parts: string[] = []
  let offset = 0
  for (const edit of format(text, undefined, FORMATTING)) {
    parts.push(text.slice(offset, edit.offset), edit.content)
    offset = edit.offset + edit.length
  }
  parts.push(text.slice(offset))
  return parts.join('')
}
