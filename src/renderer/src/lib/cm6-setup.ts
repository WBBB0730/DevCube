import { cpp } from '@codemirror/lang-cpp'
import { css } from '@codemirror/lang-css'
import { go } from '@codemirror/lang-go'
import { html } from '@codemirror/lang-html'
import { java } from '@codemirror/lang-java'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { less } from '@codemirror/lang-less'
import { markdown } from '@codemirror/lang-markdown'
import { php } from '@codemirror/lang-php'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { sass } from '@codemirror/lang-sass'
import { sql } from '@codemirror/lang-sql'
import { vue } from '@codemirror/lang-vue'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import {
  HighlightStyle,
  LanguageSupport,
  StreamLanguage,
  foldGutter,
  syntaxHighlighting,
  syntaxTree,
  type StreamParser,
  type TagStyle
} from '@codemirror/language'
import {
  csharp,
  dart,
  kotlin,
  objectiveC,
  objectiveCpp,
  scala,
  shader
} from '@codemirror/legacy-modes/mode/clike'
import { clojure } from '@codemirror/legacy-modes/mode/clojure'
import { cmake } from '@codemirror/legacy-modes/mode/cmake'
import { cobol } from '@codemirror/legacy-modes/mode/cobol'
import { coffeeScript } from '@codemirror/legacy-modes/mode/coffeescript'
import { commonLisp } from '@codemirror/legacy-modes/mode/commonlisp'
import { crystal } from '@codemirror/legacy-modes/mode/crystal'
import { d } from '@codemirror/legacy-modes/mode/d'
import { diff } from '@codemirror/legacy-modes/mode/diff'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { elm } from '@codemirror/legacy-modes/mode/elm'
import { erlang } from '@codemirror/legacy-modes/mode/erlang'
import { fortran } from '@codemirror/legacy-modes/mode/fortran'
import { gas } from '@codemirror/legacy-modes/mode/gas'
import { gherkin } from '@codemirror/legacy-modes/mode/gherkin'
import { groovy } from '@codemirror/legacy-modes/mode/groovy'
import { haskell } from '@codemirror/legacy-modes/mode/haskell'
import { haxe } from '@codemirror/legacy-modes/mode/haxe'
import { http } from '@codemirror/legacy-modes/mode/http'
import { jinja2 } from '@codemirror/legacy-modes/mode/jinja2'
import { julia } from '@codemirror/legacy-modes/mode/julia'
import { liveScript } from '@codemirror/legacy-modes/mode/livescript'
import { lua } from '@codemirror/legacy-modes/mode/lua'
import { fSharp, oCaml, sml } from '@codemirror/legacy-modes/mode/mllike'
import { nginx } from '@codemirror/legacy-modes/mode/nginx'
import { pascal } from '@codemirror/legacy-modes/mode/pascal'
import { perl } from '@codemirror/legacy-modes/mode/perl'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { protobuf } from '@codemirror/legacy-modes/mode/protobuf'
import { pug } from '@codemirror/legacy-modes/mode/pug'
import { puppet } from '@codemirror/legacy-modes/mode/puppet'
import { r } from '@codemirror/legacy-modes/mode/r'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { sas } from '@codemirror/legacy-modes/mode/sas'
import { scheme } from '@codemirror/legacy-modes/mode/scheme'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { smalltalk } from '@codemirror/legacy-modes/mode/smalltalk'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { stylus } from '@codemirror/legacy-modes/mode/stylus'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { tcl } from '@codemirror/legacy-modes/mode/tcl'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { turtle } from '@codemirror/legacy-modes/mode/turtle'
import { vb } from '@codemirror/legacy-modes/mode/vb'
import { vbScript } from '@codemirror/legacy-modes/mode/vbscript'
import { verilog } from '@codemirror/legacy-modes/mode/verilog'
import { vhdl } from '@codemirror/legacy-modes/mode/vhdl'
import { xQuery } from '@codemirror/legacy-modes/mode/xquery'
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

/** 语法高亮 tag 映射（@lezer/highlight tags ← 方案的 DEFAULT_* / JS.*）。 */
function highlightSpecs(ICLS: EditorScheme): TagStyle[] {
  return [
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
  ]
}

/** 语法高亮扩展（编辑器内用；themeType 让两套样式随编辑器明暗自动择一）。 */
function buildHighlighting(ICLS: EditorScheme, dark: boolean): Extension {
  return syntaxHighlighting(
    HighlightStyle.define(highlightSpecs(ICLS), { themeType: dark ? 'dark' : 'light' })
  )
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

/**
 * 无 themeType 的裸高亮样式：编辑器外的单行着色用（内容搜索结果列表，见
 * cm6-highlight-line）。themeType 版类名只在对应明暗的编辑器容器内生效；
 * 这两套独立生成、类名互不冲突，可同时挂载按主题取用。
 */
export const filesHighlightStyle: Record<ThemeMode, HighlightStyle> = {
  dark: HighlightStyle.define(highlightSpecs(DARK_SCHEME)),
  light: HighlightStyle.define(highlightSpecs(LIGHT_SCHEME))
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
  return languageSupportForPath(filePath) ?? []
}

/** legacy-modes 的词法级高亮包装（长尾语言：无官方 Lezer 语法，精度低一档但日常够用）。 */
function legacy(mode: StreamParser<unknown>): LanguageSupport {
  return new LanguageSupport(StreamLanguage.define(mode))
}

/** 语言支持按键缓存（LanguageSupport 不可变可复用；搜索列表逐行取用时省去重建 parser）。 */
const languageCache = new Map<string, LanguageSupport | null>()

/** 按文件名（非扩展名）匹配的特例。 */
const FILENAME_KEYS = new Set(['dockerfile', 'cmakelists.txt', 'nginx.conf'])

/** 按路径选语言支持（含 parser，供编辑器外的单行着色取用）；无对应语言为 null。 */
export function languageSupportForPath(filePath: string): LanguageSupport | null {
  const lower = filePath.toLowerCase()
  const base = lower.slice(lower.lastIndexOf('/') + 1)
  // 文件名特例优先；点开头的隐藏配置（.gitignore 等）整名即「扩展名」，自然落入 switch
  const key = FILENAME_KEYS.has(base)
    ? base
    : base.includes('.')
      ? base.slice(base.lastIndexOf('.'))
      : ''
  if (key === '') return null
  const hit = languageCache.get(key)
  if (hit !== undefined) return hit
  const built = buildLanguageSupport(key)
  languageCache.set(key, built)
  return built
}

function buildLanguageSupport(key: string): LanguageSupport | null {
  switch (key) {
    // —— 官方 Lezer 包（完整语法解析）——
    case '.ts':
    case '.tsx':
    case '.mts':
    case '.cts':
      return javascript({ typescript: true, jsx: key === '.tsx' })
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return javascript({ jsx: key === '.jsx' })
    case '.json':
    case '.jsonc':
      return json()
    case '.css':
      return css()
    case '.scss':
      return sass()
    case '.sass':
      return sass({ indented: true })
    case '.less':
      return less()
    // Svelte / EJS 无官方语法，HTML（含内嵌 js/css）近似
    case '.html':
    case '.htm':
    case '.svelte':
    case '.ejs':
      return html()
    case '.xml':
    case '.svg':
    case '.plist':
    case '.xaml':
    case '.xsl':
    case '.xsd':
    case '.csproj':
      return xml()
    case '.md':
    case '.markdown':
      return markdown()
    // .meta 起四个是 Unity 序列化资产，即 YAML（游戏开发常开）
    case '.yml':
    case '.yaml':
    case '.meta':
    case '.unity':
    case '.prefab':
    case '.asset':
      return yaml()
    case '.py':
      return python()
    case '.asmdef':
      return json()
    // GDScript 无任何官方 / legacy 语法，语法形态接近 Python，做近似高亮
    case '.gd':
      return python()
    case '.go':
      return go()
    case '.rs':
      return rust()
    case '.java':
      return java()
    case '.c':
    case '.h':
    case '.cc':
    case '.cpp':
    case '.cxx':
    case '.hh':
    case '.hpp':
      return cpp()
    case '.php':
      return php()
    case '.sql':
      return sql()
    case '.vue':
      return vue()
    // —— legacy-modes（词法级，长尾语言）——
    case '.cs':
      return legacy(csharp)
    case '.kt':
    case '.kts':
      return legacy(kotlin)
    case '.swift':
      return legacy(swift)
    case '.m':
      return legacy(objectiveC)
    case '.mm':
      return legacy(objectiveCpp)
    case '.dart':
      return legacy(dart)
    case '.scala':
      return legacy(scala)
    case '.groovy':
    case '.gradle':
      return legacy(groovy)
    case '.sh':
    case '.bash':
    case '.zsh':
      return legacy(shell)
    case '.rb':
      return legacy(ruby)
    case '.lua':
      return legacy(lua)
    case '.toml':
      return legacy(toml)
    case '.r':
      return legacy(r)
    case '.pl':
    case '.pm':
      return legacy(perl)
    case '.ps1':
    case '.psm1':
      return legacy(powerShell)
    // .conf 起为泛 key=value / 忽略清单类配置，按 properties 近似
    case '.properties':
    case '.ini':
    case '.env':
    case '.conf':
    case '.cfg':
    case '.gitignore':
    case '.gitattributes':
    case '.dockerignore':
    case '.npmrc':
    case '.editorconfig':
      return legacy(properties)
    case '.diff':
    case '.patch':
      return legacy(diff)
    // 游戏 shader（GLSL / HLSL / ShaderLab）：clike 的 shader 变体做近似词法高亮
    case '.glsl':
    case '.hlsl':
    case '.shader':
    case '.cginc':
      return legacy(shader)
    case '.clj':
    case '.cljs':
    case '.cljc':
    case '.edn':
      return legacy(clojure)
    case '.cmake':
    case 'cmakelists.txt':
      return legacy(cmake)
    case '.cob':
    case '.cbl':
      return legacy(cobol)
    case '.coffee':
      return legacy(coffeeScript)
    case '.lisp':
    case '.cl':
    case '.el':
      return legacy(commonLisp)
    case '.cr':
      return legacy(crystal)
    case '.d':
      return legacy(d)
    case '.elm':
      return legacy(elm)
    case '.erl':
    case '.hrl':
      return legacy(erlang)
    case '.f':
    case '.for':
    case '.f90':
    case '.f95':
    case '.f03':
      return legacy(fortran)
    case '.s':
      return legacy(gas)
    case '.feature':
      return legacy(gherkin)
    case '.hs':
      return legacy(haskell)
    case '.hx':
      return legacy(haxe)
    case '.http':
      return legacy(http)
    case '.j2':
    case '.jinja':
    case '.jinja2':
      return legacy(jinja2)
    case '.jl':
      return legacy(julia)
    case '.ls':
      return legacy(liveScript)
    case '.ml':
    case '.mli':
      return legacy(oCaml)
    case '.fs':
    case '.fsx':
    case '.fsi':
      return legacy(fSharp)
    case '.sml':
      return legacy(sml)
    case 'nginx.conf':
      return legacy(nginx)
    case '.pas':
      return legacy(pascal)
    case '.proto':
      return legacy(protobuf)
    case '.pug':
    case '.jade':
      return legacy(pug)
    case '.pp':
      return legacy(puppet)
    case '.sas':
      return legacy(sas)
    case '.scm':
    case '.ss':
      return legacy(scheme)
    case '.st':
      return legacy(smalltalk)
    case '.tex':
    case '.sty':
      return legacy(stex)
    case '.styl':
      return legacy(stylus)
    case '.tcl':
      return legacy(tcl)
    case '.ttl':
      return legacy(turtle)
    case '.vb':
      return legacy(vb)
    case '.vbs':
      return legacy(vbScript)
    case '.v':
    case '.sv':
    case '.svh':
      return legacy(verilog)
    case '.vhd':
    case '.vhdl':
      return legacy(vhdl)
    case '.xq':
    case '.xquery':
      return legacy(xQuery)
    case 'dockerfile':
      return legacy(dockerFile)
    default:
      return null
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
  searchKeymap: false, // 默认搜索面板退役：Cmd+F 由自定义查找浮层接管（cm6-find + FilesFindWidget）
  historyKeymap: true,
  foldKeymap: true,
  completionKeymap: false,
  lintKeymap: false
} as const
