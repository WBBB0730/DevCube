// 子查询作用域：参照 sqls parser/parseutil/parseutil_test.go 的 TestExtractTable / TestExtractSubQueryViews /
// TestExtractSubQueryViewsIncomplete。改动：表的表示照 pgcli——带别名的子查询以别名作表引用（sqls 不列出），
// 它的列在 derived 里（sqls 的 SubQueryInfo）；sqls 在子查询里只取这一层的表，这里另保留外层的表（相关子查询，
// pgcli 的测试也要求）。
import { describe, expect, it } from 'vitest'
import { SqlCompleter } from './completer'
import { completionDialect } from './dialects'
import { tableReference as t } from './parseutils/tables'
import { findPrevKeyword } from './parseutils/utils'
import { S, suggestType } from './sqlcompletion'
import { scopedTables } from './subquery-scope'

const my = completionDialect('mysql')
const scoped = (text: string, cursor: number): ReturnType<typeof scopedTables> =>
  scopedTables(text, cursor, my)
const names = (text: string, cursor: number): string[] =>
  scoped(text, cursor).tables.map((x) => (x.alias ? `${x.name} ${x.alias}` : x.name))

describe('光标处可见的表（sqls TestExtractTable）', () => {
  it.each([
    ['from only', 'from abc', ['abc']],
    ['join only', 'join abc', ['abc']],
    ['select table reference', 'select * from abc', ['abc']],
    ['select quoted table reference', 'select * from `abc`', ['abc']],
    ['select quoted table alias reference', 'select * from `abc` as a', ['abc a']],
    ['select table references', 'select * from abc, def', ['abc', 'def']],
    [
      'select join table reference',
      'select * from abc left join def on abc.id = def.id',
      ['abc', 'def']
    ],
    ['with database schema and alias', 'select * from abc.def as ghi', ['def ghi']],
    ['insert', 'insert into abc', ['abc']],
    ['update', 'update abc', ['abc']]
  ])('%s', (_, text, expected) => {
    expect(names(text, 1)).toEqual(expected)
  })

  it('sub query：子查询里的表对外不可见，别名作表引用', () => {
    const text = 'FROM (SELECT ID as city_id, Name as city_name FROM city) as t'
    expect(scoped(text, 1).tables).toEqual([t(null, 't', 't')])
  })

  it('focus outer / middle sub query：不在光标路径上的子查询不可见', () => {
    const text =
      'select t.* from (select city_id, city_name from (select city.ID as city_id, city.Name as city_name from city) as t) as t'
    expect(names(text, 1)).toEqual(['t t'])
    expect(names(text, text.length)).toEqual(['t t'])
    // 光标在中间一层：外层的 t 与这一层的 t 相同，只留一份
    expect(names(text, 18)).toEqual(['t t'])
  })

  it('focus deep sub query：最内层的表，另加外层的', () => {
    const text =
      'select t.* from (select city_id, city_name from (select ci.ID as city_id, ci.Name as city_name from city as ci) as t) as t'
    expect(names(text, 55)).toEqual(['t t', 'city ci'])
  })

  it('WHERE 里的子查询：在外层不可见，在里面可见（pgcli 取不到）', () => {
    const text = 'SELECT  FROM a WHERE id IN (SELECT a_id FROM b WHERE )'
    expect(names(text, 'SELECT '.length)).toEqual(['a'])
    expect(names(text, text.length - 1)).toEqual(['a', 'b'])
  })
})

describe('带别名的子查询的列（sqls TestExtractSubQueryViews）', () => {
  it('single', () => {
    const text = 'SELECT * FROM (SELECT ci.ID, ci.Name FROM world.city AS ci) AS sub'
    expect(scoped(text, 14).derived).toEqual([
      {
        name: 'sub',
        columns: [
          { name: 'ID', datatype: null, foreignkeys: [], default: null, hasDefault: false },
          { name: 'Name', datatype: null, foreignkeys: [], default: null, hasDefault: false }
        ]
      }
    ])
  })

  it('double：SELECT * 的列取自子查询里的表', () => {
    const text =
      'select * from (select * from city) as sub1, (select * from country) as sub2 limit 1'
    expect(scoped(text, 14).derived).toEqual([
      { name: 'sub1', columns: [], starTables: [t(null, 'city', null)] },
      { name: 'sub2', columns: [], starTables: [t(null, 'country', null)] }
    ])
  })

  it('aliased column', () => {
    const text =
      'SELECT * FROM (SELECT ci.ID AS city_id, ci.Name AS city_name FROM world.city AS ci) AS sub'
    expect(scoped(text, 14).derived[0]!.columns.map((c) => c.name)).toEqual([
      'city_id',
      'city_name'
    ])
  })

  it('not found sub query：光标在子查询里时它不算带别名的表', () => {
    const text = 'SELECT * FROM (SELECT ci.ID, ci.Name FROM world.city AS ci) AS sub'
    expect(scoped(text, 15).derived).toEqual([])
  })

  it('asterisk identifier', () => {
    const text = 'SELECT * FROM (SELECT * FROM world.city AS ci) AS sub'
    expect(scoped(text, 14).derived).toEqual([
      { name: 'sub', columns: [], starTables: [t('world', 'city', 'ci')] }
    ])
  })

  it('position of outer sub query：只列直接的子查询；嵌套的子查询合并进来', () => {
    const text =
      'SELECT * FROM (SELECT it.ID, it.Name FROM (SELECT ci.ID, ci.Name, ci.CountryCode FROM world.city AS ci) AS it) AS ot'
    const derived = scoped(text, 14).derived
    expect(derived.map((d) => d.name)).toEqual(['ot'])
    expect(derived[0]!.columns.map((c) => c.name)).toEqual(['ID', 'Name'])
    const star =
      'SELECT * FROM (SELECT * FROM (SELECT ci.ID, ci.Name FROM world.city AS ci) AS it) AS ot'
    expect(scoped(star, 14).derived[0]!.columns.map((c) => c.name)).toEqual(['ID', 'Name'])
  })

  it.each(['select * from (select) as t', 'select * from (select * from (select 1) as x) as y'])(
    'TestExtractSubQueryViewsIncomplete：%s 不出错',
    (text) => {
      expect(() => scoped(text, 1)).not.toThrow()
    }
  )
})

describe('子查询收尾之后回到外层（find_prev_keyword 跳过已收尾的括号）', () => {
  const pg = completionDialect('postgresql')

  it('往回找关键字时不进已收尾的括号', () => {
    expect(findPrevKeyword('SELECT * FROM a WHERE x IN (SELECT y FROM b) AND ', pg)[0]?.value).toBe(
      'IN'
    )
    // 没收尾的左括号照旧算
    expect(
      findPrevKeyword('SELECT * FROM a WHERE x IN (SELECT y FROM b WHERE ', pg)[0]?.value
    ).toBe('WHERE')
    expect(findPrevKeyword('SELECT * FROM a WHERE (x = 1 AND ', pg)[0]?.value).toBe('(')
  })

  it('WHERE 里的子查询之后仍按 WHERE 建议（pgcli 会误回到子查询里的 FROM）', () => {
    const text = 'SELECT * FROM a WHERE x IN (SELECT y FROM b) AND a.'
    expect(suggestType(text, text, pg)).toEqual([
      S.Column({ tableRefs: [t(null, 'a', null)] }),
      S.Table('a'),
      S.View('a'),
      S.Function('a')
    ])
  })
})

describe('补全里用到子查询的列', () => {
  const completer = new SqlCompleter('postgresql', {
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
          }
        ],
        views: [],
        functions: [],
        datatypes: []
      }
    ]
  })
  const texts = (text: string, cursor: number): string[] =>
    completer.getCompletions(text, cursor).map((c) => c.text)

  it('带别名的子查询：列取自选择列表', () => {
    const text = 'SELECT s. FROM (SELECT id AS uid, email FROM users) s'
    expect(texts(text, 'SELECT s.'.length).sort()).toEqual(['email', 'uid'])
  })

  it('子查询 SELECT *：按表结构展开', () => {
    const text = 'SELECT s. FROM (SELECT * FROM users) s'
    expect(texts(text, 'SELECT s.'.length).sort()).toEqual(['email', 'id'])
  })

  it('WHERE 里子查询的表不出现在外层的列里', () => {
    const text = 'SELECT  FROM (SELECT 1 AS one) x WHERE 1 IN (SELECT id FROM users)'
    const result = completer.getCompletions(text, 'SELECT '.length)
    expect(result.filter((c) => c.displayMeta === 'column').map((c) => c.text)).toEqual(['one'])
  })
})
