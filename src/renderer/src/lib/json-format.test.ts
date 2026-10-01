import { applyEdits, format } from 'jsonc-parser'
import { describe, expect, it } from 'vitest'
import { formatJsonText } from './json-format'

describe('formatJsonText', () => {
  it('对象与数组按 2 个空格缩进逐项换行，空对象与空数组不拆开', () => {
    expect(formatJsonText('{"a":1,"b":[true,null],"c":{},"d":[]}')).toBe(
      [
        '{',
        '  "a": 1,',
        '  "b": [',
        '    true,',
        '    null',
        '  ],',
        '  "c": {},',
        '  "d": []',
        '}'
      ].join('\n')
    )
    expect(formatJsonText('[{"a":"x"},2]')).toBe(
      ['[', '  {', '    "a": "x"', '  },', '  2', ']'].join('\n')
    )
  })

  it('token 原样保留：大整数、数字写法、转义、字符串里的标点都不改写', () => {
    expect(formatJsonText('{"id":12345678901234567890123}')).toBe(
      '{\n  "id": 12345678901234567890123\n}'
    )
    expect(formatJsonText('[1.0,1e5,-0,1E-7,0.10]')).toBe(
      '[\n  1.0,\n  1e5,\n  -0,\n  1E-7,\n  0.10\n]'
    )
    expect(formatJsonText('{"s":"\\u00e9\\n,{:}[ ]"}')).toBe('{\n  "s": "\\u00e9\\n,{:}[ ]"\n}')
  })

  it('已排过版的按统一的缩进重排，首尾空白去掉', () => {
    expect(formatJsonText('\n  {\n      "a" :  1 ,\n\n      "b":2 }  \n')).toBe(
      '{\n  "a": 1,\n  "b": 2\n}'
    )
  })

  it('较大的输入与 jsonc-parser 的 applyEdits 逐条应用的结果一致', () => {
    const value = Array.from({ length: 1000 }, (_, i) => ({ id: i, tags: ['a', i], meta: {} }))
    for (const text of [
      JSON.stringify(value),
      JSON.stringify(value, null, 4),
      JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n')
    ]) {
      const edits = format(text, undefined, { tabSize: 2, insertSpaces: true, eol: '\n' })
      expect(formatJsonText(text)).toBe(applyEdits(text, edits))
    }
  })

  it('不是对象或数组的 JSON 为 null', () => {
    for (const text of [
      '',
      '   ',
      'hello',
      '42',
      '"{\\"a\\":1}"',
      'null',
      'true',
      '{a:1}',
      "{'a':1}",
      '{"a":1,}',
      '[1,]',
      '// 注释\n{}',
      '{"a":1} x',
      '{"a":1}{"b":2}',
      '[1,2'
    ]) {
      expect(formatJsonText(text)).toBeNull()
    }
  })
})
