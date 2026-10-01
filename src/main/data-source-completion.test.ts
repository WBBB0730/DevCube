import { describe, expect, it } from 'vitest'
import {
  buildCompletionSchema,
  mysqlRoutinesOf,
  mysqlShowItemsOf,
  pgDefaultSearchPath,
  pgFunctionOf,
  sqliteForeignKeysOf,
  type CompletionRows
} from './data-source-completion'

const empty: CompletionRows = {
  databases: [],
  schemas: [],
  columns: [],
  functions: [],
  datatypes: [],
  foreignKeys: [],
  searchPath: []
}

describe('buildCompletionSchema', () => {
  it('表与视图按模式归组，列带类型与默认值；没有对象的模式也列', () => {
    const schema = buildCompletionSchema({
      ...empty,
      databases: ['shop'],
      schemas: ['empty', 'public'],
      columns: [
        ['public', 'users', 'f', 'id', 'integer', 't', "nextval('users_id_seq'::regclass)"],
        ['public', 'users', 'f', 'name', 'text', 'f', null],
        ['public', 'active_users', 't', 'id', 'integer', 'f', null],
        ['public', 'nothing', 'f', null, null, null, null]
      ],
      searchPath: ['pg_catalog', 'public']
    })
    expect(schema.databases).toEqual(['shop'])
    expect(schema.searchPath).toEqual(['pg_catalog', 'public'])
    expect(schema.schemas.map((s) => s.name)).toEqual(['empty', 'public'])
    const pub = schema.schemas[1]!
    expect(pub.tables).toEqual([
      {
        name: 'users',
        columns: [
          {
            name: 'id',
            datatype: 'integer',
            default: "nextval('users_id_seq'::regclass)",
            hasDefault: true
          },
          { name: 'name', datatype: 'text', default: null, hasDefault: false }
        ]
      },
      { name: 'nothing', columns: [] }
    ])
    expect(pub.views).toEqual([
      {
        name: 'active_users',
        columns: [{ name: 'id', datatype: 'integer', default: null, hasDefault: false }]
      }
    ])
    expect(pub.functions).toEqual([])
    expect(pub.datatypes).toEqual([])
    expect(pub.procedures).toBeUndefined()
  })

  it('布尔值认 1 / 0（MySQL / MariaDB、SQLite）', () => {
    const schema = buildCompletionSchema({
      ...empty,
      columns: [
        ['shop', 'v', '1', 'a', 'int', '0', null],
        ['shop', 't', '0', 'b', "enum('x','y')", '1', 'x']
      ]
    })
    const [shop] = schema.schemas
    expect(shop!.views.map((r) => r.name)).toEqual(['v'])
    expect(shop!.tables[0]!.columns[0]).toEqual({
      name: 'b',
      datatype: "enum('x','y')",
      default: 'x',
      hasDefault: true
    })
  })

  it('函数、类型、存储过程归到各自的模式；给了存储过程时每个模式都有这一项，重名的只留一个', () => {
    const [, func] = pgFunctionOf(['s', 'f', null, null, null, 'integer', 'f', 'f', 'f', 'f', null])
    const schema = buildCompletionSchema({
      ...empty,
      schemas: ['a', 'b'],
      functions: [['b', func]],
      datatypes: [['a', 'mood']],
      procedures: [
        ['b', 'refresh'],
        ['b', 'refresh']
      ]
    })
    expect(schema.schemas).toEqual([
      { name: 'a', tables: [], views: [], functions: [], datatypes: ['mood'], procedures: [] },
      {
        name: 'b',
        tables: [],
        views: [],
        functions: [func],
        datatypes: [],
        procedures: ['refresh']
      }
    ])
  })

  it('外键按 pgcli 的列次序，缺项的不要', () => {
    const schema = buildCompletionSchema({
      ...empty,
      foreignKeys: [
        ['public', 'users', 'id', 'public', 'orders', 'user_id'],
        ['public', 'users', null, 'public', 'orders', 'x']
      ]
    })
    expect(schema.foreignKeys).toEqual([
      {
        parentschema: 'public',
        parenttable: 'users',
        parentcolumn: 'id',
        childschema: 'public',
        childtable: 'orders',
        childcolumn: 'user_id'
      }
    ])
  })
})

describe('pgFunctionOf', () => {
  it('参数取 to_json 的数组，布尔值认 t / f', () => {
    expect(
      pgFunctionOf([
        'public',
        'calc',
        '["a","b",""]',
        '["integer","text","record"]',
        '["i","i","o"]',
        'record',
        'f',
        'f',
        't',
        'f',
        "'x'::text"
      ])
    ).toEqual([
      'public',
      {
        funcName: 'calc',
        argNames: ['a', 'b', ''],
        argTypes: ['integer', 'text', 'record'],
        argModes: ['i', 'i', 'o'],
        returnType: 'record',
        isAggregate: false,
        isWindow: false,
        isSetReturning: true,
        isExtension: false,
        argDefaults: "'x'::text"
      }
    ])
  })

  it('没有参数名、类型与模式时为 null', () => {
    const [, func] = pgFunctionOf([
      's',
      'now2',
      null,
      '[]',
      null,
      'timestamp',
      't',
      'f',
      'f',
      't',
      null
    ])
    expect(func.argNames).toBeNull()
    expect(func.argTypes).toEqual([])
    expect(func.argModes).toBeNull()
    expect(func.isAggregate).toBe(true)
    expect(func.isExtension).toBe(true)
  })
})

describe('mysqlRoutinesOf', () => {
  it('函数的参数按行合起来；没有参数的为 null；过程只要名字', () => {
    const { functions, procedures } = mysqlRoutinesOf([
      ['shop', 'calc', 'FUNCTION', 'decimal(10,2)', 'price', 'decimal(10,2)'],
      ['shop', 'calc', 'FUNCTION', 'decimal(10,2)', 'qty', 'int'],
      ['shop', 'today2', 'FUNCTION', 'date', null, null],
      ['shop', 'refresh', 'PROCEDURE', null, 'since', 'date'],
      ['shop', 'refresh', 'PROCEDURE', null, 'until', 'date'],
      ['other', 'calc', 'FUNCTION', 'int', null, null]
    ])
    expect(functions.map(([schema, f]) => [schema, f.funcName, f.argNames, f.argTypes])).toEqual([
      ['shop', 'calc', ['price', 'qty'], ['decimal(10,2)', 'int']],
      ['shop', 'today2', null, null],
      ['other', 'calc', null, null]
    ])
    expect(functions[0]![1]).toMatchObject({
      returnType: 'decimal(10,2)',
      argModes: null,
      isAggregate: false,
      isWindow: false,
      isSetReturning: false,
      isExtension: false,
      argDefaults: null
    })
    expect(procedures).toEqual([
      ['shop', 'refresh'],
      ['shop', 'refresh']
    ])
  })
})

describe('mysqlShowItemsOf', () => {
  it('去掉第一个词（同 mycli 的 split(None, 1)[-1]）；只有一个词的留它自己；空的不要', () => {
    expect(
      mysqlShowItemsOf([
        ['SHOW CREATE TABLE'],
        ['SHOW'],
        ['SHOW '],
        ['  SHOW  BINARY LOGS'],
        [''],
        [null]
      ])
    ).toEqual(['CREATE TABLE', 'SHOW', 'SHOW', 'BINARY LOGS'])
  })
})

describe('pgDefaultSearchPath', () => {
  it('"$user" 换成登录的用户，没写 pg_catalog 时补在最前', () => {
    expect(pgDefaultSearchPath('"$user", public', 'alice')).toEqual([
      'pg_catalog',
      'alice',
      'public'
    ])
  })

  it('写了 pg_catalog 即按写的次序；带引号的去掉引号、不带的折成小写，重复的只留第一个', () => {
    expect(pgDefaultSearchPath('Sales, pg_catalog, "My ""X""", sales', 'bob')).toEqual([
      'sales',
      'pg_catalog',
      'My "X"'
    ])
  })

  it('search_path 为空时只有 pg_catalog', () => {
    expect(pgDefaultSearchPath('', 'alice')).toEqual(['pg_catalog'])
  })
})

describe('sqliteForeignKeysOf', () => {
  it('写了父表列的照写；没写的取父表主键的第 seq 列；补不上的不要', () => {
    const rows = sqliteForeignKeysOf(
      [
        ['orders', 'user_id', 'users', 'id', '0'],
        ['lines', 'order_a', 'orders', null, '0'],
        ['lines', 'order_b', 'orders', null, '1'],
        ['notes', 'x', 'nopk', null, '0']
      ],
      [
        ['orders', 'a'],
        ['orders', 'b']
      ]
    )
    expect(rows).toEqual([
      ['main', 'users', 'id', 'main', 'orders', 'user_id'],
      ['main', 'orders', 'a', 'main', 'lines', 'order_a'],
      ['main', 'orders', 'b', 'main', 'lines', 'order_b']
    ])
  })
})
