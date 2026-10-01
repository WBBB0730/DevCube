// 语句切分：移植 sqlparse/engine/statement_splitter.py。
import { Statement, Token } from './sql'
import { T, ttypeIn, type TokenType } from './tokens'

/** 词法记号：类型、原文与在所解析文字里的起点。 */
export interface LexToken {
  ttype: TokenType
  value: string
  pos: number
}

/** statement_splitter.py: StatementSplitter */
class StatementSplitter {
  private blockStack: string[] = []
  private parenthesisLevel = 0
  private unconfirmedStart: string | null = null
  private isCreate = false
  private seenBegin = false
  private consumeWs = false
  private tokens: Token[] = []
  private level = 0

  /** statement_splitter.py: StatementSplitter._reset */
  private reset(): void {
    this.blockStack = []
    this.parenthesisLevel = 0
    this.unconfirmedStart = null
    this.isCreate = false
    this.seenBegin = false
    this.consumeWs = false
    this.tokens = []
    this.level = 0
  }

  /** statement_splitter.py: StatementSplitter._handle_nested_block */
  private handleNestedBlock(unified: string): number | null {
    if (unified === 'FOR') {
      this.unconfirmedStart = 'FOR'
      return 0
    }
    if (unified === 'WHILE') {
      this.unconfirmedStart = 'WHILE'
      return 0
    }
    if (unified === 'LOOP' || unified === 'DO') {
      if (this.unconfirmedStart === 'FOR' || this.unconfirmedStart === 'WHILE') {
        this.blockStack.push(this.unconfirmedStart)
        this.unconfirmedStart = null
        return 1
      }
      if (unified === 'LOOP') {
        this.blockStack.push('LOOP')
        return 1
      }
    }
    if (unified === 'IF' || unified === 'CASE') {
      this.blockStack.push(unified)
      return 1
    }
    return null
  }

  /** statement_splitter.py: StatementSplitter._handle_closing_keyword */
  private handleClosingKeyword(unified: string): number {
    const top = this.blockStack.at(-1)
    const closes: Record<string, readonly string[]> = {
      'END IF': ['IF'],
      'END FOR': ['FOR'],
      'END WHILE': ['WHILE'],
      'END LOOP': ['LOOP', 'FOR', 'WHILE'],
      'END CASE': ['CASE']
    }
    const opener = closes[unified]
    if (opener !== undefined) {
      if (top !== undefined && opener.includes(top)) {
        this.blockStack.pop()
        return -1
      }
    } else if (unified === 'END') {
      this.blockStack.pop()
      return -1
    }
    return 0
  }

  /** statement_splitter.py: StatementSplitter._change_splitlevel */
  private changeSplitlevel(ttype: TokenType, value: string): number {
    if (ttype === T.Punctuation && value === ';') {
      this.unconfirmedStart = null
      if (this.seenBegin) {
        this.seenBegin = false
        if (this.blockStack.at(-1) === 'BEGIN') {
          this.blockStack.pop()
          return -1
        }
      }
      return 0
    }
    if (ttype === T.Punctuation && value === '(') {
      this.parenthesisLevel += 1
      return 1
    }
    if (ttype === T.Punctuation && value === ')') {
      this.parenthesisLevel = Math.max(0, this.parenthesisLevel - 1)
      return -1
    }
    if (!ttypeIn(ttype, T.Keyword)) return 0

    const unified = value.toUpperCase()
    if (ttype === T.DDL && unified.startsWith('CREATE')) {
      this.isCreate = true
      return 0
    }
    if (unified === 'DECLARE' && this.isCreate && this.blockStack.length === 0) {
      this.blockStack.push('DECLARE')
      return 1
    }
    if (unified === 'BEGIN') {
      this.seenBegin = true
      if (this.blockStack.at(-1) === 'DECLARE') {
        this.blockStack.pop()
        this.blockStack.push('BEGIN')
        return 0
      }
      this.blockStack.push('BEGIN')
      return 1
    }
    if (
      this.seenBegin &&
      (ttype === T.Keyword || ttype === T.Name) &&
      ['TRANSACTION', 'WORK', 'TRAN', 'DISTRIBUTED', 'DEFERRED', 'IMMEDIATE', 'EXCLUSIVE'].includes(
        unified
      )
    ) {
      this.seenBegin = false
      if (this.blockStack.at(-1) === 'BEGIN') {
        this.blockStack.pop()
        return -1
      }
      return 0
    }
    if (this.blockStack.includes('BEGIN')) {
      const res = this.handleNestedBlock(unified)
      if (res !== null) return res
    }
    return this.handleClosingKeyword(unified)
  }

  /** statement_splitter.py: StatementSplitter.process */
  *process(stream: Iterable<LexToken>): Generator<Statement> {
    const EOS_TTYPE: readonly TokenType[] = [T.Whitespace, T.CommentSingle]
    const NON_CODE: readonly TokenType[] = [
      T.Whitespace,
      T.Newline,
      T.CommentSingle,
      T.CommentMultiline
    ]
    for (const { ttype, value, pos } of stream) {
      if (this.consumeWs && !EOS_TTYPE.includes(ttype)) {
        yield new Statement(this.tokens)
        this.reset()
      }
      this.level += this.changeSplitlevel(ttype, value)
      this.tokens.push(new Token(ttype, value, pos))
      if (ttype === T.Punctuation && value === ';') {
        this.seenBegin = false
        if (this.level <= 0 && !this.blockStack.includes('BEGIN')) this.consumeWs = true
      } else if (ttype === T.Keyword && value.split(/\s+/)[0] === 'GO') {
        this.consumeWs = true
      } else if (
        !NON_CODE.includes(ttype) &&
        !(ttype === T.Keyword && value.toUpperCase() === 'BEGIN')
      ) {
        this.seenBegin = false
      }
    }
    if (this.tokens.length > 0 && !this.tokens.every((t) => t.isWhitespace)) {
      yield new Statement(this.tokens)
    }
  }
}

/** 把词法记号流切成各条语句（未分组）。 */
export function splitStatements(stream: Iterable<LexToken>): Statement[] {
  return [...new StatementSplitter().process(stream)]
}
