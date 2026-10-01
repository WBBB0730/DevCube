// 语法元素：移植 sqlparse/sql.py（只移植补全用到的类与方法）。与原版的差别：记号多记一个 pos（在所解析文字里的起点），
// 供子查询作用域按位置判断；分组的 pos 取第一个子记号的。
import { T, ttypeIn, type TokenType } from './tokens'

/** match 的取值：一个值、多个值，或 null（只比类型）。 */
export type MatchValues = string | readonly string[] | null
/** (类型, 取值)：sqlparse 里 `m=(T.Keyword, 'AS')` 的形状。 */
export type Pattern = readonly [TokenType, MatchValues]
export type TokenListClass = new (tokens: Token[]) => TokenList

/** 在列表里找不到记号（Python 的 ValueError）。 */
export class TokenNotFoundError extends Error {}

/** sqlparse/utils.py: remove_quotes */
export function removeQuotes(val: string | null): string | null {
  if (val === null) return null
  if (val !== '' && ['"', "'", '`'].includes(val[0]!) && val[0] === val[val.length - 1]) {
    return val.slice(1, -1)
  }
  return val
}

export interface ImtArgs {
  /** 分组类（instanceof 其一即可） */
  i?: TokenListClass | readonly TokenListClass[]
  /** 一个或多个 (类型, 取值)，match 其一即可 */
  m?: Pattern | readonly Pattern[]
  /**
   * 一个类型时按层级判断（Python 的 `ttype in T.X`）；数组时按原样比较、不含子类型（Python 里传元组时
   * `ttype in (A, B)` 是元组成员判断）。
   */
  t?: TokenType | readonly TokenType[]
}

function isPatternList(m: Pattern | readonly Pattern[]): m is readonly Pattern[] {
  return Array.isArray(m[0])
}

/** sqlparse/utils.py: imt */
export function imt(token: Token | null | undefined, { i, m, t }: ImtArgs): boolean {
  if (token === null || token === undefined) return false
  if (i !== undefined) {
    const classes = Array.isArray(i) ? i : [i as TokenListClass]
    if (classes.some((cls) => token instanceof cls)) return true
  }
  if (m !== undefined) {
    if (isPatternList(m)) {
      if (m.some((pattern) => token.match(pattern[0], pattern[1]))) return true
    } else if (token.match(m[0], m[1])) {
      return true
    }
  }
  if (t !== undefined) {
    if (typeof t === 'string') {
      if (ttypeIn(token.ttype, t)) return true
    } else if (token.ttype !== null && t.includes(token.ttype)) {
      return true
    }
  }
  return false
}

/** sqlparse/sql.py: Token */
export class Token {
  value: string
  ttype: TokenType | null
  parent: TokenList | null = null
  isGroup = false
  isKeyword: boolean
  isWhitespace: boolean
  isNewline: boolean
  normalized: string
  private readonly start: number

  constructor(ttype: TokenType | null, value: string, pos = 0) {
    this.value = value
    this.ttype = ttype
    this.isKeyword = ttypeIn(ttype, T.Keyword)
    this.isWhitespace = ttypeIn(ttype, T.Whitespace)
    this.isNewline = ttypeIn(ttype, T.Newline)
    this.normalized = this.isKeyword ? value.toUpperCase() : value
    this.start = pos
  }

  get pos(): number {
    return this.start
  }

  toString(): string {
    return this.value
  }

  /** sqlparse/sql.py: Token.flatten */
  *flatten(): Generator<Token> {
    yield this
  }

  /** sqlparse/sql.py: Token.match（未移植 regex 参数） */
  match(ttype: TokenType, values: MatchValues): boolean {
    const typeMatched = this.ttype === ttype
    if (!typeMatched || values === null) return typeMatched
    const list = typeof values === 'string' ? [values] : values
    const wanted = this.isKeyword ? list.map((v) => v.toUpperCase()) : list
    return wanted.includes(this.normalized)
  }
}

type Matcher = (token: Token) => boolean

/** sqlparse/sql.py: TokenList */
export class TokenList extends Token {
  tokens: Token[]

  constructor(tokens: Token[] = []) {
    super(null, tokens.map((token) => token.value).join(''))
    this.tokens = tokens
    for (const token of tokens) token.parent = this
    this.isGroup = true
  }

  override get pos(): number {
    return this.tokens[0]?.pos ?? 0
  }

  override toString(): string {
    return [...this.flatten()].map((token) => token.value).join('')
  }

  /** sqlparse/sql.py: TokenList.flatten */
  override *flatten(): Generator<Token> {
    for (const token of this.tokens) {
      if (token.isGroup) yield* token.flatten()
      else yield token
    }
  }

  /** sqlparse/sql.py: TokenList.get_sublists */
  *getSublists(): Generator<TokenList> {
    for (const token of this.tokens) {
      if (token instanceof TokenList) yield token
    }
  }

  /** sqlparse/sql.py: TokenList._groupable_tokens */
  get groupableTokens(): Token[] {
    return this.tokens
  }

  /** sqlparse/sql.py: TokenList._token_matching */
  protected tokenMatching(
    funcs: Matcher | readonly Matcher[],
    start: number,
    end: number | null = null,
    reverse = false
  ): [number | null, Token | null] {
    const list = typeof funcs === 'function' ? [funcs] : funcs
    const indexes: number[] = []
    if (reverse) {
      for (let idx = start - 2; idx > -1; idx--) indexes.push(idx)
    } else {
      const stop = end ?? this.tokens.length
      for (let idx = start; idx < stop; idx++) indexes.push(idx)
    }
    for (const idx of indexes) {
      const token = this.tokens[idx]
      if (token === undefined) continue
      for (const func of list) {
        if (func(token)) return [idx, token]
      }
    }
    return [null, null]
  }

  /** sqlparse/sql.py: TokenList.token_first */
  tokenFirst(skipWs = true, skipCm = false): Token | null {
    return this.tokenMatching(
      (tk) => !((skipWs && tk.isWhitespace) || (skipCm && imt(tk, { t: T.Comment, i: Comment }))),
      0
    )[1]
  }

  /** sqlparse/sql.py: TokenList.token_next_by */
  tokenNextBy(args: ImtArgs, idx = -1, end: number | null = null): [number | null, Token | null] {
    return this.tokenMatching((tk) => imt(tk, args), idx + 1, end)
  }

  /** sqlparse/sql.py: TokenList.token_not_matching */
  tokenNotMatching(
    funcs: Matcher | readonly Matcher[],
    idx: number
  ): [number | null, Token | null] {
    const list = typeof funcs === 'function' ? [funcs] : funcs
    return this.tokenMatching(
      list.map((func) => (tk: Token) => !func(tk)),
      idx
    )
  }

  /** sqlparse/sql.py: TokenList.token_prev */
  tokenPrev(idx: number | null, skipWs = true, skipCm = false): [number | null, Token | null] {
    return this.tokenNext(idx, skipWs, skipCm, true)
  }

  /** sqlparse/sql.py: TokenList.token_next */
  tokenNext(
    idx: number | null,
    skipWs = true,
    skipCm = false,
    reverse = false
  ): [number | null, Token | null] {
    if (idx === null) return [null, null]
    return this.tokenMatching(
      (tk) => !((skipWs && tk.isWhitespace) || (skipCm && imt(tk, { t: T.Comment, i: Comment }))),
      idx + 1,
      null,
      reverse
    )
  }

  /** sqlparse/sql.py: TokenList.token_index */
  tokenIndex(token: Token, start = 0): number {
    const idx = this.tokens.indexOf(token, start)
    if (idx < 0) throw new TokenNotFoundError('token not in list')
    return idx
  }

  /** sqlparse/sql.py: TokenList.group_tokens */
  groupTokens(
    grpCls: TokenListClass,
    startIdx: number,
    end: number,
    includeEnd = true,
    extend = false
  ): TokenList {
    const start = this.tokens[startIdx]!
    const endIdx = end + (includeEnd ? 1 : 0)
    let grp: TokenList
    let subtokens: Token[]
    if (extend && start instanceof grpCls) {
      subtokens = this.tokens.slice(startIdx + 1, endIdx)
      grp = start
      grp.tokens.push(...subtokens)
      this.tokens.splice(startIdx + 1, endIdx - startIdx - 1)
      grp.value += subtokens.map((token) => token.value).join('')
    } else {
      subtokens = this.tokens.slice(startIdx, endIdx)
      grp = new grpCls(subtokens)
      this.tokens.splice(startIdx, endIdx - startIdx, grp)
      grp.parent = this
    }
    for (const token of subtokens) token.parent = grp
    return grp
  }

  /** sqlparse/sql.py: TokenList.get_alias */
  getAlias(): string | null {
    return null
  }

  /** sqlparse/sql.py: TokenList.get_name */
  getName(): string | null {
    return this.getAlias() || this.getRealName()
  }

  /** sqlparse/sql.py: TokenList.get_real_name */
  getRealName(): string | null {
    return null
  }

  /** sqlparse/sql.py: TokenList.get_parent_name */
  getParentName(): string | null {
    const [dotIdx] = this.tokenNextBy({ m: [T.Punctuation, '.'] })
    const [, prev] = this.tokenPrev(dotIdx)
    return prev !== null ? removeQuotes(prev.value) : null
  }

  /** sqlparse/sql.py: TokenList._get_first_name */
  getFirstName(
    idx: number | null = null,
    reverse = false,
    keywords = false,
    realName = false
  ): string | null {
    let tokens = idx ? this.tokens.slice(idx) : this.tokens
    if (reverse) tokens = [...tokens].reverse()
    const types: TokenType[] = [T.Name, T.Wildcard, T.StringSymbol]
    if (keywords) types.push(T.Keyword)
    for (const token of tokens) {
      if (token.ttype !== null && types.includes(token.ttype)) return removeQuotes(token.value)
      if (token instanceof Identifier || token instanceof SqlFunction) {
        return realName ? token.getRealName() : token.getName()
      }
    }
    return null
  }
}

/** sqlparse/sql.py: NameAliasMixin.get_real_name */
function mixinRealName(list: TokenList): string | null {
  let dotIdx: number | null = null
  list.tokens.forEach((tok, idx) => {
    if (tok.match(T.Punctuation, '.')) dotIdx = idx
  })
  return list.getFirstName(dotIdx, false, false, true)
}

/** sqlparse/sql.py: NameAliasMixin.get_alias */
function mixinAlias(list: TokenList): string | null {
  const [kwIdx, kw] = list.tokenNextBy({ m: [T.Keyword, 'AS'] })
  if (kw !== null) return list.getFirstName(kwIdx! + 1, false, true)
  const [, ws] = list.tokenNextBy({ t: T.Whitespace })
  if (list.tokens.length > 2 && ws !== null) return list.getFirstName(null, true)
  return null
}

/** sqlparse/sql.py: Statement */
export class Statement extends TokenList {
  /** sqlparse/sql.py: Statement.get_type */
  getType(): string {
    let token = this.tokenFirst(true, true)
    if (token === null) return 'UNKNOWN'
    if (token.ttype === T.DML || token.ttype === T.DDL) return token.normalized
    if (token.ttype === T.CTE) {
      let tidx: number | null = this.tokenIndex(token)
      while (tidx !== null) {
        ;[tidx, token] = this.tokenNext(tidx, true)
        if (token instanceof Identifier || token instanceof IdentifierList) {
          ;[tidx, token] = this.tokenNext(tidx, true)
          if (token !== null && token.ttype === T.DML) return token.normalized
        }
      }
    }
    return 'UNKNOWN'
  }
}

/** sqlparse/sql.py: Identifier */
export class Identifier extends TokenList {
  override getRealName(): string | null {
    return mixinRealName(this)
  }

  override getAlias(): string | null {
    return mixinAlias(this)
  }

  /** sqlparse/sql.py: Identifier.is_wildcard */
  isWildcard(): boolean {
    return this.tokenNextBy({ t: T.Wildcard })[1] !== null
  }
}

/** sqlparse/sql.py: IdentifierList */
export class IdentifierList extends TokenList {
  /** sqlparse/sql.py: IdentifierList.get_identifiers */
  *getIdentifiers(): Generator<Token> {
    for (const token of this.tokens) {
      if (!(token.isWhitespace || token.match(T.Punctuation, ','))) yield token
    }
  }
}

/** sqlparse/sql.py: TypedLiteral */
export class TypedLiteral extends TokenList {
  static readonly M_OPEN: readonly Pattern[] = [
    [T.NameBuiltin, null],
    [T.Keyword, 'TIMESTAMP']
  ]
  static readonly M_CLOSE: Pattern = [T.StringSingle, null]
  static readonly M_EXTEND: Pattern = [
    T.Keyword,
    ['DAY', 'HOUR', 'MINUTE', 'MONTH', 'SECOND', 'YEAR']
  ]
}

/** sqlparse/sql.py: Parenthesis */
export class Parenthesis extends TokenList {
  static readonly M_OPEN: Pattern = [T.Punctuation, '(']
  static readonly M_CLOSE: Pattern = [T.Punctuation, ')']

  override get groupableTokens(): Token[] {
    return this.tokens.slice(1, -1)
  }
}

/** sqlparse/sql.py: SquareBrackets */
export class SquareBrackets extends TokenList {
  static readonly M_OPEN: Pattern = [T.Punctuation, '[']
  static readonly M_CLOSE: Pattern = [T.Punctuation, ']']

  override get groupableTokens(): Token[] {
    return this.tokens.slice(1, -1)
  }
}

/** sqlparse/sql.py: Assignment */
export class Assignment extends TokenList {}

/** sqlparse/sql.py: If */
export class If extends TokenList {
  static readonly M_OPEN: Pattern = [T.Keyword, 'IF']
  static readonly M_CLOSE: Pattern = [T.Keyword, 'END IF']
}

/** sqlparse/sql.py: For */
export class For extends TokenList {
  static readonly M_OPEN: Pattern = [T.Keyword, ['FOR', 'FOREACH']]
  static readonly M_CLOSE: Pattern = [T.Keyword, 'END LOOP']
}

/** sqlparse/sql.py: Comparison */
export class Comparison extends TokenList {}

/** sqlparse/sql.py: Comment */
export class Comment extends TokenList {}

/** sqlparse/sql.py: Where */
export class Where extends TokenList {
  static readonly M_OPEN: Pattern = [T.Keyword, 'WHERE']
  static readonly M_CLOSE: Pattern = [
    T.Keyword,
    [
      'ORDER BY',
      'GROUP BY',
      'LIMIT',
      'UNION',
      'UNION ALL',
      'EXCEPT',
      'INTERSECT',
      'HAVING',
      'RETURNING',
      'INTO'
    ]
  ]
}

/** sqlparse/sql.py: Over */
export class Over extends TokenList {
  static readonly M_OPEN: Pattern = [T.Keyword, 'OVER']
}

/** sqlparse/sql.py: Having */
export class Having extends TokenList {
  static readonly M_OPEN: Pattern = [T.Keyword, 'HAVING']
  static readonly M_CLOSE: Pattern = [T.Keyword, ['ORDER BY', 'LIMIT']]
}

/** sqlparse/sql.py: Case */
export class Case extends TokenList {
  static readonly M_OPEN: Pattern = [T.Keyword, 'CASE']
  static readonly M_CLOSE: Pattern = [T.Keyword, 'END']
}

/** sqlparse/sql.py: Function（改名以免与 JS 的 Function 冲突） */
export class SqlFunction extends TokenList {
  override getRealName(): string | null {
    return mixinRealName(this)
  }

  override getAlias(): string | null {
    return mixinAlias(this)
  }
}

/** sqlparse/sql.py: Begin */
export class Begin extends TokenList {
  static readonly M_OPEN: Pattern = [T.Keyword, 'BEGIN']
  static readonly M_CLOSE: Pattern = [T.Keyword, 'END']
}

/** sqlparse/sql.py: Operation */
export class Operation extends TokenList {}

/** sqlparse/sql.py: Values */
export class Values extends TokenList {}
