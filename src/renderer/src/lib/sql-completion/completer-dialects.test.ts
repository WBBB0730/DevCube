// 补全器的方言差异：mycli 独有的建议类型（枚举值、字符集、字符集引导符、存储过程…）与 mycli / litecli 的名字引号，
// 以及按 Tabularis 的规则按子句隐藏关键字。文件后半是 mycli test/pytests/test_smart_completion_public_schema_only.py
// 与 litecli tests/test_smart_completion_public_schema_only.py 的翻译（与原测试的差别见各段开头）。
import { describe, expect, it } from 'vitest'
import type {
  CompletionForeignKey,
  CompletionNamespace,
  CompletionSchema
} from '@shared/data-source-query'
import { parseEnumValues, SqlCompleter } from './completer'
import { completionDialect } from './dialects'
import { keywordAllowed, sqlClauseAt } from './keyword-clauses'
import { PrevalenceCounter } from './prioritization'

const mysqlMetadata: CompletionSchema = {
  databases: ['shop', 'other'],
  searchPath: ['shop'],
  foreignKeys: [
    {
      parentschema: 'shop',
      parenttable: 'users',
      parentcolumn: 'id',
      childschema: 'shop',
      childtable: 'orders',
      childcolumn: 'user_id'
    }
  ],
  characterSets: ['utf8mb4', 'latin1'],
  collations: ['utf8mb4_general_ci', 'utf8mb4_bin'],
  showItems: ['DATABASES', 'TABLES', 'COLUMNS'],
  users: ["'root'@'localhost'"],
  schemas: [
    {
      name: 'shop',
      tables: [
        {
          name: 'orders',
          columns: [
            { name: 'id', datatype: 'int' },
            { name: 'user_id', datatype: 'int' },
            { name: 'status', datatype: "enum('pending','paid','it''s')" },
            { name: 'order', datatype: 'int' }
          ]
        },
        { name: 'users', columns: [{ name: 'id', datatype: 'int' }] }
      ],
      views: [],
      functions: [],
      datatypes: [],
      procedures: ['refresh_stats']
    }
  ]
}

describe('MySQL / MariaDB（mycli）', () => {
  const completer = new SqlCompleter('mysql', mysqlMetadata)
  const texts = (text: string, cursor = text.length): string[] =>
    completer.getCompletions(text, cursor).map((c) => c.text)

  it('parse_enum_values（mycli sqlexecute.py）', () => {
    expect(parseEnumValues("enum('a','b''c','d\\'e')")).toEqual(['a', "b'c", "d'e"])
    expect(parseEnumValues('int')).toEqual([])
  })

  it('「列 = 」之后只给枚举值（加引号）', () => {
    expect(texts('SELECT * FROM orders WHERE status = ').sort()).toEqual(
      ["'it''s'", "'paid'", "'pending'"].sort()
    )
  })

  it('引号里按前缀补枚举值，替换到开头的引号，补上收尾引号', () => {
    const text = "SELECT * FROM orders WHERE status = 'pa"
    expect(completer.getCompletions(text, text.length)).toEqual([
      { text: "'paid'", startPosition: -3, display: 'paid', displayMeta: 'enum value' }
    ])
    // 光标后已有收尾引号时不再补
    const withQuote = text + "'"
    expect(completer.getCompletions(withQuote, text.length)[0]!.text).toBe("'paid")
  })

  it('引号里按整个前缀匹配枚举值（mycli find_fuzzy_matches(prefix, …)，不取最后一个词）', () => {
    const enumCompleter = new SqlCompleter('mysql', {
      ...mysqlMetadata,
      schemas: [
        {
          ...mysqlMetadata.schemas[0]!,
          tables: [
            {
              name: 'orders',
              columns: [{ name: 'status', datatype: "enum('a.b-c','O''Brien','in progress')" }]
            }
          ]
        }
      ]
    })
    const values = (prefix: string): string[] => {
      const text = `SELECT * FROM orders WHERE status = '${prefix}`
      return enumCompleter.getCompletions(text, text.length).map((c) => c.text)
    }
    expect(values('a.b')).toEqual(["'a.b-c'"])
    expect(values('a.')).toEqual(["'a.b-c'"])
    expect(values('in pro')).toEqual(["'in progress'"])
  })

  it('列的补全带上列的类型（COLUMN_TYPE 原样），其余没有', () => {
    const result = completer.getCompletions('SELECT o. FROM orders o', 'SELECT o.'.length)
    expect(result.find((c) => c.text === 'status')?.datatype).toBe("enum('pending','paid','it''s')")
    expect(result.find((c) => c.text === 'user_id')?.datatype).toBe('int')
    const keywords = completer.getCompletions('SEL', 3)
    expect(keywords.every((c) => c.datatype === undefined)).toBe(true)
  })

  it('字符集、排序规则、字符集引导符', () => {
    expect(texts('SELECT CONVERT(x USING utf')).toEqual(['utf8mb4'])
    expect(texts('SELECT x COLLATE utf8mb4_b')).toEqual(['utf8mb4_bin'])
    expect(texts('SELECT _utf')).toContain('_utf8mb4')
  })

  it('SHOW、用户、CHANGE MASTER TO、存储过程', () => {
    // 模糊匹配：开头就相同的排在前面
    expect(texts('SHOW TAB')).toEqual(['TABLES', 'DATABASES'])
    expect(texts('SHOW GRANTS FOR ')).toEqual(["'root'@'localhost'"])
    expect(texts('CHANGE MASTER TO MASTER_HO')[0]).toBe('MASTER_HOST')
    expect(texts('CALL ref')).toEqual(['refresh_stats'])
  })

  it('名字是关键字时加反引号（mycli escape_name）', () => {
    expect(texts('SELECT ord FROM orders', 'SELECT ord'.length)).toContain('`order`')
  })

  it('表的位置建议库（MySQL 的模式即库）与不写前缀时查找的库里的表', () => {
    const result = completer.getCompletions('SELECT * FROM ', 'SELECT * FROM '.length)
    expect(result.filter((c) => c.displayMeta === 'schema').map((c) => c.text)).toEqual(['shop'])
    expect(
      result
        .filter((c) => c.displayMeta === 'table')
        .map((c) => c.text)
        .sort()
    ).toEqual(['orders', 'users'])
  })

  it('JOIN 之后按外键给出连接', () => {
    expect(texts('SELECT * FROM orders o JOIN ')).toContain('users ON users.id = o.user_id')
  })

  it('USE 之后建议库', () => {
    expect(texts('USE ').sort()).toEqual(['other', 'shop'])
  })

  it('单独的 * 之后只补关键字（mycli star_token）', () => {
    expect(texts('SELECT * FR')[0]).toBe('FROM')
  })

  it('关键字自动大小写：首字母或末字母是小写就用小写（mycli SQLCompleter.resolve_casing）', () => {
    expect(texts('sE')).toContain('select')
    expect(texts('Se')).toContain('select')
    expect(texts('SE')).toContain('SELECT')
  })

  it('内置函数与 SHOW 项也按关键字的大小写规则（mycli get_completions 的 function / show 分支）', () => {
    expect(texts('select cou')).toEqual(['count'])
    expect(texts('SELECT COU')).toEqual(['COUNT'])
    expect(texts('show tab')).toEqual(['tables', 'databases'])
  })

  it('关键字转成小写时同样按使用次数排', () => {
    const text = 'select * from orders l'
    expect(texts(text)[0]).not.toBe('limit')
    const used = new SqlCompleter('mysql', mysqlMetadata, {}, new PrevalenceCounter())
    used.extendQueryHistory('SELECT * FROM orders LIMIT 1')
    expect(used.getCompletions(text, text.length)[0].text).toBe('limit')
  })

  it('同一文字只列一次，留排在前面的（mycli uniq_completions_str）', () => {
    const result = completer.getCompletions('select json_v', 'select json_v'.length)
    expect(result.map((c) => [c.text, c.displayMeta])).toEqual([
      ['json_valid', 'function'],
      ['json_value', 'function']
    ])
  })
})

describe('search_path 里要加引号的模式名：只转义语句里写的模式名（修正 pgcli populate_scoped_cols）', () => {
  it('MySQL 不写前缀时查找的库为 my-shop：列、枚举值、存储过程', () => {
    const completer = new SqlCompleter('mysql', {
      databases: ['my-shop'],
      searchPath: ['my-shop'],
      foreignKeys: [],
      schemas: [
        {
          name: 'my-shop',
          tables: [
            {
              name: 'users',
              columns: [
                { name: 'id', datatype: 'int' },
                { name: 'status', datatype: "enum('active','banned')" }
              ]
            }
          ],
          views: [],
          functions: [],
          datatypes: [],
          procedures: ['refresh_stats']
        }
      ]
    })
    const texts = (text: string, cursor = text.length): string[] =>
      completer.getCompletions(text, cursor).map((c) => c.text)
    const columns = (text: string, cursor = text.length): string[] =>
      completer
        .getCompletions(text, cursor)
        .filter((c) => c.displayMeta === 'column')
        .map((c) => c.text)
    expect(columns('SELECT  FROM users', 'SELECT '.length)).toEqual(['id', 'status'])
    expect(columns('SELECT  FROM `my-shop`.users', 'SELECT '.length)).toEqual(['id', 'status'])
    expect(texts('SELECT * FROM users WHERE status = ')).toEqual(["'active'", "'banned'"])
    expect(texts('CALL ')).toEqual(['refresh_stats'])
    expect(texts('USE ')).toEqual(['`my-shop`'])
  })

  it('PostgreSQL 的 search_path 为 Sales：不写模式也能补出列', () => {
    const completer = new SqlCompleter('postgresql', {
      databases: [],
      searchPath: ['Sales'],
      foreignKeys: [],
      schemas: [
        {
          name: 'Sales',
          tables: [{ name: 'orders', columns: [{ name: 'amount', datatype: 'numeric' }] }],
          views: [],
          functions: [],
          datatypes: []
        }
      ]
    })
    const columns = (text: string, cursor: number): string[] =>
      completer
        .getCompletions(text, cursor)
        .filter((c) => c.displayMeta === 'column')
        .map((c) => c.text)
    expect(columns('SELECT am FROM orders', 'SELECT am'.length)).toEqual(['amount'])
    expect(columns('SELECT am FROM "Sales".orders', 'SELECT am'.length)).toEqual(['amount'])
  })

  it('PostgreSQL 的 search_path 为 Sales：FROM 里补得出该模式里返回结果集的函数（修正 pgcli get_function_matches）', () => {
    const completer = new SqlCompleter('postgresql', {
      databases: [],
      searchPath: ['Sales'],
      foreignKeys: [],
      schemas: [
        {
          name: 'Sales',
          tables: [],
          views: [],
          functions: [
            {
              funcName: 'daily_totals',
              argNames: null,
              argTypes: null,
              argModes: null,
              returnType: 'record',
              isAggregate: false,
              isWindow: false,
              isSetReturning: true,
              isExtension: false,
              argDefaults: null
            }
          ],
          datatypes: []
        }
      ]
    })
    const functions = completer
      .getCompletions('SELECT * FROM daily', 'SELECT * FROM daily'.length)
      .filter((c) => c.displayMeta === 'function')
      .map((c) => c.text)
    expect(functions).toEqual(['daily_totals()'])
  })
})

describe('MySQL / MariaDB 的自定义函数只插入函数名（mycli），显示时带参数表', () => {
  const calc = {
    funcName: 'calc',
    argNames: ['a', 'b'],
    argTypes: ['int', 'int'],
    argModes: null,
    returnType: 'int',
    isAggregate: false,
    isWindow: false,
    isSetReturning: false,
    isExtension: false,
    argDefaults: null
  }
  const metadata: CompletionSchema = {
    databases: ['shop'],
    searchPath: ['shop'],
    foreignKeys: [],
    schemas: [
      {
        name: 'shop',
        tables: [{ name: 'orders', columns: [{ name: 'id', datatype: 'int' }] }],
        views: [],
        functions: [calc, { ...calc, funcName: 'pick', argNames: ['x'], argTypes: ['int'] }],
        datatypes: []
      }
    ]
  }

  it.each(['mysql', 'mariadb'] as const)('%s', (kind) => {
    const completer = new SqlCompleter(kind, metadata)
    const functions = (text: string): [string, string][] =>
      completer
        .getCompletions(text, text.length)
        .filter((c) => c.displayMeta === 'function')
        .map((c) => [c.text, c.display])
    expect(functions('SELECT calc')).toEqual([['calc', 'calc(a, b)']])
    expect(functions('SELECT pic')).toEqual([['pick', 'pick(x)']])
    expect(functions('SELECT shop.ca')).toEqual([['calc', 'calc(a, b)']])
  })

  it('PostgreSQL 照旧插入具名参数的写法', () => {
    const completer = new SqlCompleter('postgresql', {
      ...metadata,
      searchPath: ['public'],
      schemas: metadata.schemas.map((s) => ({ ...s, name: 'public' }))
    })
    const texts = completer
      .getCompletions('SELECT calc', 'SELECT calc'.length)
      .filter((c) => c.displayMeta === 'function')
      .map((c) => c.text)
    expect(texts).toEqual(['calc(a := , b := )'])
  })
})

describe('SQLite（litecli）', () => {
  const completer = new SqlCompleter('sqlite', {
    databases: [],
    searchPath: ['main'],
    foreignKeys: [],
    schemas: [
      {
        name: 'main',
        tables: [{ name: 'group', columns: [{ name: 'id', datatype: 'INTEGER' }] }],
        views: [],
        functions: [],
        datatypes: []
      }
    ]
  })

  it('名字是关键字时加反引号（litecli escape_name）', () => {
    expect(completer.getCompletions('SELECT * FROM gro', 17).map((c) => c.text)).toContain(
      '`group`'
    )
  })

  it('关键字自动大小写：只看末字母（litecli SQLCompleter.find_matches）', () => {
    expect(completer.getCompletions('sE', 2).map((c) => c.text)).toContain('SELECT')
    expect(completer.getCompletions('Se', 2).map((c) => c.text)).toContain('select')
  })

  it('内置函数也按关键字的大小写规则（litecli get_completions 的 function 分支）', () => {
    expect(completer.getCompletions('select cou', 10).map((c) => c.text)).toEqual(['count'])
    expect(completer.getCompletions('select coU', 10).map((c) => c.text)).toEqual(['COUNT'])
  })

  it('内置类型（litecli 关键字里 SQLite 的类型名）', () => {
    const text = 'CREATE TABLE t (a INTEG'
    expect(completer.getCompletions(text, text.length).map((c) => c.text)).toContain('INTEGER')
  })
})

describe('关键字按子句隐藏（Tabularis KEYWORD_ALLOWED_CLAUSES）', () => {
  const completer = new SqlCompleter('postgresql', {
    databases: [],
    searchPath: ['public'],
    foreignKeys: [],
    schemas: []
  })
  const keywords = (text: string): string[] =>
    completer
      .getCompletions(text, text.length)
      .filter((c) => c.displayMeta === 'keyword')
      .map((c) => c.text)

  it('FROM 之后输入 wh 给 WHERE，不给 WHEN', () => {
    const result = keywords('SELECT * FROM t wh')
    expect(result).toContain('WHERE')
    expect(result).not.toContain('WHEN')
  })

  it('CASE 里给 WHEN', () => {
    expect(keywords('SELECT CASE wh')).toContain('WHEN')
  })
})

// —— mycli test/pytests/test_smart_completion_public_schema_only.py ——
//
// 期望值取原测试。与原测试不同的地方都属于下面几类，逐条标在用例旁：
// [排序] 照 pgcli find_matches 排序（先按匹配的紧凑程度与类别，同分按名字的字典序）；mycli 按是否开头就相同、建议的
//        先后与 frecency。这类只比集合。
// [匹配] 照 pgcli 的匹配器：名字模糊匹配不限间距，关键字只认开头；mycli 另有 regex 限距、under_words、camel_case、
//        rapidfuzz 与 completion_match_order。这类只比两者都认出的部分。
// [组合] 建议的组合照 pgcli：SELECT 列表与函数参数里给列、函数、关键字（MySQL 另加引导符），不给表别名；mycli 在函数
//        参数里只给列。ON 之后照 pgcli get_join_condition_matches：条件写成「后一张表 = 前一张表」，另有同名同类型列的
//        连接条件（name join）。
// [未吸收] mycli 独有的：每张表的 '*' 列；语句里没有表时列出 USE 选的库的全部列；输入以反引号开头时给所有候选加反引号
//        （quote_collection_if_needed）；按已输入的列给表排序；JOIN 时把有外键的表排前（pgcli 另给一条带 ON 条件的
//        join 候选，排在各表之前）。
// 未翻译：命令行专用的（test_special_name_completion、/dsn 各条、source 与文件路径各条、
// test_non_source_file_completion_uses_current_path_token、test_source_path_completion_uses_windows_quotes）；索引列的
// 样式（test_indexed_column_completion_*、test_backticked_indexed_column_completion_is_styled）；只测内部数据结构的
// test_extend_foreign_keys_*（_fk_join_conditions 的单测改为经 ON 之后的补全断言）；test_backticked_no_completion_spaces
// （原为 xfail）。
describe('mycli test/pytests/test_smart_completion_public_schema_only.py', () => {
  const my = completionDialect('mysql')
  const metadata: Record<string, string[]> = {
    users: ['id', 'email', 'first_name', 'last_name'],
    orders: ['id', 'ordered_date', 'status'],
    select: ['id', 'insert', 'ABC'],
    réveillé: ['id', 'insert', 'ABC'],
    time_zone: ['Time_zone_id'],
    time_zone_leap_second: ['Time_zone_id'],
    time_zone_name: ['Time_zone_id'],
    time_zone_transition: ['Time_zone_id'],
    time_zone_transition_type: ['Time_zone_id']
  }
  const emptySchema = (name: string): CompletionNamespace => ({
    name,
    tables: [],
    views: [],
    functions: [],
    datatypes: []
  })
  /** MySQL COLUMN_TYPE 的写法：单引号成对、反斜杠转义（mycli sqlexecute.py _parse_enum_values 的反向）。 */
  const enumColumnType = (values: readonly string[]): string =>
    `enum(${values.map((v) => `'${v.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`).join(',')})`
  /**
   * fixture completer：不写前缀时查找的库为 test，另有库 test 2。mycli 的 extend_enum_values 在这里写成 orders.status 的
   * COLUMN_TYPE；extend_character_sets / extend_collations 即 characterSets / collations。
   */
  const makeCompleter = ({
    enumValues = ['pending', 'shipped'],
    ...extra
  }: { enumValues?: readonly string[] } & Pick<
    CompletionSchema,
    'characterSets' | 'collations'
  > = {}): SqlCompleter =>
    new SqlCompleter('mysql', {
      databases: ['test', 'test 2'],
      searchPath: ['test'],
      foreignKeys: [],
      ...extra,
      schemas: [
        {
          ...emptySchema('test'),
          tables: Object.entries(metadata).map(([name, cols]) => ({
            name,
            columns: cols.map((col) => ({
              name: col,
              datatype: name === 'orders' && col === 'status' ? enumColumnType(enumValues) : null
            }))
          }))
        },
        emptySchema('test 2')
      ]
    })
  const completer = makeCompleter()
  /** fixture empty_completer：不写前缀时查找的库为 empty，库里没有表 */
  const emptyCompleter = new SqlCompleter('mysql', {
    databases: ['empty'],
    searchPath: ['empty'],
    foreignKeys: [],
    schemas: [emptySchema('empty')]
  })

  const result = (c: SqlCompleter, text: string, position = text.length): [string, number][] =>
    c.getCompletions(text, position).map((x) => [x.text, x.startPosition])
  const texts = (c: SqlCompleter, text: string, position = text.length): string[] =>
    c.getCompletions(text, position).map((x) => x.text)
  const ofMeta = (c: SqlCompleter, meta: string, text: string, position = text.length): string[] =>
    c
      .getCompletions(text, position)
      .filter((x) => x.displayMeta === meta)
      .map((x) => x.text)
  const sorted = <T>(xs: readonly T[]): T[] => [...xs].sort()
  const at0 = (xs: string[]): [string, number][] => xs.map((x) => [x, 0])
  /** mycli 的 completer.keywords（输入为空或大写时为大写），按光标所在子句去掉 Tabularis 隐藏的 */
  const keywords = (textBeforeCursor: string): string[] => {
    const clause = sqlClauseAt(textBeforeCursor, my)
    return my.keywords.filter((k) => keywordAllowed(clause, k)).map((k) => k.toUpperCase())
  }
  /** mycli 的 completer.functions（输入为空或大写时为大写） */
  const functions = my.functions.map((f) => f.toUpperCase())
  const usersColumns = ['id', 'email', 'first_name', 'last_name']
  const unquote = (name: string): string => name.replace(/^`(.*)`$/, '$1')

  it('test_use_database_completion', () => {
    expect(result(completer, 'USE ')).toEqual(at0(['test', '`test 2`']))
  })

  // 改动：原测试另有特殊命令（命令行命令，没有移植）；关键字按「语句开头」过滤。[排序]
  it('test_empty_string_completion', () => {
    expect(sorted(texts(completer, ''))).toEqual(sorted(keywords('')))
  })

  // [匹配]：pgcli 的关键字只认开头；原测试里其余各项（SERIAL、MASTER_LOG_FILE…）是 mycli 模糊匹配出的
  it('test_select_keyword_completion', () => {
    expect(result(completer, 'SEL')).toEqual([['SELECT', -3]])
  })

  // 改动：关键字按光标所在子句过滤。[排序]
  it('test_select_star', () => {
    const text = 'SELECT * '
    expect(
      completer.getCompletions(text, text.length).every((c) => c.displayMeta === 'keyword')
    ).toBe(true)
    expect(sorted(texts(completer, text))).toEqual(sorted(keywords(text)))
  })

  it('test_introducer_completion', () => {
    const c = makeCompleter({ characterSets: ['latin1', 'utf8mb4'] })
    expect(texts(c, 'SELECT _')).toEqual(expect.arrayContaining(['_latin1', '_utf8mb4']))
  })

  it('test_collation_completion', () => {
    const c = makeCompleter({ collations: ['utf16le_bin', 'utf8mb4_unicode_ci'] })
    expect(texts(c, 'SELECT "text" COLLATE ')).toEqual(
      expect.arrayContaining(['utf16le_bin', 'utf8mb4_unicode_ci'])
    )
  })

  it.each([
    ['test_transcoding_completion_1', 'SELECT CONVERT("text" USING ', ['latin1', 'utf8mb4']],
    ['test_transcoding_completion_2', 'SELECT CONVERT("text" USING u', ['utf8mb3', 'utf8mb4']],
    [
      'test_transcoding_completion_3',
      'SELECT CAST("text" AS CHAR CHARACTER SET ',
      ['latin1', 'utf8mb4']
    ],
    [
      'test_transcoding_completion_4',
      'SELECT CAST("text" AS CHAR CHARACTER SET u',
      ['utf8mb3', 'utf8mb4']
    ],
    [
      'test_where_transcoding_completion_1',
      'SELECT * FROM users WHERE CONVERT(email USING ',
      ['latin1', 'utf8mb4']
    ],
    [
      'test_where_transcoding_completion_2',
      'SELECT * FROM users WHERE CAST(email AS CHAR CHARACTER SET ',
      ['latin1', 'utf8mb4']
    ]
  ])('%s', (_, text, characterSets) => {
    const c = makeCompleter({ characterSets })
    expect(texts(c, text)).toEqual(expect.arrayContaining(characterSets))
  })

  const allRelations = [
    'users',
    'orders',
    '`select`',
    '`réveillé`',
    'time_zone',
    'time_zone_leap_second',
    'time_zone_name',
    'time_zone_transition',
    'time_zone_transition_type',
    'test',
    '`test 2`'
  ]

  // [排序]：pgcli 先列库（即模式）再按字典序列表，mycli 先列表再列库；select_filtered 与 sub_select_filtered 两条另是
  // [未吸收]：mycli 把含已输入的列（ABC、ordered_date）的表排前
  it.each([
    ['test_table_completion', 'SELECT * FROM '],
    ['test_select_filtered_table_completion', 'SELECT ABC FROM '],
    ['test_sub_select_filtered_table_completion', 'SELECT * FROM (SELECT ordered_date FROM '],
    ['test_table_names_after_from', 'SELECT * FROM '],
    ['test_grant_on_suggets_tables_and_schemata', 'GRANT ALL ON ']
  ])('%s', (_, text) => {
    expect(sorted(result(completer, text))).toEqual(sorted(at0(allRelations)))
  })

  it('test_enum_value_completion', () => {
    expect(result(completer, 'SELECT * FROM orders WHERE status = ')).toEqual(
      at0(["'pending'", "'shipped'"])
    )
  })

  describe.each(["'", '"'])('quote %s', (quote) => {
    // 原测试把匹配方式设为只认开头（completion_match_order=('perfect',)），这里是 pgcli 的模糊匹配，结果相同
    it.each(['', 'pen'])('test_quoted_enum_completion: prefix %j', (prefix) => {
      const expected = prefix ? ['pending'] : ['pending', 'shipped']
      expect(result(completer, 'SELECT * FROM orders WHERE status = ' + quote + prefix)).toEqual(
        expected.map((value) => [quote + value + quote, -prefix.length - 1])
      )
    })

    it.each(['WHERE', 'HAVING'])(
      'test_quoted_enum_completion_preserves_closing_quote: %s',
      (clause) => {
        const text = `SELECT * FROM orders o ${clause} \`o\`.\`status\` = ${quote}pen`
        const after = quote + ';'
        const pending = completer
          .getCompletions(text + after, text.length)
          .find((item) => item.text === quote + 'pending')!
        const updated = text.slice(0, text.length + pending.startPosition) + pending.text + after
        expect(updated).toBe(
          `SELECT * FROM orders o ${clause} \`o\`.\`status\` = ${quote}pending${quote};`
        )
      }
    )
  })

  it.each([
    ['in pro', 'in progress'],
    ['a.b', 'a.b-c'],
    ["O''B", "O'Brien"],
    ["O\\'B", "O'Brien"],
    ['a\\\\b', 'a\\bc']
  ])('test_quoted_enum_completion_replaces_entire_prefix: %s', (prefix, value) => {
    const c = makeCompleter({ enumValues: [value] })
    const text = "SELECT * FROM orders WHERE status = '" + prefix
    const completions = c.getCompletions(text, text.length)
    expect(completions).toHaveLength(1)
    const updated =
      text.slice(0, text.length + completions[0]!.startPosition) + completions[0]!.text
    expect(updated).toBe(
      "SELECT * FROM orders WHERE status = '" +
        value.replaceAll('\\', '\\\\').replaceAll("'", "''") +
        "'"
    )
  })

  it.each([
    'SELECT * FROM orders WHERE status = pen',
    "SELECT * FROM orders WHERE status = 'zzzzzzzzzz",
    "SELECT * FROM orders WHERE ordered_date = 'pen",
    "SELECT 'status = pen",
    "SELECT * FROM orders WHERE status = 'pending'",
    "SELECT * FROM orders -- status = 'pen",
    "SELECT * FROM orders /* status = 'pen"
  ])('test_quoted_enum_completion_does_not_leak_values: %s', (text) => {
    expect(texts(completer, text).some((t) => ["'pending'", "'shipped'"].includes(t))).toBe(false)
  })

  it.each(["ding'", " ding'"])(
    'test_quoted_enum_completion_skips_existing_value_suffix: %j',
    (suffix) => {
      const text = "SELECT * FROM orders WHERE status = 'pen"
      expect(completer.getCompletions(text + suffix, text.length)).toEqual([])
    }
  )

  // 改动：completion_match_order 是 mycli 的设置，没有移植；pgcli 的模糊匹配同原测试的 'regex' 一项
  it('test_quoted_enum_completion_uses_configured_matching', () => {
    expect(texts(completer, "SELECT * FROM orders WHERE status = 'pnd")).toEqual(["'pending'"])
  })

  it.each([
    ['ordered_date', 'pen'],
    ['status', 'zzzzzzzzzz']
  ])('test_quoted_enum_completion_has_no_sql_fallback: %s', (column, prefix) => {
    expect(texts(completer, `SELECT * FROM orders WHERE ${column} = '${prefix}`)).toEqual([])
  })

  it('test_quoted_enum_completion_after_previous_statement_and_literal', () => {
    const text = "SELECT 'other'; SELECT * FROM orders WHERE status = 'shipped' OR status='pen"
    expect(result(completer, text)).toEqual([["'pending'", -4]])
  })

  it('test_double_quoted_enum_completion_escapes_embedded_quotes', () => {
    const c = makeCompleter({ enumValues: ['say "hello"'] })
    expect(result(c, 'SELECT * FROM orders WHERE status = "say ""he')).toEqual([
      ['"say ""hello"""', -9]
    ])
  })

  // [组合]：pgcli 在 SELECT 列表里另给关键字；[未吸收]：原测试的 email 是 mycli 在语句里没有表时列出的列。[排序]
  it('test_function_name_completion', () => {
    const functionResult = completer
      .getCompletions('SELECT MA', 'SELECT MA'.length)
      .filter((c) => c.displayMeta === 'function')
      .map((c): [string, number] => [c.text, c.startPosition])
    expect(sorted(functionResult)).toEqual(
      sorted(
        ['MAX', 'MATCH', 'MAKEDATE', 'MAKETIME', 'MAKE_SET', 'MASTER_POS_WAIT'].map(
          (f): [string, number] => [f, -2]
        )
      )
    )
  })

  // [未吸收]：'*' 列；[组合]：pgcli 另给关键字，不给表别名（users、u）。[排序]
  it.each([
    ['test_suggested_column_names', 'SELECT  from users', 'SELECT '.length],
    ['test_suggested_multiple_column_names', 'SELECT id,  from users u', 'SELECT id, '.length]
  ])('%s', (_, text, position) => {
    expect(sorted(ofMeta(completer, 'column', text, position))).toEqual(sorted(usersColumns))
    expect(sorted(ofMeta(completer, 'function', text, position))).toEqual(sorted(functions))
  })

  // [未吸收]：'*' 列；[组合]：pgcli 另给关键字
  it('test_suggested_column_names_empty_db', () => {
    expect(ofMeta(emptyCompleter, 'column', 'SELECT ')).toEqual([])
    expect(sorted(ofMeta(emptyCompleter, 'function', 'SELECT '))).toEqual(sorted(functions))
  })

  // [组合]：pgcli 在函数参数里给列、函数与关键字（_suggest_expression），mycli 只给列；[未吸收]：'*' 列。[排序]
  it('test_suggested_column_names_in_function', () => {
    const text = 'SELECT MAX( from users'
    expect(sorted(ofMeta(completer, 'column', text, 'SELECT MAX('.length))).toEqual(
      sorted(usersColumns)
    )
  })

  // [未吸收]：'*' 列。[排序]
  it.each([
    ['test_suggested_column_names_with_table_dot', 'SELECT users. from users', 'SELECT users.'],
    ['test_suggested_column_names_with_alias', 'SELECT u. from users u', 'SELECT u.'],
    [
      'test_suggested_multiple_column_names_with_alias',
      'SELECT u.id, u. from users u',
      'SELECT u.id, u.'
    ],
    [
      'test_suggested_multiple_column_names_with_dot',
      'SELECT users.id, users. from users u',
      'SELECT users.id, users.'
    ]
  ])('%s', (_, text, before) => {
    expect(sorted(result(completer, text, before.length))).toEqual(sorted(at0(usersColumns)))
  })

  // [组合]：pgcli 另给同名同类型列的连接条件（两张表都有 id）。[排序]
  it('test_suggested_aliases_after_on', () => {
    const text = 'SELECT u.name, o.id FROM users u JOIN orders o ON '
    expect(sorted(ofMeta(completer, 'table alias', text))).toEqual(sorted(['u', 'o']))
    expect(texts(completer, text)).toEqual(['o.id = u.id', 'o', 'u'])
  })

  // [排序]
  it('test_suggested_aliases_after_on_right_side', () => {
    const text = 'SELECT u.name, o.id FROM users u JOIN orders o ON o.user_id = '
    expect(sorted(result(completer, text))).toEqual(sorted(at0(['u', 'o'])))
  })

  // [组合]：pgcli 另给同名同类型列的连接条件。[排序]
  it('test_suggested_tables_after_on', () => {
    const text = 'SELECT users.name, orders.id FROM users JOIN orders ON '
    expect(sorted(ofMeta(completer, 'table alias', text))).toEqual(sorted(['users', 'orders']))
    expect(texts(completer, text)).toEqual(['orders.id = users.id', 'orders', 'users'])
  })

  // [排序]
  it('test_suggested_tables_after_on_right_side', () => {
    const text = 'SELECT users.name, orders.id FROM users JOIN orders ON orders.user_id = '
    expect(sorted(result(completer, text))).toEqual(sorted(at0(['users', 'orders'])))
  })

  // [排序]：mycli 同分按长度，pgcli 按字典序
  it('test_table_names_leading_partial', () => {
    const expected = [
      'time_zone',
      'time_zone_name',
      'time_zone_transition',
      'time_zone_leap_second',
      'time_zone_transition_type'
    ]
    expect(sorted(result(completer, 'SELECT * FROM time_zone'))).toEqual(
      sorted(expected.map((x): [string, number] => [x, -9]))
    )
  })

  // [匹配]：原测试的 time_zone_name、time_zone_transition、time_zone_transition_type 是 mycli 的 rapidfuzz 匹配出的
  it('test_table_names_inter_partial', () => {
    expect(result(completer, 'SELECT * FROM time_leap')).toEqual([['time_zone_leap_second', -9]])
  })

  it('test_table_names_fuzzy', () => {
    expect(result(completer, 'SELECT * FROM tim_leap')).toEqual([['time_zone_leap_second', -8]])
  })

  // [未吸收]：'*' 列；[组合]：不给表别名（原测试为没加反引号的 select、réveillé）。[排序]
  it.each([
    ['test_auto_escaped_col_names', 'SELECT  from `select`'],
    ['test_un_escaped_table_names', 'SELECT  from réveillé']
  ])('%s', (_, text) => {
    const position = 'SELECT '.length
    expect(sorted(ofMeta(completer, 'column', text, position))).toEqual(
      sorted(['id', '`insert`', 'ABC'])
    )
    expect(sorted(ofMeta(completer, 'function', text, position))).toEqual(sorted(functions))
  })

  // 原测试断言命令行命令 exit 已从关键字里删去（mycli 按 SPECIAL_COMMANDS 删）。原测试里的 exit 一项是特殊命令，没有
  // 移植；[匹配]：explain、expire 是 mycli 对关键字模糊匹配出的
  it('test_deleted_keyword_completion', () => {
    expect(result(completer, 'exi')).toEqual([['exists', -3]])
  })

  it('test_numbers_no_completion', () => {
    const text = 'SELECT COUNT(1) FROM time_zone WHERE Time_zone_id = 1'
    expect(texts(completer, text)).toEqual([])
  })

  // [排序]：两项同分，pgcli 按字典序
  it('test_auto_case_heuristic', () => {
    expect(sorted(texts(completer, 'select json_v'))).toEqual(sorted(['json_value', 'json_valid']))
  })

  // [排序]
  it('test_create_table_like_completion', () => {
    expect(sorted(texts(completer, 'CREATE TABLE foo LIKE ti'))).toEqual(
      sorted([
        'time_zone',
        'time_zone_name',
        'time_zone_transition',
        'time_zone_leap_second',
        'time_zone_transition_type'
      ])
    )
  })

  it.each([
    ['test_string_no_completion', 'select "json', undefined],
    ['test_string_no_completion_single_quote', "select 'json", undefined],
    ['test_string_no_completion_spaces', 'select "nocomplete json', undefined],
    ['test_string_no_completion_spaces_inner_1', 'select "json nocomplete', 'select "json'.length],
    ['test_string_no_completion_spaces_inner_2', 'select "json nocomplete', 'select "json '.length],
    ['test_string_no_completion_backtick', 'select * from "`t', undefined]
  ])('%s', (_, text, position) => {
    expect(texts(completer, text, position)).toEqual([])
  })

  // [未吸收]：mycli 给所有候选加反引号；这里照 pgcli，替换掉输入的反引号，名字要加引号时才加（比较时去掉反引号）。
  // 原测试的 Time_zone_id、first_name 是 mycli 在语句里没有表时列出的列（[未吸收]）。[匹配]：只比开头就与输入相同的，
  // 其余是 mycli 的 regex 限距与 rapidfuzz 匹配出的。[排序]
  it.each([
    [
      'test_backticked_column_completion',
      'select `Tim',
      [
        '`time`',
        '`timediff`',
        '`timestamp`',
        '`time_format`',
        '`time_to_sec`',
        '`Time_zone_id`',
        '`timestampadd`',
        '`timestampdiff`',
        '`datetime`',
        '`optimize`',
        '`optimizer_costs`',
        '`utc_time`',
        '`utc_timestamp`',
        '`current_time`',
        '`current_timestamp`',
        '`localtime`',
        '`localtimestamp`',
        '`password_lock_time`'
      ],
      ['Time_zone_id']
    ],
    [
      'test_backticked_column_completion_component',
      'select `com',
      [
        '`commit`',
        '`comment`',
        '`compact`',
        '`compress`',
        '`committed`',
        '`component`',
        '`completion`',
        '`compressed`',
        '`compression`',
        '`column`',
        '`column_format`',
        '`column_name`',
        '`columns`',
        '`second_microsecond`',
        '`uncommitted`'
      ],
      []
    ],
    [
      'test_backticked_column_completion_two_character',
      'select `f',
      [
        '`for`',
        '`from`',
        '`fast`',
        '`file`',
        '`full`',
        '`floor`',
        '`false`',
        '`field`',
        '`fixed`',
        '`float`',
        '`fetch`',
        '`files`',
        '`first`',
        '`flush`',
        '`force`',
        '`found`',
        '`format`',
        '`float4`',
        '`float8`',
        '`factor`',
        '`faults`',
        '`fields`',
        '`filter`',
        '`finish`',
        '`follows`',
        '`foreign`',
        '`fulltext`',
        '`function`',
        '`from_days`',
        '`file_name`',
        '`following`',
        '`first_name`',
        '`found_rows`',
        '`find_in_set`',
        '`first_value`',
        '`from_base64`',
        '`from_vector`',
        '`file_format`',
        '`file_prefix`',
        '`foreign key`',
        '`format_bytes`',
        '`file_pattern`',
        '`from_unixtime`',
        '`file_block_size`',
        '`format_pico_time`',
        '`failed_login_attempts`',
        '`left join`',
        '`after`',
        '`before`',
        '`default`',
        '`default_auth`',
        '`definer`',
        '`definition`',
        '`enforced`',
        '`if`',
        '`infile`',
        '`left`',
        '`logfile`',
        '`of`',
        '`off`',
        '`offset`',
        '`outfile`',
        '`profile`',
        '`profiles`',
        '`reference`',
        '`references`'
      ],
      ['first_name']
    ],
    [
      'test_backticked_column_completion_three_character',
      'select `fi',
      [
        '`file`',
        '`field`',
        '`fixed`',
        '`files`',
        '`first`',
        '`fields`',
        '`filter`',
        '`finish`',
        '`file_name`',
        '`first_name`',
        '`find_in_set`',
        '`first_value`',
        '`file_format`',
        '`file_prefix`',
        '`file_pattern`',
        '`file_block_size`',
        '`definer`',
        '`definition`',
        '`failed_login_attempts`',
        '`foreign`',
        '`infile`',
        '`logfile`',
        '`outfile`',
        '`profile`',
        '`profiles`',
        '`foreign key`'
      ],
      ['first_name']
    ],
    [
      'test_backticked_column_completion_four_character',
      'select `fir',
      ['`first`', '`first_name`', '`first_value`', '`definer`', '`filter`'],
      ['first_name']
    ]
  ])('%s', (_, text, expected, nakedSelectColumns) => {
    const typed = text.slice(text.lastIndexOf('`') + 1).toLowerCase()
    const got = completer.getCompletions(text, text.length)
    expect(got.every((c) => c.startPosition === -(typed.length + 1))).toBe(true)
    expect(sorted(got.map((c) => unquote(c.text)))).toEqual(
      sorted(
        expected
          .map(unquote)
          .filter((x) => x.toLowerCase().startsWith(typed) && !nakedSelectColumns.includes(x))
      )
    )
  })

  it('test_backticked_table_completion_required', () => {
    expect(result(completer, 'select ABC from `rév')).toEqual([['`réveillé`', -4]])
  })

  // [未吸收]：mycli 给所有候选加反引号，这里只给要加的（`test 2`；比较时去掉反引号）；[匹配]：select 是 pgcli 不限
  // 间距的模糊匹配多出的。[排序]
  it('test_backticked_table_completion_not_required', () => {
    const expected = [
      '`test`',
      '`test 2`',
      '`time_zone`',
      '`time_zone_name`',
      '`time_zone_transition`',
      '`time_zone_leap_second`',
      '`time_zone_transition_type`'
    ]
    const got = completer.getCompletions('select * from `t', 'select * from `t'.length)
    expect(got.every((c) => c.startPosition === -2)).toBe(true)
    expect(sorted(got.map((c) => unquote(c.text)))).toEqual(
      sorted([...expected.map(unquote), 'select'])
    )
  })

  // fixture fk_completer：orders.user_id → users.id；tags 没有外键
  describe('外键（fk_completer）', () => {
    const fk = (
      childtable: string,
      childcolumn: string,
      parenttable: string,
      parentcolumn: string
    ): CompletionForeignKey => ({
      childschema: 'test',
      childtable,
      childcolumn,
      parentschema: 'test',
      parenttable,
      parentcolumn
    })
    const columns = (...names: string[]): { name: string; datatype: null }[] =>
      names.map((name) => ({ name, datatype: null }))
    const fkCompleter = new SqlCompleter('mysql', {
      databases: ['test'],
      searchPath: ['test'],
      foreignKeys: [fk('orders', 'user_id', 'users', 'id')],
      schemas: [
        {
          ...emptySchema('test'),
          tables: [
            { name: 'orders', columns: columns('id', 'user_id', 'ordered_date', 'status') },
            { name: 'users', columns: columns('id', 'email', 'first_name') },
            { name: 'tags', columns: columns('id', 'name') }
          ]
        }
      ]
    })
    const fkTexts = (text: string): string[] => texts(fkCompleter, text)

    // [未吸收]：mycli 把有外键关系的表排在前面；pgcli 另给一条带 ON 条件的 join 候选，排在各表之前
    it.each([
      [
        'test_join_suggests_fk_table_before_unrelated',
        'SELECT * FROM orders JOIN ',
        'users',
        'users ON users.id = orders.user_id'
      ],
      [
        'test_join_fk_lookup_is_bidirectional',
        'SELECT * FROM users JOIN ',
        'orders',
        'orders ON orders.user_id = users.id'
      ]
    ])('%s', (_, text, related, join) => {
      const got = fkTexts(text)
      expect(got).toContain(related)
      expect(got).toContain('tags')
      expect(got.indexOf(join)).toBeGreaterThanOrEqual(0)
      expect(got.indexOf(join)).toBeLessThan(got.indexOf('tags'))
    })

    it('test_join_unrelated_table_still_suggests_all_tables', () => {
      expect(fkTexts('SELECT * FROM tags JOIN ')).toEqual(
        expect.arrayContaining(['orders', 'users'])
      )
    })

    // [组合]：pgcli 的条件写成「后一张表 = 前一张表」（原测试为 o.user_id = u.id、orders.user_id = users.id）
    it.each([
      [
        'test_on_suggests_fk_condition_with_aliases',
        'SELECT * FROM orders o JOIN users u ON ',
        'u.id = o.user_id'
      ],
      [
        'test_on_suggests_fk_condition_without_aliases',
        'SELECT * FROM orders JOIN users ON ',
        'users.id = orders.user_id'
      ],
      [
        'test_on_partial_text_filters_fk_condition',
        'SELECT * FROM orders JOIN users ON ord',
        'users.id = orders.user_id'
      ]
    ])('%s', (_, text, condition) => {
      expect(fkTexts(text)).toContain(condition)
    })

    it('test_on_fk_condition_appears_before_aliases', () => {
      const got = fkTexts('SELECT * FROM orders o JOIN users u ON ')
      expect(got.indexOf('u.id = o.user_id')).toBeGreaterThanOrEqual(0)
      expect(got.indexOf('u.id = o.user_id')).toBeLessThan(got.indexOf('o'))
    })

    // 原测试直接调 _fk_join_conditions(表)，这里把这些表写进语句，看 ON 之后的外键条件（fk join）。[组合]：次序同上
    it.each([
      [
        'test_fk_join_conditions_with_aliases',
        'SELECT * FROM orders o JOIN users u ON ',
        ['u.id = o.user_id']
      ],
      [
        'test_fk_join_conditions_without_aliases',
        'SELECT * FROM orders JOIN users ON ',
        ['users.id = orders.user_id']
      ],
      ['test_fk_join_conditions_single_table_yields_nothing', 'SELECT * FROM orders o ON ', []],
      [
        'test_fk_join_conditions_unrelated_tables_yields_nothing',
        'SELECT * FROM orders o JOIN tags t ON ',
        []
      ]
    ])('%s', (_, text, conditions) => {
      expect(ofMeta(fkCompleter, 'fk join', text)).toEqual(conditions)
    })

    // [组合]：没有外键时 pgcli 仍给同名同类型列的连接条件 t.id = o.id（name join）；原测试断言没有带 = 的候选
    it('test_on_no_fk_condition_for_unrelated_join', () => {
      const text = 'SELECT * FROM orders o JOIN tags t ON '
      const got = fkCompleter.getCompletions(text, text.length)
      expect(got.filter((c) => c.text.includes('=')).map((c) => [c.text, c.displayMeta])).toEqual([
        ['t.id = o.id', 'name join']
      ])
      expect(got.map((c) => c.text)).toEqual(expect.arrayContaining(['o', 't']))
    })

    // 原测试直接调 _fk_join_conditions，这里经 ON 之后的补全断言；外键两端的列要在表结构里（pgcli
    // extend_foreignkeys 丢掉找不到列的外键），所以另给了两张表。[组合]：条件的次序同上
    it('test_fk_reserved_column_names_are_escaped', () => {
      const c = new SqlCompleter('mysql', {
        databases: [],
        searchPath: ['test'],
        foreignKeys: [fk('orders', 'order', 'users', 'select')],
        schemas: [
          {
            ...emptySchema('test'),
            tables: [
              { name: 'orders', columns: columns('order') },
              { name: 'users', columns: columns('select') }
            ]
          }
        ]
      })
      expect(texts(c, 'SELECT * FROM orders o JOIN users u ON ')).toContain(
        'u.`select` = o.`order`'
      )
    })

    // 原测试直接调 _fk_join_conditions：别的库里的表不参与外键条件
    it('test_fk_conditions_ignore_cross_schema_tables', () => {
      const got = fkTexts('SELECT * FROM other_db.orders o JOIN users u ON ')
      expect(got.some((t) => t.includes('='))).toBe(false)
    })

    it('test_join_priority_ignores_cross_schema_table', () => {
      expect(fkTexts('SELECT * FROM other_db.orders JOIN ')).toEqual(
        fkTexts('SELECT * FROM tags JOIN ')
      )
    })
  })
})

// —— litecli tests/test_smart_completion_public_schema_only.py ——
//
// 期望值取原测试。与原测试不同的地方同上一段的几类：
// [排序] litecli 各类候选各自按名字排序后依次列出；这里照 pgcli，只比各类的集合（次序相同的照原样比）。
// [组合] 照 pgcli：SELECT 列表里不给表别名；函数参数里另给函数与关键字；ON 之后另有同名同类型列的连接条件；FROM
//        之后另给模式（litecli 也给 schema 建议，但 get_completions 没有对应的分支，不出候选）。
// [未吸收] litecli 独有的：每张表的 '*' 列。
// 未翻译：命令行专用的 test_file_name_completion（source 的文件路径）。
describe('litecli tests/test_smart_completion_public_schema_only.py', () => {
  const lite = completionDialect('sqlite')
  const metadata: Record<string, string[]> = {
    users: ['id', 'email', 'first_name', 'last_name'],
    orders: ['id', 'ordered_date', 'status'],
    select: ['id', 'insert', 'ABC'],
    réveillé: ['id', 'insert', 'ABC']
  }
  const completer = new SqlCompleter('sqlite', {
    databases: [],
    searchPath: ['test'],
    foreignKeys: [],
    schemas: [
      {
        name: 'test',
        tables: Object.entries(metadata).map(([name, cols]) => ({
          name,
          columns: cols.map((col) => ({ name: col, datatype: null }))
        })),
        views: [],
        functions: [],
        datatypes: []
      }
    ]
  })
  const result = (text: string, position = text.length): [string, number][] =>
    completer.getCompletions(text, position).map((x) => [x.text, x.startPosition])
  const texts = (text: string, position = text.length): string[] =>
    completer.getCompletions(text, position).map((x) => x.text)
  const ofMeta = (meta: string, text: string, position = text.length): string[] =>
    completer
      .getCompletions(text, position)
      .filter((x) => x.displayMeta === meta)
      .map((x) => x.text)
  const sorted = <T>(xs: readonly T[]): T[] => [...xs].sort()
  const at0 = (xs: string[]): [string, number][] => xs.map((x) => [x, 0])
  /** litecli 的 completer.keywords（输入为空时为大写），按光标所在子句去掉 Tabularis 隐藏的 */
  const keywords = (textBeforeCursor: string): string[] => {
    const clause = sqlClauseAt(textBeforeCursor, lite)
    return lite.keywords.filter((k) => keywordAllowed(clause, k)).map((k) => k.toUpperCase())
  }
  const functions = lite.functions.map((f) => f.toUpperCase())
  const usersColumns = ['email', 'first_name', 'id', 'last_name']

  it('test_escape_name', () => {
    for (const [name, expected] of [
      // 大写的名字不加引号
      ['BAR', 'BAR'],
      // 要加引号，以反引号开头
      ['2025todos', '`2025todos`'],
      ['people', 'people'],
      // 带下划线的不加引号
      ['django_users', 'django_users']
    ]) {
      expect(completer.escapeName(name!)).toBe(expected)
    }
  })

  // 改动：关键字按「语句开头」过滤
  it('test_empty_string_completion', () => {
    expect(sorted(texts(''))).toEqual(sorted(keywords('')))
  })

  it('test_select_keyword_completion', () => {
    expect(result('SEL')).toEqual([['SELECT', -3]])
  })

  // [组合]：pgcli 另给模式 test。[排序]
  it.each(['test_table_completion', 'test_table_names_after_from'])('%s', () => {
    const text = 'SELECT * FROM '
    expect(sorted(ofMeta('table', text))).toEqual(
      sorted(['`réveillé`', '`select`', 'orders', 'users'])
    )
    expect(ofMeta('schema', text)).toEqual(['test'])
  })

  it('test_function_name_completion', () => {
    expect(result('SELECT MA')).toEqual([
      ['MAX', -2],
      ['MATCH', -2]
    ])
  })

  // [未吸收]：'*' 列；[组合]：不给表别名（users、u）。[排序]：函数与关键字只比集合
  it.each([
    ['test_suggested_column_names', 'SELECT  from users', 'SELECT '],
    ['test_suggested_multiple_column_names', 'SELECT id,  from users u', 'SELECT id, ']
  ])('%s', (_, text, before) => {
    const position = before.length
    expect(ofMeta('column', text, position)).toEqual(usersColumns)
    expect(sorted(ofMeta('function', text, position))).toEqual(sorted(functions))
    expect(sorted(ofMeta('keyword', text, position))).toEqual(sorted(keywords(before)))
  })

  // [组合]：pgcli 在函数参数里另给函数与关键字（_suggest_expression）；[未吸收]：'*' 列
  it('test_suggested_column_names_in_function', () => {
    expect(ofMeta('column', 'SELECT MAX( from users', 'SELECT MAX('.length)).toEqual(usersColumns)
  })

  // [未吸收]：'*' 列
  it.each([
    ['test_suggested_column_names_with_table_dot', 'SELECT users. from users', 'SELECT users.'],
    ['test_suggested_column_names_with_alias', 'SELECT u. from users u', 'SELECT u.'],
    [
      'test_suggested_multiple_column_names_with_alias',
      'SELECT u.id, u. from users u',
      'SELECT u.id, u.'
    ],
    [
      'test_suggested_multiple_column_names_with_dot',
      'SELECT users.id, users. from users u',
      'SELECT users.id, users.'
    ]
  ])('%s', (_, text, before) => {
    expect(result(text, before.length)).toEqual(at0(usersColumns))
  })

  // [组合]：pgcli 另给同名同类型列的连接条件（两张表都有 id）
  it('test_suggested_aliases_after_on', () => {
    const text = 'SELECT u.name, o.id FROM users u JOIN orders o ON '
    expect(ofMeta('table alias', text)).toEqual(['o', 'u'])
    expect(texts(text)).toEqual(['o.id = u.id', 'o', 'u'])
  })

  it('test_suggested_aliases_after_on_right_side', () => {
    expect(result('SELECT u.name, o.id FROM users u JOIN orders o ON o.user_id = ')).toEqual(
      at0(['o', 'u'])
    )
  })

  // [组合]：pgcli 另给同名同类型列的连接条件
  it('test_suggested_tables_after_on', () => {
    const text = 'SELECT users.name, orders.id FROM users JOIN orders ON '
    expect(ofMeta('table alias', text)).toEqual(['orders', 'users'])
    expect(texts(text)).toEqual(['orders.id = users.id', 'orders', 'users'])
  })

  it('test_suggested_tables_after_on_right_side', () => {
    const text = 'SELECT users.name, orders.id FROM users JOIN orders ON orders.user_id = '
    expect(result(text)).toEqual(at0(['orders', 'users']))
  })

  // [未吸收]：'*' 列；[组合]：不给表别名（select、réveillé）。[排序]：litecli 按码点排（ABC、`insert`、id），pgcli 按去掉
  // 引号的小写名字排（ABC、id、`insert`），只比集合；函数与关键字只比集合
  it.each([
    ['test_auto_escaped_col_names', 'SELECT  from `select`'],
    ['test_un_escaped_table_names', 'SELECT  from réveillé']
  ])('%s', (_, text) => {
    const position = 'SELECT '.length
    expect(sorted(ofMeta('column', text, position))).toEqual(sorted(['ABC', '`insert`', 'id']))
    expect(sorted(ofMeta('function', text, position))).toEqual(sorted(functions))
    expect(sorted(ofMeta('keyword', text, position))).toEqual(sorted(keywords('SELECT ')))
  })
})
