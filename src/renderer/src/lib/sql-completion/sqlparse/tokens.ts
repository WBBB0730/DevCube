// 记号类型：移植 sqlparse/tokens.py。类型是带层级的路径（Token.Keyword.DML），「属于」按层级判断
// （Python 里 `ttype in T.Keyword`）。

export type TokenType = string

/** sqlparse/tokens.py: _TokenType.__contains__——type 是 parent 本身或它的子类型。 */
export function ttypeIn(type: TokenType | null, parent: TokenType): boolean {
  return type !== null && (type === parent || type.startsWith(parent + '.'))
}

const Token = 'Token'
const Text = `${Token}.Text`
const Whitespace = `${Text}.Whitespace`
const Keyword = `${Token}.Keyword`
const Name = `${Token}.Name`
const Literal = `${Token}.Literal`
const String = `${Literal}.String`
const Number = `${Literal}.Number`
const Operator = `${Token}.Operator`
const Comment = `${Token}.Comment`
const Generic = `${Token}.Generic`

/** sqlparse/tokens.py 里的各个类型（只列用到的）。 */
export const T = {
  Token,
  Text,
  Whitespace,
  Newline: `${Whitespace}.Newline`,
  Error: `${Token}.Error`,
  Keyword,
  DML: `${Keyword}.DML`,
  DDL: `${Keyword}.DDL`,
  DCL: `${Keyword}.DCL`,
  CTE: `${Keyword}.CTE`,
  KeywordOrder: `${Keyword}.Order`,
  KeywordTZCast: `${Keyword}.TZCast`,
  Name,
  NameBuiltin: `${Name}.Builtin`,
  NamePlaceholder: `${Name}.Placeholder`,
  Literal,
  String,
  StringSingle: `${String}.Single`,
  StringSymbol: `${String}.Symbol`,
  Number,
  NumberInteger: `${Number}.Integer`,
  NumberFloat: `${Number}.Float`,
  NumberHexadecimal: `${Number}.Hexadecimal`,
  Punctuation: `${Token}.Punctuation`,
  Operator,
  Comparison: `${Operator}.Comparison`,
  Wildcard: `${Token}.Wildcard`,
  Comment,
  CommentSingle: `${Comment}.Single`,
  CommentSingleHint: `${Comment}.Single.Hint`,
  CommentMultiline: `${Comment}.Multiline`,
  CommentMultilineHint: `${Comment}.Multiline.Hint`,
  Assignment: `${Token}.Assignment`,
  Command: `${Generic}.Command`
} as const
