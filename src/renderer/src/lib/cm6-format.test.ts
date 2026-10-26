import { EditorSelection, EditorState } from '@codemirror/state'
import { applyEdits, format } from 'jsonc-parser'
import { describe, expect, it } from 'vitest'
import {
  formatFailure,
  formatRange,
  formatTransaction,
  textFormatEdits,
  whitespaceEdits,
  type FormatEdit
} from './cm6-format'

describe('whitespaceEdits', () => {
  it('相同为空', () => {
    expect(whitespaceEdits('select 1', 'select 1')).toEqual([])
  })

  it('非空白字符之间与首尾的空白不同各算一处：增、删、改', () => {
    expect(whitespaceEdits(' a  b(c)', 'a\n  b ( c )\n')).toEqual([
      { offset: 0, length: 1, content: '' },
      { offset: 2, length: 2, content: '\n  ' },
      { offset: 5, length: 0, content: ' ' },
      { offset: 6, length: 0, content: ' ' },
      { offset: 7, length: 0, content: ' ' },
      { offset: 8, length: 0, content: '\n' }
    ])
  })

  it('照着修改能从 before 得到 after', () => {
    const before = "select a,b  from t where s = 'x  y' -- 注释\n"
    const after = "select\n  a,\n  b\nfrom\n  t\nwhere\n  s = 'x  y' -- 注释"
    const edits = whitespaceEdits(before, after)
    expect(edits).not.toBeNull()
    expect(applyEdits(before, edits ?? [])).toBe(after)
  })

  it('非空白字符对不上为 null', () => {
    expect(whitespaceEdits('select a', 'SELECT a')).toBeNull()
    expect(whitespaceEdits('select a', 'select a;')).toBeNull()
    expect(whitespaceEdits('select a;', 'select a')).toBeNull()
  })
})

/** doc 里 part 的选区 */
function select(doc: string, part: string): EditorState {
  const from = doc.indexOf(part)
  return EditorState.create({ doc, selection: EditorSelection.range(from, from + part.length) })
}

describe('formatRange', () => {
  it('没选中为全文、选中为选区，都去掉首尾空白', () => {
    expect(formatRange(EditorState.create({ doc: '\n  [1]\n\n' }))).toEqual({ from: 3, to: 6 })
    expect(formatRange(select('x = [ 1 ] ;', '[ 1 ] '))).toEqual({ from: 4, to: 9 })
  })

  it('全是空白时为 null', () => {
    expect(formatRange(EditorState.create({ doc: ' \n\t' }))).toBeNull()
    expect(formatRange(select('a  b', '  '))).toBeNull()
  })
})

describe('textFormatEdits', () => {
  /** 把连续的空白并成一个空格 */
  const collapse = (text: string): string => text.trim().split(/\s+/).join(' ')
  const formatted = (state: EditorState, format: (text: string) => string): string =>
    apply(state, textFormatEdits(state, format)).doc.toString()

  it('只换去掉首尾空白的那一段，首尾空白原样', () => {
    expect(formatted(EditorState.create({ doc: '\n a   b \n' }), collapse)).toBe('\n a b \n')
    expect(formatted(select('x(  a   b  )y', '  a   b  '), collapse)).toBe('x(  a b  )y')
  })

  it('交给 format 的文字从选中处（没选中为文首）起，报错的行列与之对应', () => {
    const seen: string[] = []
    const record = (text: string): string => {
      seen.push(text)
      return text
    }
    textFormatEdits(EditorState.create({ doc: '\n\nselect 1;\n' }), record)
    textFormatEdits(select('a;\n  select 2;\nb', '\n  select 2;'), record)
    expect(seen).toEqual(['\n\nselect 1;', '\n  select 2;'])
  })

  it('只差空白时逐处修改，改了空白以外的字符就整段换', () => {
    expect(textFormatEdits(EditorState.create({ doc: 'a  b  c' }), collapse)).toHaveLength(2)
    expect(textFormatEdits(EditorState.create({ doc: ' ab \n' }), (t) => t.toUpperCase())).toEqual([
      { offset: 1, length: 2, content: 'AB' }
    ])
  })

  it('format 排不了时抛出', () => {
    const fail = (): string => {
      throw new Error('bad')
    }
    expect(() => textFormatEdits(EditorState.create({ doc: 'x' }), fail)).toThrow('bad')
  })
})

describe('formatFailure', () => {
  it('原因只取第一行', () => {
    expect(formatFailure(new Error('Parse error at line 1\nUnexpected token…\n\n…'))).toBe(
      'Parse error at line 1'
    )
    expect(formatFailure('bad')).toBe('bad')
  })
})

/** 把逐处修改写成事务应用到 state 上 */
function apply(state: EditorState, edits: readonly FormatEdit[]): EditorState {
  return state.update(formatTransaction(state, edits)).state
}

function jsonEdits(text: string): FormatEdit[] {
  return format(text, undefined, { tabSize: 2, insertSpaces: true, eol: '\n' })
}

describe('formatTransaction', () => {
  it('结果与逐条应用一致：压成一行的与已排过版的', () => {
    const value = Array.from({ length: 200 }, (_, i) => ({ id: i, tags: ['a', i], meta: {} }))
    for (const text of [JSON.stringify(value), JSON.stringify(value, null, 4)]) {
      const edits = jsonEdits(text)
      expect(apply(EditorState.create({ doc: text }), edits).doc.toString()).toBe(
        applyEdits(text, edits)
      )
    }
  })

  it('同一行起头的修改并成一处，不同行的各自一处', () => {
    const changeCount = (text: string): number => {
      const { changes } = formatTransaction(EditorState.create({ doc: text }), jsonEdits(text))
      return Array.isArray(changes) ? changes.length : -1
    }
    const oneLine = '{"a":1,"b":[true,null]}'
    expect(jsonEdits(oneLine).length).toBeGreaterThan(1)
    expect(changeCount(oneLine)).toBe(1)
    // 第 1、2 行行尾各一处（下一行的缩进），第 3 行两处（` :` 与 `:2`）
    const lines = '{\n    "a": 1,\n    "b" :2\n}'
    expect(jsonEdits(lines)).toHaveLength(4)
    expect(changeCount(lines)).toBe(3)
  })

  it('光标按逐处修改映射，合并成一处的也落在原来的字符旁', () => {
    const text = '{"a":1,"b":[true,null]}'
    const state = EditorState.create({
      doc: text,
      selection: EditorSelection.range(text.indexOf('true'), text.indexOf('null') + 4)
    })
    const next = apply(state, jsonEdits(text))
    const { from, to } = next.selection.main
    expect(next.sliceDoc(from, to)).toBe('true,\n    null')
  })

  it('不在改动处的光标不动', () => {
    const text = '{\n  "a":1\n}'
    const state = EditorState.create({ doc: text, selection: { anchor: 4 } })
    expect(apply(state, jsonEdits(text)).selection.main.head).toBe(4)
  })

  it('改动单独记一步撤销', () => {
    const text = '[1,2]'
    expect(formatTransaction(EditorState.create({ doc: text }), jsonEdits(text)).userEvent).toBe(
      'format'
    )
  })
})
