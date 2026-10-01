// CodeMirror 补全源：只取光标所在的语句、注释里不补、按引擎的次序原样列出。
import { describe, expect, it } from 'vitest'
import {
  CompletionContext,
  type CompletionResult,
  type CompletionSource
} from '@codemirror/autocomplete'
import { PostgreSQL, sql } from '@codemirror/lang-sql'
import { EditorState } from '@codemirror/state'
import type { SqlKind } from '@shared/data-source'
import {
  dialectOf,
  qualifiedName,
  type CompletionSchema,
  type TableRef
} from '@shared/data-source-query'
import { sqlCompletionSource, sqlLanguage } from './completion-source'
import { PrevalenceCounter } from './prioritization'

const metadata: CompletionSchema = {
  databases: [],
  searchPath: ['public'],
  foreignKeys: [],
  schemas: [
    {
      name: 'public',
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'id', datatype: 'integer' },
            { name: 'email', datatype: 'text' }
          ]
        },
        { name: 'orders', columns: [{ name: 'total', datatype: 'numeric' }] }
      ],
      views: [],
      functions: [
        {
          funcName: 'pick',
          argNames: ['a', 'b'],
          argTypes: ['integer', 'integer'],
          argModes: ['i', 'i'],
          returnType: 'integer',
          isAggregate: false,
          isWindow: false,
          isSetReturning: false,
          isExtension: false,
          argDefaults: null
        }
      ],
      datatypes: []
    }
  ]
}

const source = sqlCompletionSource({ kind: 'postgresql', metadata })

/** doc 里的 | 是光标。 */
function complete(marked: string, explicit = false): CompletionResult | null {
  const pos = marked.indexOf('|')
  const state = EditorState.create({
    doc: marked.replace('|', ''),
    extensions: [sql({ dialect: PostgreSQL })]
  })
  return source(new CompletionContext(state, pos, explicit)) as CompletionResult | null
}

describe('sqlCompletionSource', () => {
  it('按引擎的次序给出，不再过滤', () => {
    const result = complete('SELECT | FROM users', true)!
    expect(result.filter).toBe(false)
    expect(result.from).toBe('SELECT '.length)
    expect(result.options.slice(0, 2).map((o) => o.label)).toEqual(['email', 'id'])
    expect(result.options[0]!.type).toBe('property')
    // 列的 detail 为列的类型
    expect(result.options.slice(0, 2).map((o) => o.detail)).toEqual(['text', 'integer'])
    expect(result.options.find((o) => o.type === 'keyword')?.detail).toBeUndefined()
  })

  it('只看光标所在的语句', () => {
    const result = complete('SELECT * FROM orders; SELECT | FROM users', true)!
    const labels = result.options.map((o) => o.label)
    expect(labels).toContain('email')
    expect(labels).not.toContain('total')
  })

  it('语法树还没解析到光标所在的语句时，先解析完再切出这条（光标后的 FROM 也算上）', () => {
    // 没有编辑器时状态只解析开头约 3000 个字符
    const before = 'SELECT * FROM orders;\n'.repeat(500)
    const result = complete(`${before}SELECT | FROM users`, true)!
    expect(result.options.slice(0, 2).map((o) => o.label)).toEqual(['email', 'id'])
  })

  it('分号之后是新的语句', () => {
    const result = complete('SELECT * FROM users;\n|', true)!
    expect(result.options.every((o) => o.type === 'keyword')).toBe(true)
  })

  it('PostgreSQL 另补 pgcli 补全表漏掉的关键字（ILIKE）', () => {
    const labels = complete('SELECT * FROM users WHERE email il|')!.options.map((o) => o.label)
    expect(labels).toContain('ILIKE')
  })

  it('没有输入的词、也不在句点之后时，不主动唤起', () => {
    expect(complete('SELECT * FROM |')).toBeNull()
    expect(
      complete('SELECT users.| FROM users')!
        .options.map((o) => o.label)
        .sort()
    ).toEqual(['email', 'id'])
  })

  it('注释与字符串里不补全', () => {
    expect(complete('SELECT * FROM users -- us|', true)).toBeNull()
    expect(complete("SELECT * FROM users WHERE email = 'us|", true)).toBeNull()
  })

  it('PostgreSQL 的 $$ 函数体交给引擎，照 pgcli 补全函数体里的语句（收尾与没收尾）', () => {
    const body = 'CREATE OR REPLACE FUNCTION func() RETURNS setof int AS $$\nSELECT 1 FROM us|'
    expect(complete(body)!.options.map((o) => o.label)).toEqual(['users'])
    expect(complete(body + '\n$$ LANGUAGE sql')!.options.map((o) => o.label)).toEqual(['users'])
  })

  it('函数显示参数名，插入带 := 的调用形式；匹配的字符标出', () => {
    const result = complete('SELECT pi|')!
    const option = result.options.find((o) => o.label === 'pick(a := , b := )')!
    expect(option.displayLabel).toBe('pick(a, b)')
    expect(result.getMatch!(option)).toEqual([0, 2])
  })

  it('给了前缀时按「前缀 + 框里的文字」判断（表数据的 WHERE / ORDER BY 框）', () => {
    const where = sqlCompletionSource({
      kind: 'postgresql',
      metadata,
      prefix: 'SELECT * FROM users WHERE '
    })
    const state = EditorState.create({
      doc: 'id = 1 AND em',
      extensions: [sql({ dialect: PostgreSQL })]
    })
    const result = where(new CompletionContext(state, state.doc.length, false)) as CompletionResult
    expect(result.from).toBe('id = 1 AND '.length)
    expect(result.options[0]!.label).toBe('email')
  })

  it('给了计数器时用得多的排前（同一个计数器，计数晚于建补全源也算）', () => {
    const prioritizer = new PrevalenceCounter()
    const counted = sqlCompletionSource({ kind: 'postgresql', metadata, prioritizer })
    const labels = (): string[] => {
      const state = EditorState.create({
        doc: 'SELECT * FROM ',
        extensions: [sql({ dialect: PostgreSQL })]
      })
      const result = counted(
        new CompletionContext(state, state.doc.length, true)
      ) as CompletionResult
      // 只看表（模式排在表前面）
      return result.options.filter((o) => o.type === 'type').map((o) => o.label)
    }
    expect(labels()).toEqual(['orders', 'users'])
    prioritizer.update('SELECT * FROM users', 'postgresql')
    expect(labels()).toEqual(['users', 'orders'])
  })
})

describe('表数据的 WHERE / ORDER BY 框：前缀为按方言引用的完整表名（同 TableDataView）', () => {
  const schemaNamed = (name: string, searchPath: string[]): CompletionSchema => ({
    databases: [name],
    searchPath,
    foreignKeys: [],
    schemas: [
      {
        name,
        tables: [
          {
            name: 'Order Items',
            columns: [
              { name: 'qty', datatype: 'int' },
              { name: 'status', datatype: "enum('open','done')" }
            ]
          }
        ],
        views: [],
        functions: [],
        datatypes: []
      }
    ]
  })

  it.each<[SqlKind, CompletionSchema, TableRef]>([
    [
      'postgresql',
      schemaNamed('sales', ['pg_catalog', 'public']),
      { schema: 'sales', name: 'Order Items' }
    ],
    ['mysql', schemaNamed('shop', ['other']), { database: 'shop', name: 'Order Items' }],
    ['mariadb', schemaNamed('shop', ['other']), { database: 'shop', name: 'Order Items' }],
    ['sqlite', schemaNamed('main', ['main']), { name: 'Order Items' }]
  ])('%s', (kind, schema, table) => {
    const select = `SELECT * FROM ${qualifiedName(dialectOf(kind), table)}`
    const labels = (clause: string, doc: string): string[] => {
      const state = EditorState.create({
        doc,
        extensions: [sqlLanguage(kind, { metadata: schema, prefix: `${select} ${clause} ` })]
      })
      const [source] = state.languageDataAt<CompletionSource>('autocomplete', doc.length)
      const result = source!(new CompletionContext(state, doc.length, false)) as CompletionResult
      return result.options.map((o) => o.label)
    }
    expect(labels('WHERE', 'qt')[0]).toBe('qty')
    expect(labels('ORDER BY', 'sta')[0]).toBe('status')
  })
})

describe('sqlLanguage', () => {
  it('只有引擎的补全源，不带 lang-sql 自带的；不给补全时没有补全源', () => {
    const state = EditorState.create({
      doc: 'SELECT em FROM users',
      extensions: [sqlLanguage('postgresql', { metadata })]
    })
    const sources = state.languageDataAt<CompletionSource>('autocomplete', 'SELECT em'.length)
    expect(sources).toHaveLength(1)
    const result = sources[0]!(
      new CompletionContext(state, 'SELECT em'.length, false)
    ) as CompletionResult
    expect(result.options[0]!.label).toBe('email')
    const plain = EditorState.create({ doc: 'SELECT 1', extensions: [sqlLanguage('mysql')] })
    expect(plain.languageDataAt('autocomplete', 3)).toEqual([])
  })
})
