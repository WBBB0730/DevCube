// 关键字按子句过滤：移植 Tabularis（debba/tabularis）src/utils/sqlContext.ts 的 KEYWORD_ALLOWED_CLAUSES 与
// getKeywordRelevance 的「隐藏」部分，以及判断光标所在子句的 analyzeSqlContext（只取子句，不取表引用）。
// 与原版的差别：原版逐字符扫描，这里按切词适配层给出的记号扫描（字符串、注释、带引号的名字已由 lang-sql 切好），
// sqlparse 合并的多词关键字（ORDER BY、LEFT JOIN…）拆回各个词依次处理。
import type { Dialect } from './dialects'
import { T } from './sqlparse/tokens'
import { tokenize } from './token-adapter'

/** sqlContext.ts: SQL_CLAUSES */
export type SqlClause =
  | 'start'
  | 'select'
  | 'from'
  | 'join'
  | 'on'
  | 'using'
  | 'where'
  | 'group-by'
  | 'having'
  | 'order-by'
  | 'limit'
  | 'update'
  | 'set'
  | 'delete'
  | 'insert-into'
  | 'insert-columns'
  | 'values'
  | 'case'
  | 'function-args'
  | 'in-list'
  | 'window'
  | 'returning'
  | 'union'
  | 'create'
  | 'drop'
  | 'alter'
  | 'truncate'
  | 'with'

/**
 * sqlContext.ts: KEYWORD_ALLOWED_CLAUSES——只在这些子句里有意义的关键字，其余子句里不给（免得在 FROM 之后输入 wh
 * 时 WHEN 排到 WHERE 前面）。
 */
const KEYWORD_ALLOWED_CLAUSES: Readonly<Record<string, readonly SqlClause[]>> = {
  WHEN: ['case'],
  THEN: ['case'],
  ELSE: ['case'],
  END: ['case'],
  ON: ['join', 'values'], // values：MySQL 的 `… VALUES (...) ON DUPLICATE KEY UPDATE`
  VALUES: ['insert-into', 'insert-columns', 'values', 'start'],
  SET: ['update', 'start'], // start：MySQL 的 `SET @var = ...`
  INTO: ['insert-into', 'select', 'start'] // select：`SELECT ... INTO`
}

/** sqlContext.ts: getKeywordRelevance 的「hidden」判断——关键字在这个子句里是否可用。 */
export function keywordAllowed(clause: SqlClause, keyword: string): boolean {
  const allowed = KEYWORD_ALLOWED_CLAUSES[keyword.toUpperCase()]
  return allowed === undefined || allowed.includes(clause)
}

/** sqlContext.ts: KEYWORDS——不会是表名、函数名的词（用于区分 count( 与 WHERE (）。 */
const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
  'CROSS', 'NATURAL', 'FULL', 'LATERAL', 'ON', 'USING', 'AND', 'OR', 'NOT',
  'IN', 'IS', 'NULL', 'BETWEEN', 'LIKE', 'ILIKE', 'EXISTS', 'AS', 'DISTINCT',
  'ALL', 'ANY', 'SOME', 'GROUP', 'ORDER', 'PARTITION', 'BY', 'HAVING',
  'LIMIT', 'OFFSET', 'FETCH', 'UPDATE', 'SET', 'DELETE', 'INSERT', 'INTO',
  'VALUES', 'VALUE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'UNION',
  'INTERSECT', 'EXCEPT', 'MINUS', 'CREATE', 'DROP', 'ALTER', 'TRUNCATE',
  'TABLE', 'VIEW', 'INDEX', 'IF', 'RETURNING', 'WITH', 'OVER', 'WINDOW',
  'ASC', 'DESC', 'RECURSIVE', 'REPLACE', 'STRAIGHT_JOIN'
]) // prettier-ignore

interface Frame {
  clause: SqlClause
  /** 进入 CASE 前的子句（CASE 可嵌套，END 时恢复） */
  caseSaved: SqlClause[]
}

interface WordToken {
  upper: string
  isKeyword: boolean
}

/** sqlContext.ts: applyWord——一个关键字作用于最内层（只取子句的部分）。 */
function applyWord(frame: Frame, upper: string, prev: WordToken | null): void {
  switch (upper) {
    case 'SELECT':
      frame.clause = 'select'
      break
    case 'FROM':
      frame.clause = 'from'
      break
    case 'JOIN':
    case 'STRAIGHT_JOIN':
      frame.clause = 'join'
      break
    case 'ON':
      frame.clause = 'on'
      break
    case 'USING':
      frame.clause = 'using'
      break
    case 'WHERE':
      frame.clause = 'where'
      break
    case 'BY':
      if (prev?.upper === 'GROUP') frame.clause = 'group-by'
      else if (prev?.upper === 'ORDER') frame.clause = 'order-by'
      else if (prev?.upper === 'PARTITION') frame.clause = 'window'
      break
    case 'HAVING':
      frame.clause = 'having'
      break
    case 'LIMIT':
    case 'OFFSET':
    case 'FETCH':
      frame.clause = 'limit'
      break
    case 'UPDATE':
      // FOR UPDATE（加锁）与 ON DUPLICATE KEY UPDATE 不是 UPDATE 语句
      if (prev?.upper === 'FOR' || prev?.upper === 'KEY') break
      frame.clause = 'update'
      break
    case 'SET':
      frame.clause = 'set'
      break
    case 'DELETE':
      frame.clause = 'delete'
      break
    case 'INSERT':
    case 'REPLACE':
    case 'INTO':
      frame.clause = 'insert-into'
      break
    case 'VALUES':
    case 'VALUE':
      frame.clause = 'values'
      break
    case 'CASE':
      frame.caseSaved.push(frame.clause)
      frame.clause = 'case'
      break
    case 'END':
      frame.clause = frame.caseSaved.pop() ?? frame.clause
      break
    case 'UNION':
    case 'INTERSECT':
    case 'EXCEPT':
    case 'MINUS':
      frame.clause = 'union'
      break
    case 'CREATE':
      frame.clause = 'create'
      break
    case 'DROP':
      frame.clause = 'drop'
      break
    case 'ALTER':
      frame.clause = 'alter'
      break
    case 'TRUNCATE':
      frame.clause = 'truncate'
      break
    case 'RETURNING':
      frame.clause = 'returning'
      break
    case 'WITH':
      frame.clause = 'with'
      break
  }
}

/** sqlContext.ts: openFrameClause——按左括号之前的记号定新一层的子句。 */
function openFrameClause(outer: Frame, prev: WordToken | null): SqlClause {
  if (prev) {
    // `IN (` 为取值或子查询的列表
    if (prev.isKeyword && prev.upper === 'IN') return 'in-list'
    // `AS (` 为 CTE（或子查询）的体：新的语句
    if (prev.isKeyword && prev.upper === 'AS') return 'start'
    if (!prev.isKeyword) {
      // `INSERT INTO users (` 为目标列的列表
      if (outer.clause === 'insert-into') return 'insert-columns'
      // 其余紧跟名字的左括号当作函数调用
      return 'function-args'
    }
  }
  // 括起的表达式或子查询：沿用外层，直到里面的关键字（如 SELECT）另行指定
  return outer.clause
}

const WORD = /^[A-Za-z0-9_$]+$/

/**
 * sqlContext.ts: analyzeSqlContext 的子句部分——光标之前的文字所处的子句。分号之后重新开始，前面的语句不影响。
 */
export function sqlClauseAt(textBeforeCursor: string, dialect: Dialect): SqlClause {
  let stack: Frame[] = [{ clause: 'start', caseSaved: [] }]
  let prev: WordToken | null = null
  const top = (): Frame => stack[stack.length - 1]!
  for (const token of tokenize(textBeforeCursor, dialect)) {
    const { ttype, value } = token
    if (ttype.startsWith(T.Whitespace) || ttype.startsWith(T.Comment)) continue
    if (ttype === T.StringSymbol || (ttype === T.Name && /^[`[]/.test(value))) {
      // 带引号的名字：算名字，不算关键字
      prev = { upper: value.toUpperCase(), isKeyword: false }
      continue
    }
    if (ttype.startsWith(T.Literal) || ttype === T.Error) {
      prev = null
      continue
    }
    const words = value.split(/\s+/)
    if (words.every((w) => WORD.test(w))) {
      for (const word of words) {
        const upper = word.toUpperCase()
        const isKeyword = KEYWORDS.has(upper)
        if (isKeyword) applyWord(top(), upper, prev)
        prev = { upper, isKeyword }
      }
      continue
    }
    if (value === '(') {
      stack.push({ clause: openFrameClause(top(), prev), caseSaved: [] })
      prev = null
    } else if (value === ')') {
      if (stack.length > 1) stack.pop()
      prev = null
    } else if (value === ';') {
      stack = [{ clause: 'start', caseSaved: [] }]
      prev = null
    } else if (value !== '.') {
      // 运算符、逗号等结束名字的上下文
      prev = null
    }
  }
  return top().clause
}
