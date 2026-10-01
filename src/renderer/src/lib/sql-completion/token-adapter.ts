// 切词适配层：把 lang-sql 语法树的叶子（与叶子之间的空白）转成与 sqlparse 词法（sqlparse/lexer.py + keywords.py 的
// SQL_REGEX）等价的记号流，交给照搬的 sqlparse 切分与分组。这是与 pgcli 唯一允许的差异：切词按 lang-sql（各方言的
// 引号、注释、字符串、变量写法都随编辑器），其余按 sqlparse 的规则：
// - 词的类别查 sqlparse 的关键字表（sqlparse/keywords.json，与 sqlparse 默认词法的 KEYWORDS_* 查表相同；mycli、
//   litecli 也用 sqlparse，所以各方言都与来源一致）。lang-sql 自己的关键字 / 类型表不用来分类。
// - sqlparse 按位置判定的规则照做：词后紧跟「(」为名字（函数）、挨着「.」的为名字、多词关键字合并（LEFT JOIN、
//   ORDER BY、NOT NULL…）、ASC / DESC 为 Keyword.Order、LIKE / REGEXP 为比较运算符。
// - 运算符按 sqlparse 的规则：相邻的运算符字符连成一段再切（lang-sql 各方言缺的运算符字符也算，见 mergeOperators），
//   单独的 - 紧挨数字时为负号；lang-sql 标成变量、却只有符号没有名字的（SQLite 单独的 :）按 sqlparse 切
//   （见 splitSpecialVar）。
// - 与 sqlparse 有意不同的有两处：
//   - sqlparse 表里的关键字（type、key、data、session…）不是本方言保留字的，在只能是名字的几个位置纠正为名字（见
//     correctNonReserved）：表名与别名的位置、AS 之后、选择列表里的一项。
//   - MySQL / MariaDB 的可执行注释（`/*! … */`、`/*!50003 … */`）照 mysql 客户端不当注释：里面的内容照常切词，只有
//     开头与结尾记为 VERSION_COMMENT（见 versionCommentPieces）。sqlparse 与 lang-sql 都把它整个当注释。
import type { SQLDialectSpec } from '@codemirror/lang-sql'
import type { Dialect } from './dialects'
import { LruCache } from './lru'
import sqlparseKeywords from './sqlparse/keywords.json'
import type { LexToken } from './sqlparse/statement-splitter'
import { T, type TokenType } from './sqlparse/tokens'

/** lang-sql 的叶子节点名，或补切出的：换行、空白、词、其他单个字符。 */
type PieceKind = string

interface Piece {
  kind: PieceKind
  text: string
  from: number
}

/** 词（关键字、名字、类型…）：参与 sqlparse 按位置的判定。 */
const WORD_KINDS: ReadonlySet<PieceKind> = new Set([
  'Identifier',
  'Keyword',
  'Type',
  'Builtin',
  'Bool',
  'Null',
  'word'
])

/** lang-sql 切不出的部分（错误节点、空白）按 sqlparse 的写法补切：换行、单个空白、Unicode 词、其余单个字符。 */
const FALLBACK = /(\r\n|\r|\n)|(\s)|([\p{L}\p{N}_]+)|([\s\S])/uy

function fallbackPieces(text: string, from: number): Piece[] {
  const pieces: Piece[] = []
  FALLBACK.lastIndex = 0
  let m: RegExpExecArray | null
  while (FALLBACK.lastIndex < text.length && (m = FALLBACK.exec(text)) !== null) {
    const kind = m[1] ? 'newline' : m[2] ? 'space' : m[3] ? 'word' : 'char'
    pieces.push({ kind, text: m[0], from: from + m.index })
  }
  return pieces
}

/** lang-sql 语法树里包住其他节点的节点：没有子节点时（如只有空白的文字）不是记号。 */
const CONTAINERS: ReadonlySet<string> = new Set([
  'Script',
  'Statement',
  'CompositeIdentifier',
  'Parens',
  'Braces',
  'Brackets'
])

/** 语法树的叶子依次取出，叶子之间与错误节点里的文字补切。 */
function leafPieces(text: string, dialect: Dialect, offset: number): Piece[] {
  const tree = dialect.codemirror.language.parser.parse(text)
  const pieces: Piece[] = []
  let pos = 0
  tree.iterate({
    enter: (node) => {
      if (node.node.firstChild !== null) return true
      if (node.to <= pos || CONTAINERS.has(node.name)) return false
      if (node.from > pos) pieces.push(...fallbackPieces(text.slice(pos, node.from), offset + pos))
      const leaf = text.slice(node.from, node.to)
      if (node.name === '⚠') pieces.push(...fallbackPieces(leaf, offset + node.from))
      else pieces.push({ kind: node.name, text: leaf, from: offset + node.from })
      pos = node.to
      return false
    }
  })
  if (pos < text.length) pieces.push(...fallbackPieces(text.slice(pos), offset + pos))
  return pieces
}

/**
 * lang-sql 的 SpecialVar（MySQL / MariaDB 的 @ ?，SQLite 的 @ : ? $）：符号加名字（或带引号的文字）的是变量，照
 * lang-sql（各方言变量的写法随编辑器，同引号与注释）；只有符号、没有名字的（单独的 :、::、@、@@、?、$）不是变量，按
 * sqlparse 切成单个字符：「:」为标点（sqlparse `[;:()\[\],\.]`，相邻的两个合成 ::、与 = 合成 :=，见 mergePieces），
 * @ ? 交给运算符的规则（见 mergeOperators），$ 没有规则（Error；紧挨着词时为占位符，见 mergePieces）。
 */
function splitSpecialVar(piece: Piece): Piece[] {
  if (/[^@:?$]/.test(piece.text)) return [piece]
  return [...piece.text].map((ch, i): Piece => ({
    kind: ch === ':' ? 'Punctuation' : 'char',
    text: ch,
    from: piece.from + i
  }))
}

/**
 * 字符串 / 带引号的名字没有收尾（lang-sql 一直读到文字末尾）时，开头引号的位置；已收尾为 null。
 * 判断与 lang-sql 的 readLiteral / readDoubleDollarLiteral 相同。
 */
function unclosedQuoteAt(piece: Piece, dialect: Dialect): number | null {
  const { text } = piece
  if (piece.kind === 'QuotedIdentifier') {
    const end = text[0] === '[' ? ']' : text[0]!
    return text.indexOf(end, 1) < 0 ? 0 : null
  }
  if (piece.kind !== 'String') return null
  const dollar = /^\$\w*\$/.exec(text)
  if (dollar !== null) {
    const tag = dollar[0]
    return text.length >= tag.length * 2 && text.endsWith(tag) ? null : 0
  }
  const quoteAt = text.search(/['"]/)
  if (quoteAt < 0) return null
  const quote = text[quoteAt]!
  const backslash = /^[eE]'/.test(text) || dialect.codemirror.spec.backslashEscapes === true
  let escaped = false
  for (let i = quoteAt + 1; i < text.length; i++) {
    const ch = text[i]!
    if (ch === quote && !escaped) return null
    escaped = backslash && !escaped && ch === '\\'
  }
  return quoteAt
}

/**
 * 可执行注释的开头（连同 5 或 6 位的版本号，同服务器），按 lang-sql 方言的 versionComments（见 data-source-sql）：
 * MySQL 为 `/*!`；MariaDB 另认只在 MariaDB 上执行的 `/*M!`，MySQL 把它当普通注释。其余方言没有。
 */
const VERSION_COMMENT_OPEN: Record<NonNullable<SQLDialectSpec['versionComments']>, RegExp> = {
  mysql: /^\/\*!(\d{5,6})?/,
  mariadb: /^\/\*M?!(\d{5,6})?/
}

/**
 * 可执行注释开头之后的文字是否以它的结尾收尾：lang-sql 照 mysql 客户端读到第一个在代码里的结尾符（不在字符串、带引号
 * 的名字与注释里）为止，没有时读到文字末尾——这时末尾即使是结尾符，也在字符串或注释里。代码里的 * 在 lang-sql 的
 * MySQL / MariaDB 方言里都切成运算符。
 */
function closesVersionComment(body: string, dialect: Dialect): boolean {
  if (!body.endsWith('*/')) return false
  const star = body.length - 2
  return (
    leafPieces(body, dialect, 0).find((p) => p.from + p.text.length > star)?.kind === 'Operator'
  )
}

/**
 * 可执行注释拆成开头、内容与结尾（照 mysql 客户端：它不把这种注释当注释，内容照常按分隔符切开，连同注释原样发给服务器，
 * 由服务器按版本号决定执行与否；mysqldump 把 SET 头、视图、触发器、事件整条写在里面）：内容重新切片，开头与结尾记为
 * VERSION_COMMENT。注释的范围照 lang-sql（与编辑器的高亮一致；lang-sql 补丁里照 mysql 客户端找结尾，字符串里的结尾符
 * 不算）。不是可执行注释的原样返回。
 */
function versionCommentPieces(piece: Piece, dialect: Dialect): Piece[] {
  const kind = dialect.codemirror.spec.versionComments
  const open = kind === undefined ? undefined : VERSION_COMMENT_OPEN[kind].exec(piece.text)?.[0]
  if (open === undefined) return [piece]
  const closed = closesVersionComment(piece.text.slice(open.length), dialect)
  const end = closed ? piece.text.length - 2 : piece.text.length
  const mark = (text: string, from: number): Piece => ({ kind: 'VersionComment', text, from })
  return [
    mark(open, piece.from),
    ...allPieces(piece.text.slice(open.length, end), dialect, piece.from + open.length),
    ...(closed ? [mark('*/', piece.from + end)] : [])
  ]
}

/**
 * 全部切片：没收尾的引号按 sqlparse 记为 Error，之后的文字重新切（sqlparse 在不配对的引号处出一个 Error 记号后
 * 接着往下切）。
 */
function allPieces(text: string, dialect: Dialect, offset = 0): Piece[] {
  const pieces = leafPieces(text, dialect, offset).flatMap((p) => {
    if (p.kind === 'SpecialVar') return splitSpecialVar(p)
    if (p.kind === 'BlockComment') return versionCommentPieces(p, dialect)
    return [p]
  })
  const lastIdx = pieces.findLastIndex((p) => p.kind !== 'space' && p.kind !== 'newline')
  const last = pieces[lastIdx]
  if (last === undefined) return pieces
  const quoteAt = unclosedQuoteAt(last, dialect)
  if (quoteAt === null) return pieces
  const rest: Piece[] = []
  if (quoteAt > 0) rest.push({ kind: 'word', text: last.text.slice(0, quoteAt), from: last.from })
  rest.push({ kind: 'char', text: last.text[quoteAt]!, from: last.from + quoteAt })
  const start = last.from - offset + quoteAt + 1
  rest.push(...allPieces(text.slice(start), dialect, offset + start))
  return [...pieces.slice(0, lastIdx), ...rest]
}

const adjacent = (a: Piece, b: Piece): boolean => a.from + a.text.length === b.from

/** 相邻的几片合成一片。 */
function joined(kind: PieceKind, parts: Piece[]): Piece {
  return { kind, text: parts.map((p) => p.text).join(''), from: parts[0]!.from }
}

/** sqlparse SQL_REGEX 里运算符规则（见 OPERATOR_RULES）用到的字符。 */
const SQLPARSE_OPERATOR_CHARS: ReadonlySet<string> = new Set('*?<>=~!+/@#%^&|-')

/**
 * 相邻的运算符连成一段，交给 operatorTokens 按 sqlparse 的规则再切：lang-sql 各方言的运算符字符不全（MySQL /
 * MariaDB 没有 / 与 ~，SQLite 没有 ^ 与 #），缺的字符落在错误节点里，连同 SpecialVar 切出的 @ ?（见
 * splitSpecialVar）都按 sqlparse 算作运算符，与相邻的运算符合成一段（sqlparse 的运算符规则按整段匹配，如 /-、~=）。
 */
function mergeOperators(pieces: Piece[]): Piece[] {
  const isOperator = (p: Piece): boolean =>
    p.kind === 'Operator' || (p.kind === 'char' && SQLPARSE_OPERATOR_CHARS.has(p.text))
  const out: Piece[] = []
  for (const piece of pieces) {
    const prev = out.at(-1)
    if (isOperator(piece) && prev !== undefined && isOperator(prev) && adjacent(prev, piece)) {
      out[out.length - 1] = joined('Operator', [prev, piece])
    } else {
      out.push(isOperator(piece) ? { ...piece, kind: 'Operator' } : piece)
    }
  }
  return out
}

/**
 * 按 sqlparse 的写法合并切片：
 * - 连写的两个引号是转义（'it''s'、"a""b"）：lang-sql 切成两段，合成一段；
 * - 含 Unicode 字母的词（lang-sql 只认 ASCII）：与相邻的词连成一个名字（sqlparse 的 \w 含 Unicode）；
 * - 「::」「:=」；「$1」「:name」「?」等占位符（sqlparse `(?<!\w)[$:?]\w+`）；
 * - SQLite 的 [名字]（sqlparse `(?<![\w\])])(\[[^\]\[]+\])`）；
 * - 单行注释带上结尾的换行（sqlparse `(--|# ).*?(\r\n|\r|\n|$)`）。
 */
function mergePieces(pieces: Piece[]): Piece[] {
  const out: Piece[] = []
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]!
    const prev = out.at(-1)
    // 连写引号
    if (
      prev !== undefined &&
      (piece.kind === 'String' || piece.kind === 'QuotedIdentifier') &&
      prev.kind === piece.kind &&
      adjacent(prev, piece) &&
      /^['"`]/.test(piece.text) &&
      prev.text.endsWith(piece.text[0]!)
    ) {
      out[out.length - 1] = joined(piece.kind, [prev, piece])
      continue
    }
    // Unicode 词：与左右相邻的词、数字连成一个名字
    if (WORD_KINDS.has(piece.kind) || piece.kind === 'Number') {
      let j = i
      let hasFallback = false
      while (j < pieces.length) {
        const p = pieces[j]!
        const joinable = WORD_KINDS.has(p.kind) || (p.kind === 'Number' && /^\d+$/.test(p.text))
        if (!joinable || (j > i && !adjacent(pieces[j - 1]!, p))) break
        if (p.kind === 'word') hasFallback = true
        j++
      }
      if (hasFallback && j - i > 1) {
        out.push(joined('word', pieces.slice(i, j)))
        i = j - 1
        continue
      }
    }
    const next = pieces[i + 1]
    // ::、:=
    if (
      piece.kind === 'Punctuation' &&
      piece.text === ':' &&
      next !== undefined &&
      adjacent(piece, next)
    ) {
      if (next.kind === 'Punctuation' && next.text === ':') {
        out.push(joined('::', [piece, next]))
        i++
        continue
      }
      if (next.kind === 'Operator' && next.text.startsWith('=')) {
        out.push({ kind: ':=', text: ':=', from: piece.from })
        if (next.text.length > 1) {
          out.push({ kind: 'Operator', text: next.text.slice(1), from: next.from + 1 })
        }
        i++
        continue
      }
    }
    // 占位符
    if (
      ((piece.kind === 'char' && piece.text === '$') ||
        (piece.kind === 'Punctuation' && piece.text === ':')) &&
      next !== undefined &&
      adjacent(piece, next) &&
      (WORD_KINDS.has(next.kind) || next.kind === 'Number') &&
      !(prev !== undefined && adjacent(prev, piece) && /[\p{L}\p{N}_]$/u.test(prev.text))
    ) {
      out.push(joined('Placeholder', [piece, next]))
      i++
      continue
    }
    // [名字]
    if (
      piece.kind === '[' &&
      !(prev !== undefined && adjacent(prev, piece) && /[\p{L}\p{N}_\])]$/u.test(prev.text))
    ) {
      const close = pieces.findIndex((p, k) => k > i && p.kind === ']')
      if (close > i + 1) {
        const inner = pieces.slice(i + 1, close)
        if (inner.every((p) => !/[[\]]/.test(p.text))) {
          out.push(joined('BracketName', pieces.slice(i, close + 1)))
          i = close
          continue
        }
      }
    }
    // 单行注释带上结尾的换行
    if (piece.kind === 'LineComment' && next?.kind === 'newline' && adjacent(piece, next)) {
      out.push(joined('LineComment', [piece, next]))
      i++
      continue
    }
    out.push(piece)
  }
  return out
}

/** 分类后的记号；word 为 sqlparse 按「词」处理的（参与按位置的判定）。 */
interface Tok extends LexToken {
  word: boolean
}

/**
 * sqlparse/keywords.py 的关键字表：默认词法依次查 KEYWORDS_COMMON、_ORACLE、_MYSQL、_PLPGSQL、_HQL、_MSACCESS、
 * _SNOWFLAKE、_BIGQUERY、KEYWORDS，先查到的为准。keywords.json 是按这个次序合并后、按类型分组的结果（只留单个词，
 * 多词的项词法规则匹配不到）。
 */
const SQLPARSE_KEYWORDS: ReadonlyMap<string, TokenType> = new Map(
  Object.entries(sqlparseKeywords).flatMap(([type, words]) =>
    words.map((word): [string, TokenType] => [word, `${T.Token}.${type}`])
  )
)

/** sqlparse/lexer.py: Lexer.is_keyword——查关键字表，查不到为名字。 */
function wordType(upper: string): TokenType {
  return SQLPARSE_KEYWORDS.get(upper) ?? T.Name
}

/** sqlparse SQL_REGEX 里运算符字符的规则（按原顺序）。 */
const OPERATOR_RULES: readonly [RegExp, TokenType][] = [
  [/\*/y, T.Wildcard],
  [/\?/y, T.NamePlaceholder],
  [/->>?|#>>?|@>|<@|\?\|?|\?&|-|#-/y, T.Operator],
  [/[<>=~!]+/y, T.Comparison],
  [/[+/@#%^&|-]+/y, T.Operator]
]

function operatorTokens(piece: Piece): Tok[] {
  const toks: Tok[] = []
  let at = 0
  while (at < piece.text.length) {
    let matched = false
    for (const [re, ttype] of OPERATOR_RULES) {
      re.lastIndex = at
      const m = re.exec(piece.text)
      if (m !== null) {
        toks.push({ ttype, value: m[0], pos: piece.from + at, word: false })
        at += m[0].length
        matched = true
        break
      }
    }
    if (!matched) {
      toks.push({
        ttype: T.Error,
        value: piece.text[at]!,
        pos: piece.from + at,
        word: false
      })
      at += 1
    }
  }
  return toks
}

/**
 * 可执行注释的开头与结尾（见 versionCommentPieces）的记号类型：算作一种注释，sqlparse 的分组、补全与各处跳过注释的
 * 判断都跳过它、只看里面的内容；但切语句时不能像注释那样去掉，要连同它原样发出（见 sql-statements）。
 */
export const VERSION_COMMENT: TokenType = `${T.CommentMultiline}.Version`

function numberType(text: string): TokenType {
  if (/^0x/i.test(text)) return T.NumberHexadecimal
  if (/^x'/i.test(text)) return T.StringSingle
  if (/[.eE]/.test(text)) return T.NumberFloat
  return T.NumberInteger
}

/**
 * 切片分类为 sqlparse 的记号类型。词（不论 lang-sql 标成关键字、类型、名字还是命令行命令）都按 sqlparse 的
 * PROCESS_AS_KEYWORD 查关键字表。
 */
function classify(pieces: Piece[]): Tok[] {
  const toks: Tok[] = []
  const push = (ttype: TokenType, piece: Piece, word = false): void => {
    toks.push({ ttype, value: piece.text, pos: piece.from, word })
  }
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]!
    const { kind, text } = piece
    if (WORD_KINDS.has(kind)) {
      push(wordType(text.toUpperCase()), piece, true)
      continue
    }
    switch (kind) {
      case 'newline':
        push(T.Newline, piece)
        break
      case 'space':
        push(T.Whitespace, piece)
        break
      case 'LineComment':
        push(/^(--|# )\+/.test(text) ? T.CommentSingleHint : T.CommentSingle, piece)
        break
      case 'BlockComment':
        push(text.startsWith('/*+') ? T.CommentMultilineHint : T.CommentMultiline, piece)
        break
      case 'VersionComment':
        push(VERSION_COMMENT, piece)
        break
      case 'String':
        push(text.startsWith('$') ? T.Literal : T.StringSingle, piece)
        break
      case 'Bytes':
        push(T.StringSingle, piece)
        break
      case 'Number':
        push(numberType(text), piece)
        break
      case 'Bits':
        push(T.NumberInteger, piece)
        break
      case 'QuotedIdentifier':
        push(text.startsWith('"') ? T.StringSymbol : T.Name, piece)
        break
      case 'BracketName':
        push(T.Name, piece)
        break
      case 'SpecialVar':
        push(text.startsWith('@') ? T.Name : T.NamePlaceholder, piece)
        break
      case 'Placeholder':
        push(T.NamePlaceholder, piece)
        break
      case '::':
        push(T.Punctuation, piece)
        break
      case ':=':
        push(T.Assignment, piece)
        break
      case 'Operator': {
        const ops = operatorTokens(piece)
        const last = ops.at(-1)!
        const next = pieces[i + 1]
        // sqlparse 的数字规则（`-?\d+`、`-?0x…` 等）排在运算符之前：单独的 - 紧挨着数字时算作数字的负号（a=-1、
        // a-1）；被前面的运算符连成一段的不算（a+-1 为 +- 与 1）
        if (
          last.value === '-' &&
          next?.kind === 'Number' &&
          adjacent(piece, next) &&
          /^(\d|\.\d|0x)/i.test(next.text)
        ) {
          toks.push(...ops.slice(0, -1), {
            ttype: numberType(next.text),
            value: '-' + next.text,
            pos: last.pos,
            word: false
          })
          i++
        } else {
          toks.push(...ops)
        }
        break
      }
      case '(':
      case ')':
      case '[':
      case ']':
      case ';':
      case '.':
      case 'Punctuation':
        push(T.Punctuation, piece)
        break
      default:
        // { }、单个未知字符：sqlparse 没有对应规则，记为 Error
        push(T.Error, piece)
    }
  }
  return toks
}

/** sqlparse SQL_REGEX 里的多词规则（按原顺序），在词的开头依次尝试。 */
const MULTIWORD_RULES: readonly [RegExp, TokenType][] = [
  [
    /((LEFT\s+|RIGHT\s+|FULL\s+)?(INNER\s+|OUTER\s+|STRAIGHT\s+)?|(CROSS\s+|NATURAL\s+)?)?JOIN\b/iy,
    T.Keyword
  ],
  [/END(\s+IF|\s+LOOP|\s+WHILE|\s+FOR|\s+CASE)?\b/iy, T.Keyword],
  [/IF\s+(NOT\s+)?EXISTS\b/iy, T.Keyword],
  [/NOT\s+NULL\b/iy, T.Keyword],
  [/(ASC|DESC)(\s+NULLS\s+(FIRST|LAST))?\b/iy, T.KeywordOrder],
  [/(ASC|DESC)\b/iy, T.KeywordOrder],
  [/NULLS\s+(FIRST|LAST)\b/iy, T.KeywordOrder],
  [/UNION\s+ALL\b/iy, T.Keyword],
  [/CREATE(\s+OR\s+REPLACE)?\b/iy, T.DDL],
  [/DOUBLE\s+PRECISION\b/iy, T.NameBuiltin],
  [/GROUP\s+BY\b/iy, T.Keyword],
  [/ORDER\s+BY\b/iy, T.Keyword],
  [/PRIMARY\s+KEY\b/iy, T.Keyword],
  [/HANDLER\s+FOR\b/iy, T.Keyword],
  [/GO(\s\d+)\b/iy, T.Keyword],
  [/(LATERAL\s+VIEW\s+)(EXPLODE|INLINE|PARSE_URL_TUPLE|POSEXPLODE|STACK)\b/iy, T.Keyword],
  [/(AT|WITH')\s+TIME\s+ZONE\s+'[^']+'/iy, T.KeywordTZCast],
  [/(NOT\s+)?(LIKE|ILIKE|RLIKE)\b/iy, T.Comparison],
  [/(NOT\s+)?(REGEXP)(\s+(BINARY))?\b/iy, T.Comparison]
]

/** sqlparse `(CASE|IN|VALUES|USING|FROM|AS)\b`：这几个词总是关键字（后面跟括号也不算函数）。 */
const ALWAYS_KEYWORDS: ReadonlySet<string> = new Set([
  'CASE',
  'IN',
  'VALUES',
  'USING',
  'FROM',
  'AS'
])

/** sqlparse 位置规则只作用于字母开头的词（`[A-ZÀ-Ü]`，忽略大小写）。 */
const LETTER_START = /^[A-Za-zÀ-Üà-ü]/

/** sqlparse SQL_REGEX 里词的规则：按位置判为名字、合并多词关键字，其余按 lang-sql 的类别。 */
function applyWordRules(toks: Tok[], text: string): Tok[] {
  const out: Tok[] = []
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i]!
    if (!tok.word) {
      out.push(tok)
      continue
    }
    const upper = tok.value.toUpperCase()
    const end = tok.pos + tok.value.length
    if (ALWAYS_KEYWORDS.has(upper)) {
      out.push({ ...tok, ttype: T.Keyword })
      continue
    }
    if (LETTER_START.test(tok.value)) {
      const after = text.slice(end)
      if (/^\s*\.(?!\d)/.test(after) || text[tok.pos - 1] === '.' || after.startsWith('(')) {
        out.push({ ...tok, ttype: T.Name })
        continue
      }
    }
    let merged: Tok | null = null
    for (const [re, ttype] of MULTIWORD_RULES) {
      re.lastIndex = tok.pos
      const m = re.exec(text)
      if (m === null) continue
      const matchEnd = tok.pos + m[0].length
      let last = i
      while (last < toks.length && toks[last]!.pos + toks[last]!.value.length < matchEnd) last++
      if (last === toks.length || toks[last]!.pos + toks[last]!.value.length !== matchEnd) continue
      merged = { ttype, value: m[0], pos: tok.pos, word: false }
      i = last
      break
    }
    out.push(merged ?? tok)
  }
  return out
}

const significant = (tok: Tok): boolean =>
  !tok.ttype.startsWith(T.Whitespace) && !tok.ttype.startsWith(T.Comment)

const upperOf = (tok: Tok | undefined): string => tok?.value.toUpperCase() ?? ''
const isPunct = (tok: Tok | undefined, value: string): boolean =>
  tok?.ttype === T.Punctuation && tok.value === value
const isKeywordValue = (tok: Tok | undefined, values: ReadonlySet<string>): boolean =>
  tok !== undefined && tok.ttype.startsWith(T.Keyword) && values.has(upperOf(tok))

/** 可按位置纠正为名字的：sqlparse 算作关键字 / 类型、又不是本方言保留字的单个词。 */
function correctable(tok: Tok, dialect: Dialect): boolean {
  const upper = upperOf(tok)
  return (
    (tok.ttype === T.Keyword || tok.ttype === T.NameBuiltin) &&
    !/\s/.test(tok.value) &&
    !ALWAYS_KEYWORDS.has(upper) &&
    !dialect.reserved.has(upper)
  )
}

const isNameLike = (tok: Tok): boolean =>
  tok.ttype === T.Name || tok.ttype === T.StringSymbol || tok.ttype === T.NamePlaceholder

/** 选择列表之后的子句（遇到时选择列表结束）。 */
const SELECT_LIST_ENDS: ReadonlySet<string> = new Set([
  'INTO',
  'FROM',
  'WHERE',
  'GROUP BY',
  'HAVING',
  'WINDOW',
  'UNION',
  'UNION ALL',
  'INTERSECT',
  'EXCEPT',
  'ORDER BY',
  'LIMIT',
  'OFFSET',
  'FETCH',
  'FOR'
])

/** 其后是选择列表里一项的关键字。 */
const SELECT_ITEM_STARTERS: ReadonlySet<string> = new Set(['SELECT', 'DISTINCT', 'ALL'])

/** 表达式之后可以跟的关键字。 */
const EXPRESSION_FOLLOWERS: ReadonlySet<string> = new Set([
  'AS',
  'FROM',
  'WHERE',
  'AND',
  'OR',
  'IS',
  'IN',
  'NOT',
  'BETWEEN',
  'GROUP BY',
  'ORDER BY',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'UNION',
  'UNION ALL',
  'EXCEPT',
  'INTERSECT',
  'THEN',
  'WHEN',
  'ELSE',
  'END',
  'ON',
  'USING',
  'INTO',
  'RETURNING',
  'WINDOW',
  'FETCH',
  'FOR',
  'COLLATE',
  'ESCAPE'
])

/** 表达式的结尾：没有下一个记号，或下一个是逗号、右括号、运算符、名字，或 AS、FROM 这类关键字。 */
function endsExpression(next: Tok | undefined): boolean {
  if (next === undefined) return true
  if (next.ttype === T.Punctuation) return [',', ')', ';', '.', '::', '['].includes(next.value)
  if (next.ttype.startsWith(T.Operator) || next.ttype === T.Wildcard) return true
  if (next.ttype === T.KeywordOrder || next.ttype === T.KeywordTZCast) return true
  if (isNameLike(next) || next.ttype === T.NameBuiltin) return true
  if (!next.ttype.startsWith(T.Keyword)) return false
  const upper = upperOf(next)
  return EXPRESSION_FOLLOWERS.has(upper) || upper.endsWith('JOIN') || upper === 'NOT NULL'
}

interface Level {
  /** 下一个词是否在表名 / 别名的位置 */
  expect: 'none' | 'table' | 'alias'
  /** 是否在 FROM / JOIN 的表列表里（逗号之后又是表名，表名之后可跟别名） */
  fromList: boolean
  /** 是否在 SELECT 的选择列表里 */
  selectList: boolean
  /** 这一层括号开始时外层所处的位置 */
  openedAt: Level['expect']
}

/** 选择列表里一项的开头：前一个记号是 SELECT、DISTINCT、ALL，或选择列表里的逗号。 */
function startsSelectItem(prev: Tok | undefined, level: Level): boolean {
  if (!level.selectList || prev === undefined) return false
  return isPunct(prev, ',') || isKeywordValue(prev, SELECT_ITEM_STARTERS)
}

/**
 * 按位置把非保留字纠正为名字（与 sqlparse 有意不同之处，只在这几个只能是名字的位置）：
 * - 表名的位置：FROM、各种 JOIN、INSERT … INTO、语句开头的 UPDATE、TABLE、COPY 之后，FROM 列表里逗号之后；
 * - 别名的位置：FROM 列表里表名（或括号括起的子查询、函数）之后；
 * - AS 之后（后面紧跟「(」的除外）；
 * - 选择列表里的一项（前一个记号是 SELECT 或选择列表里的逗号、后一个记号是表达式的结尾，如 SELECT type FROM）。
 * 后两种只纠正关键字，类型照旧（多是类型本身）。其余位置（条件、参数表、SET 列表、COLUMN 之后、窗口子句…）照
 * sqlparse，交给照搬的 pgcli 逻辑处理。
 */
function correctNonReserved(toks: Tok[], dialect: Dialect): void {
  const sig = toks.filter(significant)
  const stack: Level[] = [{ expect: 'none', fromList: false, selectList: false, openedAt: 'none' }]
  sig.forEach((tok, k) => {
    const level = stack.at(-1)!
    const prev = sig[k - 1]
    const next = sig[k + 1]
    if (tok.ttype === T.Punctuation) {
      if (tok.value === '(') {
        stack.push({ expect: 'none', fromList: false, selectList: false, openedAt: level.expect })
      } else if (tok.value === ')') {
        if (stack.length > 1) {
          const closed = stack.pop()!
          const outer = stack.at(-1)!
          outer.expect = closed.openedAt !== 'none' && outer.fromList ? 'alias' : 'none'
        }
      } else if (tok.value === ',') {
        level.expect = level.fromList ? 'table' : 'none'
      } else if (tok.value === '.') {
        level.expect = level.expect === 'alias' ? 'table' : 'none'
      } else {
        level.expect = 'none'
        level.fromList = false
        level.selectList = false
      }
      return
    }
    if (correctable(tok, dialect)) {
      // 类型（Name.Builtin）在表达式里多是类型本身（CAST … AS 类型），只在表名 / 别名的位置纠正
      const keyword = tok.ttype === T.Keyword
      const afterAs =
        keyword && prev?.ttype === T.Keyword && upperOf(prev) === 'AS' && !isPunct(next, '(')
      const selectItem = keyword && startsSelectItem(prev, level) && endsExpression(next)
      if (level.expect !== 'none' || afterAs || selectItem) tok.ttype = T.Name
    }
    if (level.expect !== 'none' && isNameLike(tok)) {
      level.expect = level.expect === 'table' && level.fromList ? 'alias' : 'none'
      return
    }
    const upper = upperOf(tok)
    if (level.expect === 'alias' && tok.ttype === T.Keyword && upper === 'AS') return
    if (tok.ttype.startsWith(T.Keyword)) {
      if (tok.ttype === T.DML && upper === 'SELECT') level.selectList = true
      else if (SELECT_LIST_ENDS.has(upper)) level.selectList = false
      const prevIsKeyword = prev !== undefined && prev.ttype.startsWith(T.Keyword)
      if (upper === 'FROM' || upper.endsWith('JOIN')) {
        level.expect = 'table'
        level.fromList = true
      } else if (
        (upper === 'INTO' && prevIsKeyword) ||
        (upper === 'UPDATE' && !prevIsKeyword) ||
        upper === 'TABLE' ||
        upper === 'COPY'
      ) {
        level.expect = 'table'
        level.fromList = false
      } else {
        level.expect = 'none'
        level.fromList = false
      }
      return
    }
    level.expect = 'none'
  })
}

/** 容量同解析缓存（见 sqlparse/parse.ts） */
const cache = new LruCache<readonly LexToken[]>(128, 256_000)

/**
 * 文字的 sqlparse 等价记号流（sqlparse/lexer.py: Lexer.get_tokens 的替代）：lang-sql 切词，sqlparse 的类别与
 * 位置规则，再按保留字纠正名字的位置。结果按（方言, 文字）缓存复用（同 parse，见 sqlparse/parse.ts），只读。
 */
export function tokenize(text: string, dialect: Dialect): readonly LexToken[] {
  return cache.getOrCompute(`${dialect.kind}\u0000${text}`, () => {
    const toks = applyWordRules(
      classify(mergePieces(mergeOperators(allPieces(text, dialect)))),
      text
    )
    correctNonReserved(toks, dialect)
    return toks.map(({ ttype, value, pos }) => ({ ttype, value, pos }))
  })
}
