// 方言差异：翻译自 mycli test/pytests/test_completion_engine.py（MySQL / MariaDB）与 litecli
// tests/test_completion_engine.py（SQLite）里与 pgcli 不同的部分。期望值改写为本引擎统一的建议类型（pgcli 的
// namedtuple）：mycli 的 {'type': 'database'}（表的位置）即 Schema（MySQL 的模式就是库），fk_join 即 JoinCondition，
// drop_unique 即 requireLastTable；mycli 在 SELECT / WHERE 里另给 alias、不给 keyword 的组合差异不吸收（见 notes），
// 所以这些位置的期望是 pgcli 的组合加上 mycli 的 Introducer。
// 未翻译：mycli / litecli 的命令行专用用例（source、\f、特殊命令大小写…）与各 _emit_* / _token_* 内部函数的单测
// （行为已由下面按 suggest_type 的用例覆盖）；test_arrow_op_inside_function_suggests_nothing（原为 xfail）。
import { describe, expect, it } from 'vitest'
import { completionDialect } from './dialects'
import { tableReference, type TableReference } from './parseutils/tables'
import {
  findDoubledBackticks,
  isInsideQuotes,
  S,
  suggestType as suggestTypeOf,
  type Suggestion
} from './sqlcompletion'

const asSet = (suggestions: Suggestion[]): string[] =>
  suggestions.map((s) => JSON.stringify(s)).sort()
const t = (schema: string | null, name: string, alias: string | null = null): TableReference =>
  tableReference(schema, name, alias, false)

describe('MySQL / MariaDB（mycli test_completion_engine.py）', () => {
  const my = completionDialect('mysql')
  const suggestType = (full: string, before = full): Suggestion[] => suggestTypeOf(full, before, my)
  /** pgcli 的表达式建议加上 mycli 的字符集引导符。 */
  const expression = (tables: TableReference[], keyword: string): Suggestion[] => [
    S.Column({ tableRefs: tables, qualifiable: true }),
    S.Function(null),
    S.Keyword(keyword),
    S.Introducer()
  ]

  it('MariaDB 同 MySQL', () => {
    const text = 'SELECT * FROM tabl WHERE foo = '
    expect(suggestTypeOf(text, text, completionDialect('mariadb'))).toEqual(suggestType(text))
  })

  it('test_select_suggests_cols_with_visible_table_scope', () => {
    expect(asSet(suggestType('SELECT  FROM tabl', 'SELECT '))).toEqual(
      asSet(expression([t(null, 'tabl')], 'SELECT'))
    )
  })

  it('test_where_equals_suggests_enum_values_first', () => {
    const text = 'SELECT * FROM tabl WHERE foo = '
    const suggestions = suggestType(text)
    expect(suggestions[0]).toEqual(S.EnumValue([t(null, 'tabl')], 'foo', null))
    expect(asSet(suggestions.slice(1))).toEqual(asSet(expression([t(null, 'tabl')], 'WHERE')))
  })

  describe.each(["'", '"'])('quote %s', (quote) => {
    describe.each(['WHERE', 'HAVING'])('clause %s', (clause) => {
      it.each(['=', ' = '])('test_quoted_enum_prefix_context: %j', (separator) => {
        const text = `SELECT * FROM tabl t ${clause} \`t\`.\`foo\`${separator}${quote}in_pro`
        expect(suggestType(text)).toEqual([
          {
            ...S.EnumValue([t(null, 'tabl', 't')], '`foo`', '`t`'),
            valuePrefix: 'in_pro',
            quote,
            replacementLength: 7
          }
        ])
      })
    })
  })

  it.each([
    "SELECT * FROM tabl WHERE foo > 'pen",
    "SELECT * FROM tabl WHERE foo = 'pending'",
    "SELECT * FROM tabl WHERE 'foo = pen",
    "SELECT * FROM tabl -- foo = 'pen",
    "SELECT * FROM tabl # foo = 'pen",
    "SELECT * FROM tabl /* foo = 'pen"
  ])('test_quoted_enum_context_excludes_other_strings_and_comments: %s', (text) => {
    expect(suggestType(text).some((s) => s.type === 'EnumValue')).toBe(false)
  })

  it.each([
    ["'", "O''Br", "O'Br"],
    ['"', 'say ""he', 'say "he'],
    ["'", "O\\'Br", "O'Br"],
    ['"', 'say \\"he', 'say "he'],
    ["'", 'a\\\\b', 'a\\b'],
    ["'", 'a\\nb', 'a\nb'],
    ["'", 'a\\tb', 'a\tb'],
    ["'", 'a\\0b', 'a\0b'],
    ["'", 'a\\qb', 'aqb'],
    ["'", 'unfinished\\', 'unfinished\\']
  ])('test_quoted_enum_prefix_decodes_sql_escapes: %s%s', (quote, prefix, decoded) => {
    const text = `SELECT * FROM tabl WHERE foo = ${quote}${prefix}`
    expect(suggestType(text)).toEqual([
      {
        ...S.EnumValue([t(null, 'tabl')], 'foo', null),
        valuePrefix: decoded,
        quote,
        replacementLength: prefix.length + 1
      }
    ])
  })

  // mycli 的 _enum_value_suggestion 单测，改为经 suggest_type 验证
  it('test_enum_value_suggestion_returns_none_without_equals_context', () => {
    expect(suggestType('SELECT * FROM tabl WHERE foo ').some((s) => s.type === 'EnumValue')).toBe(
      false
    )
  })

  it('test_enum_value_suggestion_handles_qualified_backticked_identifier', () => {
    expect(suggestType('SELECT * FROM sch.tabl WHERE `tabl`.`foo` = ')[0]).toEqual(
      S.EnumValue([t('sch', 'tabl')], '`foo`', '`tabl`')
    )
  })

  it('test_enum_value_suggestion_returns_none_inside_quotes', () => {
    expect(
      suggestType('SELECT * FROM tabl WHERE "foo = ').some((s) => s.type === 'EnumValue')
    ).toBe(false)
  })

  it('test_where_convert_using_suggests_character_set', () => {
    expect(suggestType('SELECT * FROM tabl WHERE CONVERT(foo USING ')).toEqual([S.CharacterSet()])
  })

  it('test_where_cast_character_set_suggests_character_set', () => {
    expect(suggestType('SELECT * FROM tabl WHERE CAST(foo AS CHAR CHARACTER SET ')).toEqual([
      S.CharacterSet()
    ])
  })

  it.each([
    ['ALTER TABLE t CONVERT TO CHARACTER SET ', S.CharacterSet()],
    ['SELECT CONVERT(foo USING ', S.CharacterSet()],
    ['collate ', S.Collation()],
    ['call ', S.Procedure(null)]
  ])('test_suggest_based_on_last_token_direct_keyword_branches: %s', (text, expected) => {
    expect(suggestType(text)).toEqual([expected])
  })

  // mycli test_suggest_based_on_last_token 的 ('*', 'select *', …) 一行与 test_emit_star：原测试直接以记号 * 调用，
  // 这里经 suggest_type，以「select * 」（* 之后有空白，最后一个记号才是 *）验证
  it.each(['select * ', 'SELECT a * ', 'SELECT a, b * '])(
    'star_token（test_emit_star）: %s',
    (text) => {
      expect(suggestType(text)).toEqual([S.Keyword()])
    }
  )

  it('SHOW 与 SHOW (（test_emit_show、test_suggest_based_on_last_token_lparen_after_show）', () => {
    expect(suggestType('SHOW ')).toEqual([S.Show()])
    expect(suggestType('SHOW (')).toEqual([S.Show()])
  })

  it('TO：CHANGE MASTER TO 为复制选项，其余为用户（test_emit_to_*）', () => {
    expect(suggestType('CHANGE MASTER TO ')).toEqual([S.Change()])
    expect(suggestType('GRANT ALL ON db.* TO ')).toEqual([S.User()])
  })

  it('USER / FOR 之后为用户（test_emit_user）', () => {
    expect(suggestType('SHOW GRANTS FOR ')).toEqual([S.User()])
    expect(suggestType('DROP USER ')).toEqual([S.User()])
  })

  it.each(['DESCRIBE ', 'DESC ', 'EXPLAIN '])(
    'test_expression_suggests_tables_views_and_schemas: %s',
    (text) => {
      expect(asSet(suggestType(text))).toEqual(asSet([S.Table(null), S.View(null), S.Schema()]))
    }
  )

  it.each(['DESCRIBE sch.', 'DESC sch.', 'EXPLAIN sch.'])(
    'test_expression_suggests_qualified_tables_views_and_schemas: %s',
    (text) => {
      expect(asSet(suggestType(text))).toEqual(asSet([S.Table('sch'), S.View('sch')]))
    }
  )

  it('test_suggest_based_on_last_token_like_in_create_table_suggests_relations', () => {
    expect(asSet(suggestType('CREATE TABLE new LIKE '))).toEqual(
      asSet([S.Schema(), S.Table(null), S.View(null)])
    )
  })

  it('test_suggest_based_on_last_token_on_without_tables_adds_database_and_table', () => {
    expect(suggestType('grant select on ')).toEqual([
      S.Alias([]),
      S.JoinCondition([], null),
      S.Schema(),
      S.Table(null)
    ])
  })

  it.each([
    ['SELECT MAX(col1 +  FROM tbl', 'SELECT MAX(col1 + '],
    ['SELECT MAX(col1 + col2 +  FROM tbl', 'SELECT MAX(col1 + col2 + '],
    ['SELECT MAX(col1 ||  FROM tbl', 'SELECT MAX(col1 || '],
    ['SELECT MAX(col1 LIKE  FROM tbl', 'SELECT MAX(col1 LIKE '],
    ['SELECT MAX(col1 DIV  FROM tbl', 'SELECT MAX(col1 DIV '],
    // 补充（不在 mycli 测试里）：lang-sql 的 MySQL 方言切不出 /，适配层按 sqlparse 切成运算符
    ['SELECT MAX(col1 /  FROM tbl', 'SELECT MAX(col1 / '],
    ['SELECT MAX(col1/ FROM tbl', 'SELECT MAX(col1/']
  ])('test_operand_inside_function_suggests_cols: %s', (full, before) => {
    expect(asSet(suggestType(full, before))).toEqual(asSet(expression([t(null, 'tbl')], '(')))
  })

  it('test_suggest_based_on_last_token_nonprogressing_comma_falls_back_to_keyword', () => {
    expect(suggestType(',')).toEqual([S.Keyword()])
  })

  it('test_quoted_where', () => {
    expect(suggestType("'where i=';")).toEqual([S.Keyword()])
  })

  it('test_cross_join', () => {
    const text = 'select * from v1 cross join v2 JOIN v1.id, '
    expect(asSet(suggestType(text))).toEqual(
      asSet([S.Schema(), S.FromClauseItem(null, [t(null, 'v1'), t(null, 'v2')])])
    )
  })

  it('引号里不补全（guard_quote_prefix、guard_inside_single_or_double）', () => {
    expect(suggestType("SELECT * FROM tabl WHERE foo > 'pen")).toEqual([])
    expect(suggestType("SELECT 'abc")).toEqual([])
  })

  it('数字或句点开头的词不补全（guard_number_or_dot）', () => {
    expect(suggestType('SELECT 12')).toEqual([])
    expect(suggestType('SELECT .5')).toEqual([])
  })

  it('test_find_doubled_backticks', () => {
    expect(findDoubledBackticks('select `ab`')).toEqual([])
    expect(findDoubledBackticks('select `a``b`')).toEqual([9, 10])
  })

  it.each<[string, number, false | 'single' | 'double' | 'backtick']>([
    ["select '", "select '".length, 'single'],
    ["select '\\'", "select '\\'".length, 'single'],
    ["select '`", "select '`".length, 'single'],
    ['select "', 'select "'.length, 'double'],
    ['select "\\"\'', 'select "\\"\''.length, 'double'],
    ['select ""', 'select ""'.length, false],
    ["select `'", "select `'".length, 'backtick'],
    ["select `' ", "select `' ".length, 'backtick'],
    ["select `'", -1, 'backtick'],
    ["select `'", -2, false],
    ['select `ab` ', -1, false],
    ['select `ab` ', -2, 'backtick'],
    ['select `a``b` ', -1, false],
    ['select `a``b` ', -2, 'backtick'],
    ['select `a``b` ', -3, 'backtick'],
    ['select `a``b` ', -4, 'backtick'],
    ['select `a``b` ', -5, 'backtick'],
    ['select `a``b` ', -6, 'backtick'],
    ['select `a``b` ', -7, false],
    ['select ``', -1, false],
    ['select ``', -2, false]
  ])('is_inside_quotes(%j, %d)', (text, position, expected) => {
    expect(isInsideQuotes(text, position)).toBe(expected)
  })
})

describe('SQLite（litecli test_completion_engine.py）', () => {
  const lite = completionDialect('sqlite')
  const suggestType = (full: string, before = full): Suggestion[] =>
    suggestTypeOf(full, before, lite)

  it.each(['DESCRIBE ', 'DESC ', 'EXPLAIN '])(
    'test_expression_suggests_tables_views_and_schemas: %s',
    (text) => {
      expect(asSet(suggestType(text))).toEqual(asSet([S.Table(null), S.View(null), S.Schema()]))
    }
  )

  it.each(['DESCRIBE sch.', 'DESC sch.', 'EXPLAIN sch.'])(
    'test_expression_suggests_qualified_tables_views_and_schemas: %s',
    (text) => {
      expect(asSet(suggestType(text))).toEqual(asSet([S.Table('sch'), S.View('sch')]))
    }
  )

  it.each([
    ['SELECT MAX(col1 +  FROM tbl', 'SELECT MAX(col1 + '],
    ['SELECT MAX(col1 + col2 +  FROM tbl', 'SELECT MAX(col1 + col2 + '],
    // 补充（不在 litecli 测试里）：/ 同 +（litecli 按结尾的 + - * / 判断）
    ['SELECT MAX(col1 /  FROM tbl', 'SELECT MAX(col1 / ']
  ])('test_operand_inside_function_suggests_cols: %s', (full, before) => {
    expect(asSet(suggestType(full, before))).toEqual(
      asSet([
        S.Column({ tableRefs: [t(null, 'tbl')], qualifiable: true }),
        S.Function(null),
        S.Keyword('(')
      ])
    )
  })

  it('ON 之后没有表时建议表（litecli：GRANT … ON <表>）', () => {
    expect(suggestType('CREATE INDEX idx ON ')).toEqual([
      S.Alias([]),
      S.JoinCondition([], null),
      S.Table(null)
    ])
  })

  it('test_cross_join', () => {
    const text = 'select * from v1 cross join v2 JOIN v1.id, '
    expect(asSet(suggestType(text))).toEqual(
      asSet([S.Schema(), S.FromClauseItem(null, [t(null, 'v1'), t(null, 'v2')])])
    )
  })
})
