// 子查询作用域：参照 sqls（sqls-server/sqls）的 parser/parseutil/parseutil.go。pgcli 的 extract_tables 不分作用域
// （FROM 里的子查询会把里面的表带到外层，WHERE 里的子查询里的表又取不到），这里按 sqls 的做法：
// - 光标在子查询里（extractFocusedSubQuery：最内层以 SELECT 开头的括号）时，取这一层自己的表；另外保留外面各层
//   的表（相关子查询里引用外层的表，pgcli 的测试也要求外层的表可见）；
// - 不在光标路径上的子查询，里面的表对外不可见；带别名的子查询（sqls 的 SubQueryInfo）当作语句自带的表，列取自
//   它的选择列表（extractSubQueryColumns：取列名与别名，SELECT * / t.* 取自子查询里的表，里面再嵌套的子查询合并）。
// 不带别名的 FROM 子查询照 pgcli（extract_from_part 递归进去，里面的表可见）。
// 做法：各层文字里把对外不可见的子查询的内容抹成等长的空白，再交给照搬的 extract_tables。
import type { Dialect } from './dialects'
import { extractColumnNames } from './parseutils/ctes'
import { columnMetadata, type TableMetadata } from './parseutils/meta'
import { extractTables, type TableReference } from './parseutils/tables'
import { parse } from './sqlparse/parse'
import { Identifier, IdentifierList, type Token } from './sqlparse/sql'
import { T } from './sqlparse/tokens'

/** 一对括号：左括号与右括号（没收尾时为文字末尾）的位置。 */
interface Paren {
  open: number
  close: number
  /** 以 SELECT 开头（sqls 的 isSubQuery） */
  subquery: boolean
  /** 在 FROM / JOIN 的位置（作表用的子查询） */
  inFrom: boolean
  /** 作表用的子查询的别名 */
  alias: string | null
}

const significant = (t: Token): boolean =>
  !t.isWhitespace && !(t.ttype !== null && t.ttype.startsWith(T.Comment))

/** 第一条语句的括号（sqls 以 AST 判断，这里用记号流：括号配对，看左括号之后、右括号之后的记号）。 */
function parensOf(text: string, dialect: Dialect): Paren[] {
  const statement = parse(text, dialect)[0]
  if (statement === undefined) return []
  const toks = [...statement.flatten()].filter(significant)
  const parens: Paren[] = []
  const stack: { index: number; paren: Paren }[] = []
  toks.forEach((tok, index) => {
    if (tok.ttype === T.Punctuation && tok.value === '(') {
      const next = toks[index + 1]
      const paren: Paren = {
        open: tok.pos,
        close: text.length,
        subquery: next?.ttype === T.DML && next.value.toUpperCase() === 'SELECT',
        inFrom: inFromClause(toks, index),
        alias: null
      }
      parens.push(paren)
      stack.push({ index, paren })
    } else if (tok.ttype === T.Punctuation && tok.value === ')') {
      const top = stack.pop()
      if (top === undefined) return
      top.paren.close = tok.pos
      top.paren.alias = aliasAfter(toks, index)
    }
  })
  return parens
}

/** 左括号是否在 FROM / JOIN 的位置：同一层往回找到的第一个关键字是 FROM、各种 JOIN 或 LATERAL。 */
function inFromClause(toks: Token[], openIndex: number): boolean {
  let depth = 0
  for (let i = openIndex - 1; i >= 0; i--) {
    const tok = toks[i]!
    if (tok.ttype === T.Punctuation && tok.value === ')') depth++
    else if (tok.ttype === T.Punctuation && tok.value === '(') {
      if (depth === 0) return false
      depth--
    } else if (depth === 0 && tok.isKeyword && tok.normalized !== 'AS') {
      const upper = tok.normalized
      return upper === 'FROM' || upper === 'LATERAL' || upper.endsWith('JOIN')
    }
  }
  return false
}

/** 右括号之后的别名（AS 别名，或直接跟的名字）。 */
function aliasAfter(toks: Token[], closeIndex: number): string | null {
  let next = toks[closeIndex + 1]
  if (next?.isKeyword && next.normalized === 'AS') next = toks[closeIndex + 2]
  if (next === undefined || next.isKeyword) return null
  if (next.ttype === T.Name || next.ttype === T.StringSymbol) {
    return next.value.replace(/^(["`])(.*)\1$/, '$2')
  }
  return null
}

/** 把一段文字里 [from, to) 的内容抹成空白（换行保留，位置不变）。 */
function blank(text: string, from: number, to: number): string {
  return text.slice(0, from) + text.slice(from, to).replace(/[^\n]/g, ' ') + text.slice(to)
}

/** 括号是否包住光标（光标紧跟左括号也算；没收尾的括号包住其后全部）。 */
const encloses = (paren: Paren, cursor: number): boolean =>
  paren.open < cursor && cursor <= paren.close

/**
 * 一层查询的文字：只留 [from, to) 这一段，其中对外不可见的子查询抹掉——光标路径上的（单独作一层）、带别名的
 * （作语句自带的表）、表达式里的；只保留不带别名的 FROM 子查询（照 pgcli）。
 */
function levelText(text: string, parens: Paren[], from: number, to: number): string {
  let out = text.slice(0, to)
  for (const paren of parens) {
    if (!paren.subquery || paren.open < from || paren.open >= to) continue
    if (paren.inFrom && paren.alias === null) continue
    out = blank(out, paren.open + 1, Math.min(paren.close, to))
  }
  return out.slice(from)
}

/** sqls：extractSubQueryColumns——带别名的子查询的列（列名、别名；* / t.* 取自子查询里的表）。 */
function derivedTable(
  name: string,
  body: string,
  dialect: Dialect,
  localTables: TableMetadata[]
): TableMetadata {
  const inner = scopedTables(body, -1, dialect, localTables)
  const statement = parse(body, dialect)[0]
  const columns = statement === undefined ? [] : extractColumnNames(statement)
  // 选择列表里的 * 与 t.*
  const stars: (string | null)[] = []
  const [selectIdx] = statement?.tokenNextBy({ t: T.DML }) ?? [null]
  const selectList = selectIdx === null ? null : statement!.tokenNext(selectIdx, true, true)[1]
  const items =
    selectList instanceof IdentifierList ? [...selectList.getIdentifiers()] : [selectList]
  for (const item of items) {
    if (item?.ttype === T.Wildcard) stars.push(null)
    else if (item instanceof Identifier && item.isWildcard()) stars.push(item.getParentName())
  }
  const starTables = inner.tables.filter((t) =>
    stars.some((parent) => parent === null || parent === t.alias || parent === t.name)
  )
  const table: TableMetadata = {
    name,
    columns: columns.filter((c) => c !== '*').map((c) => columnMetadata(c, null, []))
  }
  // 取自语句自带的表（CTE、里面的子查询）时直接展开，其余留给补全时按表结构展开
  const expanded: TableReference[] = []
  for (const star of starTables) {
    const local = [...inner.derived, ...localTables].find(
      (t) => star.schema === null && t.name === star.name
    )
    if (local !== undefined) {
      table.columns.push(...local.columns)
      expanded.push(...(local.starTables ?? []))
    } else {
      expanded.push(star)
    }
  }
  if (expanded.length > 0) table.starTables = expanded
  return table
}

/**
 * 光标处可见的表（sqls：ExtractTable 按光标所在的子查询取表），与带别名的子查询（当作语句自带的表）。cursor 为光标
 * 在 text 里的位置；为负时不在任何子查询里（整条语句算一层）。localTables 为 CTE，展开子查询的 * 时用。
 */
export function scopedTables(
  text: string,
  cursor: number,
  dialect: Dialect,
  localTables: TableMetadata[] = []
): { tables: TableReference[]; derived: TableMetadata[] } {
  const parens = parensOf(text, dialect)
  const chain = parens.filter((p) => p.subquery && encloses(p, cursor))
  const levels: [number, number][] = [
    [0, text.length],
    ...chain.map((p): [number, number] => [p.open + 1, p.close])
  ]
  const tables: TableReference[] = []
  const derived: TableMetadata[] = []
  for (const [from, to] of levels) {
    // 光标路径上更内层的子查询单独作一层，这一层里抹掉
    const visible = parens.filter((p) => !chain.includes(p) || p.open < from || p.open >= to)
    const own = parens.filter((p) => chain.includes(p) && p.open >= from && p.open < to)
    let body = levelText(text, visible, from, to)
    for (const p of own) body = blank(body, p.open + 1 - from, Math.min(p.close, to) - from)
    tables.push(...extractTables(body, dialect))
    for (const p of visible) {
      if (!p.subquery || !p.inFrom || p.alias === null || p.open < from || p.open >= to) continue
      // 只取这一层直接的子查询（更深的属于里面的子查询）
      if (
        visible.some(
          (q) => q !== p && q.subquery && q.open < p.open && p.close <= q.close && q.open >= from
        )
      ) {
        continue
      }
      derived.push(derivedTable(p.alias, text.slice(p.open + 1, p.close), dialect, localTables))
    }
  }
  // 同一张表（模式、名字、别名都相同）在内外层都出现时只留一份（sqls 按模式与表名去重）
  const unique = [...new Map(tables.map((x) => [JSON.stringify(x), x])).values()]
  return { tables: unique, derived }
}
