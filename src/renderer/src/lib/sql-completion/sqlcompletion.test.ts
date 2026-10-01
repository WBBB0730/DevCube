// 翻译自 pgcli tests/test_sqlcompletion.py（PostgreSQL）。与原测试的差别逐条标在用例旁（「改动：」「未翻译：」）。
import { describe, expect, it } from 'vitest'
import { completionDialect } from './dialects'
import { tableReference as TableReference, type TableReference as Ref } from './parseutils/tables'
import { S, suggestType as suggestTypeOf, type Suggestion } from './sqlcompletion'

const pg = completionDialect('postgresql')
const suggestType = (full: string, before: string): Suggestion[] => suggestTypeOf(full, before, pg)

/** 与 Python 的 set 比较：不计顺序。 */
const asSet = (suggestions: Suggestion[]): string[] =>
  suggestions.map((s) => JSON.stringify(s)).sort()

/** pgcli 测试里的元组 (schema, name, alias, is_function)。 */
const t = (
  schema: string | null,
  name: string,
  alias: string | null = null,
  isFunction = false
): Ref => TableReference(schema, name, alias, isFunction)

/** 单表 SELECT 的选择列表建议（pgcli 的 cols_etc）。 */
function colsEtc(
  table: string,
  schema: string | null = null,
  alias: string | null = null,
  isFunction = false,
  parent: string | null = null,
  lastKeyword: string | null = null
): Suggestion[] {
  return [
    S.Column({ tableRefs: [t(schema, table, alias, isFunction)], qualifiable: true }),
    S.Function(parent),
    S.Keyword(lastKeyword)
  ]
}

describe('suggest_type（pgcli tests/test_sqlcompletion.py）', () => {
  it('test_select_suggests_cols_with_visible_table_scope', () => {
    expect(asSet(suggestType('SELECT  FROM tabl', 'SELECT '))).toEqual(
      asSet(colsEtc('tabl', null, null, false, null, 'SELECT'))
    )
  })

  it('test_select_suggests_cols_with_qualified_table_scope', () => {
    expect(asSet(suggestType('SELECT  FROM sch.tabl', 'SELECT '))).toEqual(
      asSet(colsEtc('tabl', 'sch', null, false, null, 'SELECT'))
    )
  })

  it('test_cte_does_not_crash', () => {
    const sql =
      'WITH CTE AS (SELECT F.* FROM Foo F WHERE F.Bar > 23) SELECT C.* FROM CTE C WHERE C.FooID BETWEEN 123 AND 234;'
    for (let i = 0; i < sql.length; i++) suggestType(sql.slice(0, i + 1), sql.slice(0, i + 1))
  })

  it('test_where_suggests_columns_functions_quoted_table', () => {
    const expression = 'SELECT * FROM "tabl" WHERE '
    expect(asSet(suggestType(expression, expression))).toEqual(
      asSet(colsEtc('tabl', null, '"tabl"', false, null, 'WHERE'))
    )
  })

  it.each([
    'INSERT INTO OtherTabl(ID, Name) SELECT * FROM tabl WHERE ',
    'INSERT INTO OtherTabl SELECT * FROM tabl WHERE ',
    'SELECT * FROM tabl WHERE ',
    'SELECT * FROM tabl WHERE (',
    'SELECT * FROM tabl WHERE foo = ',
    'SELECT * FROM tabl WHERE bar OR ',
    'SELECT * FROM tabl WHERE foo = 1 AND ',
    'SELECT * FROM tabl WHERE (bar > 10 AND ',
    'SELECT * FROM tabl WHERE (bar AND (baz OR (qux AND (',
    'SELECT * FROM tabl WHERE 10 < ',
    'SELECT * FROM tabl WHERE foo BETWEEN ',
    'SELECT * FROM tabl WHERE foo BETWEEN foo AND '
  ])('test_where_suggests_columns_functions: %s', (expression) => {
    expect(asSet(suggestType(expression, expression))).toEqual(
      asSet(colsEtc('tabl', null, null, false, null, 'WHERE'))
    )
  })

  it.each(['SELECT * FROM tabl WHERE foo IN (', 'SELECT * FROM tabl WHERE foo IN (bar, '])(
    'test_where_in_suggests_columns: %s',
    (expression) => {
      expect(asSet(suggestType(expression, expression))).toEqual(
        asSet(colsEtc('tabl', null, null, false, null, 'WHERE'))
      )
    }
  )

  it.each(['SELECT 1 AS ', 'SELECT 1 FROM tabl AS '])('test_after_as: %s', (expression) => {
    expect(suggestType(expression, expression)).toEqual([])
  })

  it('test_where_equals_any_suggests_columns_or_keywords', () => {
    const text = 'SELECT * FROM tabl WHERE foo = ANY('
    expect(asSet(suggestType(text, text))).toEqual(
      asSet(colsEtc('tabl', null, null, false, null, 'WHERE'))
    )
  })

  it('test_lparen_suggests_cols_and_funcs', () => {
    expect(asSet(suggestType('SELECT MAX( FROM tbl', 'SELECT MAX('))).toEqual(
      asSet([
        S.Column({ tableRefs: [t(null, 'tbl')], qualifiable: true }),
        S.Function(null),
        S.Keyword('(')
      ])
    )
  })

  it('test_select_suggests_cols_and_funcs', () => {
    expect(asSet(suggestType('SELECT ', 'SELECT '))).toEqual(
      asSet([S.Column({ tableRefs: [], qualifiable: true }), S.Function(null), S.Keyword('SELECT')])
    )
  })

  it.each(['INSERT INTO ', 'COPY ', 'UPDATE ', 'DESCRIBE '])(
    'test_suggests_tables_views_and_schemas: %s',
    (expression) => {
      expect(asSet(suggestType(expression, expression))).toEqual(
        asSet([S.Table(null), S.View(null), S.Schema()])
      )
    }
  )

  it('test_suggest_tables_views_schemas_and_functions', () => {
    const expression = 'SELECT * FROM '
    expect(asSet(suggestType(expression, expression))).toEqual(
      asSet([S.FromClauseItem(null), S.Schema()])
    )
  })

  it.each([
    'SELECT * FROM foo JOIN bar on bar.barid = foo.barid JOIN ',
    'SELECT * FROM foo JOIN bar USING (barid) JOIN '
  ])('test_suggest_after_join_with_two_tables: %s', (expression) => {
    const tables = [t(null, 'foo'), t(null, 'bar')]
    expect(asSet(suggestType(expression, expression))).toEqual(
      asSet([S.FromClauseItem(null, tables), S.Join(tables, null), S.Schema()])
    )
  })

  it.each(['SELECT * FROM foo JOIN ', 'SELECT * FROM foo JOIN bar'])(
    'test_suggest_after_join_with_one_table: %s',
    (expression) => {
      const tables = [t(null, 'foo')]
      expect(asSet(suggestType(expression, expression))).toEqual(
        asSet([S.FromClauseItem(null, tables), S.Join([t(null, 'foo')], null), S.Schema()])
      )
    }
  )

  it.each(['INSERT INTO sch.', 'COPY sch.', 'DESCRIBE sch.'])(
    'test_suggest_qualified_tables_and_views: %s',
    (expression) => {
      expect(asSet(suggestType(expression, expression))).toEqual(
        asSet([S.Table('sch'), S.View('sch')])
      )
    }
  )

  it('test_suggest_qualified_aliasable_tables_and_views', () => {
    const expression = 'UPDATE sch.'
    expect(asSet(suggestType(expression, expression))).toEqual(
      asSet([S.Table('sch'), S.View('sch')])
    )
  })

  it.each([
    'SELECT * FROM sch.',
    'SELECT * FROM sch."',
    'SELECT * FROM sch."foo',
    'SELECT * FROM "sch".',
    'SELECT * FROM "sch"."'
  ])('test_suggest_qualified_tables_views_and_functions: %s', (expression) => {
    expect(asSet(suggestType(expression, expression))).toEqual(asSet([S.FromClauseItem('sch')]))
  })

  it('test_suggest_qualified_tables_views_functions_and_joins', () => {
    const expression = 'SELECT * FROM foo JOIN sch.'
    const tbls = [t(null, 'foo')]
    expect(asSet(suggestType(expression, expression))).toEqual(
      asSet([S.FromClauseItem('sch', tbls), S.Join(tbls, 'sch')])
    )
  })

  it('test_truncate_suggests_tables_and_schemas', () => {
    expect(asSet(suggestType('TRUNCATE ', 'TRUNCATE '))).toEqual(asSet([S.Table(null), S.Schema()]))
  })

  it('test_truncate_suggests_qualified_tables', () => {
    expect(asSet(suggestType('TRUNCATE sch.', 'TRUNCATE sch.'))).toEqual(asSet([S.Table('sch')]))
  })

  it.each(['SELECT DISTINCT ', 'INSERT INTO foo SELECT DISTINCT '])(
    'test_distinct_suggests_cols: %s',
    (text) => {
      expect(asSet(suggestType(text, text))).toEqual(
        asSet([
          S.Column({ tableRefs: [], localTables: [], qualifiable: true }),
          S.Function(null),
          S.Keyword('DISTINCT')
        ])
      )
    }
  )

  it.each([
    ['SELECT DISTINCT FROM tbl x JOIN tbl1 y', 'SELECT DISTINCT', 'SELECT'],
    [
      'SELECT * FROM tbl x JOIN tbl1 y ORDER BY ',
      'SELECT * FROM tbl x JOIN tbl1 y ORDER BY ',
      'ORDER BY'
    ],
    [
      'SELECT * FROM tbl x JOIN tbl1 y GROUP BY ',
      'SELECT * FROM tbl x JOIN tbl1 y GROUP BY ',
      'GROUP BY'
    ]
  ])('test_distinct_and_order_by_suggestions_with_aliases: %s', (text, textBefore, lastKeyword) => {
    expect(asSet(suggestType(text, textBefore))).toEqual(
      asSet([
        S.Column({
          tableRefs: [t(null, 'tbl', 'x'), t(null, 'tbl1', 'y')],
          localTables: [],
          qualifiable: true
        }),
        S.Function(null),
        S.Keyword(lastKeyword)
      ])
    )
  })

  it.each([
    ['SELECT DISTINCT x. FROM tbl x JOIN tbl1 y', 'SELECT DISTINCT x.'],
    ['SELECT * FROM tbl x JOIN tbl1 y ORDER BY x.', 'SELECT * FROM tbl x JOIN tbl1 y ORDER BY x.'],
    ['SELECT * FROM tbl x JOIN tbl1 y GROUP BY x.', 'SELECT * FROM tbl x JOIN tbl1 y GROUP BY x.']
  ])('test_distinct_and_order_by_suggestions_with_alias_given: %s', (text, textBefore) => {
    expect(asSet(suggestType(text, textBefore))).toEqual(
      asSet([
        S.Column({ tableRefs: [t(null, 'tbl', 'x')], localTables: [], qualifiable: false }),
        S.Table('x'),
        S.View('x'),
        S.Function('x')
      ])
    )
  })

  it('test_function_arguments_with_alias_given', () => {
    expect(asSet(suggestType('SELECT avg(x. FROM tbl x, tbl2 y', 'SELECT avg(x.'))).toEqual(
      asSet([
        S.Column({ tableRefs: [t(null, 'tbl', 'x')], localTables: [], qualifiable: false }),
        S.Table('x'),
        S.View('x'),
        S.Function('x')
      ])
    )
  })

  it('test_col_comma_suggests_cols', () => {
    expect(asSet(suggestType('SELECT a, b, FROM tbl', 'SELECT a, b,'))).toEqual(
      asSet([
        S.Column({ tableRefs: [t(null, 'tbl')], qualifiable: true }),
        S.Function(null),
        S.Keyword('SELECT')
      ])
    )
  })

  it('test_table_comma_suggests_tables_and_schemas', () => {
    expect(asSet(suggestType('SELECT a, b FROM tbl1, ', 'SELECT a, b FROM tbl1, '))).toEqual(
      asSet([S.FromClauseItem(null), S.Schema()])
    )
  })

  it('test_into_suggests_tables_and_schemas', () => {
    expect(asSet(suggestType('INSERT INTO ', 'INSERT INTO '))).toEqual(
      asSet([S.Table(null), S.View(null), S.Schema()])
    )
  })

  it.each(['INSERT INTO abc (', 'INSERT INTO abc () SELECT * FROM hij;'])(
    'test_insert_into_lparen_suggests_cols: %s',
    (text) => {
      expect(suggestType(text, 'INSERT INTO abc (')).toEqual([
        S.Column({ tableRefs: [t(null, 'abc')], context: 'insert' })
      ])
    }
  )

  it('test_insert_into_lparen_partial_text_suggests_cols', () => {
    expect(suggestType('INSERT INTO abc (i', 'INSERT INTO abc (i')).toEqual([
      S.Column({ tableRefs: [t(null, 'abc')], context: 'insert' })
    ])
  })

  it('test_insert_into_lparen_comma_suggests_cols', () => {
    expect(suggestType('INSERT INTO abc (id,', 'INSERT INTO abc (id,')).toEqual([
      S.Column({ tableRefs: [t(null, 'abc')], context: 'insert' })
    ])
  })

  it('test_partially_typed_col_name_suggests_col_names', () => {
    expect(
      asSet(suggestType('SELECT * FROM tabl WHERE col_n', 'SELECT * FROM tabl WHERE col_n'))
    ).toEqual(asSet(colsEtc('tabl', null, null, false, null, 'WHERE')))
  })

  it('test_dot_suggests_cols_of_a_table_or_schema_qualified_table', () => {
    expect(asSet(suggestType('SELECT tabl. FROM tabl', 'SELECT tabl.'))).toEqual(
      asSet([
        S.Column({ tableRefs: [t(null, 'tabl')] }),
        S.Table('tabl'),
        S.View('tabl'),
        S.Function('tabl')
      ])
    )
  })

  it.each([
    'SELECT t1. FROM tabl1 t1',
    'SELECT t1. FROM tabl1 t1, tabl2 t2',
    'SELECT t1. FROM "tabl1" t1',
    'SELECT t1. FROM "tabl1" t1, "tabl2" t2'
  ])('test_dot_suggests_cols_of_an_alias: %s', (sql) => {
    expect(asSet(suggestType(sql, 'SELECT t1.'))).toEqual(
      asSet([
        S.Table('t1'),
        S.View('t1'),
        S.Column({ tableRefs: [t(null, 'tabl1', 't1')] }),
        S.Function('t1')
      ])
    )
  })

  it.each([
    'SELECT * FROM tabl1 t1 WHERE t1.',
    'SELECT * FROM tabl1 t1, tabl2 t2 WHERE t1.',
    'SELECT * FROM "tabl1" t1 WHERE t1.',
    'SELECT * FROM "tabl1" t1, tabl2 t2 WHERE t1.'
  ])('test_dot_suggests_cols_of_an_alias_where: %s', (sql) => {
    expect(asSet(suggestType(sql, sql))).toEqual(
      asSet([
        S.Table('t1'),
        S.View('t1'),
        S.Column({ tableRefs: [t(null, 'tabl1', 't1')] }),
        S.Function('t1')
      ])
    )
  })

  it('test_dot_col_comma_suggests_cols_or_schema_qualified_table', () => {
    expect(
      asSet(suggestType('SELECT t1.a, t2. FROM tabl1 t1, tabl2 t2', 'SELECT t1.a, t2.'))
    ).toEqual(
      asSet([
        S.Column({ tableRefs: [t(null, 'tabl2', 't2')] }),
        S.Table('t2'),
        S.View('t2'),
        S.Function('t2')
      ])
    )
  })

  it.each([
    'SELECT * FROM (',
    'SELECT * FROM foo WHERE EXISTS (',
    'SELECT * FROM foo WHERE bar AND NOT EXISTS ('
  ])('test_sub_select_suggests_keyword: %s', (expression) => {
    expect(suggestType(expression, expression)).toEqual([S.Keyword()])
  })

  it.each([
    'SELECT * FROM (S',
    'SELECT * FROM foo WHERE EXISTS (S',
    'SELECT * FROM foo WHERE bar AND NOT EXISTS (S'
  ])('test_sub_select_partial_text_suggests_keyword: %s', (expression) => {
    expect(suggestType(expression, expression)).toEqual([S.Keyword()])
  })

  it('test_outer_table_reference_in_exists_subquery_suggests_columns', () => {
    const q = 'SELECT * FROM foo f WHERE EXISTS (SELECT 1 FROM bar WHERE f.'
    expect(asSet(suggestType(q, q))).toEqual(
      asSet([
        S.Column({ tableRefs: [t(null, 'foo', 'f')] }),
        S.Table('f'),
        S.View('f'),
        S.Function('f')
      ])
    )
  })

  it('test_sub_select_table_name_completion', () => {
    const expression = 'SELECT * FROM (SELECT * FROM '
    expect(asSet(suggestType(expression, expression))).toEqual(
      asSet([S.FromClauseItem(null), S.Schema()])
    )
  })

  it.each([
    'SELECT * FROM foo WHERE EXISTS (SELECT * FROM ',
    'SELECT * FROM foo WHERE bar AND NOT EXISTS (SELECT * FROM '
  ])('test_sub_select_table_name_completion_with_outer_table: %s', (expression) => {
    const tbls = [t(null, 'foo')]
    expect(asSet(suggestType(expression, expression))).toEqual(
      asSet([S.FromClauseItem(null, tbls), S.Schema()])
    )
  })

  it('test_sub_select_col_name_completion', () => {
    expect(asSet(suggestType('SELECT * FROM (SELECT  FROM abc', 'SELECT * FROM (SELECT '))).toEqual(
      asSet([
        S.Column({ tableRefs: [t(null, 'abc')], qualifiable: true }),
        S.Function(null),
        S.Keyword('SELECT')
      ])
    )
  })

  // 改动：原为 xfail（pgcli 把 a 也当作表）。按 sqls 的子查询作用域只取子查询自己的表，已能给出 abc 的列；
  // 最后一个关键字为 SELECT（原 xfail 的期望 cols_etc("abc") 未指定关键字）。
  it('test_sub_select_multiple_col_name_completion', () => {
    expect(
      asSet(suggestType('SELECT * FROM (SELECT a, FROM abc', 'SELECT * FROM (SELECT a, '))
    ).toEqual(asSet(colsEtc('abc', null, null, false, null, 'SELECT')))
  })

  it('test_sub_select_dot_col_name_completion', () => {
    expect(
      asSet(suggestType('SELECT * FROM (SELECT t. FROM tabl t', 'SELECT * FROM (SELECT t.'))
    ).toEqual(
      asSet([
        S.Column({ tableRefs: [t(null, 'tabl', 't')] }),
        S.Table('t'),
        S.View('t'),
        S.Function('t')
      ])
    )
  })

  describe.each(['', 'INNER', 'LEFT', 'RIGHT OUTER'])('join_type %j', (joinType) => {
    it.each(['', 'foo'])('test_join_suggests_tables_and_schemas: alias %j', (tblAlias) => {
      const text = `SELECT * FROM abc ${tblAlias} ${joinType} JOIN `
      const tbls = [t(null, 'abc', tblAlias || null)]
      expect(asSet(suggestType(text, text))).toEqual(
        asSet([S.FromClauseItem(null, tbls), S.Schema(), S.Join(tbls, null)])
      )
    })
  })

  it('test_left_join_with_comma', () => {
    const text = 'select * from foo f left join bar b,'
    // 表里本该也有 (None, 'bar', 'b', False)，但逗号有问题（pgcli 原注）
    const tbls = [t(null, 'foo', 'f')]
    expect(asSet(suggestType(text, text))).toEqual(
      asSet([S.FromClauseItem(null, tbls), S.Schema()])
    )
  })

  it.each([
    'SELECT * FROM abc a JOIN def d ON a.',
    'SELECT * FROM abc a JOIN def d ON a.id = d.id AND a.'
  ])('test_join_alias_dot_suggests_cols1: %s', (sql) => {
    const tables = [t(null, 'abc', 'a'), t(null, 'def', 'd')]
    expect(asSet(suggestType(sql, sql))).toEqual(
      asSet([
        S.Column({ tableRefs: [t(null, 'abc', 'a')] }),
        S.Table('a'),
        S.View('a'),
        S.Function('a'),
        S.JoinCondition(tables, t(null, 'abc', 'a'))
      ])
    )
  })

  it.each([
    'SELECT * FROM abc a JOIN def d ON a.id = d.',
    'SELECT * FROM abc a JOIN def d ON a.id = d.id AND a.id2 = d.'
  ])('test_join_alias_dot_suggests_cols2: %s', (sql) => {
    expect(asSet(suggestType(sql, sql))).toEqual(
      asSet([
        S.Column({ tableRefs: [t(null, 'def', 'd')] }),
        S.Table('d'),
        S.View('d'),
        S.Function('d')
      ])
    )
  })

  it.each([
    'select a.x, b.y from abc a join bcd b on ',
    'select a.x, b.y\nfrom abc a\njoin bcd b on\n',
    'select a.x, b.y\nfrom abc a\njoin bcd b\non ',
    'select a.x, b.y from abc a join bcd b on a.id = b.id OR '
  ])('test_on_suggests_aliases_and_join_conditions: %j', (sql) => {
    const tables = [t(null, 'abc', 'a'), t(null, 'bcd', 'b')]
    expect(asSet(suggestType(sql, sql))).toEqual(
      asSet([S.JoinCondition(tables, null), S.Alias(['a', 'b'])])
    )
  })

  it.each([
    'select abc.x, bcd.y from abc join bcd on abc.id = bcd.id AND ',
    'select abc.x, bcd.y from abc join bcd on '
  ])('test_on_suggests_tables_and_join_conditions: %s', (sql) => {
    const tables = [t(null, 'abc'), t(null, 'bcd')]
    expect(asSet(suggestType(sql, sql))).toEqual(
      asSet([S.JoinCondition(tables, null), S.Alias(['abc', 'bcd'])])
    )
  })

  it.each([
    'select a.x, b.y from abc a join bcd b on a.id = ',
    'select a.x, b.y from abc a join bcd b on a.id = b.id AND a.id2 = '
  ])('test_on_suggests_aliases_right_side: %s', (sql) => {
    expect(suggestType(sql, sql)).toEqual([S.Alias(['a', 'b'])])
  })

  it.each([
    'select abc.x, bcd.y from abc join bcd on abc.id = bcd.id and ',
    'select abc.x, bcd.y from abc join bcd on '
  ])('test_on_suggests_tables_and_join_conditions_right_side: %s', (sql) => {
    const tables = [t(null, 'abc'), t(null, 'bcd')]
    expect(asSet(suggestType(sql, sql))).toEqual(
      asSet([S.JoinCondition(tables, null), S.Alias(['abc', 'bcd'])])
    )
  })

  it.each([
    'select * from abc inner join def using (',
    'select * from abc inner join def using (col1, ',
    'insert into hij select * from abc inner join def using (',
    'insert into hij(x, y, z)\n    select * from abc inner join def using (col1, ',
    'insert into hij (a,b,c)\n    select * from abc inner join def using (col1, '
  ])('test_join_using_suggests_common_columns: %j', (text) => {
    const tables = [t(null, 'abc'), t(null, 'def')]
    expect(asSet(suggestType(text, text))).toEqual(
      asSet([S.Column({ tableRefs: tables, requireLastTable: true })])
    )
  })

  it('test_suggest_columns_after_multiple_joins', () => {
    const sql = `select * from t1
            inner join t2 ON
              t1.id = t2.t1_id
            inner join t3 ON
              t2.id = t3.`
    expect(asSet(suggestType(sql, sql))).toContain(
      JSON.stringify(S.Column({ tableRefs: [t(null, 't3')] }))
    )
  })

  it('test_2_statements_2nd_current', () => {
    expect(
      asSet(suggestType('select * from a; select * from ', 'select * from a; select * from '))
    ).toEqual(asSet([S.FromClauseItem(null), S.Schema()]))
    expect(
      asSet(suggestType('select * from a; select  from b', 'select * from a; select '))
    ).toEqual(
      asSet([
        S.Column({ tableRefs: [t(null, 'b')], qualifiable: true }),
        S.Function(null),
        S.Keyword('SELECT')
      ])
    )
    // 第一条语句不完整也要能用
    expect(
      asSet(suggestType('select * from; select * from ', 'select * from; select * from '))
    ).toEqual(asSet([S.FromClauseItem(null), S.Schema()]))
  })

  it('test_2_statements_1st_current', () => {
    expect(asSet(suggestType('select * from ; select * from b', 'select * from '))).toEqual(
      asSet([S.FromClauseItem(null), S.Schema()])
    )
    expect(asSet(suggestType('select  from a; select * from b', 'select '))).toEqual(
      asSet(colsEtc('a', null, null, false, null, 'SELECT'))
    )
  })

  it('test_3_statements_2nd_current', () => {
    expect(
      asSet(
        suggestType(
          'select * from a; select * from ; select * from c',
          'select * from a; select * from '
        )
      )
    ).toEqual(asSet([S.FromClauseItem(null), S.Schema()]))
    expect(
      asSet(
        suggestType('select * from a; select  from b; select * from c', 'select * from a; select ')
      )
    ).toEqual(asSet(colsEtc('b', null, null, false, null, 'SELECT')))
  })

  it.each([
    `
CREATE OR REPLACE FUNCTION func() RETURNS setof int AS $$
SELECT  FROM foo;
SELECT 2 FROM bar;
$$ language sql;
    `,
    `create function func2(int, varchar)
RETURNS text
language sql AS
$func$
SELECT 2 FROM bar;
SELECT  FROM foo;
$func$
    `,
    `
CREATE OR REPLACE FUNCTION func() RETURNS setof int AS $func$
SELECT 3 FROM foo;
SELECT 2 FROM bar;
$$ language sql;
create function func2(int, varchar)
RETURNS text
language sql AS
$func$
SELECT 2 FROM bar;
SELECT  FROM foo;
$func$
    `,
    `
SELECT * FROM baz;
CREATE OR REPLACE FUNCTION func() RETURNS setof int AS $func$
SELECT  FROM foo;
SELECT 2 FROM bar;
$$ language sql;
create function func2(int, varchar)
RETURNS text
language sql AS
$func$
SELECT 3 FROM bar;
SELECT  FROM foo;
$func$
SELECT * FROM qux;
    `
  ])('test_statements_in_function_body %#', (text) => {
    expect(asSet(suggestType(text, text.slice(0, text.indexOf('  ') + 1)))).toEqual(
      asSet([
        S.Column({ tableRefs: [t(null, 'foo')], qualifiable: true }),
        S.Function(null),
        S.Keyword('SELECT')
      ])
    )
  })

  const functions = [
    `
CREATE OR REPLACE FUNCTION func() RETURNS setof int AS $$
SELECT 1 FROM foo;
SELECT 2 FROM bar;
$$ language sql;
    `,
    `
create function func2(int, varchar)
RETURNS text
language sql AS
'
SELECT 2 FROM bar;
SELECT 1 FROM foo;
';
    `
  ]

  it.each(functions)('test_statements_with_cursor_after_function_body %#', (text) => {
    expect(asSet(suggestType(text, text.slice(0, text.indexOf('; ') + 1)))).toEqual(
      asSet([S.Keyword(), S.Special()])
    )
  })

  it.each(functions)('test_statements_with_cursor_before_function_body %#', (text) => {
    expect(asSet(suggestType(text, ''))).toEqual(asSet([S.Keyword(), S.Special()]))
  })

  it('test_create_db_with_template', () => {
    const text = 'create database foo with template '
    expect(asSet(suggestType(text, text))).toEqual(asSet([S.Database()]))
  })

  it.each(['', '    ', '\t \t', '\n'])(
    'test_specials_included_for_initial_completion: %j',
    (initialText) => {
      expect(asSet(suggestType(initialText, initialText))).toEqual(
        asSet([S.Keyword(), S.Special()])
      )
    }
  )

  it('test_drop_schema_qualified_table_suggests_only_tables', () => {
    const text = 'DROP TABLE schema_name.table_name'
    expect(suggestType(text, text)).toEqual([S.Table('schema_name')])
  })

  it.each([',', '  ,', 'sel ,'])('test_handle_pre_completion_comma_gracefully: %j', (text) => {
    expect(Array.isArray(suggestType(text, text))).toBe(true)
  })

  it('test_drop_schema_suggests_schemas', () => {
    const sql = 'DROP SCHEMA '
    expect(suggestType(sql, sql)).toEqual([S.Schema()])
  })

  it.each(['SELECT x::', 'SELECT x::y', 'SELECT (x + y)::'])(
    'test_cast_operator_suggests_types: %s',
    (text) => {
      expect(asSet(suggestType(text, text))).toEqual(
        asSet([S.Datatype(null), S.Table(null), S.Schema()])
      )
    }
  )

  it.each(['SELECT foo::bar.', 'SELECT foo::bar.baz', 'SELECT (x + y)::bar.'])(
    'test_cast_operator_suggests_schema_qualified_types: %s',
    (text) => {
      expect(asSet(suggestType(text, text))).toEqual(asSet([S.Datatype('bar'), S.Table('bar')]))
    }
  )

  it('test_alter_column_type_suggests_types', () => {
    const q = 'ALTER TABLE foo ALTER COLUMN bar TYPE '
    expect(asSet(suggestType(q, q))).toEqual(asSet([S.Datatype(null), S.Table(null), S.Schema()]))
  })

  // 改动：「SELECT type 」里的 type 是选择列表里的一项，适配层按非保留字纠正为名字，结果同「SELECT foo 」（Keyword()，
  // 该写别名或 FROM 了）；原测试的本意——不改为建议类型——仍然成立。其余两条照原样。
  it.each(['SELECT type ', 'SELECT type, ', 'SELECT id, type, '])(
    'test_column_named_type_still_suggests_columns: %s',
    (text) => {
      const suggestions = suggestType(text, text)
      expect(suggestions).not.toContainEqual(S.Datatype(null))
      if (text === 'SELECT type ') {
        expect(suggestions).toEqual(suggestType('SELECT foo ', 'SELECT foo '))
      } else {
        expect(suggestions.map((s) => s.type)).toContain('Column')
      }
    }
  )

  it.each([
    'CREATE TABLE foo (bar ',
    'CREATE TABLE foo (bar DOU',
    'CREATE TABLE foo (bar INT, baz ',
    'CREATE TABLE foo (bar INT, baz TEXT, qux ',
    'CREATE FUNCTION foo (bar ',
    'CREATE FUNCTION foo (bar INT, baz ',
    'SELECT * FROM foo() AS bar (baz ',
    'SELECT * FROM foo() AS bar (baz INT, qux ',
    // 不能触发反斜杠命令的补全
    'CREATE TABLE foo (dt d'
  ])('test_identifier_suggests_types_in_parentheses: %s', (text) => {
    expect(asSet(suggestType(text, text))).toEqual(
      asSet([S.Datatype(null), S.Table(null), S.Schema()])
    )
  })

  it.each([
    'SELECT foo ',
    'SELECT foo FROM bar ',
    'SELECT foo AS bar ',
    'SELECT foo bar ',
    'SELECT * FROM foo AS bar ',
    'SELECT * FROM foo bar ',
    'SELECT foo FROM (SELECT bar '
  ])('test_alias_suggests_keywords: %s', (text) => {
    expect(suggestType(text, text)).toEqual([S.Keyword()])
  })

  it('test_invalid_sql', () => {
    // pgcli issue 317
    const text = 'selt *'
    expect(suggestType(text, text)).toEqual([S.Keyword()])
  })

  it.each(['SELECT * FROM foo where created > now() - ', 'select * from foo where bar '])(
    'test_suggest_where_keyword: %s',
    (text) => {
      // https://github.com/dbcli/mycli/issues/135
      expect(asSet(suggestType(text, text))).toEqual(
        asSet(colsEtc('foo', null, null, false, null, 'WHERE'))
      )
    }
  )

  // 未翻译：test_named_query_completion（\ns 命名查询是 pgcli 命令行的功能，控制台没有）。

  it('test_select_suggests_fields_from_function', () => {
    expect(asSet(suggestType('SELECT  FROM func()', 'SELECT '))).toEqual(
      asSet(colsEtc('func', null, null, true, null, 'SELECT'))
    )
  })

  it('test_leading_parenthesis', () => {
    // 只要不出错
    suggestType('(', '(')
  })

  it.each(['select * from "', 'select * from "foo'])(
    'test_ignore_leading_double_quotes: %s',
    (sql) => {
      expect(asSet(suggestType(sql, sql))).toContain(JSON.stringify(S.FromClauseItem(null)))
    }
  )

  it.each([
    'ALTER TABLE foo ALTER COLUMN ',
    'ALTER TABLE foo ALTER COLUMN bar',
    'ALTER TABLE foo DROP COLUMN ',
    'ALTER TABLE foo DROP COLUMN bar'
  ])('test_column_keyword_suggests_columns: %s', (sql) => {
    expect(asSet(suggestType(sql, sql))).toEqual(asSet([S.Column({ tableRefs: [t(null, 'foo')] })]))
  })

  it('test_handle_unrecognized_kw_generously', () => {
    const sql = 'SELECT * FROM sessions WHERE session = 1 AND '
    expect(asSet(suggestType(sql, sql))).toContain(
      JSON.stringify(S.Column({ tableRefs: [t(null, 'sessions')], qualifiable: true }))
    )
  })

  it.each(['ALTER ', 'ALTER TABLE foo ALTER '])('test_keyword_after_alter: %s', (sql) => {
    expect(asSet(suggestType(sql, sql))).toContain(JSON.stringify(S.Keyword('ALTER')))
  })

  it('test_suggestion_when_setting_search_path', () => {
    expect(asSet(suggestType('SET ', 'SET '))).toEqual(asSet([S.Keyword('SET')]))
    const sql = 'SET search_path TO '
    expect(asSet(suggestType(sql, sql))).toEqual(asSet([S.Schema()]))
  })
})

// 补充用例（不在 pgcli 的测试里），期望值都取 pgcli 对同样输入的结果。
describe('suggest_type 补充：以左括号定位与非保留字（期望值取 pgcli）', () => {
  // find_prev_keyword 只跳过已收尾的子查询括号；列名表、参数表、VALUES 的元组照 pgcli 回到左括号
  it('INSERT … (列名) VALUES 之后补该表的列', () => {
    const text = 'INSERT INTO users (id, name) VALUES '
    expect(suggestType(text, text)).toEqual([
      S.Column({ tableRefs: [t(null, 'users')], context: 'insert' })
    ])
  })

  it.each([
    'INSERT INTO foo (a, b) VALUES (1, 2), ',
    'INSERT INTO foo (a, b) VALUES (1, 2) RETURNING ',
    'INSERT INTO foo (a, b) VALUES (1, 2) ON CONFLICT (a) DO NOTHING RETURNING ',
    'CREATE FUNCTION f(a int) RETURNS ',
    'SELECT max(a), ',
    'SELECT CAST(a AS int), extract(year '
  ])('回到已收尾的左括号，补列、函数、关键字: %s', (text) => {
    expect(asSet(suggestType(text, text))).toEqual(
      asSet([S.Column({ tableRefs: [], qualifiable: true }), S.Function(null), S.Keyword('(')])
    )
  })

  // 词的类别照 sqlparse：name 是名字，PARTITION 是关键字
  it.each([
    'ALTER TABLE users ALTER COLUMN name T',
    'UPDATE users SET name ',
    'ALTER TABLE foo ALTER COLUMN name ',
    'ALTER TABLE t ADD COLUMN name ',
    'SELECT row_number() OVER (PARTITION B',
    'SELECT row_number() OVER (PARTITION '
  ])('非保留字照 sqlparse 分类: %s', (text) => {
    expect(suggestType(text, text)).toEqual([S.Keyword()])
  })
})
