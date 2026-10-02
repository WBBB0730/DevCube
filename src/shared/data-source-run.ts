// 数据源上的配置的一次运行（docs/prd/database.md「运行配置」，ADR-0044）：渲染端交来的运行输入、主进程持有的结果，
// 以及据此得出的连接目标与结束状态。参数见 run-params。

import type { DataSourceConnectPassword, DataSourceTarget } from './data-source'
import type { ConsoleRun } from './data-source-query'
import type { RedisCommandResult } from './redis'

/**
 * 运行数据源上的配置时，渲染端交来的：切好的各条语句（Redis 为各行命令），以及密码框交上来的密码（没出密码框时为
 * null）。语句用控制台同一套切法切（lang-sql 的语法树切词），主进程就不必带上 CodeMirror 的语言包及其界面依赖。
 */
export interface DataSourceRunInput {
  statements: string[]
  password: DataSourceConnectPassword | null
}

/**
 * 一次运行的结果（主进程持有，执行完一次推送）：SQL 为各条语句的结果与最后一个结果集，Redis 为各条命令的回复；
 * error 为整个没能执行的原因（数据源已移除、没有要执行的语句、库编号不对、连不上、连上之前被停止等）。
 * null = 还没有结果（连接中、等密码或执行中）。
 */
export type DataSourceRunOutput =
  | { kind: 'sql'; run: ConsoleRun }
  | { kind: 'redis'; results: RedisCommandResult[] }
  | { kind: 'error'; message: string }

export interface DataSourceRunOutputEvent {
  key: string
  output: DataSourceRunOutput | null
}

/** 运行时的连接目标：配置指定了库就换成那个库（Redis 为库编号），SQLite 与没指定时照数据源的。 */
export function dataSourceRunTarget(target: DataSourceTarget, database?: string): DataSourceTarget {
  if (target.kind === 'sqlite' || database === undefined || database === '') return target
  return { ...target, database }
}

/**
 * 这次运行算不算成功：要执行的 total 条全都执行了且没有出错、没有被取消。停在中途（包括在两条之间被停止）、
 * 整个没能执行都算失败。
 */
export function dataSourceRunSucceeded(output: DataSourceRunOutput, total: number): boolean {
  switch (output.kind) {
    case 'sql':
      return (
        total > 0 &&
        output.run.statements.length === total &&
        output.run.statements.every(
          (s) => s.outcome.kind !== 'error' && s.outcome.kind !== 'canceled'
        )
      )
    case 'redis':
      return total > 0 && output.results.length === total && output.results.every((r) => !r.error)
    case 'error':
      return false
  }
}
