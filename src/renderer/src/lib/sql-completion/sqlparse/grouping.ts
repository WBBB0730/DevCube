// 分组：移植 sqlparse/engine/grouping.py（pgcli 把 MAX_GROUPING_DEPTH / MAX_GROUPING_TOKENS 设为 None，这里同样不设上限）。
import {
  Assignment,
  Begin,
  Case,
  Comment,
  Comparison,
  For,
  Identifier,
  IdentifierList,
  If,
  imt,
  Operation,
  Over,
  Parenthesis,
  SqlFunction,
  SquareBrackets,
  Statement,
  Token,
  TokenList,
  TypedLiteral,
  Values,
  Where,
  type Pattern,
  type TokenListClass
} from './sql'
import { T, type TokenType } from './tokens'

const T_NUMERICAL: readonly TokenType[] = [T.Number, T.NumberInteger, T.NumberFloat]
const T_STRING: readonly TokenType[] = [T.String, T.StringSingle, T.StringSymbol]
const T_NAME: readonly TokenType[] = [T.Name, T.NamePlaceholder]

type MatchingClass = TokenListClass & { M_OPEN: Pattern; M_CLOSE: Pattern }
type Check = (token: Token | null) => boolean
type Post = (tlist: TokenList, pidx: number, tidx: number, nidx: number | null) => [number, number]

/** sqlparse/utils.py: recurse——先对不属于 classes 的子分组递归，再处理本层。 */
function recurse(
  f: (tlist: TokenList) => void,
  ...classes: TokenListClass[]
): (tlist: TokenList) => void {
  const wrapped = (tlist: TokenList): void => {
    for (const sgroup of tlist.getSublists()) {
      if (!classes.some((cls) => sgroup instanceof cls)) wrapped(sgroup)
    }
    f(tlist)
  }
  return wrapped
}

/** grouping.py: _group_matching */
function groupMatching(tlist: TokenList, cls: MatchingClass): void {
  const opens: number[] = []
  let tidxOffset = 0
  const tokenList = [...tlist.tokens]
  tokenList.forEach((token, idx) => {
    const tidx = idx - tidxOffset
    if (token.isWhitespace) return
    if (token instanceof TokenList && !(token instanceof cls)) {
      groupMatching(token, cls)
      return
    }
    if (token.match(cls.M_OPEN[0], cls.M_OPEN[1])) {
      opens.push(tidx)
    } else if (token.match(cls.M_CLOSE[0], cls.M_CLOSE[1])) {
      const openIdx = opens.pop()
      if (openIdx === undefined) return
      tlist.groupTokens(cls, openIdx, tidx)
      tidxOffset += tidx - openIdx
    }
  })
}

/** grouping.py: _group */
function group_(
  tlist: TokenList,
  cls: TokenListClass,
  match: (token: Token) => boolean,
  validPrev: Check,
  validNext: Check,
  post: Post,
  extend = true,
  recurseInto = true
): void {
  let tidxOffset = 0
  let pidx: number | null = null
  let prev: Token | null = null
  for (const [idx, token] of [...tlist.tokens].entries()) {
    const tidx = idx - tidxOffset
    if (tidx < 0) continue
    if (token.isWhitespace) continue
    if (recurseInto && token instanceof TokenList && !(token instanceof cls)) {
      group_(token, cls, match, validPrev, validNext, post, extend, true)
    }
    if (match(token)) {
      const [nidx, next] = tlist.tokenNext(tidx)
      if (prev !== null && validPrev(prev) && validNext(next)) {
        const [fromIdx, toIdx] = post(tlist, pidx!, tidx, nidx)
        const grp = tlist.groupTokens(cls, fromIdx, toIdx, true, extend)
        tidxOffset += toIdx - fromIdx
        pidx = fromIdx
        prev = grp
        continue
      }
    }
    pidx = tidx
    prev = token
  }
}

const notNull: Check = (token) => token !== null

/** grouping.py: group_typecasts */
function groupTypecasts(tlist: TokenList): void {
  group_(
    tlist,
    Identifier,
    (token) => token.match(T.Punctuation, '::'),
    notNull,
    notNull,
    (_t, pidx, _tidx, nidx) => [pidx, nidx!]
  )
}

/** grouping.py: group_tzcasts */
function groupTzcasts(tlist: TokenList): void {
  group_(
    tlist,
    Identifier,
    (token) => token.ttype === T.KeywordTZCast,
    notNull,
    (token) =>
      token !== null &&
      (token.isWhitespace ||
        token.match(T.Keyword, 'AS') ||
        token.match(TypedLiteral.M_CLOSE[0], TypedLiteral.M_CLOSE[1])),
    (_t, pidx, _tidx, nidx) => [pidx, nidx!]
  )
}

/** grouping.py: group_typed_literal */
function groupTypedLiteral(tlist: TokenList): void {
  const post: Post = (_t, _pidx, tidx, nidx) => [tidx, nidx!]
  group_(
    tlist,
    TypedLiteral,
    (token) => imt(token, { m: TypedLiteral.M_OPEN }),
    notNull,
    (token) => token !== null && token.match(TypedLiteral.M_CLOSE[0], TypedLiteral.M_CLOSE[1]),
    post,
    false
  )
  group_(
    tlist,
    TypedLiteral,
    (token) => token instanceof TypedLiteral,
    notNull,
    (token) => token !== null && token.match(TypedLiteral.M_EXTEND[0], TypedLiteral.M_EXTEND[1]),
    post,
    true
  )
}

/** grouping.py: group_period */
function groupPeriod(tlist: TokenList): void {
  const periods: Pattern[] = [
    [T.Punctuation, '.'],
    [T.Operator, '->'],
    [T.Operator, '->>']
  ]
  group_(
    tlist,
    Identifier,
    (token) => periods.some(([ttype, value]) => token.match(ttype, value)),
    (token) => imt(token, { i: [SquareBrackets, Identifier], t: [T.Name, T.StringSymbol] }),
    () => true,
    (t, pidx, tidx, nidx) => {
      const next = nidx !== null ? t.tokens[nidx]! : null
      const validNext = imt(next, {
        i: [SquareBrackets, SqlFunction],
        t: [T.Name, T.StringSymbol, T.Wildcard, T.StringSingle]
      })
      return validNext ? [pidx, nidx!] : [pidx, tidx]
    }
  )
}

/** grouping.py: group_as */
function groupAs(tlist: TokenList): void {
  group_(
    tlist,
    Identifier,
    (token) => token.isKeyword && token.normalized === 'AS',
    (token) => token!.normalized === 'NULL' || !token!.isKeyword,
    (token) => !imt(token, { t: [T.DML, T.DDL, T.CTE] }) && token !== null,
    (_t, pidx, _tidx, nidx) => [pidx, nidx!]
  )
}

/** grouping.py: group_assignment */
function groupAssignment(tlist: TokenList): void {
  const valid: Check = (token) => token !== null && token.ttype !== T.Keyword
  group_(
    tlist,
    Assignment,
    (token) => token.match(T.Assignment, ':='),
    valid,
    valid,
    (t, pidx, _tidx, nidx) => {
      const [snidx] = t.tokenNextBy({ m: [T.Punctuation, ';'] }, nidx!)
      return [pidx, snidx || nidx!]
    }
  )
}

/** grouping.py: group_comparison */
function groupComparison(tlist: TokenList): void {
  const sqlcls = [Parenthesis, SqlFunction, Identifier, Operation, TypedLiteral]
  const ttypes = [...T_NUMERICAL, ...T_STRING, ...T_NAME]
  const valid: Check = (token) =>
    imt(token, { t: ttypes, i: sqlcls }) ||
    (token !== null && token.isKeyword && token.normalized === 'NULL')
  group_(
    tlist,
    Comparison,
    (token) => token.ttype === T.Comparison,
    valid,
    valid,
    (_t, pidx, _tidx, nidx) => [pidx, nidx!],
    false
  )
}

/** grouping.py: group_identifier */
const groupIdentifier = recurse((tlist) => {
  const ttypes = [T.StringSymbol, T.Name]
  let [tidx, token] = tlist.tokenNextBy({ t: ttypes })
  while (token !== null) {
    tlist.groupTokens(Identifier, tidx!, tidx!)
    ;[tidx, token] = tlist.tokenNextBy({ t: ttypes }, tidx!)
  }
}, Identifier)

/** grouping.py: group_over */
const groupOver = recurse((tlist) => {
  let [tidx, token] = tlist.tokenNextBy({ m: Over.M_OPEN })
  while (token !== null) {
    const [nidx, next] = tlist.tokenNext(tidx)
    if (imt(next, { i: Parenthesis, t: T.Name })) tlist.groupTokens(Over, tidx!, nidx!)
    ;[tidx, token] = tlist.tokenNextBy({ m: Over.M_OPEN }, tidx!)
  }
}, Over)

/** grouping.py: group_arrays */
function groupArrays(tlist: TokenList): void {
  group_(
    tlist,
    Identifier,
    (token) => token instanceof SquareBrackets,
    (token) =>
      imt(token, { i: [SquareBrackets, Identifier, SqlFunction], t: [T.Name, T.StringSymbol] }),
    () => true,
    (_t, pidx, tidx) => [pidx, tidx],
    true,
    false
  )
}

/** grouping.py: group_operator */
function groupOperator(tlist: TokenList): void {
  const ttypes = [...T_NUMERICAL, ...T_STRING, ...T_NAME]
  const sqlcls = [SquareBrackets, Parenthesis, SqlFunction, Identifier, Operation, TypedLiteral]
  const valid: Check = (token) =>
    imt(token, { i: sqlcls, t: ttypes }) ||
    (token !== null &&
      token.match(T.Keyword, ['CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP']))
  group_(
    tlist,
    Operation,
    (token) => imt(token, { t: [T.Operator, T.Wildcard] }),
    valid,
    valid,
    (t, pidx, tidx, nidx) => {
      t.tokens[tidx]!.ttype = T.Operator
      return [pidx, nidx!]
    },
    false
  )
}

/** grouping.py: group_identifier_list */
function groupIdentifierList(tlist: TokenList): void {
  const sqlcls = [SqlFunction, Case, Identifier, Comparison, IdentifierList, Operation]
  const ttypes = [...T_NUMERICAL, ...T_STRING, ...T_NAME, T.Keyword, T.Comment, T.Wildcard]
  const valid: Check = (token) =>
    imt(token, { i: sqlcls, m: [T.Keyword, ['null', 'role']], t: ttypes })
  group_(
    tlist,
    IdentifierList,
    (token) => token.match(T.Punctuation, ','),
    valid,
    valid,
    (_t, pidx, _tidx, nidx) => [pidx, nidx!],
    true
  )
}

/** grouping.py: group_comments */
const groupComments = recurse((tlist) => {
  let [tidx, token] = tlist.tokenNextBy({ t: T.Comment })
  while (token !== null) {
    let [eidx, end] = tlist.tokenNotMatching(
      (tk) => imt(tk, { t: T.Comment }) || tk.isNewline,
      tidx!
    )
    if (end === null) break
    ;[eidx, end] = tlist.tokenPrev(eidx, false)
    tlist.groupTokens(Comment, tidx!, eidx!)
    ;[tidx, token] = tlist.tokenNextBy({ t: T.Comment }, tidx!)
  }
}, Comment)

/** grouping.py: group_where */
const groupWhere = recurse((tlist) => {
  let [tidx, token] = tlist.tokenNextBy({ m: Where.M_OPEN })
  while (token !== null) {
    const [closeIdx, close] = tlist.tokenNextBy({ m: Where.M_CLOSE }, tidx!)
    const end = close === null ? tlist.groupableTokens.at(-1)! : tlist.tokens[closeIdx! - 1]!
    tlist.groupTokens(Where, tidx!, tlist.tokenIndex(end))
    ;[tidx, token] = tlist.tokenNextBy({ m: Where.M_OPEN }, tidx!)
  }
}, Where)

/** grouping.py: group_aliased */
const groupAliased = recurse((tlist) => {
  const I_ALIAS = [Parenthesis, SqlFunction, Case, Identifier, Operation, Comparison]
  let [tidx, token] = tlist.tokenNextBy({ i: I_ALIAS, t: T.Number })
  while (token !== null) {
    const [nidx, next] = tlist.tokenNext(tidx)
    if (next instanceof Identifier) tlist.groupTokens(Identifier, tidx!, nidx!, true, true)
    ;[tidx, token] = tlist.tokenNextBy({ i: I_ALIAS, t: T.Number }, tidx!)
  }
})

/** grouping.py: group_functions */
const groupFunctions = recurse((tlist) => {
  let hasCreate = false
  let hasTable = false
  let hasAs = false
  for (const tmp of tlist.tokens) {
    const upper = tmp.value.toUpperCase()
    if (upper === 'CREATE') hasCreate = true
    if (upper === 'TABLE') hasTable = true
    if (upper === 'AS') hasAs = true
  }
  if (hasCreate && hasTable && !hasAs) return
  let [tidx, token] = tlist.tokenNextBy({ t: T.Name })
  while (token !== null) {
    const [nidx, next] = tlist.tokenNext(tidx)
    if (next instanceof Parenthesis) {
      const [overIdx, over] = tlist.tokenNext(nidx)
      const eidx = over instanceof Over ? overIdx! : nidx!
      tlist.groupTokens(SqlFunction, tidx!, eidx)
    }
    ;[tidx, token] = tlist.tokenNextBy({ t: T.Name }, tidx!)
  }
}, SqlFunction)

/** grouping.py: group_order */
const groupOrder = recurse((tlist) => {
  let [tidx, token] = tlist.tokenNextBy({ t: T.KeywordOrder })
  while (token !== null) {
    const [pidx, prev] = tlist.tokenPrev(tidx)
    if (imt(prev, { i: Identifier, t: T.Number })) {
      tlist.groupTokens(Identifier, pidx!, tidx!)
      tidx = pidx
    }
    ;[tidx, token] = tlist.tokenNextBy({ t: T.KeywordOrder }, tidx!)
  }
}, Identifier)

/** grouping.py: align_comments */
const alignComments = recurse((tlist) => {
  let [tidx, token] = tlist.tokenNextBy({ i: Comment })
  while (token !== null) {
    const [pidx, prev] = tlist.tokenPrev(tidx)
    if (prev instanceof TokenList) {
      tlist.groupTokens(TokenList, pidx!, tidx!, true, true)
      tidx = pidx
    }
    ;[tidx, token] = tlist.tokenNextBy({ i: Comment }, tidx!)
  }
})

/** grouping.py: group_values */
function groupValues(tlist: TokenList): void {
  let [tidx, token] = tlist.tokenNextBy({ m: [T.Keyword, 'VALUES'] })
  const startIdx = tidx
  let endIdx = -1
  while (token !== null) {
    if (token instanceof Parenthesis) endIdx = tidx!
    ;[tidx, token] = tlist.tokenNext(tidx)
  }
  if (endIdx !== -1) tlist.groupTokens(Values, startIdx!, endIdx, true, true)
}

/** grouping.py: group */
export function group(stmt: Statement): Statement {
  for (const func of [
    groupComments,
    (t: TokenList) => groupMatching(t, SquareBrackets),
    (t: TokenList) => groupMatching(t, Parenthesis),
    (t: TokenList) => groupMatching(t, Case),
    (t: TokenList) => groupMatching(t, If),
    (t: TokenList) => groupMatching(t, For),
    (t: TokenList) => groupMatching(t, Begin),
    groupOver,
    groupFunctions,
    groupWhere,
    groupPeriod,
    groupArrays,
    groupIdentifier,
    groupOrder,
    groupTypecasts,
    groupTzcasts,
    groupTypedLiteral,
    groupOperator,
    groupComparison,
    groupAs,
    groupAliased,
    groupAssignment,
    alignComments,
    groupIdentifierList,
    groupValues
  ]) {
    func(stmt)
  }
  return stmt
}
