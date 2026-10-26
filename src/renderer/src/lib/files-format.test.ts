import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { formatTransaction } from './cm6-format'
import { filesFormatEdits, filesFormatLanguage, type FilesFormatLanguage } from './files-format'

/** 格式化 doc（selection 为选中的 [from, to)，不给即全文），交回格式化后的全文 */
function format(language: FilesFormatLanguage, doc: string, selection?: [number, number]): string {
  const state = EditorState.create({
    doc,
    selection: selection === undefined ? undefined : EditorSelection.range(...selection)
  })
  return state
    .update(formatTransaction(state, filesFormatEdits(state, language)))
    .state.doc.toString()
}

/** doc 里 part 的 [from, to) */
function rangeOf(doc: string, part: string): [number, number] {
  const from = doc.indexOf(part)
  return [from, from + part.length]
}

describe('filesFormatLanguage', () => {
  it('跟高亮同一份映射：JSON、带注释的 JSON、Unity 的 .asmdef 为 json，.sql 为 sql', () => {
    expect(filesFormatLanguage('/p/package.json')).toBe('json')
    expect(filesFormatLanguage('/p/.vscode/settings.jsonc')).toBe('json')
    expect(filesFormatLanguage('/p/Game.asmdef')).toBe('json')
    expect(filesFormatLanguage('/p/db/001_init.SQL')).toBe('sql')
  })

  it('其他文件不能格式化', () => {
    for (const path of ['/p/a.ts', '/p/README.md', '/p/a.yaml', '/p/Makefile', '/p/data.csv']) {
      expect(filesFormatLanguage(path)).toBeNull()
    }
  })
})

describe('filesFormatEdits：JSON', () => {
  it('压成一行的排开，看不出缩进时 2 个空格；文末换行原样', () => {
    expect(format('json', '{"a":1,"b":[true,null],"c":{}}\n')).toBe(
      '{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ],\n  "c": {}\n}\n'
    )
    expect(format('json', '[1,2]')).toBe('[\n  1,\n  2\n]')
  })

  it('缩进跟着全文现有的写法：4 个空格、Tab', () => {
    expect(format('json', '{\n    "a": 1,\n    "b":{"c":2}\n}')).toBe(
      '{\n    "a": 1,\n    "b": {\n        "c": 2\n    }\n}'
    )
    expect(format('json', '{\n\t"a": 1,\n\t"b":[2]\n}')).toBe(
      '{\n\t"a": 1,\n\t"b": [\n\t\t2\n\t]\n}'
    )
  })

  it('注释与末尾逗号原样保留（tsconfig、VS Code 设置这类带注释的 JSON）', () => {
    expect(format('json', '{\n  // 编译选项\n  "strict":true, /* 严格 */\n  "a":[1,],\n}')).toBe(
      '{\n  // 编译选项\n  "strict": true, /* 严格 */\n  "a": [\n    1,\n  ],\n}'
    )
  })

  it('只排选中的部分，以所在行原有的缩进为起始层级', () => {
    const doc = '{\n  "keep" :  1,\n  "x": {"y":[1,2]}\n}'
    expect(format('json', doc, rangeOf(doc, '{"y":[1,2]}'))).toBe(
      '{\n  "keep" :  1,\n  "x": {\n    "y": [\n      1,\n      2\n    ]\n  }\n}'
    )
  })

  it('语法有错的地方跳过不排，其余照排，不报错', () => {
    expect(format('json', '{"a":1 "b":[2,3]}')).toBe('{\n  "a": 1 "b": [\n    2,\n    3\n  ]\n}')
  })

  it('全是空白时不改', () => {
    const state = EditorState.create({ doc: ' \n\t\n' })
    expect(filesFormatEdits(state, 'json')).toEqual([])
  })
})

describe('filesFormatEdits：SQL', () => {
  it('按标准 SQL 排版，首尾空白（文末换行）原样', () => {
    expect(format('sql', '\nselect a,b from t where id=1;\n')).toBe(
      '\nselect\n  a,\n  b\nfrom\n  t\nwhere\n  id = 1;\n'
    )
  })

  it('缩进跟着全文现有的写法', () => {
    expect(format('sql', 'select\n    a\nfrom\n    t;\nselect b from u;')).toBe(
      'select\n    a\nfrom\n    t;\n\nselect\n    b\nfrom\n    u;'
    )
  })

  it('只排选中的语句，其余原样', () => {
    const doc = 'select  1;\nselect a,b from t;\nselect  2;'
    expect(format('sql', doc, rangeOf(doc, 'select a,b from t;'))).toBe(
      'select  1;\nselect\n  a,\n  b\nfrom\n  t;\nselect  2;'
    )
  })

  it('认不出的语句抛出，交给调用方报「无法格式化」', () => {
    const state = EditorState.create({ doc: 'select (1;' })
    expect(() => filesFormatEdits(state, 'sql')).toThrow(/Parse error/)
  })
})
