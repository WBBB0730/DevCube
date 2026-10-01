// 数据源上的配置的一次运行（docs/prd/database.md「运行配置」，ADR-0044）：配置里的参数与替换、渲染端交来的运行输入、
// 主进程持有的结果，以及据此得出的连接目标与结束状态。

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

/** 运行配置的参数值：参数名 → 填的值。 */
export type DataSourceRunParams = Record<string, string>

/** 参数花括号里的文字：不跨行、不含花括号。 */
const RUN_PARAM_BODY = '[^{}\\r\\n]*'

/**
 * 参数的写法 `${…}`（正则的源码，不带捕获组）：格式化 SQL 时据此把参数认作一个整体、原样保留（sql-formatter 默认
 * 遇到它会报错）。与下面认参数的正则同源，两处不会各认各的。
 */
export const RUN_PARAM_SOURCE = `\\$\\{${RUN_PARAM_BODY}\\}`

/**
 * 运行配置里的参数：`${名称}`，名称为花括号里去掉首尾空白的文字（不跨行、不含花括号）。只认这一种写法，不认 `?` 与
 * `:名称`：免得与 PostgreSQL 的 `::` 类型转换冲突，也免得普通语句误弹参数框。
 */
const RUN_PARAM = new RegExp(`\\$\\{(${RUN_PARAM_BODY})\\}`, 'g')

/** 参数名：花括号里去掉首尾空白；空的（`${}`、只有空白）不算参数，为 null。 */
function runParamName(inner: string): string | null {
  const name = inner.trim()
  return name === '' ? null : name
}

/** 配置内容里的参数名：写在哪里都算（含字符串、注释里），去重，按第一次出现的顺序。 */
export function dataSourceRunParamNames(script: string): string[] {
  const names = new Set<string>()
  for (const match of script.matchAll(RUN_PARAM)) {
    const name = runParamName(match[1]!)
    if (name !== null) names.add(name)
  }
  return [...names]
}

/**
 * 把参数按文字原样换成填的值（不加引号、不转义）；没给值的参数与不算参数的原样留着。只换一遍，填的值里的 `${…}`
 * 不再展开。
 */
export function fillDataSourceRunParams(script: string, params: DataSourceRunParams): string {
  return script.replace(RUN_PARAM, (whole, inner: string) => {
    const name = runParamName(inner)
    return name !== null && Object.hasOwn(params, name) ? params[name]! : whole
  })
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
