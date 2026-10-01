// 数据源上的配置的运行（docs/prd/database.md「运行配置」，ADR-0044）：每次运行开一条自己的连接（挂在数据源连接会话里，
// 键即运行会话键），连上后把渲染端切好的语句依次执行、遇错即停，执行完即断开。结果是表格与语句列表（Redis 为
// redis-cli 式的记录），由这里持有、执行完一次推送；对渲染端仍是运行会话那一套状态与移除推送，经 runner 注入的
// sink 发出（runner 把运行、停止、关闭转到这里）。
// 停止即取消：还在连接或等密码时直接以「已取消」结束；执行中叫停正在执行的语句并断开，被打断的那条记为已取消。
// 重跑先叫停旧的一次。运行结束、被重跑取代时断开连接并推送未连接，渲染端不留上一次的连接状态。
// 退出时还在执行的语句由 disposeAllDataSourceSessions 叫停并断开。

import { redisDatabaseError } from '../shared/data-source'
import { queryFailureText, type ConsoleRun, type QueryFailure } from '../shared/data-source-query'
import {
  dataSourceRunSucceeded,
  type DataSourceRunInput,
  type DataSourceRunOutput,
  type DataSourceRunOutputEvent
} from '../shared/data-source-run'
import type { RedisCommandResult, RedisFailure } from '../shared/redis'
import type { DataSourceRunConfig, SessionState, SessionStatus } from '../shared/types'
import {
  closeDataSourceRunSession,
  closeDataSourceSession,
  connectDataSourceRun,
  runDataSourceConsole,
  runRedisCommands
} from './data-source-sessions'
import { findDataSource } from './data-sources'

/** 一条配置的一次运行（单实例：重跑即换成新的一次，键不变）。 */
interface DataSourceRun {
  key: string
  status: SessionStatus
  exitCode: number | null
  /** 执行完的结果；还没有时为 null */
  output: DataSourceRunOutput | null
  /** 要执行的条数：停在中途（包括在两条之间被停止）即算失败 */
  total: number
  /** 被停止了：一律按失败结束 */
  stopped: boolean
  /**
   * 在执行语句（停止时要叫停）；否则还在连接，或在等密码（密码被拒：运行会话仍在运行，等未连接页的密码框交上来，
   * 交上来即带着密码重跑）
   */
  executing: boolean
}

const runs = new Map<string, DataSourceRun>()

export interface DataSourceRunSink {
  /** 运行状态变了（同其他运行会话） */
  status: (state: SessionState) => void
  /** 结果变了：开始运行时清空，执行完交回 */
  output: (event: DataSourceRunOutputEvent) => void
  /** 这次运行被丢掉了（关 Tab、删配置、移除数据源） */
  removed: (key: string) => void
}

let sink: DataSourceRunSink | null = null

/** 状态、结果与移除推给谁：由 runner 绑定（与其他运行会话同一套推送）。 */
export function setDataSourceRunSink(next: DataSourceRunSink): void {
  sink = next
}

function snapshot(run: DataSourceRun): SessionState {
  return { key: run.key, status: run.status, exitCode: run.exitCode }
}

function emit(run: DataSourceRun): void {
  sink?.output({ key: run.key, output: run.output })
  sink?.status(snapshot(run))
}

/** 这一次还在跑：没有被重跑取代、没有被丢掉，也还没结束。 */
function live(run: DataSourceRun): boolean {
  return runs.get(run.key) === run && run.status === 'running'
}

/**
 * 结束这一次（已结束、已被取代的不再处理）：记下结果、断开它的连接；全部执行完、没出错也没被停止才算成功。
 * 先交回结果再断开：断开推送的未连接晚于结果到达，渲染端不会在结果到达前先闪一下「连接中」。
 */
function end(run: DataSourceRun, output: DataSourceRunOutput): void {
  if (!live(run)) return
  run.output = output
  run.status = !run.stopped && dataSourceRunSucceeded(output, run.total) ? 'exited' : 'failed'
  run.exitCode = run.status === 'exited' ? 0 : null
  emit(run)
  closeDataSourceRunSession(run.key)
}

/** 整个没能执行：结果为原因。 */
function fail(run: DataSourceRun, message: string): void {
  end(run, { kind: 'error', message })
}

/** 控制台执行的结果换成运行结果：无权与别的失败都算整个没能执行。 */
function sqlOutput(result: ConsoleRun | QueryFailure): DataSourceRunOutput {
  if ('statements' in result) return { kind: 'sql', run: result }
  return { kind: 'error', message: queryFailureText(result, '无权执行') }
}

function redisOutput(result: RedisCommandResult[] | RedisFailure): DataSourceRunOutput {
  return Array.isArray(result)
    ? { kind: 'redis', results: result }
    : { kind: 'error', message: result.error }
}

export function isDataSourceRun(key: string): boolean {
  return runs.has(key)
}

export function getDataSourceRunStates(): SessionState[] {
  return [...runs.values()].map(snapshot)
}

export function getDataSourceRunOutput(key: string): DataSourceRunOutput | null {
  return runs.get(key)?.output ?? null
}

/**
 * 运行一次：input 为渲染端切好的语句与密码框交上来的密码（见 DataSourceRunInput）。先占住运行会话、推送运行中，
 * 连接与执行随后进行；库按配置覆盖，类型按数据源当前的类型。
 */
export async function runDataSourceConfig(
  key: string,
  config: DataSourceRunConfig,
  input?: DataSourceRunInput
): Promise<void> {
  // 单实例：重跑先叫停旧的一次（叫停语句并断开，推送未连接），旧的随后发现自己已被取代，什么都不做
  if (runs.get(key)?.status === 'running') closeDataSourceRunSession(key)
  const statements = input?.statements ?? []
  const run: DataSourceRun = {
    key,
    status: 'running',
    exitCode: null,
    output: null,
    total: statements.length,
    stopped: false,
    executing: false
  }
  runs.set(key, run)
  emit(run)

  const dataSource = findDataSource(config.dataSourceId)
  if (dataSource === null) {
    fail(run, '数据源已移除，无法运行')
    return
  }
  if (statements.length === 0) {
    fail(run, '没有要执行的语句')
    return
  }
  // 数据源改成 Redis 后，配置里原来的库名当不了库编号：连接前就说明
  const databaseError =
    dataSource.target.kind === 'redis' ? redisDatabaseError(config.database ?? '') : null
  if (databaseError !== null) {
    fail(run, databaseError)
    return
  }

  const state = await connectDataSourceRun(
    key,
    dataSource,
    config.database,
    input?.password ?? null
  )
  if (!live(run)) return
  if (state.phase === 'disconnected') {
    // 密码被拒：保持运行中，等未连接页的密码框（同服务器上的配置运行时弹提问）
    if (!state.passwordRejected) fail(run, state.message)
    return
  }
  if (state.phase !== 'connected') {
    fail(run, '已取消')
    return
  }

  run.executing = true
  const output =
    dataSource.target.kind === 'redis'
      ? redisOutput(await runRedisCommands(key, statements))
      : sqlOutput(await runDataSourceConsole(key, statements))
  // 执行期间被重跑取代、被丢掉时 end 什么都不做（不能关掉新一次的连接）
  end(run, output)
}

/**
 * 停止即取消：执行中叫停正在执行的语句并断开，被打断的那条记为已取消，执行收尾后按失败结束（这时才推送未连接，
 * 结果到达前仍显示在执行）；还在连接或等密码时直接以「已取消」结束（连接随之断开，晚到的连接连上即关）。
 */
export function stopDataSourceRun(key: string): void {
  const run = runs.get(key)
  if (run === undefined || !live(run)) return
  run.stopped = true
  if (run.executing) closeDataSourceSession(key)
  else fail(run, '已取消')
}

/** 关 Tab、删配置、移除数据源：在跑则叫停并断开，丢掉这一次的状态与结果，通知渲染端移除。 */
export function disposeDataSourceRun(key: string): void {
  const run = runs.get(key)
  if (run === undefined) return
  runs.delete(key)
  if (run.status === 'running') closeDataSourceSession(key)
  sink?.removed(key)
}
