import { describe, expect, it } from 'vitest'
import type { DataSourceTarget } from './data-source'
import type { ConsoleStatementResult } from './data-source-query'
import {
  dataSourceRunSucceeded,
  dataSourceRunTarget,
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
