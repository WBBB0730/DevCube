// 要执行的语句（docs/prd/database.md「控制台」「运行配置」）：照 pgcli / mycli / litecli 执行前的切法（sqlparse.split，即
// 补全引擎移植的 StatementSplitter），切词同补全引擎（lang-sql 的适配层 tokenize）。字符串与注释里的分号不切（MySQL /
// MariaDB 的可执行注释 `/*! … */` 照 mysql 客户端不算注释，里面照常切，见 token-adapter）；建存储过程、函数、触发器
// 时 BEGIN … END 块里的分号也不切（MySQL / MariaDB 的过程体、SQLite 的触发器、PostgreSQL 的 BEGIN ATOMIC），整条发出。
// MySQL / MariaDB 另照 mycli 认客户端命令 DELIMITER：之后按换上的分隔符切，命令本身不发出。
// 切之前同步完整解析、不设时限，不用编辑器里的语法树：刚载入很长的文字时它可能还没解析完，切不准。
import type { EditorState } from '@codemirror/state'
import type { SqlKind } from '@shared/data-source'
import { completionDialect, type Dialect } from './sql-completion/dialects'
import type { Token } from './sql-completion/sqlparse/sql'
import { splitStatements } from './sql-completion/sqlparse/statement-splitter'
import { T, ttypeIn } from './sql-completion/sqlparse/tokens'
import { tokenize, VERSION_COMMENT } from './sql-completion/token-adapter'

interface Span {
  /** 语句的起点：第一个不是空白、注释与分号的记号 */
  from: number
  /** 语句的终点：结尾的分号（或分隔符）之前 */
  end: number
  /** 连同结尾的分号（或分隔符）的终点：光标落在它之后仍算这一条 */
  to: number
}

/**
 * 按别的分隔符切时换掉原文分号用的占位符（mycli 的 U+FFFC）：切词时是单独的一个记号，不是语句的边界，也不会与前后的
 * 词连成一个（换成空格的话，`END;` 与下一行的 `IF` 会连成 `END IF`）。
 */
const PLACEHOLDER = '\ufffc'

/**
 * 按分隔符 delimiter 切用的文字（照 mycli 的 DelimiterCommand._split）：原文的分号换成占位符、分隔符换成分号，照常切出
 * 的即按分隔符切的各条。分隔符换成的分号后面补空格、与原文等长，切出的位置即原文里的位置：语句直接从原文里取，不必
 * 像 mycli 那样再换回。分隔符是分号时原样切。
 */
function splitSource(text: string, delimiter: string): string {
  if (delimiter === ';') return text
  return text
    .split(delimiter)
    .map((part) => part.replaceAll(';', PLACEHOLDER))
    .join(';'.padEnd(delimiter.length))
}

/**
 * text 里从 start 起按分隔符 delimiter 切出的各条语句（位置为在 text 里的）。语句首尾的分号不算在语句里；只有空白、
 * 注释与分号的不算一条（MySQL 执行只有注释的语句会报「Query was empty」）。
 */
function spansFrom(text: string, start: number, delimiter: string, dialect: Dialect): Span[] {
  // 原文里是分号或分隔符的记号：切分用的文字里的分号（分隔符换成的），与换掉原文分号的占位符
  const isSemicolon = (token: Token): boolean =>
    token.match(T.Punctuation, ';') ||
    (token.value === PLACEHOLDER && text[start + token.pos] === ';')
  const spans: Span[] = []
  const tokens = tokenize(splitSource(text.slice(start), delimiter), dialect)
  for (const statement of splitStatements(tokens)) {
    // MySQL / MariaDB 可执行注释的开头与结尾算代码：连同注释原样发出，由服务器按版本号决定执行与否
    const code = statement.tokens.filter(
      (token) =>
        !token.isWhitespace && (!ttypeIn(token.ttype, T.Comment) || token.ttype === VERSION_COMMENT)
    )
    const first = code.find((token) => !isSemicolon(token))
    const last = code.findLast((token) => !isSemicolon(token))
    const tail = code.at(-1)
    if (first === undefined || last === undefined || tail === undefined) continue
    spans.push({
      from: start + first.pos,
      end: start + last.pos + last.value.length,
      // 切分用的文字里的分号在原文里是整个分隔符
      to: start + tail.pos + (tail.match(T.Punctuation, ';') ? delimiter.length : tail.value.length)
    })
  }
  return spans
}

/**
 * 从 at 起是 DELIMITER 命令时，为换上的分隔符与命令之后的位置；不是为 null。照 mycli：不分大小写，分隔符为其后第一段
 * 不含空白的文字，写成 delimiter 本身的不算。分隔符从命令所在的那一行里取（同 mysql 客户端按行认命令），不从切出的
 * 这条里取：按分号切，mysqldump 写的 `DELIMITER ;;` 只切到第一个分号。
 */
function delimiterCommandAt(text: string, at: number): { delimiter: string; next: number } | null {
  const lineEnd = text.indexOf('\n', at)
  const match = /^delimiter[ \t]+(\S+)/i.exec(text.slice(at, lineEnd < 0 ? undefined : lineEnd))
  const delimiter = match?.[1]
  if (match === null || delimiter === undefined || delimiter.toLowerCase() === 'delimiter') {
    return null
  }
  return { delimiter, next: at + match[0].length }
}

/**
 * 各条语句的范围。MySQL / MariaDB 照 mycli 的 DelimiterCommand.queries_iter 认 DELIMITER：切出的一条以 DELIMITER 命令
 * 开头时换上新的分隔符，从命令之后重新切；命令本身不是语句，不发出。每次都从分号切起，换上的分隔符只在这段文字里
 * 有效。kind 为数据源的类型（按它的方言切）。
 */
function spansOf(text: string, kind: SqlKind): Span[] {
  const dialect = completionDialect(kind)
  const spans: Span[] = []
  let delimiter = ';'
  let start: number | null = 0
  while (start !== null) {
    const pieces = spansFrom(text, start, delimiter, dialect)
    start = null
    for (const span of pieces) {
      const command = dialect.family === 'mysql' ? delimiterCommandAt(text, span.from) : null
      if (command !== null) {
        delimiter = command.delimiter
        start = command.next
        break
      }
      spans.push(span)
    }
  }
  return spans
}

/**
 * 要执行的语句：有选区时为选中的文字切出的各条；否则为光标所在的那条——光标落在两条之间（空行、注释）时取上面那条，
 * 上面没有就取下面那条。kind 为数据源的类型（按它的方言切）。
 */
export function statementsToRun(state: EditorState, kind: SqlKind): string[] {
  const { from, to, head } = state.selection.main
  if (from !== to) return allStatements(state.sliceDoc(from, to), kind)
  const spans = spansOf(state.doc.toString(), kind)
  const containing = spans.find((span) => span.from <= head && head <= span.to)
  const above = spans.filter((span) => span.to <= head).at(-1)
  const below = spans.find((span) => span.from >= head)
  const span = containing ?? above ?? below
  return span === undefined ? [] : [state.sliceDoc(span.from, span.end)]
}

/**
 * 整段文字里的全部语句（数据源上的配置运行时依次执行；控制台里执行选中的文字也用它）。kind 为数据源的类型。
 */
export function allStatements(text: string, kind: SqlKind): string[] {
  return spansOf(text, kind).map((span) => text.slice(span.from, span.end))
}
