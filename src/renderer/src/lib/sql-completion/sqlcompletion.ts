// 补全上下文判断：移植 pgcli/packages/sqlcompletion.py（suggest_type 与 suggest_based_on_last_token 的结构、各建议类型
// 照 pgcli）。三者同源，同一个判断点上 mycli / litecli 与 pgcli 不同或另有分支时，MySQL / MariaDB 照
// mycli/packages/completion_engine.py，SQLite 照 litecli/packages/completion_engine.py（见各处「mycli：」「litecli：」）。
// 没有移植的：pgcli / mycli / litecli 的命令行专用部分（反斜杠命令 suggest_special、\i 路径、\ns 命名查询）。
import type { Dialect } from './dialects'
import { isolateQueryCtes } from './parseutils/ctes'
import type { TableMetadata } from './parseutils/meta'
import { tableRef, type TableReference } from './parseutils/tables'
import { findPrevKeyword, lastWord, parsePartialIdentifier } from './parseutils/utils'
import { parse, parseFresh } from './sqlparse/parse'
import { Comparison, Identifier, Statement, Token, TokenNotFoundError, Where } from './sqlparse/sql'
import { T } from './sqlparse/tokens'
import { scopedTables } from './subquery-scope'

// —— 建议类型（pgcli 的 namedtuple；mycli 独有的在后） ——

export type Suggestion =
  | { type: 'Special' }
  | { type: 'Database' }
  | { type: 'Schema'; quoted: boolean }
  /** FROM 里可用的表、视图、函数；tableRefs 为语句里已有的表（别名不重复用） */
  | {
      type: 'FromClauseItem'
      schema: string | null
      tableRefs: TableReference[]
      localTables: TableMetadata[]
    }
  | {
      type: 'Table'
      schema: string | null
      tableRefs: TableReference[]
      localTables: TableMetadata[]
    }
  | { type: 'View'; schema: string | null; tableRefs: TableReference[] }
  /** ON 之后的连接条件，如 foo.barid = bar.barid */
  | { type: 'JoinCondition'; tableRefs: TableReference[]; parent: TableReference | null }
  /** JOIN 之后的表与连接条件，如 foo ON foo.barid = bar.barid */
  | { type: 'Join'; tableRefs: TableReference[]; schema: string | null }
  | {
      type: 'Function'
      schema: string | null
      tableRefs: TableReference[]
      usage: 'signature' | 'special' | 'from' | null
    }
  | {
      type: 'Column'
      tableRefs: TableReference[]
      requireLastTable: boolean
      localTables: TableMetadata[]
      qualifiable: boolean
      context: 'insert' | null
    }
  | { type: 'Keyword'; lastToken: string | null }
  | { type: 'Datatype'; schema: string | null }
  | { type: 'Alias'; aliases: string[] }
  // mycli：
  /** 枚举列的取值；在引号里补全时带已输入的前缀、引号与要替换的长度 */
  | {
      type: 'EnumValue'
      tableRefs: TableReference[]
      column: string
      parent: string | null
      valuePrefix?: string
      quote?: string
      replacementLength?: number
    }
  | { type: 'CharacterSet' }
  | { type: 'Collation' }
  /** 字符集引导符（_utf8mb4'…'） */
  | { type: 'Introducer' }
  | { type: 'Show' }
  | { type: 'User' }
  /** CHANGE MASTER TO 的选项 */
  | { type: 'Change' }
  | { type: 'Procedure'; schema: string | null }

/** 建议的构造（对应 pgcli 各 namedtuple 与其默认值）。 */
export const S = {
  Special: (): Suggestion => ({ type: 'Special' }),
  Database: (): Suggestion => ({ type: 'Database' }),
  Schema: (quoted = false): Suggestion => ({ type: 'Schema', quoted }),
  FromClauseItem: (
    schema: string | null = null,
    tableRefs: TableReference[] = [],
    localTables: TableMetadata[] = []
  ): Suggestion => ({ type: 'FromClauseItem', schema, tableRefs, localTables }),
  Table: (
    schema: string | null = null,
    tableRefs: TableReference[] = [],
    localTables: TableMetadata[] = []
  ): Suggestion => ({ type: 'Table', schema, tableRefs, localTables }),
  View: (schema: string | null = null, tableRefs: TableReference[] = []): Suggestion => ({
    type: 'View',
    schema,
    tableRefs
  }),
  JoinCondition: (tableRefs: TableReference[], parent: TableReference | null): Suggestion => ({
    type: 'JoinCondition',
    tableRefs,
    parent
  }),
  Join: (tableRefs: TableReference[], schema: string | null): Suggestion => ({
    type: 'Join',
    tableRefs,
    schema
  }),
  Function: (
    schema: string | null = null,
    tableRefs: TableReference[] = [],
    usage: 'signature' | 'special' | 'from' | null = null
  ): Suggestion => ({ type: 'Function', schema, tableRefs, usage }),
  Column: ({
    tableRefs = [],
    requireLastTable = false,
    localTables = [],
    qualifiable = false,
    context = null
  }: {
    tableRefs?: TableReference[]
    requireLastTable?: boolean
    localTables?: TableMetadata[]
    qualifiable?: boolean
    context?: 'insert' | null
  } = {}): Suggestion => ({
    type: 'Column',
    tableRefs,
    requireLastTable,
    localTables,
    qualifiable,
    context
  }),
  Keyword: (lastToken: string | null = null): Suggestion => ({ type: 'Keyword', lastToken }),
  Datatype: (schema: string | null = null): Suggestion => ({ type: 'Datatype', schema }),
  Alias: (aliases: string[]): Suggestion => ({ type: 'Alias', aliases }),
  EnumValue: (
    tableRefs: TableReference[],
    column: string,
    parent: string | null
  ): Extract<Suggestion, { type: 'EnumValue' }> => ({
    type: 'EnumValue',
    tableRefs,
    column,
    parent
  }),
  CharacterSet: (): Suggestion => ({ type: 'CharacterSet' }),
  Collation: (): Suggestion => ({ type: 'Collation' }),
  Introducer: (): Suggestion => ({ type: 'Introducer' }),
  Show: (): Suggestion => ({ type: 'Show' }),
  User: (): Suggestion => ({ type: 'User' }),
  Change: (): Suggestion => ({ type: 'Change' }),
  Procedure: (schema: string | null = null): Suggestion => ({ type: 'Procedure', schema })
}

/** 最后一个记号：pgcli 里为 Token、字符串（内部直接指定的上下文，如 'where'、'type'）或空串（没有记号）。 */
type LastToken = Token | string | null

/** sqlcompletion.py: SqlStatement */
export class SqlStatement {
  identifier: Identifier | null = null
  readonly wordBeforeCursor: string
  readonly localTables: TableMetadata[]
  fullText: string
  textBeforeCursor: string
  readonly parsed: Statement | null
  readonly lastToken: Token | ''
  /** 光标前本条语句的文字，含打了一半的词（mycli 的 ctx.text_before_cursor） */
  readonly textWithWord: string
  /** 光标在 fullText 里的位置 */
  private readonly cursor: number
  private readonly scopes = new Map<string, ReturnType<typeof scopedTables>>()

  constructor(
    fullText: string,
    textBeforeCursor: string,
    readonly dialect: Dialect
  ) {
    const wordBeforeCursor = lastWord(textBeforeCursor, 'many_punctuations')
    this.wordBeforeCursor = wordBeforeCursor
    ;[fullText, textBeforeCursor, this.localTables] = isolateQueryCtes(
      fullText,
      textBeforeCursor,
      dialect
    )
    // 打了一半的词先去掉再交给解析，否则最后一个记号总是这个词，只能补关键字。parsed 是新解析的一棵树（不取缓存），
    // get_previous_token 按对象同一性在里面找记号，与 pgcli 相同
    let parsed: Statement[]
    let stripped = ''
    if (wordBeforeCursor) {
      if (wordBeforeCursor.endsWith('(') || wordBeforeCursor.startsWith('\\')) {
        parsed = parseFresh(textBeforeCursor, dialect)
      } else {
        textBeforeCursor = textBeforeCursor.slice(0, -wordBeforeCursor.length)
        parsed = parseFresh(textBeforeCursor, dialect)
        this.identifier = parsePartialIdentifier(wordBeforeCursor, dialect)
        stripped = wordBeforeCursor
      }
    } else {
      parsed = parseFresh(textBeforeCursor, dialect)
    }
    let statement: Statement | null
    ;[fullText, textBeforeCursor, statement] = splitMultipleStatements(
      fullText,
      textBeforeCursor,
      parsed,
      dialect
    )
    this.fullText = fullText
    this.textBeforeCursor = textBeforeCursor
    this.textWithWord = textBeforeCursor + stripped
    this.cursor = this.textWithWord.length
    this.parsed = statement
    this.lastToken = statement?.tokenPrev(statement.tokens.length)[1] ?? ''
  }

  /** 按子查询作用域取表（同一段文字只算一次）。 */
  private scoped(text: string, cursor: number): ReturnType<typeof scopedTables> {
    const key = `${cursor}\u0000${text}`
    let result = this.scopes.get(key)
    if (result === undefined) {
      result = scopedTables(text, cursor, this.dialect, this.localTables)
      this.scopes.set(key, result)
    }
    return result
  }

  /** sqlcompletion.py: SqlStatement.is_insert */
  isInsert(): boolean {
    return this.parsed?.tokenFirst()?.value.toLowerCase() === 'insert'
  }

  /**
   * sqlcompletion.py: SqlStatement.get_tables——语句里可用的表。scope 为 'insert' 时只取第一张；为 'before' 时只取
   * 光标之前的；INSERT 语句在其余情况下跳过第一张。取表的范围按子查询作用域（见 subquery-scope.ts）。
   */
  getTables(scope: 'full' | 'insert' | 'before' = 'full'): TableReference[] {
    let tables =
      scope === 'full' ? this.scoped(this.fullText, this.cursor).tables : this.tablesBefore()
    if (scope === 'insert') tables = tables.slice(0, 1)
    else if (this.isInsert()) tables = tables.slice(1)
    return tables
  }

  /** 光标所在子查询作用域里带别名的子查询（sqls：当作语句自带的表，列取自子查询的选择列表）。 */
  derivedTables(): TableMetadata[] {
    return this.scoped(this.fullText, this.cursor).derived
  }

  /** 光标之前的文字里可见的表（pgcli 的 extract_tables(text_before_cursor)，按子查询作用域）。 */
  tablesBefore(): TableReference[] {
    return this.scoped(this.textBeforeCursor, this.textBeforeCursor.length).tables
  }

  /** sqlcompletion.py: SqlStatement.get_previous_token（记号不在本层时抛 TokenNotFoundError） */
  getPreviousToken(token: Token): Token | null {
    return this.parsed!.tokenPrev(this.parsed!.tokenIndex(token))[1]
  }

  /** sqlcompletion.py: SqlStatement.get_identifier_schema */
  getIdentifierSchema(): string | null {
    let schema = this.identifier?.getParentName() || null
    // 不带引号的模式名转成小写（PostgreSQL 的规则；mycli / litecli 原样）
    if (schema && this.identifier!.value[0] !== '"' && this.dialect.family === 'postgresql') {
      schema = schema.toLowerCase()
    }
    return schema
  }

  /** sqlcompletion.py: SqlStatement.reduce_to_prev_keyword */
  reduceToPrevKeyword(nSkip = 0): Token | null {
    const [prevKeyword, text] = findPrevKeyword(this.textBeforeCursor, this.dialect, nSkip)
    this.textBeforeCursor = text
    return prevKeyword
  }
}

/**
 * sqlcompletion.py: suggest_type——按整段文字与光标前的文字，给出要补全的种类与范围（列的范围是一组表）。
 */
export function suggestType(
  fullText: string,
  textBeforeCursor: string,
  dialect: Dialect
): Suggestion[] {
  let stmt: SqlStatement
  try {
    stmt = new SqlStatement(fullText, textBeforeCursor, dialect)
  } catch {
    // pgcli：sqlparse 出错时（TypeError / AttributeError）不给建议
    return []
  }
  return suggestBasedOnLastToken(stmt.lastToken, stmt, stmt.wordBeforeCursor)
}

const functionBodyPattern = /(\$.*?\$)([\s\S]*?)\1/m

/** sqlcompletion.py: _find_function_body */
function findFunctionBody(text: string): [number | null, number | null] {
  const m = functionBodyPattern.exec(text)
  if (m === null) return [null, null]
  const start = m.index + m[1]!.length
  return [start, start + m[2]!.length]
}

/** sqlcompletion.py: _statement_from_function */
function statementFromFunction(
  fullText: string,
  textBeforeCursor: string,
  statement: Statement,
  dialect: Dialect
): [string, string, Statement | null] {
  const currentPos = textBeforeCursor.length
  const [bodyStart, bodyEnd] = findFunctionBody(fullText)
  if (bodyStart === null || bodyEnd === null) return [fullText, textBeforeCursor, statement]
  if (!(bodyStart <= currentPos && currentPos < bodyEnd)) {
    return [fullText, textBeforeCursor, statement]
  }
  fullText = fullText.slice(bodyStart, bodyEnd)
  textBeforeCursor = textBeforeCursor.slice(bodyStart)
  const parsed = parseFresh(textBeforeCursor, dialect)
  return splitMultipleStatements(fullText, textBeforeCursor, parsed, dialect)
}

/** sqlcompletion.py: _split_multiple_statements——多条语句时只留光标所在的那条；在函数体里时取函数体里的那条。 */
function splitMultipleStatements(
  fullText: string,
  textBeforeCursor: string,
  parsed: Statement[],
  dialect: Dialect
): [string, string, Statement | null] {
  let statement: Statement
  if (parsed.length > 1) {
    // 按各条语句的长度累加，找到包住光标的那条
    const currentPos = textBeforeCursor.length
    let stmtStart = 0
    let stmtEnd = 0
    for (const s of parsed) {
      statement = s
      const stmtLen = s.toString().length
      ;[stmtStart, stmtEnd] = [stmtEnd, stmtEnd + stmtLen]
      if (stmtEnd >= currentPos) {
        textBeforeCursor = fullText.slice(stmtStart, currentPos)
        fullText = fullText.slice(stmtStart)
        break
      }
    }
  } else if (parsed.length === 1) {
    statement = parsed[0]!
  } else {
    return [fullText, textBeforeCursor, null]
  }
  let token2: Token | null = null
  if (['CREATE', 'CREATE OR REPLACE'].includes(statement!.getType())) {
    const token1 = statement!.tokenFirst()
    if (token1) token2 = statement!.tokenNext(statement!.tokenIndex(token1))[1]
  }
  if (token2 && token2.value.toUpperCase() === 'FUNCTION') {
    return statementFromFunction(fullText, textBeforeCursor, statement!, dialect)
  }
  return [fullText, textBeforeCursor, statement!]
}

/** sqlcompletion.py: _is_datatype_keyword——type 是 TYPE 关键字（DDL 里）还是名为 type 的列。 */
function isDatatypeKeyword(token: LastToken, stmt: SqlStatement): boolean {
  // 内部直接要类型建议（如 CREATE TABLE foo (bar <光标>）
  if (typeof token === 'string') return true
  if (token === null || !token.isKeyword) return false
  const [prevKeyword] = findPrevKeyword(stmt.textBeforeCursor.trimEnd(), stmt.dialect, 1)
  if (prevKeyword === null) return false
  return prevKeyword.ttype !== T.DML
}

/** sqlcompletion.py: identifies——名字（别名、表名或 模式.表名）是否指这张表。 */
export function identifies(tableId: string, ref: TableReference): boolean {
  return (
    tableId === ref.alias ||
    tableId === ref.name ||
    (Boolean(ref.schema) && tableId === `${ref.schema}.${ref.name}`)
  )
}

/** sqlcompletion.py: _allow_join_condition——前一个记号是 ON / AND / OR 时才建议连接条件（= 之后不建议）。 */
function allowJoinCondition(statement: Statement | null): boolean {
  if (!statement || statement.tokens.length === 0) return false
  const lastTok = statement.tokenPrev(statement.tokens.length)[1]
  return ['on', 'and', 'or'].includes(lastTok?.value.toLowerCase() ?? '')
}

/** sqlcompletion.py: _allow_join——前一个记号是 JOIN（CROSS / NATURAL JOIN 除外）时才建议连接。 */
function allowJoin(statement: Statement | null): boolean {
  if (!statement || statement.tokens.length === 0) return false
  const value = statement.tokenPrev(statement.tokens.length)[1]?.value.toLowerCase() ?? ''
  return value.endsWith('join') && value !== 'cross join' && value !== 'natural join'
}

/** 列建议用的语句自带的表：CTE，加上子查询作用域里带别名的子查询。 */
function columnLocalTables(stmt: SqlStatement): TableMetadata[] {
  return [...stmt.localTables, ...stmt.derivedTables()]
}

/**
 * sqlcompletion.py: _suggest_expression——表达式里的建议；打了一半的名字带前缀（表别名或模式名）时按前缀缩小范围。
 * mycli：没有前缀时另加字符集引导符（_emit_select_like 的 introducer）。
 */
function suggestExpression(tokenV: string, stmt: SqlStatement): Suggestion[] {
  const parent = stmt.identifier?.getParentName() ?? null
  let tables = stmt.getTables()
  if (parent) {
    tables = tables.filter((t) => identifies(parent, t))
    return [
      S.Column({ tableRefs: tables, localTables: columnLocalTables(stmt) }),
      S.Table(parent),
      S.View(parent),
      S.Function(parent)
    ]
  }
  const suggestions = [
    S.Column({ tableRefs: tables, localTables: columnLocalTables(stmt), qualifiable: true }),
    S.Function(null),
    S.Keyword(tokenV.toUpperCase())
  ]
  if (stmt.dialect.family === 'mysql') suggestions.push(S.Introducer())
  return suggestions
}

/** mycli：BINARY_OPERANDS——其后是表达式的二元运算符（遇到时回到前一个关键字判断）。 */
const MYSQL_BINARY_OPERANDS: ReadonlySet<string> = new Set([
  '&',
  '>',
  '>>',
  '>=',
  '<',
  '<>',
  '!=',
  '<<',
  '<=',
  '<=>',
  '%',
  '*',
  '+',
  '-',
  '->',
  '->>',
  '/',
  ':=',
  '=',
  '^',
  'and',
  '&&',
  'div',
  'like',
  'not like',
  'not regexp',
  'or',
  '||',
  'regexp',
  'rlike',
  'sounds like',
  '|'
])

/** 逗号或运算符之后回到前一个关键字判断的记号（pgcli；mycli 为二元运算符；litecli 另加 + - * /）。 */
function continuesExpression(tokenV: string, dialect: Dialect): boolean {
  if (tokenV.endsWith(',')) return true
  switch (dialect.family) {
    case 'mysql':
      return MYSQL_BINARY_OPERANDS.has(tokenV)
    case 'sqlite':
      return (
        ['=', 'and', 'or'].includes(tokenV) ||
        ['+', '-', '*', '/'].some((op) => tokenV.endsWith(op))
      )
    default:
      return ['=', 'and', 'or'].includes(tokenV)
  }
}

/** sqlcompletion.py: suggest_based_on_last_token */
function suggestBasedOnLastToken(
  token: LastToken,
  stmt: SqlStatement,
  wordBeforeCursor: string | null = null
): Suggestion[] {
  const { dialect } = stmt
  const family = dialect.family
  // mycli 的 ctx.text_before_cursor：最外层含打了一半的词，递归时为回退后的文字
  const ctxText = wordBeforeCursor === null ? stmt.textBeforeCursor : stmt.textWithWord
  if (family === 'mysql') {
    const guarded = mysqlGuards(token, stmt, wordBeforeCursor)
    if (guarded !== null) return guarded
  }
  let tokenV: string
  if (typeof token === 'string') {
    tokenV = token.toLowerCase()
  } else if (token instanceof Comparison) {
    // 'select * FROM abc a JOIN def d ON a.id = d.' 这类比较，取右侧最后一个记号
    tokenV = token.tokens.at(-1)!.value.toLowerCase()
  } else if (token instanceof Where) {
    // sqlparse 把整个 WHERE 子句归为一组，往回找真正的关键字
    if (family === 'mysql') return mysqlWhereToken(token, stmt, ctxText)
    const prevKeyword = stmt.reduceToPrevKeyword()
    return suggestBasedOnLastToken(prevKeyword, stmt)
  } else if (token instanceof Identifier) {
    // 在括号括起的列表里（CREATE TABLE foo (名字 <光标>、CREATE FUNCTION foo (名字 <光标>）建议类型；
    // 否则多半要写别名（SELECT 名字 <光标>、SELECT foo FROM 名字 <光标>）
    const [prevKeyword] = findPrevKeyword(stmt.textBeforeCursor, dialect)
    if (prevKeyword && prevKeyword.value === '(') return suggestBasedOnLastToken('type', stmt)
    return [S.Keyword()]
  } else if (token === null) {
    // mycli 的 none_token：没有可依据的记号
    return [S.Keyword()]
  } else {
    tokenV = token.value.toLowerCase()
  }
  const isKeyword = typeof token !== 'string' && token.isKeyword

  if (!token) return [S.Keyword(), S.Special()]

  // mycli：star_token——单独的 * 之后只补关键字（这条规则排在 binary_or_comma 之前，BINARY_OPERANDS 里的 * 因而
  // 不会用到）
  if (family === 'mysql' && tokenV === '*') return [S.Keyword()]

  if (tokenV.endsWith('(')) {
    const p = parse(stmt.textBeforeCursor, dialect)[0]!
    if (p.tokens.length > 0 && p.tokens.at(-1) instanceof Where) {
      // 四种情况：
      //  1 括起的条件，如 "WHERE foo AND ("：建议列、函数
      //  2 函数调用，如 "WHERE foo("：建议列、函数
      //  3 子查询表达式，如 "WHERE EXISTS ("：建议关键字（写子查询）
      //  4 子查询或数组比较，如 "WHERE foo = ANY("：建议列、函数（与关键字）
      const columnSuggestions = suggestBasedOnLastToken('where', stmt)
      const where = p.tokens.at(-1) as Where
      let prevTok = where.tokenPrev(where.tokens.length - 1)[1]
      if (prevTok instanceof Comparison) prevTok = prevTok.tokens.at(-1)!
      if (prevTok?.value.toLowerCase() === 'exists') return [S.Keyword()]
      return columnSuggestions
    }
    // 括号前的记号
    const prevTok = p.tokenPrev(p.tokens.length - 1)[1]
    if (prevTok?.value && prevTok.value.toLowerCase().split(' ').at(-1) === 'using') {
      // tbl1 INNER JOIN tbl2 USING (col1, col2)：只建议出现在不止一张表里的列
      return [
        S.Column({
          tableRefs: stmt.getTables('before'),
          requireLastTable: true,
          localTables: stmt.localTables
        })
      ]
    }
    const first = p.tokenFirst()?.value.toLowerCase()
    if (first === 'select') {
      // 左括号前有空格时多半要写子查询
      if (lastWord(stmt.textBeforeCursor, 'all_punctuations').startsWith('(')) return [S.Keyword()]
    } else if (family === 'mysql' && first === 'show') {
      // mycli：SHOW (
      return [S.Show()]
    }
    const prevPrevTok = prevTok !== null ? p.tokenPrev(p.tokenIndex(prevTok))[1] : null
    if (prevPrevTok?.normalized === 'INTO') {
      return [S.Column({ tableRefs: stmt.getTables('insert'), context: 'insert' })]
    }
    // 多半在函数的参数表里
    return suggestExpression(tokenV, stmt)
  }

  if (family === 'mysql') {
    const suggestion = mysqlKeywordBranches(tokenV, stmt, ctxText)
    if (suggestion !== null) return suggestion
  }

  if (tokenV === 'set') {
    // 语句开头的 SET 改运行参数
    const p = parse(stmt.textBeforeCursor, dialect)[0]!
    if (p.tokenFirst()?.value.toUpperCase() === tokenV.toUpperCase()) {
      return [S.Keyword(tokenV.toUpperCase())]
    }
    // 如 'UPDATE foo SET'
    return [S.Column({ tableRefs: stmt.getTables(), localTables: columnLocalTables(stmt) })]
  }
  if (['select', 'where', 'having', 'group by', 'order by', 'distinct'].includes(tokenV)) {
    return suggestExpression(tokenV, stmt)
  }
  if (tokenV === 'as') {
    // 别名不补全
    return []
  }
  const relationKeywords = ['copy', 'from', 'update', 'into', 'describe', 'truncate']
  // mycli / litecli：DESC、EXPLAIN 之后也是表；mycli：CREATE TABLE … LIKE 之后也是表
  if (family !== 'postgresql') relationKeywords.push('desc', 'explain')
  const createTableLike =
    family === 'mysql' && tokenV === 'like' && /^\s*create\s+table\s/i.test(stmt.fullText)
  if (
    (tokenV.endsWith('join') && isKeyword) ||
    relationKeywords.includes(tokenV) ||
    createTableLike
  ) {
    const schema = stmt.getIdentifierSchema()
    const tables = stmt.tablesBefore()
    const isJoin = tokenV.endsWith('join') && isKeyword
    // 没写模式时建议当前模式（或 public）里的表，另建议模式
    const suggest: Suggestion[] = []
    if (!schema) suggest.unshift(S.Schema())
    if (tokenV === 'from' || isJoin) {
      suggest.push(S.FromClauseItem(schema, tables, stmt.localTables))
    } else if (tokenV === 'truncate') {
      suggest.push(S.Table(schema))
    } else {
      suggest.push(S.Table(schema), S.View(schema))
    }
    if (isJoin && allowJoin(stmt.parsed)) {
      suggest.push(S.Join(stmt.getTables('before'), schema))
    }
    return suggest
  }
  if (tokenV === 'function') {
    const schema = stmt.getIdentifierSchema()
    // 'SELECT 1 FROM functions WHERE function:' 这类取不到前一个记号
    try {
      const prev = stmt.getPreviousToken(token as Token)?.value.toLowerCase() ?? ''
      if (['drop', 'alter', 'create', 'create or replace'].includes(prev)) {
        const suggest: Suggestion[] = []
        if (!schema) suggest.unshift(S.Schema())
        suggest.push(S.Function(schema, [], 'signature'))
        return suggest
      }
    } catch (error) {
      if (!(error instanceof TokenNotFoundError)) throw error
    }
    return []
  }
  if (tokenV === 'table' || tokenV === 'view') {
    // 如 'ALTER TABLE <表名>'
    const relType = tokenV === 'table' ? S.Table : S.View
    const schema = stmt.getIdentifierSchema()
    return schema ? [relType(schema)] : [S.Schema(), relType(schema)]
  }
  if (tokenV === 'column') {
    // 如 'ALTER TABLE foo ALTER COLUMN bar'
    return [S.Column({ tableRefs: stmt.getTables() })]
  }
  if (tokenV === 'on') {
    const tables = stmt.getTables('before')
    const parent = stmt.identifier?.getParentName() || null
    if (parent) {
      // "ON parent.<建议>"：parent 可以是模式名或表别名
      const filtered = tables.filter((t) => identifies(parent, t))
      const sugs = [
        S.Column({ tableRefs: filtered, localTables: columnLocalTables(stmt) }),
        S.Table(parent),
        S.View(parent),
        S.Function(parent)
      ]
      if (filtered.length > 0 && allowJoinCondition(stmt.parsed)) {
        sugs.push(S.JoinCondition(tables, filtered.at(-1)!))
      }
      return sugs
    }
    // ON <建议>：有别名用别名，否则用表名
    const aliases = tables.map((t) => tableRef(t, dialect))
    const sugs = allowJoinCondition(stmt.parsed)
      ? [S.Alias(aliases), S.JoinCondition(tables, null)]
      : [S.Alias(aliases)]
    // mycli / litecli：没有别名时多半在写 GRANT … ON <表>，建议表（mycli 另建议库）
    if (aliases.length === 0 && family === 'mysql') sugs.push(S.Schema(), S.Table(null))
    if (aliases.length === 0 && family === 'sqlite') sugs.push(S.Table(null))
    return sugs
  }
  if (['c', 'use', 'database', 'template'].includes(tokenV)) {
    // "use <库>"、"DROP DATABASE <库>"、"CREATE DATABASE <新库> WITH TEMPLATE <库>"
    return [S.Database()]
  }
  if (tokenV === 'schema') {
    // DROP SCHEMA 模式名、SET SCHEMA 模式名
    const prevKeyword = stmt.reduceToPrevKeyword(2)
    const quoted = prevKeyword !== null && prevKeyword.value.toLowerCase() === 'set'
    return [S.Schema(quoted)]
  }
  if (family === 'mysql' && isSingleOrDoubleQuoted(ctxText)) {
    // mycli：inside_single_or_double
    return []
  }
  if (continuesExpression(tokenV, dialect)) {
    if (family === 'mysql') return mysqlBinaryOrComma(stmt, ctxText)
    const prevKeyword = stmt.reduceToPrevKeyword()
    return prevKeyword ? suggestBasedOnLastToken(prevKeyword, stmt) : []
  }
  if (tokenV === '::' || (tokenV === 'type' && isDatatypeKeyword(token, stmt))) {
    //   ALTER TABLE foo SET DATA TYPE bar
    //   SELECT foo::bar
    // PostgreSQL 里表也是一种复合类型，一并建议
    const schema = stmt.getIdentifierSchema()
    const suggestions = [S.Datatype(schema), S.Table(schema)]
    if (!schema) suggestions.push(S.Schema())
    return suggestions
  }
  if (['alter', 'create', 'drop'].includes(tokenV)) return [S.Keyword(tokenV.toUpperCase())]
  if (tokenV === 'to') {
    // 如 'SET search_path TO'
    return [S.Schema()]
  }
  if (isKeyword) {
    // 没有专门处理的关键字：往回找认得的关键字
    const prevKeyword = stmt.reduceToPrevKeyword(1)
    return prevKeyword
      ? suggestBasedOnLastToken(prevKeyword, stmt)
      : [S.Keyword(tokenV.toUpperCase())]
  }
  return [S.Keyword()]
}

// —— mycli（MySQL / MariaDB）独有的判断：mycli/packages/completion_engine.py ——

/** mycli：MYSQL_ESCAPES（mycli/constants.py） */
const MYSQL_ESCAPES: Readonly<Record<string, string>> = {
  '0': '\0',
  b: '\b',
  n: '\n',
  r: '\r',
  t: '\t',
  Z: '\x1a'
}

const ENUM_VALUE_RE =
  /(?<lhs>(?:`[^`]+`|[\p{L}\p{N}_$]+)(?:\.(?:`[^`]+`|[\p{L}\p{N}_$]+))?)\s*=\s*$/iu
const QUOTED_ENUM_TOKENS = /--(?=\s|$)[^\n]*|#[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|`(?:``|[^`])*`|['"]/g

/** mycli：_find_doubled_backticks */
export function findDoubledBackticks(text: string): number[] {
  const positions: number[] = []
  if (!text.includes('``')) return positions
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '`') continue
    if (index + 1 < text.length && text[index + 1] === '`') positions.push(index, index + 1)
  }
  return positions
}

/** mycli：is_inside_quotes——pos 之前是否在单引号、双引号或反引号里（pos 为负时从末尾数）。 */
export function isInsideQuotes(
  text: string,
  pos: number
): false | 'single' | 'double' | 'backtick' {
  let inSingle = false
  let inDouble = false
  let inBackticks = false
  let escaped = false
  const doubled = findDoubledBackticks(text)
  if (pos < 0) pos = Math.max(text.length + pos, 0)
  pos = Math.min(text.length, pos)
  const upTo = text.slice(0, pos)
  if (!upTo.includes('`') && !upTo.includes("'") && !upTo.includes('"')) return false
  for (let index = 0; index < pos; index++) {
    const ch = text[index]
    if (doubled.includes(index)) continue
    if (escaped && (inDouble || inSingle)) {
      escaped = false
      continue
    }
    if (ch === '\\' && (inDouble || inSingle)) {
      escaped = true
      continue
    }
    if (ch === '`' && !inDouble && !inSingle) inBackticks = !inBackticks
    else if (ch === "'" && !inDouble && !inBackticks) inSingle = !inSingle
    else if (ch === '"' && !inSingle && !inBackticks) inDouble = !inDouble
  }
  if (inSingle) return 'single'
  if (inDouble) return 'double'
  if (inBackticks) return 'backtick'
  return false
}

/** mycli：_is_single_or_double_quoted */
function isSingleOrDoubleQuoted(text: string): boolean {
  const quoted = isInsideQuotes(text, -1)
  return quoted === 'single' || quoted === 'double'
}

/** mycli：_enum_value_suggestion——「列 = 」之后建议这一列的枚举值。 */
function enumValueSuggestion(
  textBeforeCursor: string,
  stmt: SqlStatement
): Extract<Suggestion, { type: 'EnumValue' }> | null {
  const match = ENUM_VALUE_RE.exec(textBeforeCursor)
  if (match === null) return null
  if (isInsideQuotes(textBeforeCursor, match.index)) return null
  const lhs = match.groups!.lhs!
  const dot = lhs.indexOf('.')
  const [parent, column] = dot >= 0 ? [lhs.slice(0, dot), lhs.slice(dot + 1)] : [null, lhs]
  return S.EnumValue(stmt.getTables(), column, parent)
}

/** mycli：_is_where_or_having */
function isWhereOrHaving(token: Token | null): boolean {
  return ['where', 'having'].includes(token?.value.toLowerCase() ?? '')
}

/** mycli：_charset_suggestion——CHARACTER SET、CONVERT(… USING、COLLATE 之后。 */
function charsetSuggestion(tokens: Token[]): Suggestion[] | null {
  const v = tokens.filter((t) => t.value).map((t) => t.value.toLowerCase())
  const at = (i: number): string | undefined => v[v.length + i]
  if (v.length >= 2 && at(-1) === 'set' && at(-2) === 'character') return [S.CharacterSet()]
  if (v.length >= 3 && at(-2) === 'set' && at(-3) === 'character') return [S.CharacterSet()]
  if (v.length >= 5 && at(-1) === 'using' && at(-4) === 'convert') return [S.CharacterSet()]
  if (v.length >= 6 && at(-2) === 'using' && at(-5) === 'convert') return [S.CharacterSet()]
  if (v.length >= 1 && at(-1) === 'collate') return [S.Collation()]
  return null
}

/** mycli：_tokens_wo_space——语句顶层去掉空白（不含换行）后的记号。 */
function tokensWithoutSpace(text: string, dialect: Dialect): Token[] {
  const parsed = parse(text, dialect)[0]
  return parsed === undefined ? [] : parsed.tokens.filter((x) => x.ttype !== T.Whitespace)
}

/**
 * mycli：quoted_enum_value、guard_number_or_dot、guard_quote_prefix、guard_inside_single_or_double 四条规则
 * （只在最外层判断，mycli 递归时 word_before_cursor 为 None）。不适用时为 null。
 */
function mysqlGuards(
  token: LastToken,
  stmt: SqlStatement,
  word: string | null
): Suggestion[] | null {
  if (!word) return null
  const text = stmt.textWithWord
  const startsWithQuote = word[0] === '"' || word[0] === "'"
  const insideQuotes = isSingleOrDoubleQuoted(text)
  const enumContext =
    token instanceof Where ||
    (token instanceof Token && ['=', 'having'].includes(token.value.toLowerCase()))
  if ((startsWithQuote || insideQuotes) && enumContext) return quotedEnumValueOrNothing(stmt)
  if (/^[\d.]/.test(word)) return []
  if (startsWithQuote) return []
  if (insideQuotes) return []
  return null
}

/** mycli：_emit_quoted_enum_value_or_nothing——在没收尾的引号里补枚举值（带上已输入的前缀）。 */
function quotedEnumValueOrNothing(stmt: SqlStatement): Suggestion[] {
  const text = stmt.textWithWord
  // 先跳过注释与反引号名字，再找没收尾的字符串
  QUOTED_ENUM_TOKENS.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = QUOTED_ENUM_TOKENS.exec(text)) !== null) {
    const quote = match[0]
    let offset = QUOTED_ENUM_TOKENS.lastIndex
    if (quote !== "'" && quote !== '"') continue
    const start = match.index
    const value: string[] = []
    let closed = false
    while (offset < text.length) {
      const char = text[offset]!
      offset += 1
      if (char === '\\' && offset < text.length) {
        const escaped = text[offset]!
        value.push(MYSQL_ESCAPES[escaped] ?? escaped)
        offset += 1
      } else if (char === quote) {
        if (text.slice(offset, offset + 1) === quote) {
          value.push(quote)
          offset += 1
        } else {
          closed = true
          break
        }
      } else {
        value.push(char)
      }
    }
    QUOTED_ENUM_TOKENS.lastIndex = offset
    if (closed) continue
    const prefix = text.slice(0, start)
    if (!enumValueSuggestion(prefix, stmt)) return []
    // 去掉引号里的值，按同样的子句与表判断
    const contextText = prefix + ' ' + stmt.fullText.slice(start)
    for (const suggestion of suggestType(contextText, prefix + ' ', stmt.dialect)) {
      if (suggestion.type === 'EnumValue') {
        return [
          {
            ...suggestion,
            valuePrefix: value.join(''),
            quote,
            replacementLength: text.length - start
          }
        ]
      }
    }
    return []
  }
  return []
}

/** mycli：_emit_where_token——WHERE 子句里先看字符集，再往回找关键字；「列 = 」之后先建议枚举值。 */
function mysqlWhereToken(where: Where, stmt: SqlStatement, ctxText: string): Suggestion[] {
  const whereTokens = where.tokens.filter((x) => x.ttype !== T.Whitespace)
  const transcoding = charsetSuggestion(whereTokens)
  if (transcoding !== null) return transcoding
  const enumSuggestion = enumValueSuggestion(ctxText, stmt)
  const prevKeyword = rewindTo(ctxText, stmt)
  const fallback = suggestBasedOnLastToken(prevKeyword, stmt)
  return enumSuggestion && isWhereOrHaving(prevKeyword) ? [enumSuggestion, ...fallback] : fallback
}

/** mycli：find_prev_keyword(ctx.text_before_cursor)，之后按回退后的文字判断（同 pgcli 的 reduce_to_prev_keyword）。 */
function rewindTo(text: string, stmt: SqlStatement): Token | null {
  const [prevKeyword, rewound] = findPrevKeyword(text, stmt.dialect)
  stmt.textBeforeCursor = rewound
  return prevKeyword
}

/** mycli：_emit_binary_or_comma——往回找关键字（回退不前进时只给关键字）；WHERE / HAVING 里「列 = 」先建议枚举值。 */
function mysqlBinaryOrComma(stmt: SqlStatement, ctxText: string): Suggestion[] {
  const enumSuggestion = enumValueSuggestion(ctxText, stmt)
  const prevKeyword = rewindTo(ctxText, stmt)
  // 回退不前进时（某些运算符的写法会让 find_prev_keyword 停在原处）只给关键字，免得无限递归
  const fallback =
    prevKeyword && stmt.textBeforeCursor.trimEnd() !== ctxText.trimEnd()
      ? suggestBasedOnLastToken(prevKeyword, stmt)
      : [S.Keyword()]
  return enumSuggestion && isWhereOrHaving(prevKeyword) ? [enumSuggestion, ...fallback] : fallback
}

/**
 * mycli 独有的关键字分支：CALL、CHARACTER SET、SHOW、TO、USER / FOR、COLLATE、CONVERT(… USING。不适用时为 null。
 */
function mysqlKeywordBranches(
  tokenV: string,
  stmt: SqlStatement,
  ctxText: string
): Suggestion[] | null {
  let tokens: Token[] | null = null
  const back = (n: number): string | undefined => {
    tokens ??= tokensWithoutSpace(ctxText, stmt.dialect)
    return tokens.at(-n)?.value.toLowerCase()
  }
  switch (tokenV) {
    case 'call':
      return [S.Procedure(null)]
    case 'set':
      if (back(3) === 'character' || back(2) === 'character') return [S.CharacterSet()]
      return null
    case 'show':
      return [S.Show()]
    case 'to':
      return parse(ctxText, stmt.dialect)[0]?.tokenFirst()?.value.toLowerCase() === 'change'
        ? [S.Change()]
        : [S.User()]
    case 'user':
    case 'for':
      return [S.User()]
    case 'collate':
      return [S.Collation()]
    case 'using':
      if (back(5) === 'convert' || back(4) === 'convert') return [S.CharacterSet()]
      return null
    default:
      return null
  }
}
