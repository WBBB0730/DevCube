// 翻译自 pgcli tests/test_smart_completion_public_schema_only.py、test_smart_completion_multiple_schemata.py、
// test_fuzzy_completion.py、test_prioritization.py 与 tests/metadata.py（测试用的表结构与期望值的构造）。
// 与原测试的差别（逐条也标在用例旁）：
// - 关键字按 Tabularis 的 KEYWORD_ALLOWED_CLAUSES 过滤：期望的关键字列表同样按光标所在子句过滤（keywords(text)）；
// - 未翻译命令行专用的：反斜杠命令（test_list_functions_for_special、test_special_name_completion），空文字时的
//   特殊命令（test_empty_string_completion 只比关键字）。
// tests/test_pgcompleter.py 也在这里（未翻译的逐条标在该段开头）。
import { describe, expect, it } from 'vitest'
import type { CompletionColumn, CompletionSchema } from '@shared/data-source-query'
import {
  comparePriority,
  generateAlias,
  SqlCompleter,
  type Completion,
  type CompleterSettings
} from './completer'
import { completionDialect } from './dialects'
import { keywordAllowed, sqlClauseAt } from './keyword-clauses'
import { isLower } from './parseutils/tables'
import { PrevalenceCounter } from './prioritization'

const pg = completionDialect('postgresql')

// —— tests/metadata.py ——

type FuncTuple = [string, string[], string[], string[], string, boolean, boolean, boolean, boolean]
type FkTuple = [string, string, string, string, string, string]

interface TestMetadata {
  tables: Record<string, Record<string, string[]>>
  views?: Record<string, Record<string, string[]>>
  functions: Record<string, FuncTuple[]>
  datatypes: Record<string, string[]>
  foreignkeys: Record<string, FkTuple[]>
  /** (表, 列) → 默认值 */
  defaults?: Record<string, Record<string, string>>
}

/** metadata.py: escape */
const escape = (name: string): string =>
  !isLower(name) || name === 'select' || name === 'localtimestamp' ? `"${name}"` : name

/** metadata.py: completion */
const completion = (displayMeta: string, text: string, pos = 0, display = text): Completion => ({
  text,
  startPosition: pos,
  display,
  displayMeta
})
const fn = (text: string, pos = 0, display = text): Completion =>
  completion('function', text, pos, display)
const schema = (text: string, pos = 0): Completion => completion('schema', text, pos)
const table = (text: string, pos = 0): Completion => completion('table', text, pos)
const view = (text: string, pos = 0): Completion => completion('view', text, pos)
const column = (text: string, pos = 0): Completion => completion('column', text, pos)
const keyword = (text: string, pos = 0): Completion => completion('keyword', text, pos)
const datatype = (text: string, pos = 0): Completion => completion('datatype', text, pos)
const alias = (text: string, pos = 0): Completion => completion('table alias', text, pos)
const nameJoin = (text: string, pos = 0): Completion => completion('name join', text, pos)
const fkJoin = (text: string, pos = 0): Completion => completion('fk join', text, pos)
const join = (text: string, pos = 0): Completion => completion('join', text, pos)
/** metadata.py: wildcard_expansion */
const wildcardExpansion = (cols: string, pos = -1): Completion => ({
  text: cols,
  startPosition: pos,
  display: '*',
  displayMeta: 'columns'
})

/** tests/utils.py: completions_to_set——只比显示的文字与说明。 */
const completionsToSet = (completions: Completion[]): string[] =>
  [...new Set(completions.map((c) => JSON.stringify([c.display, c.displayMeta]))).values()].sort()

const qual = ['if_more_than_one_table', 'always'] as const
const noQual = ['if_more_than_one_table', 'never'] as const
type Qualify = CompleterSettings['qualifyColumns']

/** metadata.py: MetaData */
class MetaData {
  constructor(readonly metadata: TestMetadata) {}

  get completer(): SqlCompleter {
    return this.getCompleter()
  }

  builtinFunctions(pos = 0): Completion[] {
    return pg.functions.map((f) => fn(f, pos))
  }

  builtinDatatypes(pos = 0): Completion[] {
    return pg.datatypes.map((dt) => datatype(dt, pos))
  }

  /** 改动：按 text 光标处的子句去掉 Tabularis 隐藏的关键字。 */
  keywords(text: string, pos = 0): Completion[] {
    const clause = sqlClauseAt(text, pg)
    return pg.keywords.filter((kw) => keywordAllowed(clause, kw)).map((kw) => keyword(kw, pos))
  }

  columns(
    tbl: string,
    parent = 'public',
    typ: 'tables' | 'views' | 'functions' = 'tables',
    pos = 0
  ): Completion[] {
    const cols =
      typ === 'functions'
        ? this.metadata.functions[parent]!.find((x) => x[0] === tbl)![1]
        : this.metadata[typ]![parent]![tbl]!
    return cols.map((col) => column(escape(col), pos))
  }

  datatypes(parent = 'public', pos = 0): Completion[] {
    return (this.metadata.datatypes[parent] ?? []).map((x) => datatype(escape(x), pos))
  }

  tables(parent = 'public', pos = 0): Completion[] {
    return Object.keys(this.metadata.tables[parent] ?? {}).map((x) => table(escape(x), pos))
  }

  views(parent = 'public', pos = 0): Completion[] {
    return Object.keys(this.metadata.views?.[parent] ?? {}).map((x) => view(escape(x), pos))
  }

  functions(parent = 'public', pos = 0): Completion[] {
    return (this.metadata.functions[parent] ?? []).map((x) => {
      const args = x[1].filter((_, i) => ['b', 'i'].includes(x[3][i]!))
      return fn(
        escape(x[0]) + '(' + args.map((a) => a + ' := ').join(', ') + ')',
        pos,
        escape(x[0]) + '(' + args.join(', ') + ')'
      )
    })
  }

  schemas(pos = 0): Completion[] {
    const schemas = new Set(
      Object.values(this.metadata).flatMap((kind) => Object.keys(kind as Record<string, unknown>))
    )
    return [...schemas].map((s) => schema(escape(s), pos))
  }

  functionsAndKeywords(text: string, parent = 'public', pos = 0): Completion[] {
    return [
      ...this.functions(parent, pos),
      ...this.builtinFunctions(pos),
      ...this.keywords(text, pos)
    ]
  }

  /** 这里的筛选参数只对列起作用 */
  columnsFunctionsAndKeywords(
    text: string,
    tbl: string,
    parent = 'public',
    typ: 'tables' | 'views' | 'functions' = 'tables',
    pos = 0
  ): Completion[] {
    return [
      ...this.functionsAndKeywords(text, 'public', pos),
      ...this.columns(tbl, parent, typ, pos)
    ]
  }

  fromClauseItems(parent = 'public', pos = 0): Completion[] {
    return [...this.functions(parent, pos), ...this.views(parent, pos), ...this.tables(parent, pos)]
  }

  schemasAndFromClauseItems(parent = 'public', pos = 0): Completion[] {
    return [...this.fromClauseItems(parent, pos), ...this.schemas(pos)]
  }

  types(parent = 'public', pos = 0): Completion[] {
    return [...this.datatypes(parent, pos), ...this.tables(parent, pos)]
  }

  /** metadata.py: MetaData.get_completers——按 casing、search_path 过滤、别名、列的限定组合出补全器。 */
  completersOf(casingWords: readonly string[]) {
    return ({
      casing,
      filtr,
      aliasing,
      qualify
    }: {
      casing?: boolean
      filtr?: boolean
      aliasing?: boolean
      qualify?: readonly Qualify[]
    } = {}): [string, SqlCompleter][] => {
      const out: [string, SqlCompleter][] = []
      for (const c of casing === undefined ? [true, false] : [casing]) {
        for (const f of filtr === undefined ? [true, false] : [filtr]) {
          for (const a of aliasing === undefined ? [true, false] : [aliasing]) {
            for (const q of qualify ?? (['always', 'if_more_than_one_table', 'never'] as const)) {
              out.push([
                `casing=${c} filtr=${f} aliasing=${a} qualify=${q}`,
                this.getCompleter(
                  { searchPathFilter: f, generateAliases: a, qualifyColumns: q },
                  c ? casingWords : undefined
                )
              ])
            }
          }
        }
      }
      return out
    }
  }

  /** metadata.py: MetaData.get_completer */
  getCompleter(
    settings: Partial<CompleterSettings> = {},
    casing?: readonly string[],
    searchPath = ['public']
  ): SqlCompleter {
    const { metadata } = this
    const defaults = metadata.defaults ?? {}
    const makeCols = (sch: string, tbl: string, cols: string[]): CompletionColumn[] =>
      cols.map((col) => {
        const def = defaults[sch]?.[`${tbl}\u0000${col}`]
        return { name: col, datatype: 'text', hasDefault: def !== undefined, default: def ?? null }
      })
    const schemaNames = Object.keys(metadata.tables)
    const input: CompletionSchema = {
      databases: [],
      schemas: schemaNames.map((sch) => ({
        name: sch,
        tables: Object.entries(metadata.tables[sch] ?? {}).map(([name, cols]) => ({
          name,
          columns: makeCols(sch, name, cols)
        })),
        views: Object.entries(metadata.views?.[sch] ?? {}).map(([name, cols]) => ({
          name,
          columns: makeCols(sch, name, cols)
        })),
        functions: (metadata.functions[sch] ?? []).map((f) => ({
          funcName: f[0],
          argNames: f[1],
          argTypes: f[2],
          argModes: f[3],
          returnType: f[4],
          isAggregate: f[5],
          isWindow: f[6],
          isSetReturning: f[7],
          isExtension: f[8],
          argDefaults: null
        })),
        datatypes: metadata.datatypes[sch] ?? []
      })),
      searchPath,
      foreignKeys: Object.values(metadata.foreignkeys)
        .flat()
        .map(([parentschema, parenttable, parentcolumn, childschema, childtable, childcolumn]) => ({
          parentschema,
          parenttable,
          parentcolumn,
          childschema,
          childtable,
          childcolumn
        }))
    }
    return new SqlCompleter('postgresql', input, { ...settings, casing: casing ?? [] })
  }
}

/** metadata.py: get_result（只留 pgcli 的 Completion 有的四项；列的类型另测，见 Completion.datatype） */
const getResult = (completer: SqlCompleter, text: string, position?: number): Completion[] =>
  completer
    .getCompletions(text, position ?? text.length)
    .map(({ text, startPosition, display, displayMeta }) => ({
      text,
      startPosition,
      display,
      displayMeta
    }))

/** 在结果里的位置（同 Python 的 list.index，按各字段比较）。 */
const indexOf = (result: Completion[], c: Completion): number =>
  result.findIndex(
    (x) =>
      x.text === c.text &&
      x.startPosition === c.startPosition &&
      x.display === c.display &&
      x.displayMeta === c.displayMeta
  )

/** 包含关系（Python 的 set >=） */
const expectSuperset = (result: Completion[], expected: Completion[]): void => {
  const set = new Set(completionsToSet(result))
  for (const e of completionsToSet(expected)) expect(set).toContain(e)
}

// —— tests/test_smart_completion_public_schema_only.py ——

describe('pgcli tests/test_smart_completion_public_schema_only.py', () => {
  const metadata: TestMetadata = {
    tables: {
      public: {
        users: ['id', 'parentid', 'email', 'first_name', 'last_name'],
        Users: ['userid', 'username'],
        orders: ['id', 'ordered_date', 'status', 'email'],
        select: ['id', 'insert', 'ABC']
      }
    },
    views: { public: { user_emails: ['id', 'email'], functions: ['function'] } },
    functions: {
      public: [
        ['custom_fun', [], [], [], '', false, false, false, false],
        ['_custom_fun', [], [], [], '', false, false, false, false],
        ['custom_func1', [], [], [], '', false, false, false, false],
        ['custom_func2', [], [], [], '', false, false, false, false],
        [
          'set_returning_func',
          ['x', 'y'],
          ['integer', 'integer'],
          ['b', 'b'],
          '',
          false,
          false,
          true,
          false
        ]
      ]
    },
    datatypes: { public: ['custom_type1', 'custom_type2'] },
    foreignkeys: {
      public: [
        ['public', 'users', 'id', 'public', 'users', 'parentid'],
        ['public', 'users', 'id', 'public', 'Users', 'userid']
      ]
    }
  }
  const testdata = new MetaData(metadata)
  const casedUsersColNames = ['ID', 'PARENTID', 'Email', 'First_Name', 'last_name']
  const casedUsers2ColNames = ['UserID', 'UserName']
  const casedFuncNames = [
    'Custom_Fun',
    '_custom_fun',
    'Custom_Func1',
    'custom_func2',
    'set_returning_func'
  ]
  const casedTblNames = ['Users', 'Orders']
  const casedViewNames = ['User_Emails', 'Functions']
  const casing = [
    'SELECT',
    'PUBLIC',
    ...casedFuncNames,
    ...casedTblNames,
    ...casedViewNames,
    ...casedUsersColNames,
    ...casedUsers2ColNames
  ]
  const casedFuncs = [
    ...['Custom_Fun()', '_custom_fun()', 'Custom_Func1()', 'custom_func2()'].map((f) => fn(f)),
    fn('set_returning_func(x := , y := )', 0, 'set_returning_func(x, y)')
  ]
  const casedTbls = [...casedTblNames, '"Users"', '"select"'].map((t) => table(t))
  const casedRels = [...casedViewNames.map((t) => view(t)), ...casedFuncs, ...casedTbls]
  const casedUsersCols = casedUsersColNames.map((c) => column(c))
  const aliasedRels = [
    ...['users u', '"Users" U', 'orders o', '"select" s'].map((t) => table(t)),
    view('user_emails ue'),
    view('functions f'),
    ...['_custom_fun() cf', 'custom_fun() cf', 'custom_func1() cf', 'custom_func2() cf'].map((f) =>
      fn(f)
    ),
    fn('set_returning_func(x := , y := ) srf', 0, 'set_returning_func(x, y) srf')
  ]
  const casedAliasedRels = [
    ...['Users U', '"Users" U', 'Orders O', '"select" s'].map((t) => table(t)),
    view('User_Emails UE'),
    view('Functions F'),
    ...['_custom_fun() cf', 'Custom_Fun() CF', 'Custom_Func1() CF', 'custom_func2() cf'].map((f) =>
      fn(f)
    ),
    fn('set_returning_func(x := , y := ) srf', 0, 'set_returning_func(x, y) srf')
  ]
  const completers = testdata.completersOf(casing)

  // 只要不出错
  it.each(completers())('test_function_column_name: %s', (_, completer) => {
    const text = 'SELECT * FROM Functions WHERE function:text'
    for (let l = 'SELECT * FROM Functions WHERE function:'.length; l <= text.length; l++) {
      expect(getResult(completer, text.slice(0, l))).toEqual([])
    }
  })

  describe.each(['ALTER', 'DROP', 'CREATE', 'CREATE OR REPLACE'])('action %s', (action) => {
    it.each(completers())('test_drop_alter_function: %s', (_, completer) => {
      expect(getResult(completer, action + ' FUNCTION set_ret')).toEqual([
        fn('set_returning_func(x integer, y integer)', -'set_ret'.length)
      ])
    })
  })

  // 改动：原测试另有特殊命令（\x 这类命令行命令），没有移植；关键字按「语句开头」过滤。
  it.each(completers())('test_empty_string_completion: %s', (_, completer) => {
    expect(completionsToSet(getResult(completer, ''))).toEqual(
      completionsToSet(testdata.keywords(''))
    )
  })

  it.each(completers())('test_select_keyword_completion: %s', (_, completer) => {
    expect(completionsToSet(getResult(completer, 'SEL'))).toEqual(
      completionsToSet([keyword('SELECT', -3)])
    )
  })

  it.each(completers())('test_builtin_function_name_completion: %s', (_, completer) => {
    expect(completionsToSet(getResult(completer, 'SELECT MA'))).toEqual(
      completionsToSet([
        fn('MAKE_DATE', -2),
        fn('MAKE_INTERVAL', -2),
        fn('MAKE_TIME', -2),
        fn('MAKE_TIMESTAMP', -2),
        fn('MAKE_TIMESTAMPTZ', -2),
        fn('MASKLEN', -2),
        fn('MAX', -2),
        keyword('MAXEXTENTS', -2),
        keyword('MATERIALIZED VIEW', -2)
      ])
    )
  })

  it.each(completers())('test_builtin_version_function_completion: %s', (_, completer) => {
    expect(completionsToSet(getResult(completer, 'SELECT VE'))).toEqual(
      completionsToSet([fn('VERSION', -2)])
    )
  })

  it.each(completers())('test_builtin_function_matches_only_at_start: %s', (_, completer) => {
    expect(getResult(completer, 'SELECT IN').map((c) => c.text)).not.toContain('MIN')
  })

  // 改动：另有 CURRENT_USER、CURRENT_SCHEMA——补全另补了 pgcli 关键字表漏掉的常用关键字（dialects.ts 的 PG_MISSING_KEYWORDS）。
  it.each(completers({ casing: false, aliasing: false }))(
    'test_user_function_name_completion: %s',
    (_, completer) => {
      expect(completionsToSet(getResult(completer, 'SELECT cu'))).toEqual(
        completionsToSet([
          fn('custom_fun()', -2),
          fn('_custom_fun()', -2),
          fn('custom_func1()', -2),
          fn('custom_func2()', -2),
          fn('CURRENT_DATE', -2),
          fn('CURRENT_TIMESTAMP', -2),
          fn('CUME_DIST', -2),
          fn('CURRENT_TIME', -2),
          keyword('CURRENT', -2),
          keyword('CURRENT_USER', -2),
          keyword('CURRENT_SCHEMA', -2)
        ])
      )
    }
  )

  it.each(completers({ casing: false, aliasing: false }))(
    'test_user_function_name_completion_matches_anywhere: %s',
    (_, completer) => {
      expect(completionsToSet(getResult(completer, 'SELECT om'))).toEqual(
        completionsToSet([
          fn('custom_fun()', -2),
          fn('_custom_fun()', -2),
          fn('custom_func1()', -2),
          fn('custom_func2()', -2)
        ])
      )
    }
  )

  // 未翻译：test_list_functions_for_special（\df 是命令行的反斜杠命令）。

  it.each(completers({ casing: false, qualify: noQual }))(
    'test_suggested_column_names_from_visible_table: %s',
    (_, completer) => {
      const result = getResult(completer, 'SELECT  from users', 'SELECT '.length)
      expect(completionsToSet(result)).toEqual(
        completionsToSet(testdata.columnsFunctionsAndKeywords('SELECT ', 'users'))
      )
    }
  )

  it.each(completers({ casing: true, qualify: noQual }))(
    'test_suggested_cased_column_names: %s',
    (_, completer) => {
      const result = getResult(completer, 'SELECT  from users', 'SELECT '.length)
      expect(completionsToSet(result)).toEqual(
        completionsToSet([
          ...casedFuncs,
          ...casedUsersCols,
          ...testdata.builtinFunctions(),
          ...testdata.keywords('SELECT ')
        ])
      )
    }
  )

  describe.each(['SELECT  from users', 'INSERT INTO Orders SELECT  from users'])(
    'text %s',
    (text) => {
      it.each(completers({ casing: false, qualify: noQual }))(
        'test_suggested_auto_qualified_column_names: %s',
        (_, completer) => {
          const position = text.indexOf('  ') + 1
          const cols = casedUsersColNames.map((c) => column(c.toLowerCase()))
          expect(completionsToSet(getResult(completer, text, position))).toEqual(
            completionsToSet([...cols, ...testdata.functionsAndKeywords(text.slice(0, position))])
          )
        }
      )
    }
  )

  describe.each([
    'SELECT  from users U NATURAL JOIN "Users"',
    'INSERT INTO Orders SELECT  from users U NATURAL JOIN "Users"'
  ])('text %s', (text) => {
    it.each(completers({ casing: false, qualify: qual }))(
      'test_suggested_auto_qualified_column_names_two_tables: %s',
      (_, completer) => {
        const position = text.indexOf('  ') + 1
        const cols = [
          ...casedUsersColNames.map((c) => column('U.' + c.toLowerCase())),
          ...casedUsers2ColNames.map((c) => column('"Users".' + c.toLowerCase()))
        ]
        expect(completionsToSet(getResult(completer, text, position))).toEqual(
          completionsToSet([...cols, ...testdata.functionsAndKeywords(text.slice(0, position))])
        )
      }
    )
  })

  describe.each(['UPDATE users SET ', 'INSERT INTO users('])('text %s', (text) => {
    it.each(completers({ casing: true, qualify: ['always'] }))(
      'test_no_column_qualification: %s',
      (_, completer) => {
        expect(completionsToSet(getResult(completer, text))).toEqual(
          completionsToSet(casedUsersColNames.map((c) => column(c)))
        )
      }
    )
  })

  it.each(completers({ casing: true, qualify: ['always'] }))(
    'test_suggested_cased_always_qualified_column_names: %s',
    (_, completer) => {
      const cols = casedUsersColNames.map((c) => column('users.' + c))
      const result = getResult(completer, 'SELECT  from users', 'SELECT '.length)
      expect(completionsToSet(result)).toEqual(
        completionsToSet([
          ...casedFuncs,
          ...cols,
          ...testdata.builtinFunctions(),
          ...testdata.keywords('SELECT ')
        ])
      )
    }
  )

  it.each(completers({ casing: false, qualify: noQual }))(
    'test_suggested_column_names_in_function: %s',
    (_, completer) => {
      const result = getResult(completer, 'SELECT MAX( from users', 'SELECT MAX('.length)
      expect(completionsToSet(result)).toEqual(
        completionsToSet(testdata.columnsFunctionsAndKeywords('SELECT MAX(', 'users'))
      )
    }
  )

  it.each(completers({ casing: false }))(
    'test_suggested_column_names_with_table_dot: %s',
    (_, completer) => {
      const result = getResult(completer, 'SELECT users. from users', 'SELECT users.'.length)
      expect(completionsToSet(result)).toEqual(completionsToSet(testdata.columns('users')))
    }
  )

  it.each(completers({ casing: false }))(
    'test_suggested_column_names_with_alias: %s',
    (_, completer) => {
      const result = getResult(completer, 'SELECT u. from users u', 'SELECT u.'.length)
      expect(completionsToSet(result)).toEqual(completionsToSet(testdata.columns('users')))
    }
  )

  it.each(completers({ casing: false, qualify: noQual }))(
    'test_suggested_multiple_column_names: %s',
    (_, completer) => {
      const result = getResult(completer, 'SELECT id,  from users u', 'SELECT id, '.length)
      expect(completionsToSet(result)).toEqual(
        completionsToSet(testdata.columnsFunctionsAndKeywords('SELECT id, ', 'users'))
      )
    }
  )

  it.each(completers({ casing: false }))(
    'test_suggested_multiple_column_names_with_alias: %s',
    (_, completer) => {
      const result = getResult(completer, 'SELECT u.id, u. from users u', 'SELECT u.id, u.'.length)
      expect(completionsToSet(result)).toEqual(completionsToSet(testdata.columns('users')))
    }
  )

  it.each(completers({ casing: true }))(
    'test_suggested_cased_column_names_with_alias: %s',
    (_, completer) => {
      const result = getResult(completer, 'SELECT u.id, u. from users u', 'SELECT u.id, u.'.length)
      expect(completionsToSet(result)).toEqual(completionsToSet(casedUsersCols))
    }
  )

  it.each(completers({ casing: false }))(
    'test_suggested_multiple_column_names_with_dot: %s',
    (_, completer) => {
      const result = getResult(
        completer,
        'SELECT users.id, users. from users u',
        'SELECT users.id, users.'.length
      )
      expect(completionsToSet(result)).toEqual(completionsToSet(testdata.columns('users')))
    }
  )

  it.each(completers({ casing: false }))(
    'test_suggest_columns_after_three_way_join: %s',
    (_, completer) => {
      const text = `SELECT * FROM users u1
              INNER JOIN users u2 ON u1.id = u2.id
              INNER JOIN users u3 ON u2.id = u3.`
      expect(getResult(completer, text)).toContainEqual(column('id'))
    }
  )

  const joinConditionTexts = [
    'INSERT INTO orders SELECT * FROM users U JOIN "Users" U2 ON ',
    `INSERT INTO public.orders(orderid)
    SELECT * FROM users U JOIN "Users" U2 ON `,
    'SELECT * FROM users U JOIN "Users" U2 ON ',
    'SELECT * FROM users U INNER join "Users" U2 ON ',
    'SELECT * FROM USERS U right JOIN "Users" U2 ON ',
    'SELECT * FROM users U LEFT JOIN "Users" U2 ON ',
    'SELECT * FROM Users U FULL JOIN "Users" U2 ON ',
    'SELECT * FROM users U right outer join "Users" U2 ON ',
    'SELECT * FROM Users U LEFT OUTER JOIN "Users" U2 ON ',
    'SELECT * FROM users U FULL OUTER JOIN "Users" U2 ON ',
    `SELECT *
    FROM users U
    FULL OUTER JOIN "Users" U2 ON
    `
  ]

  describe.each(joinConditionTexts)('text %j', (text) => {
    it.each(completers({ casing: false }))('test_suggested_join_conditions: %s', (_, completer) => {
      expect(completionsToSet(getResult(completer, text))).toEqual(
        completionsToSet([alias('U'), alias('U2'), fkJoin('U2.userid = U.id')])
      )
    })

    it.each(completers({ casing: true }))('test_cased_join_conditions: %s', (_, completer) => {
      expect(completionsToSet(getResult(completer, text))).toEqual(
        completionsToSet([alias('U'), alias('U2'), fkJoin('U2.UserID = U.ID')])
      )
    })
  })

  it.each(completers({ casing: false }))(
    'test_suggested_join_conditions_with_same_table_twice: %s',
    (_, completer) => {
      const text = `SELECT *
    FROM users
    CROSS JOIN "Users"
    NATURAL JOIN users u
    JOIN "Users" u2 ON
    `
      expect(getResult(completer, text)).toEqual([
        fkJoin('u2.userid = u.id'),
        fkJoin('u2.userid = users.id'),
        nameJoin('u2.userid = "Users".userid'),
        nameJoin('u2.username = "Users".username'),
        alias('u'),
        alias('u2'),
        alias('users'),
        alias('"Users"')
      ])
    }
  )

  it.each(completers())(
    'test_suggested_join_conditions_with_invalid_qualifier: %s',
    (_, completer) => {
      expect(getResult(completer, 'SELECT * FROM users JOIN users u2 on foo.')).toEqual([])
    }
  )

  describe.each([
    ['SELECT * FROM users JOIN NonTable on ', 'NonTable'],
    ['SELECT * FROM users JOIN nontable nt on ', 'nt']
  ])('text %s', (text, ref) => {
    it.each(completers({ casing: false }))(
      'test_suggested_join_conditions_with_invalid_table: %s',
      (_, completer) => {
        expect(completionsToSet(getResult(completer, text))).toEqual(
          completionsToSet([alias('users'), alias(ref)])
        )
      }
    )
  })

  describe.each([
    'SELECT * FROM "Users" u JOIN u',
    'SELECT * FROM "Users" u JOIN uid',
    'SELECT * FROM "Users" u JOIN userid',
    'SELECT * FROM "Users" u JOIN id'
  ])('text %s', (text) => {
    it.each(completers({ casing: false, aliasing: false }))(
      'test_suggested_joins_fuzzy: %s',
      (_, completer) => {
        const lastWord = text.split(/\s+/).at(-1)!
        expect(getResult(completer, text)).toContainEqual(
          join('users ON users.id = u.userid', -lastWord.length)
        )
      }
    )
  })

  const joinTexts = [
    'SELECT * FROM Users JOIN ',
    `INSERT INTO "Users"
    SELECT *
    FROM Users
    INNER JOIN `,
    `INSERT INTO public."Users"(username)
    SELECT *
    FROM Users
    INNER JOIN `,
    `SELECT *
    FROM Users
    INNER JOIN `
  ]

  describe.each(joinTexts)('text %j', (text) => {
    it.each(completers({ casing: false, aliasing: false }))(
      'test_suggested_joins: %s',
      (_, completer) => {
        expect(completionsToSet(getResult(completer, text))).toEqual(
          completionsToSet([
            ...testdata.schemasAndFromClauseItems(),
            join('"Users" ON "Users".userid = Users.id'),
            join('users users2 ON users2.id = Users.parentid'),
            join('users users2 ON users2.parentid = Users.id')
          ])
        )
      }
    )

    it.each(completers({ casing: true, aliasing: false }))(
      'test_cased_joins: %s',
      (_, completer) => {
        expect(completionsToSet(getResult(completer, text))).toEqual(
          completionsToSet([
            schema('PUBLIC'),
            ...casedRels,
            join('"Users" ON "Users".UserID = Users.ID'),
            join('Users Users2 ON Users2.ID = Users.PARENTID'),
            join('Users Users2 ON Users2.PARENTID = Users.ID')
          ])
        )
      }
    )

    it.each(completers({ casing: false, aliasing: true }))(
      'test_aliased_joins: %s',
      (_, completer) => {
        expect(completionsToSet(getResult(completer, text))).toEqual(
          completionsToSet([
            ...testdata.schemas(),
            ...aliasedRels,
            join('"Users" U ON U.userid = Users.id'),
            join('users u ON u.id = Users.parentid'),
            join('users u ON u.parentid = Users.id')
          ])
        )
      }
    )
  })

  describe.each([
    'SELECT * FROM public."Users" JOIN ',
    'SELECT * FROM public."Users" RIGHT OUTER JOIN ',
    `SELECT *
    FROM public."Users"
    LEFT JOIN `
  ])('text %j', (text) => {
    it.each(completers({ casing: false, aliasing: false }))(
      'test_suggested_joins_quoted_schema_qualified_table: %s',
      (_, completer) => {
        expect(completionsToSet(getResult(completer, text))).toEqual(
          completionsToSet([
            ...testdata.schemasAndFromClauseItems(),
            join('public.users ON users.id = "Users".userid')
          ])
        )
      }
    )
  })

  describe.each([
    'SELECT u.name, o.id FROM users u JOIN orders o ON ',
    'SELECT u.name, o.id FROM users u JOIN orders o ON JOIN orders o2 ON'
  ])('text %s', (text) => {
    it.each(completers({ casing: false }))(
      'test_suggested_aliases_after_on: %s',
      (_, completer) => {
        const position = 'SELECT u.name, o.id FROM users u JOIN orders o ON '.length
        expect(completionsToSet(getResult(completer, text, position))).toEqual(
          completionsToSet([
            alias('u'),
            nameJoin('o.id = u.id'),
            nameJoin('o.email = u.email'),
            alias('o')
          ])
        )
      }
    )
  })

  describe.each([
    'SELECT u.name, o.id FROM users u JOIN orders o ON o.user_id = ',
    'SELECT u.name, o.id FROM users u JOIN orders o ON o.user_id =  JOIN orders o2 ON'
  ])('text %s', (text) => {
    it.each(completers())('test_suggested_aliases_after_on_right_side: %s', (_, completer) => {
      const position = 'SELECT u.name, o.id FROM users u JOIN orders o ON o.user_id = '.length
      expect(completionsToSet(getResult(completer, text, position))).toEqual(
        completionsToSet([alias('u'), alias('o')])
      )
    })
  })

  describe.each([
    'SELECT users.name, orders.id FROM users JOIN orders ON ',
    'SELECT users.name, orders.id FROM users JOIN orders ON JOIN orders orders2 ON'
  ])('text %s', (text) => {
    it.each(completers({ casing: false }))('test_suggested_tables_after_on: %s', (_, completer) => {
      const position = 'SELECT users.name, orders.id FROM users JOIN orders ON '.length
      expect(completionsToSet(getResult(completer, text, position))).toEqual(
        completionsToSet([
          nameJoin('orders.id = users.id'),
          nameJoin('orders.email = users.email'),
          alias('users'),
          alias('orders')
        ])
      )
    })
  })

  describe.each([
    'SELECT users.name, orders.id FROM users JOIN orders ON orders.user_id = JOIN orders orders2 ON',
    'SELECT users.name, orders.id FROM users JOIN orders ON orders.user_id = '
  ])('text %s', (text) => {
    it.each(completers({ casing: false }))(
      'test_suggested_tables_after_on_right_side: %s',
      (_, completer) => {
        const position = 'SELECT users.name, orders.id FROM users JOIN orders ON orders.user_id = '
          .length
        expect(completionsToSet(getResult(completer, text, position))).toEqual(
          completionsToSet([alias('users'), alias('orders')])
        )
      }
    )
  })

  describe.each([
    'SELECT * FROM users INNER JOIN orders USING (',
    'SELECT * FROM users INNER JOIN orders USING('
  ])('text %s', (text) => {
    it.each(completers({ casing: false }))(
      'test_join_using_suggests_common_columns: %s',
      (_, completer) => {
        expect(completionsToSet(getResult(completer, text))).toEqual(
          completionsToSet([column('id'), column('email')])
        )
      }
    )
  })

  describe.each([
    'SELECT * FROM users u1 JOIN users u2 USING (email) JOIN user_emails ue USING()',
    'SELECT * FROM users u1 JOIN users u2 USING(email) JOIN user_emails ue USING ()',
    'SELECT * FROM users u1 JOIN user_emails ue USING () JOIN users u2 ue USING(first_name, last_name)',
    'SELECT * FROM users u1 JOIN user_emails ue USING() JOIN users u2 ue USING (first_name, last_name)'
  ])('text %s', (text) => {
    it.each(completers({ casing: false }))(
      'test_join_using_suggests_from_last_table: %s',
      (_, completer) => {
        const position = text.indexOf('()') + 1
        expect(completionsToSet(getResult(completer, text, position))).toEqual(
          completionsToSet([column('id'), column('email')])
        )
      }
    )
  })

  describe.each([
    'SELECT * FROM users INNER JOIN orders USING (id,',
    'SELECT * FROM users INNER JOIN orders USING(id,'
  ])('text %s', (text) => {
    it.each(completers({ casing: false }))(
      'test_join_using_suggests_columns_after_first_column: %s',
      (_, completer) => {
        expect(completionsToSet(getResult(completer, text))).toEqual(
          completionsToSet([column('id'), column('email')])
        )
      }
    )
  })

  describe.each([
    'SELECT * FROM ',
    'SELECT * FROM users CROSS JOIN ',
    'SELECT * FROM users natural join '
  ])('text %s', (text) => {
    it.each(completers({ casing: false, aliasing: false }))(
      'test_table_names_after_from: %s',
      (_, completer) => {
        const result = getResult(completer, text)
        expect(completionsToSet(result)).toEqual(
          completionsToSet(testdata.schemasAndFromClauseItems())
        )
        expect(result.map((c) => c.text)).toEqual([
          'public',
          'orders',
          '"select"',
          'users',
          '"Users"',
          'functions',
          'user_emails',
          '_custom_fun()',
          'custom_fun()',
          'custom_func1()',
          'custom_func2()',
          'set_returning_func(x := , y := )'
        ])
      }
    )
  })

  it.each(completers({ casing: false, qualify: noQual }))(
    'test_auto_escaped_col_names: %s',
    (_, completer) => {
      const result = getResult(completer, 'SELECT  from "select"', 'SELECT '.length)
      expect(completionsToSet(result)).toEqual(
        completionsToSet(testdata.columnsFunctionsAndKeywords('SELECT ', 'select'))
      )
    }
  )

  it.each(completers({ aliasing: false }))(
    'test_allow_leading_double_quote_in_last_word: %s',
    (_, completer) => {
      expect(getResult(completer, 'SELECT * from "sele')).toContainEqual(table('"select"', -5))
    }
  )

  describe.each([
    'SELECT 1::',
    'CREATE TABLE foo (bar ',
    'CREATE FUNCTION foo (bar INT, baz ',
    'ALTER TABLE foo ALTER COLUMN bar TYPE '
  ])('text %s', (text) => {
    it.each(completers({ casing: false }))('test_suggest_datatype: %s', (_, completer) => {
      expect(completionsToSet(getResult(completer, text))).toEqual(
        completionsToSet([
          ...testdata.schemas(),
          ...testdata.types(),
          ...testdata.builtinDatatypes()
        ])
      )
    })
  })

  it.each(completers({ casing: false }))(
    'test_suggest_columns_from_escaped_table_alias: %s',
    (_, completer) => {
      expect(completionsToSet(getResult(completer, 'select * from "select" s where s.'))).toEqual(
        completionsToSet(testdata.columns('select'))
      )
    }
  )

  it.each(completers({ casing: false, qualify: noQual }))(
    'test_suggest_columns_from_set_returning_function: %s',
    (_, completer) => {
      const result = getResult(completer, 'select  from set_returning_func()', 'select '.length)
      expect(completionsToSet(result)).toEqual(
        completionsToSet(
          testdata.columnsFunctionsAndKeywords(
            'select ',
            'set_returning_func',
            'public',
            'functions'
          )
        )
      )
    }
  )

  it.each(completers({ casing: false }))(
    'test_suggest_columns_from_aliased_set_returning_function: %s',
    (_, completer) => {
      const result = getResult(
        completer,
        'select f. from set_returning_func() f',
        'select f.'.length
      )
      expect(completionsToSet(result)).toEqual(
        completionsToSet(testdata.columns('set_returning_func', 'public', 'functions'))
      )
    }
  )

  it.each(completers({ casing: false }))(
    'test_join_functions_using_suggests_common_columns: %s',
    (_, completer) => {
      const text = `SELECT * FROM set_returning_func() f1
              INNER JOIN set_returning_func() f2 USING (`
      expect(completionsToSet(getResult(completer, text))).toEqual(
        completionsToSet(testdata.columns('set_returning_func', 'public', 'functions'))
      )
    }
  )

  it.each(completers({ casing: false }))(
    'test_join_functions_on_suggests_columns_and_join_conditions: %s',
    (_, completer) => {
      const text = `SELECT * FROM set_returning_func() f1
              INNER JOIN set_returning_func() f2 ON f1.`
      expect(completionsToSet(getResult(completer, text))).toEqual(
        completionsToSet([
          nameJoin('y = f2.y'),
          nameJoin('x = f2.x'),
          ...testdata.columns('set_returning_func', 'public', 'functions')
        ])
      )
    }
  )

  it.each(completers())('test_learn_keywords: %s', (_, completer) => {
    completer.extendQueryHistory('CREATE VIEW v AS SELECT 1')
    // 用过一次 VIEW 之后，它排在其他 v 开头的关键字前面
    expect(getResult(completer, 'create v')[0]!.text).toBe('VIEW')
  })

  it.each(completers({ casing: false, aliasing: false }))(
    'test_learn_table_names: %s',
    (_, completer) => {
      completer.extendQueryHistory('SELECT * FROM users; SELECT * FROM orders; SELECT * FROM users')
      const completions = getResult(completer, 'SELECT * FROM ')
      // users 用得更多，排在 orders 前面
      expect(indexOf(completions, table('users'))).toBeLessThan(
        indexOf(completions, table('orders'))
      )
    }
  )

  it.each(completers({ casing: false, qualify: noQual }))(
    'test_columns_before_keywords: %s',
    (_, completer) => {
      const completions = getResult(completer, 'SELECT * FROM orders WHERE s')
      expect(indexOf(completions, column('status', -1))).toBeLessThan(
        indexOf(completions, keyword('SELECT', -1))
      )
    }
  )

  describe.each([
    'SELECT * FROM users',
    'INSERT INTO users SELECT * FROM users u',
    `INSERT INTO users(id, parentid, email, first_name, last_name)
    SELECT *
    FROM users u`
  ])('text %j', (text) => {
    it.each(completers({ casing: false, qualify: noQual }))(
      'test_wildcard_column_expansion: %s',
      (_, completer) => {
        const position = text.indexOf('*') + 1
        expect(getResult(completer, text, position)).toEqual([
          wildcardExpansion('id, parentid, email, first_name, last_name')
        ])
      }
    )
  })

  describe.each([
    'SELECT u.* FROM users u',
    'INSERT INTO public.users SELECT u.* FROM users u',
    `INSERT INTO users(id, parentid, email, first_name, last_name)
    SELECT u.*
    FROM users u`
  ])('text %j', (text) => {
    it.each(completers({ casing: false }))(
      'test_wildcard_column_expansion_with_alias: %s',
      (_, completer) => {
        const position = text.indexOf('*') + 1
        expect(getResult(completer, text, position)).toEqual([
          wildcardExpansion('id, u.parentid, u.email, u.first_name, u.last_name')
        ])
      }
    )
  })

  describe.each([
    [
      'SELECT users.* FROM users',
      'id, users.parentid, users.email, users.first_name, users.last_name'
    ],
    [
      'SELECT Users.* FROM Users',
      'id, Users.parentid, Users.email, Users.first_name, Users.last_name'
    ]
  ])('text %s', (text, expected) => {
    it.each(completers({ casing: false }))(
      'test_wildcard_column_expansion_with_table_qualifier: %s',
      (_, completer) => {
        expect(getResult(completer, text, 'SELECT users.*'.length)).toEqual([
          wildcardExpansion(expected)
        ])
      }
    )
  })

  it.each(completers({ casing: false, qualify: qual }))(
    'test_wildcard_column_expansion_with_two_tables: %s',
    (_, completer) => {
      const text = 'SELECT * FROM "select" JOIN users u ON true'
      const cols =
        '"select".id, "select".insert, "select"."ABC", u.id, u.parentid, u.email, u.first_name, u.last_name'
      expect(getResult(completer, text, 'SELECT *'.length)).toEqual([wildcardExpansion(cols)])
    }
  )

  it.each(completers({ casing: false }))(
    'test_wildcard_column_expansion_with_two_tables_and_parent: %s',
    (_, completer) => {
      const text = 'SELECT "select".* FROM "select" JOIN users u ON true'
      expect(getResult(completer, text, 'SELECT "select".*'.length)).toEqual([
        wildcardExpansion('id, "select".insert, "select"."ABC"')
      ])
    }
  )

  describe.each(['SELECT U. FROM Users U', 'SELECT U. FROM USERS U', 'SELECT U. FROM users U'])(
    'text %s',
    (text) => {
      it.each(completers({ casing: false }))(
        'test_suggest_columns_from_unquoted_table: %s',
        (_, completer) => {
          expect(completionsToSet(getResult(completer, text, 'SELECT U.'.length))).toEqual(
            completionsToSet(testdata.columns('users'))
          )
        }
      )
    }
  )

  it.each(completers({ casing: false }))(
    'test_suggest_columns_from_quoted_table: %s',
    (_, completer) => {
      expect(
        completionsToSet(getResult(completer, 'SELECT U. FROM "Users" U', 'SELECT U.'.length))
      ).toEqual(completionsToSet(testdata.columns('Users')))
    }
  )

  describe.each(['SELECT * FROM ', 'SELECT * FROM Orders o CROSS JOIN '])('text %s', (text) => {
    it.each(completers({ casing: false, aliasing: false }))(
      'test_schema_or_visible_table_completion: %s',
      (_, completer) => {
        expect(completionsToSet(getResult(completer, text))).toEqual(
          completionsToSet(testdata.schemasAndFromClauseItems())
        )
      }
    )
  })

  it.each(completers({ casing: false, aliasing: true }))(
    'test_table_aliases: %s',
    (_, completer) => {
      expect(completionsToSet(getResult(completer, 'SELECT * FROM '))).toEqual(
        completionsToSet([...testdata.schemas(), ...aliasedRels])
      )
    }
  )

  it.each(completers({ casing: false, aliasing: true }))(
    'test_duplicate_table_aliases: %s',
    (_, completer) => {
      expect(completionsToSet(getResult(completer, 'SELECT * FROM Orders o CROSS JOIN '))).toEqual(
        completionsToSet([
          ...testdata.schemas(),
          table('orders o2'),
          table('users u'),
          table('"Users" U'),
          table('"select" s'),
          view('user_emails ue'),
          view('functions f'),
          fn('_custom_fun() cf'),
          fn('custom_fun() cf'),
          fn('custom_func1() cf'),
          fn('custom_func2() cf'),
          fn('set_returning_func(x := , y := ) srf', 0, 'set_returning_func(x, y) srf')
        ])
      )
    }
  )

  it.each(completers({ casing: true, aliasing: true }))(
    'test_duplicate_aliases_with_casing: %s',
    (_, completer) => {
      expect(completionsToSet(getResult(completer, 'SELECT * FROM Orders o CROSS JOIN '))).toEqual(
        completionsToSet([
          schema('PUBLIC'),
          table('Orders O2'),
          table('Users U'),
          table('"Users" U'),
          table('"select" s'),
          view('User_Emails UE'),
          view('Functions F'),
          fn('_custom_fun() cf'),
          fn('Custom_Fun() CF'),
          fn('Custom_Func1() CF'),
          fn('custom_func2() cf'),
          fn('set_returning_func(x := , y := ) srf', 0, 'set_returning_func(x, y) srf')
        ])
      )
    }
  )

  it.each(completers({ casing: true, aliasing: true }))(
    'test_aliases_with_casing: %s',
    (_, completer) => {
      expect(completionsToSet(getResult(completer, 'SELECT * FROM '))).toEqual(
        completionsToSet([schema('PUBLIC'), ...casedAliasedRels])
      )
    }
  )

  it.each(completers({ casing: true, aliasing: false }))(
    'test_table_casing: %s',
    (_, completer) => {
      expect(completionsToSet(getResult(completer, 'SELECT * FROM '))).toEqual(
        completionsToSet([schema('PUBLIC'), ...casedRels])
      )
    }
  )

  describe.each([
    'INSERT INTO users ()',
    'INSERT INTO users()',
    'INSERT INTO users () SELECT * FROM orders;',
    'INSERT INTO users() SELECT * FROM users u cross join orders o'
  ])('text %s', (text) => {
    it.each(completers({ casing: false }))('test_insert: %s', (_, completer) => {
      expect(completionsToSet(getResult(completer, text, text.indexOf('(') + 1))).toEqual(
        completionsToSet(testdata.columns('users'))
      )
    })
  })

  it.each(completers({ casing: false, aliasing: false }))(
    'test_suggest_cte_names: %s',
    (_, completer) => {
      const text = `
        WITH cte1 AS (SELECT a, b, c FROM foo),
             cte2 AS (SELECT d, e, f FROM bar)
        SELECT * FROM
    `
      expectSuperset(getResult(completer, text), [table('cte1'), table('cte2')])
    }
  )

  it.each(completers({ casing: false, qualify: noQual }))(
    'test_suggest_columns_from_cte: %s',
    (_, completer) => {
      const text = 'WITH cte AS (SELECT foo, bar FROM baz) SELECT  FROM cte'
      const position = 'WITH cte AS (SELECT foo, bar FROM baz) SELECT '.length
      expect(completionsToSet(getResult(completer, text, position))).toEqual(
        completionsToSet([
          column('foo'),
          column('bar'),
          ...testdata.functionsAndKeywords(text.slice(0, position))
        ])
      )
    }
  )

  describe.each([
    'WITH cte AS (SELECT foo FROM bar) SELECT * FROM cte WHERE cte.',
    'WITH cte AS (SELECT foo FROM bar) SELECT * FROM cte c WHERE c.'
  ])('text %s', (text) => {
    it.each(completers({ casing: false, qualify: noQual }))(
      'test_cte_qualified_columns: %s',
      (_, completer) => {
        expect(completionsToSet(getResult(completer, text))).toEqual(
          completionsToSet([column('foo')])
        )
      }
    )
  })

  it.each<[CompleterSettings['keywordCasing'], string, string[]]>([
    ['upper', 'SELECT', ['', 's', 'S', 'Sel']],
    ['lower', 'select', ['', 's', 'S', 'Sel']],
    ['auto', 'SELECT', ['', 'S', 'SEL', 'seL']],
    ['auto', 'select', ['s', 'sel', 'SEl']]
  ])('test_keyword_casing_upper: %s %s', (keywordCasing, expected, texts) => {
    for (const text of texts) {
      const completer = testdata.getCompleter({ keywordCasing })
      expect(getResult(completer, text).map((c) => c.text)).toContain(expected)
    }
  })

  it.each(completers())('test_keyword_after_alter: %s', (_, completer) => {
    expect(getResult(completer, 'ALTER TABLE users ALTER ')).toContainEqual(keyword('COLUMN'))
  })

  it.each(completers())('test_set_schema: %s', (_, completer) => {
    expect(completionsToSet(getResult(completer, 'SET SCHEMA '))).toEqual(
      completionsToSet([schema("'public'")])
    )
  })

  // 未翻译：test_special_name_completion（\t 是命令行的反斜杠命令）。
})

// —— tests/test_smart_completion_multiple_schemata.py ——

describe('pgcli tests/test_smart_completion_multiple_schemata.py', () => {
  const metadata: TestMetadata = {
    tables: {
      public: {
        users: ['id', 'email', 'first_name', 'last_name'],
        orders: ['id', 'ordered_date', 'status', 'datestamp'],
        select: ['id', 'localtime', 'ABC']
      },
      custom: {
        users: ['id', 'phone_number'],
        Users: ['userid', 'username'],
        products: ['id', 'product_name', 'price'],
        shipments: ['id', 'address', 'user_id']
      },
      Custom: { projects: ['projectid', 'name'] },
      blog: {
        entries: ['entryid', 'entrytitle', 'entrytext'],
        tags: ['tagid', 'name'],
        entrytags: ['entryid', 'tagid'],
        entacclog: ['entryid', 'username', 'datestamp']
      }
    },
    functions: {
      public: [
        ['func1', [], [], [], '', false, false, false, false],
        ['func2', [], [], [], '', false, false, false, false]
      ],
      custom: [
        ['func3', [], [], [], '', false, false, false, false],
        ['set_returning_func', ['x'], ['integer'], ['o'], 'integer', false, false, true, false]
      ],
      Custom: [['func4', [], [], [], '', false, false, false, false]],
      blog: [
        [
          'extract_entry_symbols',
          ['_entryid', 'symbol'],
          ['integer', 'text'],
          ['i', 'o'],
          '',
          false,
          false,
          true,
          false
        ],
        [
          'enter_entry',
          ['_title', '_text', 'entryid'],
          ['text', 'text', 'integer'],
          ['i', 'i', 'o'],
          '',
          false,
          false,
          false,
          false
        ]
      ]
    },
    datatypes: { public: ['typ1', 'typ2'], custom: ['typ3', 'typ4'] },
    foreignkeys: {
      custom: [['public', 'users', 'id', 'custom', 'shipments', 'user_id']],
      blog: [
        ['blog', 'entries', 'entryid', 'blog', 'entacclog', 'entryid'],
        ['blog', 'entries', 'entryid', 'blog', 'entrytags', 'entryid'],
        ['blog', 'tags', 'tagid', 'blog', 'entrytags', 'tagid']
      ]
    },
    defaults: {
      public: {
        'orders\u0000id': "nextval('orders_id_seq'::regclass)",
        'orders\u0000datestamp': 'now()',
        'orders\u0000status': "'PENDING'::text"
      }
    }
  }
  const testdata = new MetaData(metadata)
  const casedSchemas = ['public', 'blog', 'CUSTOM', '"Custom"'].map((x) => schema(x))
  const casing = [
    'SELECT',
    'Orders',
    'User_Emails',
    'CUSTOM',
    'Func1',
    'Entries',
    'Tags',
    'EntryTags',
    'EntAccLog',
    'EntryID',
    'EntryTitle',
    'EntryText'
  ]
  const completers = testdata.completersOf(casing)

  describe.each(['users', '"users"'])('table %s', (tbl) => {
    it.each(completers({ filtr: true, casing: false, qualify: noQual }))(
      'test_suggested_column_names_from_shadowed_visible_table: %s',
      (_, completer) => {
        const result = getResult(completer, 'SELECT  FROM ' + tbl, 'SELECT '.length)
        expect(completionsToSet(result)).toEqual(
          completionsToSet(testdata.columnsFunctionsAndKeywords('SELECT ', 'users'))
        )
      }
    )
  })

  describe.each([
    'SELECT  from custom.users',
    'WITH users as (SELECT 1 AS foo) SELECT  from custom.users'
  ])('text %s', (text) => {
    it.each(completers({ filtr: true, casing: false, qualify: noQual }))(
      'test_suggested_column_names_from_qualified_shadowed_table: %s',
      (_, completer) => {
        const position = text.indexOf('  ') + 1
        expect(completionsToSet(getResult(completer, text, position))).toEqual(
          completionsToSet(
            testdata.columnsFunctionsAndKeywords(text.slice(0, position), 'users', 'custom')
          )
        )
      }
    )
  })

  it.each(completers({ filtr: true, casing: false, qualify: noQual }))(
    'test_suggested_column_names_from_cte: %s',
    (_, completer) => {
      const text = 'WITH users as (SELECT 1 AS foo) SELECT  from users'
      const position = text.indexOf('  ') + 1
      expect(completionsToSet(getResult(completer, text, position))).toEqual(
        completionsToSet([column('foo'), ...testdata.functionsAndKeywords(text.slice(0, position))])
      )
    }
  )

  describe.each([
    'SELECT * FROM users JOIN custom.shipments ON ',
    `SELECT *
    FROM public.users
    JOIN custom.shipments ON `
  ])('text %j', (text) => {
    it.each(completers({ casing: false }))('test_suggested_join_conditions: %s', (_, completer) => {
      expect(completionsToSet(getResult(completer, text))).toEqual(
        completionsToSet([
          alias('users'),
          alias('shipments'),
          nameJoin('shipments.id = users.id'),
          fkJoin('shipments.user_id = users.id')
        ])
      )
    })
  })

  describe.each(
    [
      'SELECT * FROM public.{0} RIGHT OUTER JOIN ',
      `SELECT *
    FROM {0}
    JOIN `
    ].flatMap((query) => ['users', '"users"', 'Users'].map((tbl): [string, string] => [query, tbl]))
  )('query %j table %s', (query, tbl) => {
    it.each(completers({ filtr: true, casing: false, aliasing: false }))(
      'test_suggested_joins: %s',
      (_, completer) => {
        expect(completionsToSet(getResult(completer, query.replace('{0}', tbl)))).toEqual(
          completionsToSet([
            ...testdata.schemasAndFromClauseItems(),
            join(`custom.shipments ON shipments.user_id = ${tbl}.id`)
          ])
        )
      }
    )
  })

  it.each(completers({ filtr: true, casing: false, qualify: noQual }))(
    'test_suggested_column_names_from_schema_qualifed_table: %s',
    (_, completer) => {
      const result = getResult(completer, 'SELECT  from custom.products', 'SELECT '.length)
      expect(completionsToSet(result)).toEqual(
        completionsToSet(testdata.columnsFunctionsAndKeywords('SELECT ', 'products', 'custom'))
      )
    }
  )

  describe.each([
    'INSERT INTO orders(',
    'INSERT INTO orders (',
    'INSERT INTO public.orders(',
    'INSERT INTO public.orders ('
  ])('text %s', (text) => {
    it.each(completers({ filtr: true, casing: false }))(
      'test_suggested_columns_with_insert: %s',
      (_, completer) => {
        expect(completionsToSet(getResult(completer, text))).toEqual(
          completionsToSet(testdata.columns('orders'))
        )
      }
    )
  })

  it.each(completers({ filtr: true, casing: false, qualify: noQual }))(
    'test_suggested_column_names_in_function: %s',
    (_, completer) => {
      const result = getResult(completer, 'SELECT MAX( from custom.products', 'SELECT MAX('.length)
      expect(completionsToSet(result)).toEqual(
        completionsToSet(testdata.columnsFunctionsAndKeywords('SELECT MAX(', 'products', 'custom'))
      )
    }
  )

  describe.each(['SELECT * FROM Custom.', 'SELECT * FROM custom.', 'SELECT * FROM "custom".'])(
    'text %s',
    (text) => {
      describe.each([false, true])('use_leading_double_quote %s', (useLeadingDoubleQuote) => {
        it.each(completers({ casing: false, aliasing: false }))(
          'test_suggested_table_names_with_schema_dot: %s',
          (_, completer) => {
            const full = useLeadingDoubleQuote ? text + '"' : text
            const startPosition = useLeadingDoubleQuote ? -1 : 0
            expect(completionsToSet(getResult(completer, full))).toEqual(
              completionsToSet(testdata.fromClauseItems('custom', startPosition))
            )
          }
        )
      })
    }
  )

  describe.each([false, true])('use_leading_double_quote %s', (useLeadingDoubleQuote) => {
    it.each(completers({ casing: false, aliasing: false }))(
      'test_suggested_table_names_with_schema_dot2: %s',
      (_, completer) => {
        const text = 'SELECT * FROM "Custom".' + (useLeadingDoubleQuote ? '"' : '')
        const startPosition = useLeadingDoubleQuote ? -1 : 0
        expect(completionsToSet(getResult(completer, text))).toEqual(
          completionsToSet(testdata.fromClauseItems('Custom', startPosition))
        )
      }
    )
  })

  it.each(completers({ filtr: true, casing: false }))(
    'test_suggested_column_names_with_qualified_alias: %s',
    (_, completer) => {
      const result = getResult(completer, 'SELECT p. from custom.products p', 'SELECT p.'.length)
      expect(completionsToSet(result)).toEqual(
        completionsToSet(testdata.columns('products', 'custom'))
      )
    }
  )

  it.each(completers({ filtr: true, casing: false, qualify: noQual }))(
    'test_suggested_multiple_column_names: %s',
    (_, completer) => {
      const result = getResult(completer, 'SELECT id,  from custom.products', 'SELECT id, '.length)
      expect(completionsToSet(result)).toEqual(
        completionsToSet(testdata.columnsFunctionsAndKeywords('SELECT id, ', 'products', 'custom'))
      )
    }
  )

  it.each(completers({ filtr: true, casing: false }))(
    'test_suggested_multiple_column_names_with_alias: %s',
    (_, completer) => {
      const result = getResult(
        completer,
        'SELECT p.id, p. from custom.products p',
        'SELECT u.id, u.'.length
      )
      expect(completionsToSet(result)).toEqual(
        completionsToSet(testdata.columns('products', 'custom'))
      )
    }
  )

  describe.each([
    'SELECT x.id, y.product_name FROM custom.products x JOIN custom.products y ON ',
    'SELECT x.id, y.product_name FROM custom.products x JOIN custom.products y ON JOIN public.orders z ON z.id > y.id'
  ])('text %s', (text) => {
    it.each(completers({ filtr: true, casing: false }))(
      'test_suggestions_after_on: %s',
      (_, completer) => {
        const position =
          'SELECT x.id, y.product_name FROM custom.products x JOIN custom.products y ON '.length
        expect(completionsToSet(getResult(completer, text, position))).toEqual(
          completionsToSet([
            alias('x'),
            alias('y'),
            nameJoin('y.price = x.price'),
            nameJoin('y.product_name = x.product_name'),
            nameJoin('y.id = x.id')
          ])
        )
      }
    )
  })

  it.each(completers())('test_suggested_aliases_after_on_right_side: %s', (_, completer) => {
    const text =
      'SELECT x.id, y.product_name FROM custom.products x JOIN custom.products y ON x.id = '
    expect(completionsToSet(getResult(completer, text))).toEqual(
      completionsToSet([alias('x'), alias('y')])
    )
  })

  it.each(completers({ filtr: true, casing: false, aliasing: false }))(
    'test_table_names_after_from: %s',
    (_, completer) => {
      expect(completionsToSet(getResult(completer, 'SELECT * FROM '))).toEqual(
        completionsToSet(testdata.schemasAndFromClauseItems())
      )
    }
  )

  it.each(completers({ filtr: true, casing: false }))(
    'test_schema_qualified_function_name: %s',
    (_, completer) => {
      expect(completionsToSet(getResult(completer, 'SELECT custom.func'))).toEqual(
        completionsToSet([
          fn('func3()', -'func'.length),
          fn('set_returning_func()', -'func'.length)
        ])
      )
    }
  )

  it.each(completers({ filtr: true, casing: false, aliasing: false }))(
    'test_schema_qualified_function_name_after_from: %s',
    (_, completer) => {
      expect(completionsToSet(getResult(completer, 'SELECT * FROM custom.set_r'))).toEqual(
        completionsToSet([fn('set_returning_func()', -'func'.length)])
      )
    }
  )

  it.each(completers({ filtr: true, casing: false, aliasing: false }))(
    'test_unqualified_function_name_not_returned: %s',
    (_, completer) => {
      expect(completionsToSet(getResult(completer, 'SELECT * FROM set_r'))).toEqual([])
    }
  )

  // 改动：原测试直接改 completer.search_path，这里建补全器时给出。
  it.each([true, false])(
    'test_unqualified_function_name_in_search_path: casing=false filtr=true aliasing=false qualify=%s',
    () => {
      for (const qualifyColumns of ['always', 'if_more_than_one_table', 'never'] as const) {
        const completer = testdata.getCompleter(
          { searchPathFilter: true, generateAliases: false, qualifyColumns },
          undefined,
          ['public', 'custom']
        )
        expect(completionsToSet(getResult(completer, 'SELECT * FROM set_r'))).toEqual(
          completionsToSet([fn('set_returning_func()', -'func'.length)])
        )
      }
    }
  )

  describe.each([
    'SELECT 1::custom.',
    'CREATE TABLE foo (bar custom.',
    'CREATE FUNCTION foo (bar INT, baz custom.',
    'ALTER TABLE foo ALTER COLUMN bar TYPE custom.'
  ])('text %s', (text) => {
    it.each(completers({ filtr: true, casing: false }))(
      'test_schema_qualified_type_name: %s',
      (_, completer) => {
        expect(completionsToSet(getResult(completer, text))).toEqual(
          completionsToSet(testdata.types('custom'))
        )
      }
    )
  })

  it.each(completers({ filtr: true, casing: false }))(
    'test_suggest_columns_from_aliased_set_returning_function: %s',
    (_, completer) => {
      const result = getResult(
        completer,
        'select f. from custom.set_returning_func() f',
        'select f.'.length
      )
      expect(completionsToSet(result)).toEqual(
        completionsToSet(testdata.columns('set_returning_func', 'custom', 'functions'))
      )
    }
  )

  describe.each([
    'SELECT * FROM custom.set_returning_func()',
    'SELECT * FROM Custom.set_returning_func()',
    'SELECT * FROM Custom.Set_Returning_Func()'
  ])('text %s', (text) => {
    it.each(completers({ filtr: true, casing: false, qualify: noQual }))(
      'test_wildcard_column_expansion_with_function: %s',
      (_, completer) => {
        expect(getResult(completer, text, 'SELECT *'.length)).toEqual([wildcardExpansion('x')])
      }
    )
  })

  it.each(completers({ filtr: true, casing: false }))(
    'test_wildcard_column_expansion_with_alias_qualifier: %s',
    (_, completer) => {
      expect(
        getResult(completer, 'SELECT p.* FROM custom.products p', 'SELECT p.*'.length)
      ).toEqual([wildcardExpansion('id, p.product_name, p.price')])
    }
  )

  describe.each([
    `
    SELECT count(1) FROM users;
    CREATE FUNCTION foo(custom.products _products) returns custom.shipments
    LANGUAGE SQL
    AS $foo$
    SELECT 1 FROM custom.shipments;
    INSERT INTO public.orders(*) values(-1, now(), 'preliminary');
    SELECT 2 FROM custom.users;
    $foo$;
    SELECT count(1) FROM custom.shipments;
    `,
    'INSERT INTO public.orders(*',
    'INSERT INTO public.Orders(*',
    'INSERT INTO public.orders (*',
    'INSERT INTO public.Orders (*',
    'INSERT INTO orders(*',
    'INSERT INTO Orders(*',
    'INSERT INTO orders (*',
    'INSERT INTO Orders (*',
    'INSERT INTO public.orders(*)',
    'INSERT INTO public.Orders(*)',
    'INSERT INTO public.orders (*)',
    'INSERT INTO public.Orders (*)',
    'INSERT INTO orders(*)',
    'INSERT INTO Orders(*)',
    'INSERT INTO orders (*)',
    'INSERT INTO Orders (*)'
  ])('text %j', (text) => {
    it.each(completers({ filtr: true, casing: false }))(
      'test_wildcard_column_expansion_with_insert: %s',
      (_, completer) => {
        expect(getResult(completer, text, text.indexOf('*') + 1)).toEqual([
          wildcardExpansion('ordered_date, status')
        ])
      }
    )
  })

  it.each(completers({ filtr: true, casing: false }))(
    'test_wildcard_column_expansion_with_table_qualifier: %s',
    (_, completer) => {
      const text = 'SELECT "select".* FROM public."select"'
      expect(getResult(completer, text, 'SELECT "select".*'.length)).toEqual([
        wildcardExpansion('id, "select"."localtime", "select"."ABC"')
      ])
    }
  )

  it.each(completers({ filtr: true, casing: false, qualify: qual }))(
    'test_wildcard_column_expansion_with_two_tables: %s',
    (_, completer) => {
      const text = 'SELECT * FROM public."select" JOIN custom.users ON true'
      expect(getResult(completer, text, 'SELECT *'.length)).toEqual([
        wildcardExpansion(
          '"select".id, "select"."localtime", "select"."ABC", users.id, users.phone_number'
        )
      ])
    }
  )

  it.each(completers({ filtr: true, casing: false }))(
    'test_wildcard_column_expansion_with_two_tables_and_parent: %s',
    (_, completer) => {
      const text = 'SELECT "select".* FROM public."select" JOIN custom.users u ON true'
      expect(getResult(completer, text, 'SELECT "select".*'.length)).toEqual([
        wildcardExpansion('id, "select"."localtime", "select"."ABC"')
      ])
    }
  )

  describe.each([
    'SELECT U. FROM custom.Users U',
    'SELECT U. FROM custom.USERS U',
    'SELECT U. FROM custom.users U',
    'SELECT U. FROM "custom".Users U',
    'SELECT U. FROM "custom".USERS U',
    'SELECT U. FROM "custom".users U'
  ])('text %s', (text) => {
    it.each(completers({ filtr: true, casing: false }))(
      'test_suggest_columns_from_unquoted_table: %s',
      (_, completer) => {
        expect(completionsToSet(getResult(completer, text, 'SELECT U.'.length))).toEqual(
          completionsToSet(testdata.columns('users', 'custom'))
        )
      }
    )
  })

  describe.each(['SELECT U. FROM custom."Users" U', 'SELECT U. FROM "custom"."Users" U'])(
    'text %s',
    (text) => {
      it.each(completers({ filtr: true, casing: false }))(
        'test_suggest_columns_from_quoted_table: %s',
        (_, completer) => {
          expect(completionsToSet(getResult(completer, text, 'SELECT U.'.length))).toEqual(
            completionsToSet(testdata.columns('Users', 'custom'))
          )
        }
      )
    }
  )

  const texts = ['SELECT * FROM ', 'SELECT * FROM public.Orders O CROSS JOIN ']

  describe.each(texts)('text %s', (text) => {
    it.each(completers({ filtr: true, casing: false, aliasing: false }))(
      'test_schema_or_visible_table_completion: %s',
      (_, completer) => {
        expect(completionsToSet(getResult(completer, text))).toEqual(
          completionsToSet(testdata.schemasAndFromClauseItems())
        )
      }
    )

    it.each(completers({ aliasing: true, casing: false, filtr: true }))(
      'test_table_aliases: %s',
      (_, completer) => {
        expect(completionsToSet(getResult(completer, text))).toEqual(
          completionsToSet([
            ...testdata.schemas(),
            table('users u'),
            table(text === 'SELECT * FROM ' ? 'orders o' : 'orders o2'),
            table('"select" s'),
            fn('func1() f'),
            fn('func2() f')
          ])
        )
      }
    )

    it.each(completers({ aliasing: true, casing: true, filtr: true }))(
      'test_aliases_with_casing: %s',
      (_, completer) => {
        expect(completionsToSet(getResult(completer, text))).toEqual(
          completionsToSet([
            ...casedSchemas,
            table('users u'),
            table(text === 'SELECT * FROM ' ? 'Orders O' : 'Orders O2'),
            table('"select" s'),
            fn('Func1() F'),
            fn('func2() f')
          ])
        )
      }
    )

    it.each(completers({ aliasing: false, casing: true, filtr: true }))(
      'test_table_casing: %s',
      (_, completer) => {
        expect(completionsToSet(getResult(completer, text))).toEqual(
          completionsToSet([
            ...casedSchemas,
            table('users'),
            table('Orders'),
            table('"select"'),
            fn('Func1()'),
            fn('func2()')
          ])
        )
      }
    )
  })

  it.each(completers({ aliasing: false, casing: true }))(
    'test_alias_search_without_aliases2: %s',
    (_, completer) => {
      expect(getResult(completer, 'SELECT * FROM blog.et')[0]).toEqual(table('EntryTags', -2))
    }
  )

  it.each(completers({ aliasing: false, casing: true }))(
    'test_alias_search_without_aliases1: %s',
    (_, completer) => {
      expect(getResult(completer, 'SELECT * FROM blog.e')[0]).toEqual(table('Entries', -1))
    }
  )

  it.each(completers({ aliasing: true, casing: true }))(
    'test_alias_search_with_aliases2: %s',
    (_, completer) => {
      expect(getResult(completer, 'SELECT * FROM blog.et')[0]).toEqual(table('EntryTags ET', -2))
    }
  )

  it.each(completers({ aliasing: true, casing: true }))(
    'test_alias_search_with_aliases1: %s',
    (_, completer) => {
      expect(getResult(completer, 'SELECT * FROM blog.e')[0]).toEqual(table('Entries E', -1))
    }
  )

  it.each(completers({ aliasing: true, casing: true }))(
    'test_join_alias_search_with_aliases1: %s',
    (_, completer) => {
      expect(getResult(completer, 'SELECT * FROM blog.Entries E JOIN blog.e').slice(0, 2)).toEqual([
        table('Entries E2', -1),
        join('EntAccLog EAL ON EAL.EntryID = E.EntryID', -1)
      ])
    }
  )

  it.each(completers({ aliasing: false, casing: true }))(
    'test_join_alias_search_without_aliases1: %s',
    (_, completer) => {
      expect(getResult(completer, 'SELECT * FROM blog.Entries JOIN blog.e').slice(0, 2)).toEqual([
        table('Entries', -1),
        join('EntAccLog ON EntAccLog.EntryID = Entries.EntryID', -1)
      ])
    }
  )

  it.each(completers({ aliasing: true, casing: true }))(
    'test_join_alias_search_with_aliases2: %s',
    (_, completer) => {
      expect(getResult(completer, 'SELECT * FROM blog.Entries E JOIN blog.et')[0]).toEqual(
        join('EntryTags ET ON ET.EntryID = E.EntryID', -2)
      )
    }
  )

  it.each(completers({ aliasing: false, casing: true }))(
    'test_join_alias_search_without_aliases2: %s',
    (_, completer) => {
      expect(getResult(completer, 'SELECT * FROM blog.Entries JOIN blog.et')[0]).toEqual(
        join('EntryTags ON EntryTags.EntryID = Entries.EntryID', -2)
      )
    }
  )

  it.each(completers())('test_function_alias_search_without_aliases: %s', (_, completer) => {
    const first = getResult(completer, 'SELECT blog.ees')[0]!
    expect(first.startPosition).toBe(-3)
    expect(first.text).toBe('extract_entry_symbols()')
    expect(first.display).toBe('extract_entry_symbols(_entryid)')
  })

  it.each(completers())('test_function_alias_search_with_aliases: %s', (_, completer) => {
    const first = getResult(completer, 'SELECT blog.ee')[0]!
    expect(first.startPosition).toBe(-2)
    expect(first.text).toBe('enter_entry(_title := , _text := )')
    expect(first.display).toBe('enter_entry(_title, _text)')
  })

  it.each(completers({ filtr: true, casing: true, qualify: noQual }))(
    'test_column_alias_search: %s',
    (_, completer) => {
      const result = getResult(completer, 'SELECT et FROM blog.Entries E', 'SELECT et'.length)
      expect(result.slice(0, 3)).toEqual(
        ['EntryText', 'EntryTitle', 'EntryID'].map((c) => column(c, -2))
      )
    }
  )

  it.each(completers({ casing: true }))(
    'test_column_alias_search_qualified: %s',
    (_, completer) => {
      const result = getResult(completer, 'SELECT E.ei FROM blog.Entries E', 'SELECT E.ei'.length)
      expect(result.slice(0, 3)).toEqual(['EntryID', 'EntryTitle'].map((c) => column(c, -2)))
    }
  )

  it.each(completers({ casing: false, filtr: false, aliasing: false }))(
    'test_schema_object_order: %s',
    (_, completer) => {
      expect(getResult(completer, 'SELECT * FROM u').slice(0, 3)).toEqual(
        ['users', 'custom."Users"', 'custom.users'].map((t) => table(t, -1))
      )
    }
  )

  it.each(completers({ casing: false, filtr: false, aliasing: false }))(
    'test_all_schema_objects: %s',
    (_, completer) => {
      expectSuperset(getResult(completer, 'SELECT * FROM '), [
        ...['orders', '"select"', 'custom.shipments'].map((x) => table(x)),
        fn('func2()')
      ])
    }
  )

  it.each(completers({ filtr: false, aliasing: false, casing: true }))(
    'test_all_schema_objects_with_casing: %s',
    (_, completer) => {
      expectSuperset(getResult(completer, 'SELECT * FROM '), [
        ...['Orders', '"select"', 'CUSTOM.shipments'].map((x) => table(x)),
        fn('func2()')
      ])
    }
  )

  it.each(completers({ casing: false, filtr: false, aliasing: true }))(
    'test_all_schema_objects_with_aliases: %s',
    (_, completer) => {
      expectSuperset(getResult(completer, 'SELECT * FROM '), [
        ...['orders o', '"select" s', 'custom.shipments s'].map((x) => table(x)),
        fn('func2() f')
      ])
    }
  )

  it.each(completers({ casing: false, filtr: false, aliasing: true }))(
    'test_set_schema: %s',
    (_, completer) => {
      expect(completionsToSet(getResult(completer, 'SET SCHEMA '))).toEqual(
        completionsToSet([
          schema("'blog'"),
          schema("'Custom'"),
          schema("'custom'"),
          schema("'public'")
        ])
      )
    }
  )
})

// —— tests/test_fuzzy_completion.py ——

describe('pgcli tests/test_fuzzy_completion.py', () => {
  const completer = (): SqlCompleter =>
    new SqlCompleter('postgresql', { databases: [], schemas: [], searchPath: [], foreignKeys: [] })

  it('test_ranking_ignores_identifier_quotes', () => {
    // 排序时忽略名字的引号："user" 是保留字要加引号，但不能因此排到 user_action 之后
    expect(completer().findMatches('user', ['user_action', '"user"'])).toHaveLength(2)
  })

  it('test_ranking_based_on_shortest_match', () => {
    // 按最短的匹配算长度：user_group 的匹配长度为 4（user）而不是 7（user_gr）
    const matches = completer().findMatches('user', ['api_user', 'user_group'])
    expect(comparePriority(matches[1]!.priority, matches[0]!.priority)).toBeGreaterThan(0)
  })

  it.each([
    ['user_action', 'user'],
    ['user_group', 'user'],
    ['user_group', 'user_action']
  ])('test_should_break_ties_using_lexical_order: %s %s', (...collection) => {
    // 匹配长度与位置相同时按字典序
    const matches = completer().findMatches('user', collection)
    expect(comparePriority(matches[1]!.priority, matches[0]!.priority)).toBeGreaterThan(0)
  })

  it('test_matching_should_be_case_insensitive', () => {
    expect(completer().findMatches('foo', ['Foo', 'FOO', 'fOO'])).toHaveLength(3)
  })
})

// —— tests/test_pgcompleter.py ——
// 未翻译：test_load_alias_map_file_missing_file、test_load_alias_map_file_invalid_json（读别名映射文件，本引擎直接
// 收 aliasMap 对象）；test_escape_name_accepts_bytes 里 bytes 的解码（只翻译 str 的部分）。
// 改动：PGCompleter.alias 是内部方法，test_pgcompleter_alias_uses_configured_alias_map 改为看 FROM 之后补出的表带的别名；
// escaped_names 同样是内部方法，只断言 escape_name。

describe('pgcli tests/test_pgcompleter.py', () => {
  const emptyMetadata: CompletionSchema = {
    databases: [],
    schemas: [],
    searchPath: [],
    foreignKeys: []
  }

  it.each([
    ['SomE_Table', 'SET'],
    ['SOmeTabLe', 'SOTL'],
    ['someTable', 'T']
  ])('test_generate_alias_uses_upper_case_letters_from_name: %s', (tableName, expected) => {
    expect(generateAlias(tableName)).toBe(expected)
  })

  it.each([
    ['some_tab_le', 'stl'],
    ['s_ome_table', 'sot'],
    ['sometable', 's']
  ])(
    'test_generate_alias_uses_first_char_and_every_preceded_by_underscore: %s',
    (tableName, expected) => {
      expect(generateAlias(tableName)).toBe(expected)
    }
  )

  it.each<[string, Record<string, string>, string]>([
    ['some_table', { some_table: 'my_alias' }, 'my_alias'],
    // no_match_in_map
    ['some_other_table', { some_table: 'my_alias' }, 'sot']
  ])('test_generate_alias_can_use_alias_map: %s', (tableName, aliasMap, expected) => {
    expect(generateAlias(tableName, aliasMap)).toBe(expected)
  })

  it('test_pgcompleter_alias_uses_configured_alias_map', () => {
    const completer = new SqlCompleter(
      'postgresql',
      {
        ...emptyMetadata,
        schemas: [
          {
            name: 'public',
            tables: [{ name: 'some_table', columns: [] }],
            views: [],
            functions: [],
            datatypes: []
          }
        ],
        searchPath: ['public']
      },
      { generateAliases: true, aliasMap: { some_table: 'my_alias' } }
    )
    const text = 'SELECT * FROM some_t'
    expect(completer.getCompletions(text, text.length).map((c) => c.text)).toEqual([
      'some_table my_alias'
    ])
  })

  it('test_generate_alias_prefers_alias_over_upper_case_name', () => {
    expect(generateAlias('SomeTable', { SomeTable: 'my_alias' })).toBe('my_alias')
  })

  it.each([
    ['Some_tablE', 'SE'],
    ['SomeTab_le', 'ST']
  ])(
    'test_generate_alias_prefers_upper_case_name_over_underscore_name: %s',
    (tableName, expected) => {
      expect(generateAlias(tableName)).toBe(expected)
    }
  )

  it.each([
    ['pg_catalog', 'pg_catalog'],
    ['public', 'public'],
    ['Mixed Case', '"Mixed Case"'],
    ['select', '"select"']
  ])('test_escape_name_accepts_bytes（str 部分）: %s', (name, expected) => {
    expect(new SqlCompleter('postgresql', emptyMetadata).escapeName(name)).toBe(expected)
  })
})

// —— tests/test_prioritization.py ——

describe('pgcli tests/test_prioritization.py', () => {
  it('test_prevalence_counter', () => {
    const counter = new PrevalenceCounter()
    counter.update(
      `SELECT * FROM foo WHERE bar GROUP BY baz;
             select * from foo;
             SELECT * FROM foo WHERE bar GROUP
             BY baz`,
      'postgresql'
    )
    expect(['SELECT', 'FROM', 'GROUP BY'].map((x) => counter.keywordCount(x))).toEqual([3, 3, 2])
    expect(counter.keywordCount('NOSUCHKEYWORD')).toBe(0)
    expect(['foo', 'bar', 'baz'].map((x) => counter.nameCount(x))).toEqual([3, 2, 2])
  })
})

// —— 本项目另加：次数存盘与计数器共用（pgcli 的次数只在内存里，见 prioritization.ts 开头）——

describe('PrevalenceCounter 存盘与共用', () => {
  it('counts 取出的次数 add 进新的计数器后一样', () => {
    const counter = new PrevalenceCounter()
    counter.update('SELECT * FROM foo; select bar from foo', 'postgresql')
    const restored = new PrevalenceCounter()
    restored.add(counter.counts())
    expect(restored.counts()).toEqual(counter.counts())
    expect(restored.keywordCount('SELECT')).toBe(2)
    expect(restored.nameCount('foo')).toBe(2)
  })

  it('add 加到已有的次数上', () => {
    const counter = new PrevalenceCounter()
    counter.update('SELECT * FROM foo', 'postgresql')
    counter.add({ keywords: { SELECT: 3 }, names: { foo: 1, bar: 2 } })
    expect(counter.keywordCount('SELECT')).toBe(4)
    expect(counter.nameCount('foo')).toBe(2)
    expect(counter.nameCount('bar')).toBe(2)
  })

  it('按给出的类型计数：关键字表与切词按那个方言', () => {
    const counter = new PrevalenceCounter()
    counter.update('SELECT * FROM orders LIMIT 1', 'mysql')
    expect(counter.keywordCount('LIMIT')).toBe(1)
    expect(counter.nameCount('orders')).toBe(1)
  })

  it('表结构换了重建的补全器沿用同一个计数器（同 pgcli 的 _swap_completer_objects）', () => {
    const relation = (name: string): CompletionSchema['schemas'][number]['tables'][number] => ({
      name,
      columns: []
    })
    const metadata = (tables: string[]): CompletionSchema => ({
      databases: [],
      searchPath: ['public'],
      foreignKeys: [],
      schemas: [
        { name: 'public', tables: tables.map(relation), views: [], functions: [], datatypes: [] }
      ]
    })
    const counter = new PrevalenceCounter()
    new SqlCompleter('postgresql', metadata(['orders', 'users']), {}, counter).extendQueryHistory(
      'SELECT * FROM users'
    )
    const rebuilt = new SqlCompleter(
      'postgresql',
      metadata(['orders', 'users', 'items']),
      {},
      counter
    )
    const completions = getResult(rebuilt, 'SELECT * FROM ')
    // 没用过时 orders 按字典序排在 users 前面；users 用过一次，排到前面
    expect(indexOf(completions, table('users'))).toBeLessThan(indexOf(completions, table('orders')))
    const fresh = getResult(
      new SqlCompleter('postgresql', metadata(['orders', 'users'])),
      'SELECT * FROM '
    )
    expect(indexOf(fresh, table('orders'))).toBeLessThan(indexOf(fresh, table('users')))
  })
})
