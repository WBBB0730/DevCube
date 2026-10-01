// 移植 pgcli/packages/parseutils/utils.py（与 mycli / litecli 的同名函数相同）。sqlparse.parse 换成按方言的
// parse（见 sqlparse/parse.ts），所以各函数多一个 dialect 参数。另有补全引擎各处拼正则共用的 escapeRegex。
import type { Dialect } from '../dialects'
import { parse } from '../sqlparse/parse'
import { Identifier, type Token } from '../sqlparse/sql'
import { T } from '../sqlparse/tokens'

const cleanupRegex = {
  // 只含字母数字与下划线
  alphanum_underscore: /([\p{L}\p{N}_]+)$/u,
  // 除空白、括号、冒号、逗号以外
  many_punctuations: /([^():,\s]+)$/u,
  // 除空白、括号、冒号、逗号、句点以外
  most_punctuations: /([^.():,\s]+)$/u,
  // 除空白以外
  all_punctuations: /([^\s]+)$/u
} as const

export type LastWordInclude = keyof typeof cleanupRegex

/** utils.py: last_word——句末的最后一个词（以空白结尾时为空）。 */
export function lastWord(text: string, include: LastWordInclude = 'alphanum_underscore'): string {
  if (!text) return ''
  if (/\s/u.test(text[text.length - 1]!)) return ''
  return cleanupRegex[include].exec(text)?.[0] ?? ''
}

const isSignificant = (t: Token): boolean =>
  !t.isWhitespace && !(t.ttype !== null && t.ttype.startsWith(T.Comment))

/**
 * 已收尾的子查询括号：右括号的位置 → 与之配对的左括号的位置。子查询按 sqls 的 isSubQuery 判断：左括号之后第一个
 * 有意义的记号是 SELECT。
 */
function closedSubqueries(flattened: Token[]): Map<number, number> {
  const closed = new Map<number, number>()
  const stack: number[] = []
  flattened.forEach((t, idx) => {
    if (t.match(T.Punctuation, '(')) {
      stack.push(idx)
    } else if (t.match(T.Punctuation, ')')) {
      const open = stack.pop()
      if (open === undefined) return
      let first = open + 1
      while (first < idx && !isSignificant(flattened[first]!)) first++
      const tok = flattened[first]!
      if (first < idx && tok.ttype === T.DML && tok.value.toUpperCase() === 'SELECT') {
        closed.set(idx, open)
      }
    }
  })
  return closed
}

/**
 * utils.py: find_prev_keyword——语句里最后一个关键字（AND / OR / NOT / BETWEEN 除外）或左括号，以及去掉它之后
 * 所有内容的文字。与 pgcli 的差别（子查询作用域，参照 sqls 只看光标所在的那一层）：已收尾的子查询括号整个跳过，
 * 其中的关键字与左括号不算——pgcli 在 `WHERE x IN (SELECT y FROM b) AND ` 里会回退到子查询里的 FROM。其余括号
 * （列名表、参数表、VALUES 的元组等）照 pgcli，左括号照样可以返回。
 */
export function findPrevKeyword(sql: string, dialect: Dialect, nSkip = 0): [Token | null, string] {
  if (!sql.trim()) return [null, '']
  const parsed = parse(sql, dialect)[0]
  if (parsed === undefined) return [null, '']
  let flattened = [...parsed.flatten()]
  flattened = flattened.slice(0, Math.max(0, flattened.length - nSkip))
  const logicalOperators = ['AND', 'OR', 'NOT', 'BETWEEN']
  const subqueries = closedSubqueries(flattened)
  for (let idx = flattened.length - 1; idx >= 0; idx--) {
    const open = subqueries.get(idx)
    if (open !== undefined) {
      idx = open
      continue
    }
    const t = flattened[idx]!
    if (t.value === '(' || (t.isKeyword && !logicalOperators.includes(t.value.toUpperCase()))) {
      const text = flattened
        .slice(0, idx + 1)
        .map((tok) => tok.value)
        .join('')
      return [t, text]
    }
  }
  return [null, '']
}

/**
 * utils.py: parse_partial_identifier——把（打了一半的）词当作名字解析，可带模式前缀（schema.partial、schema.），
 * 也可有没收尾的双引号（"schema、schema."partial）。
 */
export function parsePartialIdentifier(word: string, dialect: Dialect): Identifier | null {
  const p = parse(word, dialect)[0]
  if (p === undefined) return null
  if (p.tokens.length === 1 && p.tokens[0] instanceof Identifier) return p.tokens[0]
  if (p.tokenNextBy({ m: [T.Error, '"'] })[1] !== null) {
    return parsePartialIdentifier(word + '"', dialect)
  }
  return null
}

/** Python 的 re.escape（pgcli 拼正则时用）：正则里有特殊含义的字符前加反斜杠，按字面匹配。 */
export const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
