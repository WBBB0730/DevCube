// Files 编辑器的格式化（docs/prd/files-tab.md「格式化」）：JSON（含注释）与 SQL，格式化选中的部分（没选中为全文）。
// 哪些文件算 JSON / SQL 跟高亮同一份映射；缩进跟着全文现有的写法；改动经 cm6-format 只落在真正变了的地方。
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import detectIndent from 'detect-indent'
import { format as formatJson } from 'jsonc-parser'
import { formatDialect, sql } from 'sql-formatter'
import { formatInEditor, formatRange, textFormatEdits, type FormatEdit } from './cm6-format'
import { languageSupportForPath } from './cm6-setup'

export type FilesFormatLanguage = 'json' | 'sql'

/** 这个文件能格式化时为它的语言（按高亮用的语言），否则为 null。 */
export function filesFormatLanguage(path: string): FilesFormatLanguage | null {
  const name = languageSupportForPath(path)?.language.name
  return name === 'json' || name === 'sql' ? name : null
}

/** 缩进跟着全文现有的写法（detect-indent：相邻行缩进差里最常见的那种）；看不出来时 2 个空格（JetBrains 的 JSON 与 sql-formatter 的默认值）。 */
function documentIndent(state: EditorState): { tabSize: number; insertSpaces: boolean } {
  const { type, amount } = detectIndent(state.doc.toString())
  return type === 'tab'
    ? { tabSize: state.tabSize, insertSpaces: false }
    : { tabSize: amount > 0 ? amount : 2, insertSpaces: true }
}

/** 格式化选中的部分（没选中为全文）的逐处修改；SQL 认不出（语句写得不对）时抛出。 */
export function filesFormatEdits(state: EditorState, language: FilesFormatLanguage): FormatEdit[] {
  const indent = documentIndent(state)
  if (language === 'sql') {
    // 不知道是哪种数据库，按标准 SQL；大小写选项默认原样，只动空白
    return textFormatEdits(state, (text) =>
      formatDialect(text, { dialect: sql, tabWidth: indent.tabSize, useTabs: !indent.insertSpaces })
    )
  }
  const range = formatRange(state)
  if (range === null) return []
  // 按范围排版（同 VS Code 的「格式化选定内容」）：首行原有的缩进为起始层级，只改范围内 token 之间的空白，注释原样；
  // 语法有错的地方跳过不排、不报错（同 VS Code）
  return formatJson(
    state.doc.toString(),
    { offset: range.from, length: range.to - range.from },
    { ...indent, eol: '\n' }
  )
}

/** 格式化编辑器里选中的部分（没选中为全文）。格式化不了时不改，交回原因；否则为 null。 */
export function formatFileInEditor(view: EditorView, language: FilesFormatLanguage): string | null {
  return formatInEditor(view, (state) => filesFormatEdits(state, language))
}
