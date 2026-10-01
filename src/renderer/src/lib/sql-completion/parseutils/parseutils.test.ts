// 翻译自 pgcli tests/parseutils/test_parseutils.py、test_ctes.py 与 utils.py 里 last_word 的 doctest；MySQL / SQLite 的
// extract_tables 翻译自 mycli test/pytests/test_sql_utils.py、litecli tests/test_parseutils.py（方言差异：名字不折成
// 小写、没有 is_function）。
// 未翻译：is_destructive、parse_destructive_warning、query_starts_with / queries_start_with（执行前确认用，与补全无关）；
// is_open_quote（命令行判断多行输入是否写完用，与补全无关，没有移植）；
// test_function_metadata_eq（Python 的相等与哈希语义，这里以对象本身为键）；mycli 的 extract_from_part /
// extract_table_identifiers / get_last_select / extract_columns_from_select 等内部函数的单测（mycli 自己的实现，
// 这里各方言共用 pgcli 的 extract_from_part）。
import { describe, expect, it } from 'vitest'
import { completionDialect } from '../dialects'
import { parse } from '../sqlparse/parse'
import { extractColumnNames as extractColumnNamesOf, extractCtes, tokenStartPos } from './ctes'
import { extractTables as extractTablesOf, tableReference, type TableReference } from './tables'
import { findPrevKeyword, lastWord, type LastWordInclude } from './utils'

const pg = completionDialect('postgresql')
const extractTables = (sql: string): TableReference[] => extractTablesOf(sql, pg)
const t = (
  schema: string | null,
  name: string,
  alias: string | null = null,
  isFunction = false
): TableReference => tableReference(schema, name, alias, isFunction)
/** 与 Python 的 set 比较：不计顺序。 */
const asSet = (tables: TableReference[]): string[] => tables.map((x) => JSON.stringify(x)).sort()

describe('extract_tables（pgcli tests/parseutils/test_parseutils.py）', () => {
  it('test_empty_string', () => {
    expect(extractTables('')).toEqual([])
  })

  it('test_simple_select_single_table', () => {
    expect(extractTables('select * from abc')).toEqual([t(null, 'abc')])
  })

  it.each(['select * from "abc"."def"', 'select * from abc."def"'])(
    'test_simple_select_single_table_schema_qualified_quoted_table: %s',
    (sql) => {
      expect(extractTables(sql)).toEqual([t('abc', 'def', '"def"')])
    }
  )

  it.each(['select * from abc.def', 'select * from "abc".def'])(
    'test_simple_select_single_table_schema_qualified: %s',
    (sql) => {
      expect(extractTables(sql)).toEqual([t('abc', 'def')])
    }
  )

  it('test_simple_select_single_table_double_quoted', () => {
    expect(extractTables('select * from "Abc"')).toEqual([t(null, 'Abc')])
  })

  it('test_simple_select_multiple_tables', () => {
    expect(asSet(extractTables('select * from abc, def'))).toEqual(
      asSet([t(null, 'abc'), t(null, 'def')])
    )
  })

  it('test_simple_select_multiple_tables_double_quoted', () => {
    expect(asSet(extractTables('select * from "Abc", "Def"'))).toEqual(
      asSet([t(null, 'Abc'), t(null, 'Def')])
    )
  })

  it('test_simple_select_single_table_deouble_quoted_aliased', () => {
    expect(extractTables('select * from "Abc" a')).toEqual([t(null, 'Abc', 'a')])
  })

  it('test_simple_select_multiple_tables_deouble_quoted_aliased', () => {
    expect(asSet(extractTables('select * from "Abc" a, "Def" d'))).toEqual(
      asSet([t(null, 'Abc', 'a'), t(null, 'Def', 'd')])
    )
  })

  it('test_simple_select_multiple_tables_schema_qualified', () => {
    expect(asSet(extractTables('select * from abc.def, ghi.jkl'))).toEqual(
      asSet([t('abc', 'def'), t('ghi', 'jkl')])
    )
  })

  it('test_simple_select_with_cols_single_table', () => {
    expect(extractTables('select a,b from abc')).toEqual([t(null, 'abc')])
  })

  it('test_simple_select_with_cols_single_table_schema_qualified', () => {
    expect(extractTables('select a,b from abc.def')).toEqual([t('abc', 'def')])
  })

  it('test_simple_select_with_cols_multiple_tables', () => {
    expect(asSet(extractTables('select a,b from abc, def'))).toEqual(
      asSet([t(null, 'abc'), t(null, 'def')])
    )
  })

  it('test_simple_select_with_cols_multiple_qualified_tables', () => {
    expect(asSet(extractTables('select a,b from abc.def, def.ghi'))).toEqual(
      asSet([t('abc', 'def'), t('def', 'ghi')])
    )
  })

  it('test_select_with_hanging_comma_single_table', () => {
    expect(extractTables('select a, from abc')).toEqual([t(null, 'abc')])
  })

  it('test_select_with_hanging_comma_multiple_tables', () => {
    expect(asSet(extractTables('select a, from abc, def'))).toEqual(
      asSet([t(null, 'abc'), t(null, 'def')])
    )
  })

  it('test_select_with_hanging_period_multiple_tables', () => {
    expect(asSet(extractTables('SELECT t1. FROM tabl1 t1, tabl2 t2'))).toEqual(
      asSet([t(null, 'tabl1', 't1'), t(null, 'tabl2', 't2')])
    )
  })

  it('test_simple_insert_single_table', () => {
    // sqlparse 误把表名当作别名（pgcli 原注）
    expect(extractTables('insert into abc (id, name) values (1, "def")')).toEqual([
      t(null, 'abc', 'abc')
    ])
  })

  // 改动：原为 xfail，pgcli 在现行 sqlparse 下已通过（xpassed），照常断言。
  it('test_simple_insert_single_table_schema_qualified', () => {
    expect(extractTables('insert into abc.def (id, name) values (1, "def")')).toEqual([
      t('abc', 'def')
    ])
  })

  it('test_simple_update_table_no_schema', () => {
    expect(extractTables('update abc set id = 1')).toEqual([t(null, 'abc')])
  })

  it('test_simple_update_table_with_schema', () => {
    expect(extractTables('update abc.def set id = 1')).toEqual([t('abc', 'def')])
  })

  it.each(['', 'INNER', 'LEFT', 'RIGHT OUTER'])('test_join_table: %j', (joinType) => {
    const sql = `SELECT * FROM abc a ${joinType} JOIN def d ON a.id = d.num`
    expect(asSet(extractTables(sql))).toEqual(asSet([t(null, 'abc', 'a'), t(null, 'def', 'd')]))
  })

  it('test_join_table_schema_qualified', () => {
    expect(asSet(extractTables('SELECT * FROM abc.def x JOIN ghi.jkl y ON x.id = y.num'))).toEqual(
      asSet([t('abc', 'def', 'x'), t('ghi', 'jkl', 'y')])
    )
  })

  it('test_incomplete_join_clause', () => {
    const sql = `select a.x, b.y
             from abc a join bcd b
             on a.id = `
    expect(extractTables(sql)).toEqual([t(null, 'abc', 'a'), t(null, 'bcd', 'b')])
  })

  it('test_join_as_table', () => {
    expect(extractTables('SELECT * FROM my_table AS m WHERE m.a > 5')).toEqual([
      t(null, 'my_table', 'm')
    ])
  })

  it('test_multiple_joins', () => {
    const sql = `select * from t1
            inner join t2 ON
              t1.id = t2.t1_id
            inner join t3 ON
              t2.id = t3.`
    expect(extractTables(sql)).toEqual([t(null, 't1'), t(null, 't2'), t(null, 't3')])
  })

  it('test_subselect_tables', () => {
    expect(extractTables('SELECT * FROM (SELECT  FROM abc')).toEqual([t(null, 'abc')])
  })

  it.each(['SELECT * FROM foo.', 'SELECT 123 AS foo'])('test_extract_no_tables: %s', (text) => {
    expect(extractTables(text)).toEqual([])
  })

  it.each(['', 'arg1', 'arg1, arg2, arg3'])('test_simple_function_as_table: %j', (argList) => {
    expect(extractTables(`SELECT * FROM foo(${argList})`)).toEqual([t(null, 'foo', null, true)])
  })

  it.each(['', 'arg1', 'arg1, arg2, arg3'])(
    'test_simple_schema_qualified_function_as_table: %j',
    (argList) => {
      expect(extractTables(`SELECT * FROM foo.bar(${argList})`)).toEqual([
        t('foo', 'bar', null, true)
      ])
    }
  )

  it.each(['', 'arg1', 'arg1, arg2, arg3'])(
    'test_simple_aliased_function_as_table: %j',
    (argList) => {
      expect(extractTables(`SELECT * FROM foo(${argList}) bar`)).toEqual([
        t(null, 'foo', 'bar', true)
      ])
    }
  )

  it('test_simple_table_and_function', () => {
    expect(asSet(extractTables('SELECT * FROM foo JOIN bar()'))).toEqual(
      asSet([t(null, 'foo'), t(null, 'bar', null, true)])
    )
  })

  it('test_complex_table_and_function', () => {
    const sql = `SELECT * FROM foo.bar baz
                               JOIN bar.qux(x, y, z) quux`
    expect(asSet(extractTables(sql))).toEqual(
      asSet([t('foo', 'bar', 'baz'), t('bar', 'qux', 'quux', true)])
    )
  })
})

describe('find_prev_keyword（pgcli tests/parseutils/test_parseutils.py）', () => {
  it('test_find_prev_keyword_using', () => {
    const q = 'select * from tbl1 inner join tbl2 using (col1, '
    const [kw, q2] = findPrevKeyword(q, pg)
    expect(kw?.value).toBe('(')
    expect(q2).toBe('select * from tbl1 inner join tbl2 using (')
  })

  it.each([
    'select * from foo where bar',
    'select * from foo where bar = 1 and baz or ',
    'select * from foo where bar = 1 and baz between qux and '
  ])('test_find_prev_keyword_where: %s', (sql) => {
    const [kw, stripped] = findPrevKeyword(sql, pg)
    expect(kw?.value).toBe('where')
    expect(stripped).toBe('select * from foo where')
  })

  it.each(['create table foo (bar int, baz ', 'select * from foo() as bar (baz '])(
    'test_find_prev_keyword_open_parens: %s',
    (sql) => {
      expect(findPrevKeyword(sql, pg)[0]?.value).toBe('(')
    }
  )
})

describe('last_word（pgcli parseutils/utils.py 的 doctest；mycli test_sql_utils.py: test_last_word）', () => {
  it.each<[string, LastWordInclude, string]>([
    ['abc', 'alphanum_underscore', 'abc'],
    [' abc', 'alphanum_underscore', 'abc'],
    ['', 'alphanum_underscore', ''],
    [' ', 'alphanum_underscore', ''],
    ['abc ', 'alphanum_underscore', ''],
    ['abc def', 'alphanum_underscore', 'def'],
    ['abc def ', 'alphanum_underscore', ''],
    ['abc def;', 'alphanum_underscore', ''],
    ['bac $def', 'alphanum_underscore', 'def'],
    ['bac $def', 'most_punctuations', '$def'],
    ['bac \\def', 'most_punctuations', '\\def'],
    ['bac \\def;', 'most_punctuations', '\\def;'],
    ['bac::def', 'most_punctuations', 'def'],
    ['"foo*bar', 'most_punctuations', '"foo*bar'],
    ['abc:def', 'many_punctuations', 'def'],
    ['abc.def', 'all_punctuations', 'abc.def']
  ])('%j %s', (text, include, expected) => {
    expect(lastWord(text, include)).toBe(expected)
  })
})

describe('CTE（pgcli tests/parseutils/test_ctes.py）', () => {
  const extractColumnNames = (sql: string): string[] => extractColumnNamesOf(parse(sql, pg)[0]!)

  it('test_token_str_pos', () => {
    let p = parse('SELECT * FROM xxx', pg)[0]!
    expect(tokenStartPos(p.tokens, p.tokenIndex(p.tokens.at(-1)!))).toBe('SELECT * FROM '.length)
    p = parse('SELECT * FROM \nxxx', pg)[0]!
    expect(tokenStartPos(p.tokens, p.tokenIndex(p.tokens.at(-1)!))).toBe('SELECT * FROM \n'.length)
  })

  it('test_single_column_name_extraction', () => {
    expect(extractColumnNames('SELECT abc FROM xxx')).toEqual(['abc'])
  })

  it('test_aliased_single_column_name_extraction', () => {
    expect(extractColumnNames('SELECT abc def FROM xxx')).toEqual(['def'])
  })

  it('test_aliased_expression_name_extraction', () => {
    expect(extractColumnNames('SELECT 99 abc FROM xxx')).toEqual(['abc'])
  })

  it('test_multiple_column_name_extraction', () => {
    expect(extractColumnNames('SELECT abc, def FROM xxx')).toEqual(['abc', 'def'])
  })

  it('test_missing_column_name_handled_gracefully', () => {
    expect(extractColumnNames('SELECT abc, 99 FROM xxx')).toEqual(['abc'])
    expect(extractColumnNames('SELECT abc, 99, def FROM xxx')).toEqual(['abc', 'def'])
  })

  it('test_aliased_multiple_column_name_extraction', () => {
    expect(extractColumnNames('SELECT abc def, ghi jkl FROM xxx')).toEqual(['def', 'jkl'])
  })

  it('test_table_qualified_column_name_extraction', () => {
    expect(extractColumnNames('SELECT abc.def, ghi.jkl FROM xxx')).toEqual(['def', 'jkl'])
  })

  it.each([
    'INSERT INTO foo (x, y, z) VALUES (5, 6, 7) RETURNING x, y',
    'DELETE FROM foo WHERE x > y RETURNING x, y',
    'UPDATE foo SET x = 9 RETURNING x, y'
  ])('test_extract_column_names_from_returning_clause: %s', (sql) => {
    expect(extractColumnNames(sql)).toEqual(['x', 'y'])
  })

  it('test_simple_cte_extraction', () => {
    const sql = 'WITH a AS (SELECT abc FROM xxx) SELECT * FROM a'
    const [ctes, remainder] = extractCtes(sql, pg)
    expect(ctes).toEqual([
      {
        name: 'a',
        columns: ['abc'],
        start: 'WITH a AS '.length,
        stop: 'WITH a AS (SELECT abc FROM xxx)'.length
      }
    ])
    expect(remainder.trim()).toBe('SELECT * FROM a')
  })

  it('test_cte_extraction_around_comments', () => {
    const sql = `--blah blah blah
            WITH a AS (SELECT abc def FROM x)
            SELECT * FROM a`
    const [ctes, remainder] = extractCtes(sql, pg)
    expect(ctes).toEqual([
      {
        name: 'a',
        columns: ['def'],
        start: `--blah blah blah
            WITH a AS `.length,
        stop: `--blah blah blah
            WITH a AS (SELECT abc def FROM x)`.length
      }
    ])
    expect(remainder.trim()).toBe('SELECT * FROM a')
  })

  it('test_multiple_cte_extraction', () => {
    const sql = `WITH
            x AS (SELECT abc, def FROM x),
            y AS (SELECT ghi, jkl FROM y)
            SELECT * FROM a, b`
    const [ctes] = extractCtes(sql, pg)
    expect(ctes).toEqual([
      {
        name: 'x',
        columns: ['abc', 'def'],
        start: `WITH
            x AS `.length,
        stop: `WITH
            x AS (SELECT abc, def FROM x)`.length
      },
      {
        name: 'y',
        columns: ['ghi', 'jkl'],
        start: `WITH
            x AS (SELECT abc, def FROM x),
            y AS `.length,
        stop: `WITH
            x AS (SELECT abc, def FROM x),
            y AS (SELECT ghi, jkl FROM y)`.length
      }
    ])
  })
})

// MySQL 翻译自 mycli test/pytests/test_sql_utils.py，SQLite 翻译自 litecli tests/test_parseutils.py
describe.each(['mysql', 'sqlite'] as const)('extract_tables（%s）', (kind) => {
  const dialect = completionDialect(kind)
  const extract = (sql: string): TableReference[] => extractTablesOf(sql, dialect)

  it('test_empty_string', () => {
    expect(extract('')).toEqual([])
  })

  it('test_simple_select_single_table', () => {
    expect(extract('select * from abc')).toEqual([t(null, 'abc')])
  })

  it('test_simple_select_single_table_schema_qualified', () => {
    expect(extract('select * from abc.def')).toEqual([t('abc', 'def')])
  })

  it('test_simple_select_multiple_tables', () => {
    expect(asSet(extract('select * from abc, def'))).toEqual(
      asSet([t(null, 'abc'), t(null, 'def')])
    )
  })

  it('test_simple_select_multiple_tables_schema_qualified', () => {
    expect(asSet(extract('select * from abc.def, ghi.jkl'))).toEqual(
      asSet([t('abc', 'def'), t('ghi', 'jkl')])
    )
  })

  it('test_simple_select_with_cols_single_table', () => {
    expect(extract('select a,b from abc')).toEqual([t(null, 'abc')])
  })

  it('test_simple_select_with_cols_single_table_schema_qualified', () => {
    expect(extract('select a,b from abc.def')).toEqual([t('abc', 'def')])
  })

  it('test_simple_select_with_cols_multiple_tables', () => {
    expect(asSet(extract('select a,b from abc, def'))).toEqual(
      asSet([t(null, 'abc'), t(null, 'def')])
    )
  })

  it('test_simple_select_with_cols_multiple_tables_with_schema', () => {
    expect(asSet(extract('select a,b from abc.def, def.ghi'))).toEqual(
      asSet([t('abc', 'def'), t('def', 'ghi')])
    )
  })

  it('test_select_with_hanging_comma_single_table', () => {
    expect(extract('select a, from abc')).toEqual([t(null, 'abc')])
  })

  it('test_select_with_hanging_comma_multiple_tables', () => {
    expect(asSet(extract('select a, from abc, def'))).toEqual(
      asSet([t(null, 'abc'), t(null, 'def')])
    )
  })

  it('test_select_with_hanging_period_multiple_tables', () => {
    expect(asSet(extract('SELECT t1. FROM tabl1 t1, tabl2 t2'))).toEqual(
      asSet([t(null, 'tabl1', 't1'), t(null, 'tabl2', 't2')])
    )
  })

  it('test_simple_insert_single_table', () => {
    // sqlparse 误把表名当作别名（mycli / litecli 原注）
    expect(extract('insert into abc (id, name) values (1, "def")')).toEqual([t(null, 'abc', 'abc')])
  })

  // mycli 为普通用例，litecli 为 xfail（现已通过）
  it('test_simple_insert_single_table_schema_qualified', () => {
    expect(extract('insert into abc.def (id, name) values (1, "def")')).toEqual([t('abc', 'def')])
  })

  it('test_simple_update_table', () => {
    expect(extract('update abc set id = 1')).toEqual([t(null, 'abc')])
  })

  it('test_simple_update_table_with_schema', () => {
    expect(extract('update abc.def set id = 1')).toEqual([t('abc', 'def')])
  })

  it('test_join_table', () => {
    expect(asSet(extract('SELECT * FROM abc a JOIN def d ON a.id = d.num'))).toEqual(
      asSet([t(null, 'abc', 'a'), t(null, 'def', 'd')])
    )
  })

  it('test_join_table_schema_qualified', () => {
    expect(extract('SELECT * FROM abc.def x JOIN ghi.jkl y ON x.id = y.num')).toEqual([
      t('abc', 'def', 'x'),
      t('ghi', 'jkl', 'y')
    ])
  })

  it('test_join_as_table', () => {
    expect(extract('SELECT * FROM my_table AS m WHERE m.a > 5')).toEqual([t(null, 'my_table', 'm')])
  })

  it('名字不折成小写（与 PostgreSQL 不同）', () => {
    expect(extract('SELECT * FROM Users U')).toEqual([t(null, 'Users', 'U')])
  })
})
