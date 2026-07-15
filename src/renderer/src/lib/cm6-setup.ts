import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { EditorState, RangeSetBuilder, StateField, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

/**
 * WebStorm Dark.icls（2026.1 · parent Darcula）编辑器色。
 * 字体：JetBrains Mono 13 / weight 400 / 无连字。
 * 行高：见 main.css `.files-codemirror`（当前 CSS line-height: 1.7）。
 */
const ICLS = {
  bg: '#1E1F22', // TEXT BACKGROUND
  fg: '#BCBEC4', // TEXT FOREGROUND / DEFAULT_IDENTIFIER
  caret: '#CED0D6', // CARET_COLOR
  caretRow: '#26282E', // CARET_ROW_COLOR
  selection: 'var(--editor-selection)', // #224283，WebStorm；≠ UI `--selection-row`
  lineNumber: '#4B5059', // LINE_NUMBERS_COLOR
  lineNumberCaret: '#A1A3AB', // LINE_NUMBER_ON_CARET_ROW_COLOR
  indentGuide: '#313438', // INDENT_GUIDE
  keyword: '#CF8E6D', // DEFAULT_KEYWORD
  string: '#6AAB73', // DEFAULT_STRING
  stringEscape: '#CF8E6D', // DEFAULT_VALID_STRING_ESCAPE
  number: '#2AACB8', // DEFAULT_NUMBER
  comment: '#7A7E85', // DEFAULT_LINE_COMMENT / DEFAULT_BLOCK_COMMENT
  docComment: '#5F826B', // DEFAULT_DOC_COMMENT
  docTag: '#67A37C', // DEFAULT_DOC_COMMENT_TAG
  functionDecl: '#56A8F5', // DEFAULT_FUNCTION_DECLARATION / JS.INSTANCE_MEMBER_FUNCTION
  method: '#57AAF7', // DEFAULT_INSTANCE_METHOD
  constant: '#C77DBB', // DEFAULT_CONSTANT / DEFAULT_INSTANCE_FIELD / JS.GLOBAL_VARIABLE
  metadata: '#B3AE60', // DEFAULT_METADATA
  typeParam: '#16BAAC', // TYPE_PARAMETER_NAME_ATTRIBUTES
  regexp: '#42C3D4', // JS.REGEXP
  link: '#548AF7', // CTRL_CLICKABLE / HYPERLINK
  cssUrl: '#5C92FF', // CSS.URL
  badChar: '#F75464', // UNMATCHED_BRACE / PROPERTIES.INVALID_STRING_ESCAPE 系
  searchBg: '#114957', // TEXT_SEARCH_RESULT_ATTRIBUTES
  searchSelected: '#165E70', // TEXT_SEARCH_RESULT EFFECT_COLOR
  matchedBrace: '#43454A', // MATCHED_BRACE_ATTRIBUTES BACKGROUND
  foldedBg: '#393B40', // FOLDED_TEXT_ATTRIBUTES BACKGROUND
  lookupBg: '#2B2D30', // LOOKUP_COLOR / DOCUMENTATION_COLOR
  htmlTagName: '#D5B778' // HTML_TAG_NAME / HTML_TAG
} as const

/** 编辑器 chrome：背景 / 光标 / 选区 / 行号 / 活动行（Dark.icls）。 */
export const filesEditorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      fontSize: '13px',
      color: ICLS.fg,
      backgroundColor: ICLS.bg
    },
    '.cm-scroller': {
      fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", monospace',
      fontWeight: '400',
      letterSpacing: '0',
      fontVariantLigatures: 'none',
      fontFeatureSettings: '"liga" 0, "calt" 0'
    },
    '.cm-content': {
      caretColor: ICLS.caret,
      paddingTop: '0',
      paddingBottom: '0'
    },
    '.cm-line': {
      padding: '0 2px 0 4px'
    },
    '&.cm-focused .cm-cursor, .cm-cursor': {
      borderLeftColor: ICLS.caret,
      borderLeftWidth: '2px'
    },
    // 默认选区层在内容层之下，会被 .cm-activeLine 盖住；改由行内 mark 叠在活动行上（见 filesSelectionMarkup）
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionLayer .cm-selectionBackground':
      {
        backgroundColor: 'transparent !important'
      },
    '.cm-filesSelectionMark': {
      backgroundColor: ICLS.selection
    },
    '&.cm-focused ::selection, ::selection': {
      backgroundColor: ICLS.selection
    },
    '.cm-activeLine': {
      backgroundColor: ICLS.caretRow
    },
    '.cm-gutters': {
      backgroundColor: ICLS.bg,
      color: ICLS.lineNumber,
      border: 'none'
    },
    '.cm-activeLineGutter': {
      backgroundColor: ICLS.caretRow,
      color: ICLS.lineNumberCaret
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 8px 0 16px',
      minWidth: '36px'
    },
    '.cm-foldGutter .cm-gutterElement': {
      padding: '0 4px',
      color: ICLS.lineNumber
    },
    '.cm-foldPlaceholder': {
      backgroundColor: ICLS.foldedBg,
      border: 'none',
      color: ICLS.fg,
      margin: '0 1px',
      borderRadius: '0'
    },
    // MATCHED_BRACE_ATTRIBUTES：背景 #43454A + bold
    '.cm-matchingBracket': {
      backgroundColor: ICLS.matchedBrace,
      outline: 'none',
      fontWeight: '700'
    },
    // UNMATCHED_BRACE_ATTRIBUTES
    '.cm-nonmatchingBracket': {
      backgroundColor: 'transparent',
      color: ICLS.badChar,
      outline: 'none'
    },
    '.cm-searchMatch': {
      backgroundColor: ICLS.searchBg
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: ICLS.searchSelected
    },
    '.cm-tooltip': {
      backgroundColor: ICLS.lookupBg,
      border: `1px solid ${ICLS.indentGuide}`,
      color: ICLS.fg,
      borderRadius: '0'
    },
    '.cm-panels': {
      backgroundColor: ICLS.lookupBg,
      color: ICLS.fg
    },
    // Lezer JS 不区分 JSDoc；由 filesJsdocHighlight 打标后用此类上色
    '.cm-jsdoc': {
      color: `${ICLS.docComment} !important`,
      fontStyle: 'italic'
    },
    '.cm-jsdoc-tag': {
      color: `${ICLS.docTag} !important`,
      fontStyle: 'normal',
      textDecoration: 'underline'
    }
  },
  { dark: true }
)

/** 语法高亮：映射 @lezer/highlight tags ← Dark.icls DEFAULT_* / JS.* */
const darculaHighlight = HighlightStyle.define(
  [
    { tag: t.keyword, color: ICLS.keyword },
    { tag: t.modifier, color: ICLS.keyword },
    { tag: t.operatorKeyword, color: ICLS.keyword },
    { tag: t.controlKeyword, color: ICLS.keyword },
    { tag: t.definitionKeyword, color: ICLS.keyword },
    { tag: t.moduleKeyword, color: ICLS.keyword },
    { tag: t.self, color: ICLS.keyword },
    { tag: t.atom, color: ICLS.keyword },
    { tag: t.bool, color: ICLS.keyword },
    { tag: t.null, color: ICLS.keyword },

    { tag: t.comment, color: ICLS.comment },
    { tag: t.lineComment, color: ICLS.comment },
    { tag: t.blockComment, color: ICLS.comment },
    { tag: t.docComment, color: ICLS.docComment, fontStyle: 'italic' },

    { tag: t.string, color: ICLS.string },
    { tag: t.special(t.string), color: ICLS.stringEscape },
    { tag: t.character, color: ICLS.string },
    { tag: t.escape, color: ICLS.stringEscape },
    { tag: t.regexp, color: ICLS.regexp },

    { tag: t.number, color: ICLS.number },
    { tag: t.integer, color: ICLS.number },
    { tag: t.float, color: ICLS.number },

    { tag: t.variableName, color: ICLS.fg },
    { tag: t.local(t.variableName), color: ICLS.fg },
    { tag: t.definition(t.variableName), color: ICLS.fg },
    // DEFAULT_CONSTANT / JS.GLOBAL_VARIABLE：斜体紫
    { tag: t.special(t.variableName), color: ICLS.constant, fontStyle: 'italic' },

    { tag: t.propertyName, color: ICLS.constant },
    { tag: t.definition(t.propertyName), color: ICLS.constant },
    { tag: t.attributeName, color: ICLS.constant },

    // DEFAULT_FUNCTION_CALL → DEFAULT_IDENTIFIER（调用不着色）
    { tag: t.function(t.variableName), color: ICLS.fg },
    // DEFAULT_FUNCTION_DECLARATION / JS.INSTANCE_MEMBER_FUNCTION
    { tag: t.definition(t.function(t.variableName)), color: ICLS.functionDecl },
    // DEFAULT_INSTANCE_METHOD（obj.method）
    { tag: t.function(t.propertyName), color: ICLS.method },
    { tag: t.labelName, color: ICLS.functionDecl },

    { tag: t.typeName, color: ICLS.typeParam },
    { tag: t.className, color: ICLS.fg }, // DEFAULT_CLASS_REFERENCE
    { tag: t.namespace, color: ICLS.fg },
    { tag: t.typeOperator, color: ICLS.keyword },
    { tag: t.standard(t.typeName), color: ICLS.typeParam },

    // HTML_TAG_NAME；JSX 组件色（#9C9CFF）在 CM6 难与 HTML 标签稳定区分，统一用标签金
    { tag: t.tagName, color: ICLS.htmlTagName },
    { tag: t.angleBracket, color: ICLS.fg },
    { tag: t.attributeValue, color: ICLS.string },

    { tag: t.operator, color: ICLS.fg }, // DEFAULT_OPERATION_SIGN
    { tag: t.punctuation, color: ICLS.fg },
    { tag: t.separator, color: ICLS.fg },
    { tag: t.bracket, color: ICLS.fg },
    { tag: t.paren, color: ICLS.fg },
    { tag: t.squareBracket, color: ICLS.fg },
    { tag: t.brace, color: ICLS.fg },

    { tag: t.meta, color: ICLS.metadata },
    { tag: t.annotation, color: ICLS.metadata },
    { tag: t.processingInstruction, color: ICLS.metadata },
    { tag: t.link, color: ICLS.link },
    { tag: t.url, color: ICLS.cssUrl },
    { tag: t.heading, color: ICLS.constant, fontWeight: 'bold' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strong, fontWeight: 'bold' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: t.invalid, color: ICLS.badChar },

    { tag: t.color, color: ICLS.functionDecl }, // CSS.COLOR
    { tag: t.unit, color: ICLS.number },
    { tag: t.derefOperator, color: ICLS.fg }
  ],
  { themeType: 'dark' }
)

const selectionMark = Decoration.mark({ class: 'cm-filesSelectionMark' })

/** 选区画在行内 mark 上，叠在活动行背景之上，两者可同时可见（CM 默认选区层在内容下）。 */
const filesSelectionMarkup = StateField.define({
  create(state) {
    return selectionDecorations(state)
  },
  update(value, tr) {
    return tr.selection || tr.docChanged ? selectionDecorations(tr.state) : value
  },
  provide: (f) => EditorView.decorations.from(f)
})

function selectionDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const r of state.selection.ranges) {
    if (!r.empty) builder.add(r.from, r.to, selectionMark)
  }
  return builder.finish()
}

/** tab 宽 + 行内选区（与活动行并存）。 */
export const filesEditorConfig: Extension = [
  EditorState.tabSize.of(4),
  filesSelectionMarkup
]

const jsdocMark = Decoration.mark({ class: 'cm-jsdoc' })
const jsdocTagMark = Decoration.mark({ class: 'cm-jsdoc-tag' })

/** `@lezer/javascript` 把 JSDoc 块注释也标成 blockComment；补一层识别以对齐 Dark.icls。 */
function buildJsdocDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'BlockComment') return
        if (node.to - node.from < 3) return
        if (view.state.doc.sliceString(node.from, node.from + 3) !== '/**') return
        builder.add(node.from, node.to, jsdocMark)
        const body = view.state.doc.sliceString(node.from, node.to)
        const tagRe = /@[A-Za-z][\w]*/g
        let m: RegExpExecArray | null
        while ((m = tagRe.exec(body))) {
          const start = node.from + m.index
          builder.add(start, start + m[0].length, jsdocTagMark)
        }
      }
    })
  }
  return builder.finish()
}

const filesJsdocHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildJsdocDecorations(view)
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildJsdocDecorations(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations }
)

export const filesHighlighting: Extension = [
  syntaxHighlighting(darculaHighlight),
  filesJsdocHighlight
]

/** 按路径选语言扩展：只高亮，不接 lint / 补全。 */
export function languageExtensionForPath(filePath: string): Extension {
  const lower = filePath.toLowerCase()
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.')) : ''
  switch (ext) {
    case '.ts':
    case '.tsx':
    case '.mts':
    case '.cts':
      return javascript({ typescript: true, jsx: ext === '.tsx' })
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return javascript({ jsx: ext === '.jsx' })
    case '.json':
    case '.jsonc':
      return json()
    case '.css':
    case '.scss':
    case '.less':
      return css()
    case '.html':
    case '.htm':
      return html()
    case '.xml':
    case '.svg':
      return xml()
    case '.md':
    case '.markdown':
      return markdown()
    case '.yml':
    case '.yaml':
      return yaml()
    case '.py':
      return python()
    default:
      return []
  }
}

/** basicSetup：关掉默认高亮/补全；高亮改由 filesHighlighting（Dark.icls）提供。 */
export const FILES_BASIC_SETUP = {
  lineNumbers: true,
  highlightActiveLineGutter: true,
  highlightSpecialChars: true,
  history: true,
  foldGutter: true,
  drawSelection: true,
  dropCursor: true,
  allowMultipleSelections: true,
  indentOnInput: true,
  syntaxHighlighting: false,
  bracketMatching: true,
  closeBrackets: true,
  autocompletion: false,
  rectangularSelection: true,
  crosshairCursor: false,
  highlightActiveLine: true,
  highlightSelectionMatches: false,
  closeBracketsKeymap: true,
  defaultKeymap: true,
  searchKeymap: true,
  historyKeymap: true,
  foldKeymap: true,
  completionKeymap: false,
  lintKeymap: false
} as const
