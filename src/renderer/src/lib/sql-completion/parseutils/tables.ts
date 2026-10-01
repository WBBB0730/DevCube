// 移植 pgcli/packages/parseutils/tables.py：取出语句里的表、别名与作表用的函数。名字的大小写与引号规则是
// PostgreSQL 的（不加引号的名字折成小写）；MySQL / MariaDB / SQLite 照 mycli / litecli 的 extract_table_identifiers
// 原样取名字，引用名（ref）为别名或表名。
import type { Dialect } from '../dialects'
import { parse } from '../sqlparse/parse'
import {
  Identifier,
  IdentifierList,
  SqlFunction,
  type Token,
  type TokenList
} from '../sqlparse/sql'
import { T } from '../sqlparse/tokens'

/** tables.py: TableReference */
export interface TableReference {
  schema: string | null
  name: string
  alias: string | null
  isFunction: boolean
}

export function tableReference(
  schema: string | null,
  name: string,
  alias: string | null = null,
  isFunction = false
): TableReference {
  return { schema, name, alias, isFunction }
}

/** Python 的 str.islower：至少有一个区分大小写的字符，且没有大写。 */
export function isLower(s: string): boolean {
  return s.toLowerCase() !== s.toUpperCase() && s === s.toLowerCase()
}

/**
 * tables.py: TableReference.ref——语句里指称这张表用的名字：别名，否则表名（PostgreSQL 里含大写的表名要加双引号；
 * mycli / litecli 的 `alias or table`）。
 */
export function tableRef(t: TableReference, dialect: Dialect): string {
  if (t.alias) return t.alias
  if (dialect.family !== 'postgresql') return t.name
  return isLower(t.name) || t.name[0] === '"' ? t.name : `"${t.name}"`
}

/** tables.py: is_subselect（源自 sqlparse 的示例脚本） */
export function isSubselect(parsed: Token): parsed is TokenList {
  if (!parsed.isGroup) return false
  return (parsed as TokenList).tokens.some(
    (item) =>
      item.ttype === T.DML &&
      ['SELECT', 'INSERT', 'UPDATE', 'CREATE', 'DELETE'].includes(item.value.toUpperCase())
  )
}

/** tables.py: _identifier_is_function */
function identifierIsFunction(identifier: TokenList): boolean {
  return identifier.tokens.some((t) => t instanceof SqlFunction)
}

/** tables.py: extract_from_part */
export function* extractFromPart(parsed: TokenList, stopAtPunctuation = true): Generator<Token> {
  let tblPrefixSeen = false
  for (const item of parsed.tokens) {
    if (tblPrefixSeen) {
      if (isSubselect(item)) {
        yield* extractFromPart(item, stopAtPunctuation)
      } else if (stopAtPunctuation && item.ttype === T.Punctuation) {
        return
      } else if (
        // 没写完的子查询（如 'SELECT * FROM (SELECT id FROM user'）认不出是子查询，里面的 FROM 不能当作终止；
        // 'SELECT * FROM abc JOIN def' 里的 JOIN 及各种 JOIN 也不能
        item.ttype === T.Keyword &&
        item.value.toUpperCase() !== 'FROM' &&
        !item.value.toUpperCase().endsWith('JOIN')
      ) {
        tblPrefixSeen = false
      } else {
        yield item
      }
    } else if (item.ttype === T.Keyword || item.ttype === T.DML) {
      const itemVal = item.value.toUpperCase()
      if (
        ['COPY', 'FROM', 'INTO', 'UPDATE', 'TABLE'].includes(itemVal) ||
        itemVal.endsWith('JOIN')
      ) {
        tblPrefixSeen = true
      }
    } else if (item instanceof IdentifierList) {
      // 'SELECT a, FROM abc' 会把 FROM 认作列列表的一部分
      for (const identifier of item.getIdentifiers()) {
        if (identifier.ttype === T.Keyword && identifier.value.toUpperCase() === 'FROM') {
          tblPrefixSeen = true
          break
        }
      }
    }
  }
}

/** tables.py: extract_table_identifiers 的内部函数 parse_identifier（PostgreSQL 的大小写与引号规则）。 */
function parseIdentifier(item: TokenList): [string | null, string | null, string | null] {
  let name = item.getRealName()
  let schemaName = item.getParentName()
  let alias = item.getAlias()
  if (!name) {
    schemaName = null
    name = item.getName()
    alias = alias || name
  }
  const schemaQuoted = Boolean(schemaName) && item.value[0] === '"'
  if (schemaName && !schemaQuoted) schemaName = schemaName.toLowerCase()
  const quoteCount = item.value.split('"').length - 1
  const nameQuoted = quoteCount > 2 || (quoteCount > 0 && !schemaQuoted)
  const aliasQuoted = Boolean(alias) && item.value[item.value.length - 1] === '"'
  if (aliasQuoted || (nameQuoted && !alias && name !== null && isLower(name))) {
    alias = `"${alias || name}"`
  }
  if (name && !nameQuoted && !isLower(name)) {
    if (!alias) alias = name
    name = name.toLowerCase()
  }
  return [schemaName, name, alias]
}

/**
 * tables.py: extract_table_identifiers；MySQL / MariaDB / SQLite 分支照 mycli / litecli 的同名函数
 * （mycli/packages/sql_utils.py、litecli/packages/parseutils.py）。
 */
export function* extractTableIdentifiers(
  tokenStream: Iterable<Token>,
  dialect: Dialect,
  allowFunctions = true
): Generator<TableReference> {
  const pg = dialect.family === 'postgresql'
  for (const item of tokenStream) {
    if (item instanceof IdentifierList) {
      for (const identifier of item.getIdentifiers()) {
        // 有时关键字（如 FROM）会被归为列表里的一项，它没有 get_real_name（Python 里捕获 AttributeError）
        if (!(identifier instanceof Identifier || identifier instanceof SqlFunction)) continue
        const schemaName = identifier.getParentName()
        const realName = identifier.getRealName()
        const isFunction = pg && allowFunctions && identifierIsFunction(identifier)
        if (realName) yield tableReference(schemaName, realName, identifier.getAlias(), isFunction)
      }
    } else if (item instanceof Identifier) {
      if (pg) {
        const [schemaName, realName, alias] = parseIdentifier(item)
        const isFunction = allowFunctions && identifierIsFunction(item)
        yield tableReference(schemaName, realName ?? '', alias, isFunction)
      } else {
        const realName = item.getRealName()
        if (realName) {
          yield tableReference(item.getParentName(), realName, item.getAlias())
        } else {
          const name = item.getName() ?? ''
          yield tableReference(null, name, item.getAlias() || name)
        }
      }
    } else if (item instanceof SqlFunction) {
      if (pg) {
        const [, realName, alias] = parseIdentifier(item)
        yield tableReference(null, realName ?? '', alias, allowFunctions)
      } else {
        const name = item.getName() ?? ''
        yield tableReference(null, name, name)
      }
    }
  }
}

/** tables.py: extract_tables——语句里的表（源自 sqlparse 的示例）。 */
export function extractTables(sql: string, dialect: Dialect): TableReference[] {
  const parsed = parse(sql, dialect)
  const first = parsed[0]
  if (first === undefined) return []
  // INSERT 语句遇到第一个标点就停：INSERT INTO abc (col1, col2) VALUES (1, 2) 里表名只有 abc
  const insertStmt = first.tokenFirst()?.value.toLowerCase() === 'insert'
  const stream = extractFromPart(first, insertStmt)
  // sqlparse 会把 "insert into foo (bar, baz)" 误认成函数调用，INSERT 语句里的名字都不算函数
  const identifiers = extractTableIdentifiers(stream, dialect, !insertStmt)
  // 'sche.<光标>' 会得到一个空的表引用，去掉
  return [...identifiers].filter((i) => i.name)
}
