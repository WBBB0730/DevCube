// 移植 pgcli/packages/parseutils/ctes.py：把 WITH 里的 CTE 转成表的元数据，并定位光标所在的那部分查询。
import type { Dialect } from '../dialects'
import { parse } from '../sqlparse/parse'
import {
  Identifier,
  IdentifierList,
  Parenthesis,
  type Token,
  type TokenList
} from '../sqlparse/sql'
import { T } from '../sqlparse/tokens'
import { columnMetadata, type TableMetadata } from './meta'

/**
 * ctes.py: TableExpression——语句里的一个 CTE：name 为别名，columns 为列名，start / stop 为包住 CTE 体的左右括号
 * 在原文里的位置。
 */
export interface TableExpression {
  name: string
  columns: string[]
  start: number
  stop: number
}

/** ctes.py: isolate_query_ctes——把 CTE 化为表的元数据，只留下光标所在的那部分查询。 */
export function isolateQueryCtes(
  fullText: string,
  textBeforeCursor: string,
  dialect: Dialect
): [string, string, TableMetadata[]] {
  if (!fullText || !fullText.trim()) return [fullText, textBeforeCursor, []]
  const [ctes] = extractCtes(fullText, dialect)
  if (ctes.length === 0) return [fullText, textBeforeCursor, []]
  const currentPosition = textBeforeCursor.length
  const meta: TableMetadata[] = []
  for (const cte of ctes) {
    if (cte.start < currentPosition && currentPosition < cte.stop) {
      // 正在编辑某个 CTE：以它的体为整段文字
      return [fullText.slice(cte.start, cte.stop), fullText.slice(cte.start, currentPosition), meta]
    }
    meta.push({
      name: cte.name,
      columns: cte.columns.map((name) => columnMetadata(name, null, []))
    })
  }
  // 光标在最后一个 CTE 之后（查询主体）
  const last = ctes.at(-1)!
  return [fullText.slice(last.stop), textBeforeCursor.slice(last.stop, currentPosition), meta]
}

/**
 * ctes.py: extract_ctes——取出语句开头 WITH 里的各个 CTE。返回 [ctes, 去掉 CTE 之后的文字]。
 */
export function extractCtes(sql: string, dialect: Dialect): [TableExpression[], string] {
  const p = parse(sql, dialect)[0]
  if (p === undefined) return [[], sql]
  // 第一个有意义的记号须是 WITH
  let [idx, tok] = p.tokenNext(-1, true, true)
  if (!(tok && tok.ttype === T.CTE)) return [[], sql]
  ;[idx, tok] = p.tokenNext(idx)
  if (!tok) return [[], '']
  const startPos = tokenStartPos(p.tokens, idx!)
  const ctes: TableExpression[] = []
  if (tok instanceof IdentifierList) {
    // 多个 CTE
    for (const t of tok.getIdentifiers()) {
      const cteStartOffset = tokenStartPos(tok.tokens, tok.tokenIndex(t))
      const cte = getCteFromToken(t, startPos + cteStartOffset)
      if (cte) ctes.push(cte)
    }
  } else if (tok instanceof Identifier) {
    // 一个 CTE
    const cte = getCteFromToken(tok, startPos)
    if (cte) ctes.push(cte)
  }
  idx = p.tokenIndex(tok) + 1
  // 其后的内容拼成剩下的查询
  const remainder = p.tokens
    .slice(idx)
    .map((t) => t.toString())
    .join('')
  return [ctes, remainder]
}

/** ctes.py: get_cte_from_token */
function getCteFromToken(tok: Token, pos0: number): TableExpression | null {
  if (!(tok instanceof Identifier || tok instanceof IdentifierList)) return null
  const cteName = tok.getRealName()
  if (!cteName) return null
  // 包住 CTE 体的左括号的位置
  const [idx, parens] = tok.tokenNextBy({ i: Parenthesis })
  if (!parens) return null
  const startPos = pos0 + tokenStartPos(tok.tokens, idx!)
  const cteLen = parens.toString().length // 含括号
  const stopPos = startPos + cteLen
  const columnNames = extractColumnNames(parens as TokenList)
  return { name: cteName, columns: columnNames, start: startPos, stop: stopPos }
}

/** ctes.py: extract_column_names——SELECT 的列名，或 INSERT / UPDATE / DELETE 里 RETURNING 的列名。 */
export function extractColumnNames(parsed: TokenList): string[] {
  let [idx, tok] = parsed.tokenNextBy({ t: T.DML })
  const tokVal = tok?.value.toLowerCase()
  if (tokVal === 'insert' || tokVal === 'update' || tokVal === 'delete') {
    // 跳到列出列名的 RETURNING
    ;[idx, tok] = parsed.tokenNextBy({ m: [T.Keyword, 'returning'] }, idx!)
  } else if (tokVal !== 'select') {
    // 不是有效的 CTE
    return []
  }
  // 下一个记号是一个列名，或一串列名
  ;[idx, tok] = parsed.tokenNext(idx, true, true)
  return identifiers(tok).map((t) => t.getName() ?? '')
}

/** ctes.py: token_start_pos */
export function tokenStartPos(tokens: Token[], idx: number): number {
  return tokens.slice(0, idx).reduce((sum, t) => sum + t.toString().length, 0)
}

/** ctes.py: _identifiers（IdentifierList.get_identifiers 可能给出不是名字的项，要筛掉） */
function identifiers(tok: Token | null): Identifier[] {
  if (tok instanceof IdentifierList) {
    return [...tok.getIdentifiers()].filter((t): t is Identifier => t instanceof Identifier)
  }
  if (tok instanceof Identifier) return [tok]
  return []
}
