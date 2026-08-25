import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { HighlightStyle, foldGutter, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { EditorState, RangeSetBuilder, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import type { ThemeMode } from '@shared/theme'
import { filesLineNumbers } from './cm6-git-gutter'
import { filesSelectionLayer } from './cm6-selection-layer'

/**
 * WebStorm 编辑器色（2026.1 New UI）：深色取 `Dark`（parent Darcula），浅色取 `Light`
 * （themes/expUI/expUI_lightScheme.xml，parent Default）。
 * 字体：JetBrains Mono 13 / weight 500（补偿 macOS 灰度平滑渲染偏细，同控制台思路）/ 无连字。
 * 行高：见 main.css `.files-codemirror`（当前 CSS line-height: 1.7）。
 */
const DARK_SCHEME = {
  bg: '#1E1F22', // TEXT BACKGROUND
  fg: '#BCBEC4', // TEXT FOREGROUND / DEFAULT_IDENTIFIER
  caret: '#CED0D6', // CARET_COLOR
  selection: 'var(--editor-selection)', // #224283，WebStorm；≠ UI `--selection-row`
  // 活动行用等效半透明叠色（One Dark 同款惯例）：叠在 bg 上精确等于 CARET_ROW_COLOR，
  // 且不遮挡画在内容层之下的选区层。
  activeLine: 'rgba(163, 181, 234, 0.06)', // 叠在 #1E1F22 上 = CARET_ROW_COLOR #26282E
  caretRowGutter: '#26282E', // CARET_ROW_COLOR（行号栏不透明，直接用原色）
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

type EditorScheme = { readonly [K in keyof typeof DARK_SCHEME]: string }

/**
 * 浅色（expUI_lightScheme.xml）。三处标「推导」的键在浅色方案里确实没有对等取值：
 * 浅色 doc 注释与普通注释同色、坏字符只有背景没有前景、搜索命中没有 EFFECT_COLOR。
 */
const LIGHT_SCHEME: EditorScheme = {
  bg: '#FFFFFF',
  fg: '#080808',
  caret: '#000000', // 浅色方案未定义，继承 Default 基方案
  selection: 'var(--editor-selection)', // #A6D2FF
  activeLine: 'rgba(88, 138, 238, 0.06)', // 叠在 #FFFFFF 上 = CARET_ROW_COLOR #F5F8FE
  caretRowGutter: '#F5F8FE',
  lineNumber: '#AEB3C2',
  lineNumberCaret: '#767A8A',
  indentGuide: '#EBECF0',
  keyword: '#0033B3',
  string: '#067D17',
  stringEscape: '#0037A6',
  number: '#1750EB',
  comment: '#8C8C8C',
  docComment: '#8C8C8C',
  docTag: '#8C8C8C', // 推导：浅色 DEFAULT_DOC_COMMENT_TAG 只有下划线色，前景继承 doc 注释
  functionDecl: '#00627A',
  method: '#00627A', // 代码级 fallback：DEFAULT_INSTANCE_METHOD → FUNCTION_DECLARATION
  constant: '#871094',
  metadata: '#9E880D',
  typeParam: '#007E8A',
  regexp: '#264EFF',
  link: '#006DCC',
  cssUrl: '#067D17', // 代码级 fallback：CSS.URL → HTML_ATTRIBUTE_VALUE → STRING
  badChar: '#F50000', // 推导：浅色无前景红，取 WRONG_REFERENCES_ATTRIBUTES
  searchBg: '#FCD47E',
  searchSelected: '#C47233', // 推导：浅色无 EFFECT_COLOR，取同块 ERROR_STRIPE_COLOR
  matchedBrace: '#93D9D9',
  foldedBg: '#E9F5E6',
  lookupBg: '#FFFFFF',
  htmlTagName: '#0033B3' // 代码级 fallback：HTML_TAG_NAME → DEFAULT_KEYWORD
}

/** 编辑器 chrome：背景 / 光标 / 选区 / 行号 / 活动行。 */
function buildEditorTheme(ICLS: EditorScheme, dark: boolean): Extension {
  return EditorView.theme(
    {
      '&': {
        height: '100%',
        fontSize: '13px',
        color: ICLS.fg,
        backgroundColor: ICLS.bg
      },
      '.cm-scroller': {
        fontFamily: '"JetBrains Mono", monospace',
        fontWeight: '500',
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
      // 官方 drawSelection 的选区层置透明：选区由 cm6-selection-layer 自绘（整行高 / 换行格 / 圆角），
      // 光标层仍用官方
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionLayer .cm-selectionBackground':
        {
          backgroundColor: 'transparent !important'
        },
      // 活动行用等效半透明叠色（见 activeLine 的注释）：正文层不遮挡画在其下的选区层
      '.cm-activeLine': {
        backgroundColor: ICLS.activeLine
      },
      '.cm-gutters': {
        backgroundColor: ICLS.bg,
        color: ICLS.lineNumber,
        border: 'none'
      },
      '.cm-activeLineGutter': {
        backgroundColor: ICLS.caretRowGutter,
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
    { dark }
  )
}

/** 语法高亮：映射 @lezer/highlight tags ← 方案的 DEFAULT_* / JS.* */
function buildHighlighting(ICLS: EditorScheme, dark: boolean): Extension {
  const style = HighlightStyle.define(
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
    { themeType: dark ? 'dark' : 'light' }
  )
  return syntaxHighlighting(style)
}

/** 编辑器 chrome / 语法高亮各两套，按主题取用（识别稳定，切主题即 reconfigure、不重建编辑器）。 */
export const filesEditorTheme: Record<ThemeMode, Extension> = {
  dark: buildEditorTheme(DARK_SCHEME, true),
  light: buildEditorTheme(LIGHT_SCHEME, false)
}

const HIGHLIGHT_STYLES: Record<ThemeMode, Extension> = {
  dark: buildHighlighting(DARK_SCHEME, true),
  light: buildHighlighting(LIGHT_SCHEME, false)
}

/** tab 宽 + 自绘选区层（整行高 / 换行格 / 圆角，见 cm6-selection-layer）。 */
export const filesEditorConfig: Extension = [EditorState.tabSize.of(4), filesSelectionLayer]

/**
 * Files 编辑器的 gutter 列：行号（带 diff 标记点击接线）在左、折叠在右。
 * basicSetup 的同款两项已关闭——gutter 顺序跟随扩展顺序，若仍由 basicSetup 提供行号，
 * 追加的点击接线版会落到折叠列右侧。
 */
export const filesGutters: Extension = [filesLineNumbers, foldGutter()]

const jsdocMark = Decoration.mark({ class: 'cm-jsdoc' })
const jsdocTagMark = Decoration.mark({ class: 'cm-jsdoc-tag' })

/** `@lezer/javascript` 把 JSDoc 块注释也标成 blockComment；补一层识别以对齐 IDE 配色方案。 */
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

export const filesHighlighting: Record<ThemeMode, Extension> = {
  dark: [HIGHLIGHT_STYLES.dark, filesJsdocHighlight],
  light: [HIGHLIGHT_STYLES.light, filesJsdocHighlight]
}

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

/** basicSetup：关掉默认高亮/补全；高亮改由 filesHighlighting 按主题提供。 */
export const FILES_BASIC_SETUP = {
  lineNumbers: false, // 由 filesGutters 提供（带 diff 标记点击接线）
  highlightActiveLineGutter: true,
  highlightSpecialChars: true,
  history: true,
  foldGutter: false, // 由 filesGutters 提供（保证列序：行号左、折叠右）
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
