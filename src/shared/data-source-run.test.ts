import { describe, expect, it } from 'vitest'
import type { DataSourceTarget } from './data-source'
import type { ConsoleStatementResult } from './data-source-query'
import {
  dataSourceRunParamNames,
  dataSourceRunSucceeded,
  dataSourceRunTarget,
  fillDataSourceRunParams,
  RUN_PARAM_SOURCE,
  type DataSourceRunOutput
} from './data-source-run'
import type { RedisCommandResult } from './redis'

const pg: DataSourceTarget = {
  kind: 'postgresql',
  host: 'db',
  port: 5432,
  user: 'app',
  database: 'shop',
  sslMode: null,
  direct: false
}

const ok = (sql: string): ConsoleStatementResult => ({
  sql,
  ms: 1,
  outcome: { kind: 'affected', count: 1 }
})

const sql = (...statements: ConsoleStatementResult[]): DataSourceRunOutput => ({
  kind: 'sql',
  run: { statements, result: null }
})

const reply = (command: string, error = false): RedisCommandResult => ({
  command,
  ms: 2,
  reply: error ? '(error) ERR' : '"OK"',
  error
})

describe('dataSourceRunParamNames', () => {
  it('只认 ${名称}：去重，按第一次出现的顺序', () => {
    expect(
      dataSourceRunParamNames(
        'SELECT * FROM t WHERE a = ${id} AND b > ${min} OR a = ${id};\nDELETE FROM u WHERE c = ${名称}'
      )
    ).toEqual(['id', 'min', '名称'])
  })

  it('写在字符串、注释里也算；名称去掉首尾空白', () => {
    expect(dataSourceRunParamNames("SELECT '${ tag }' -- ${note}\nSELECT ${tag}")).toEqual([
      'tag',
      'note'
    ])
  })

  it('不认 ? 与 :名称，PostgreSQL 的 :: 不受影响', () => {
    expect(dataSourceRunParamNames('SELECT ?::int, :name, created::date FROM t')).toEqual([])
  })

  it('空的、跨行的、带花括号的不算参数', () => {
    expect(dataSourceRunParamNames('SELECT ${}, ${  }, ${a\nb}, ${{x}}, $x, {y}')).toEqual([])
  })

  it('Redis 命令同样认', () => {
    expect(dataSourceRunParamNames('GET user:${id}\nEXPIRE user:${id} ${ttl}')).toEqual([
      'id',
      'ttl'
    ])
  })
})

describe('fillDataSourceRunParams', () => {
  it('按文字原样替换，写在哪里都换（含字符串里），同名的都换', () => {
    expect(
      fillDataSourceRunParams("SELECT * FROM t WHERE a = ${id} AND b = '${ id }-${tag}'", {
        id: '42',
        tag: 'x y'
      })
    ).toBe("SELECT * FROM t WHERE a = 42 AND b = '42-x y'")
  })

  it('值不加引号、不转义；空值即换成空', () => {
    expect(fillDataSourceRunParams('SET k ${v}\nGET ${key}', { v: '"a b"', key: '' })).toBe(
      'SET k "a b"\nGET '
    )
  })

  it('没给值的参数与不算参数的原样留着', () => {
    expect(fillDataSourceRunParams('SELECT ${a}, ${b}, ${}', { a: '1' })).toBe(
      'SELECT 1, ${b}, ${}'
    )
  })

  it('只换一遍：填的值里的 ${…} 不再展开', () => {
    expect(fillDataSourceRunParams('SELECT ${a}', { a: '${b}', b: '2' })).toBe('SELECT ${b}')
  })

  it('只认自己的键，不认原型上的', () => {
    expect(fillDataSourceRunParams('SELECT ${constructor}', {})).toBe('SELECT ${constructor}')
  })
})

describe('dataSourceRunTarget', () => {
  it('SQLite 与没指定库时照数据源的', () => {
    const file: DataSourceTarget = { kind: 'sqlite', file: '/tmp/app.db' }
    expect(dataSourceRunTarget(file, 'main')).toBe(file)
    expect(dataSourceRunTarget(pg)).toBe(pg)
    expect(dataSourceRunTarget(pg, '')).toBe(pg)
  })

  it('指定了库就换成那个库（Redis 为库编号）', () => {
    expect(dataSourceRunTarget(pg, 'report')).toEqual({ ...pg, database: 'report' })
    const mysql = { ...pg, kind: 'mysql', port: 3306 } as DataSourceTarget
    expect(dataSourceRunTarget(mysql, 'report')).toEqual({ ...mysql, database: 'report' })
    const redis: DataSourceTarget = {
      kind: 'redis',
      host: 'cache',
      port: 6379,
      user: '',
      database: '',
      tls: false,
      direct: false
    }
    expect(dataSourceRunTarget(redis, '3')).toEqual({ ...redis, database: '3' })
  })
})

describe('dataSourceRunSucceeded', () => {
  it('要执行的全都执行了、没有出错才算成功', () => {
    expect(dataSourceRunSucceeded(sql(ok('a'), ok('b')), 2)).toBe(true)
    expect(dataSourceRunSucceeded({ kind: 'redis', results: [reply('SET a 1')] }, 1)).toBe(true)
  })

  it('中间出错、被取消都算失败', () => {
    const failed: ConsoleStatementResult = {
      sql: 'b',
      ms: 1,
      outcome: { kind: 'error', message: 'syntax error' }
    }
    const canceled: ConsoleStatementResult = { sql: 'b', ms: 1, outcome: { kind: 'canceled' } }
    expect(dataSourceRunSucceeded(sql(ok('a'), failed), 3)).toBe(false)
    expect(dataSourceRunSucceeded(sql(ok('a'), canceled), 2)).toBe(false)
    expect(
      dataSourceRunSucceeded({ kind: 'redis', results: [reply('SET a 1'), reply('BAD', true)] }, 2)
    ).toBe(false)
  })

  it('停在中途（在两条之间被停止）算失败', () => {
    expect(dataSourceRunSucceeded(sql(ok('a')), 2)).toBe(false)
    expect(dataSourceRunSucceeded({ kind: 'redis', results: [reply('SET a 1')] }, 2)).toBe(false)
  })

  it('什么都没执行、整个没能执行都算失败', () => {
    expect(dataSourceRunSucceeded(sql(), 0)).toBe(false)
    expect(dataSourceRunSucceeded({ kind: 'redis', results: [] }, 0)).toBe(false)
    expect(dataSourceRunSucceeded({ kind: 'error', message: '已取消' }, 1)).toBe(false)
  })
})

describe('RUN_PARAM_SOURCE', () => {
  it('与认参数的规则一致：整个 ${…} 算一个，不跨行、不含花括号', () => {
    const pattern = new RegExp(`^${RUN_PARAM_SOURCE}$`)
    expect(pattern.test('${id}')).toBe(true)
    expect(pattern.test('${ user name }')).toBe(true)
    expect(pattern.test('${}')).toBe(true)
    expect(pattern.test('${a\nb}')).toBe(false)
    expect(pattern.test('${a{b}}')).toBe(false)
    expect(pattern.test('$id')).toBe(false)
  })
})
