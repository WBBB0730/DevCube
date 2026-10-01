// SQLite 连接：一个查询线程持有一个数据库文件（见 data-source-sqlite-worker）。关闭或取消即结束线程：进行中的查询当场
// 以「查询已取消」失败，不等线程真正结束（见 close）。

import { Worker } from 'node:worker_threads'
import type { ExportFormat, InsertTarget } from '../shared/data-source-export'
import type { QueryOutcome } from '../shared/data-source-query'
import type {
  SqliteMessage,
  SqliteReplies,
  SqliteRequestKind,
  SqliteRequests,
  SqliteWorkerData
} from './data-source-sqlite-worker'
import workerPath from './data-source-sqlite-worker?modulePath'

function errorOf(message: string, code?: string): Error {
  return Object.assign(new Error(message), code === undefined ? {} : { code })
}

export class SqliteClient {
  private seq = 0
  /** 线程已结束（关闭、取消后真正结束了，或意外退出） */
  private exited = false
  /** 已关闭或线程已结束：之后的请求不再发出 */
  private closed = false
  /** 线程里没接住的异常（线程随之结束）：意外退出的原因 */
  private crash: Error | null = null
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()

  private constructor(private readonly worker: Worker) {
    worker.on('message', (message: SqliteMessage) => {
      if (message.type === 'ready' || message.type === 'failed') return
      const request = this.pending.get(message.id)
      if (request === undefined) return
      this.pending.delete(message.id)
      if (message.type === 'error') request.reject(errorOf(message.message, message.code))
      else request.resolve(message.value)
    })
    worker.on('error', (error) => {
      this.crash = error
    })
    // 线程结束（关闭后真正结束，或意外退出）：还在等结果的查询一并失败（关闭的在关闭时已先失败）
    worker.on('exit', () => {
      this.exited = true
      this.abandon()
    })
  }

  /** 不再收发：还在等结果的查询一并以「查询已取消」失败，之后的请求也不再发出。 */
  private abandon(): void {
    this.closed = true
    for (const request of this.pending.values()) request.reject(new Error('查询已取消'))
    this.pending.clear()
  }

  /** 打开数据库文件：线程起来并打开成功才算连上。 */
  static open(file: string): Promise<SqliteClient> {
    const worker = new Worker(workerPath, { workerData: { file } satisfies SqliteWorkerData })
    return new Promise((resolve, reject) => {
      worker.once('message', (message: SqliteMessage) => {
        if (message.type === 'ready') resolve(new SqliteClient(worker))
        else if (message.type === 'failed') reject(errorOf(message.message, message.code))
      })
      worker.once('error', reject)
    })
  }

  /**
   * 查询线程结束时回调一次（关闭、取消也算，由调用方区分）；线程抛出了没接住的异常时带上它。
   * 注册时线程已经结束则立即回调。
   */
  onExit(cb: (crash: Error | null) => void): void {
    if (this.exited) cb(this.crash)
    else this.worker.once('exit', () => cb(this.crash))
  }

  /** 发一个请求给线程，等它那种请求的回复（回复按 id 对上请求，是哪种回复由线程的协议保证）。 */
  private send<K extends SqliteRequestKind>(
    kind: K,
    body: SqliteRequests[K]
  ): Promise<SqliteReplies[K]>
  private send(kind: SqliteRequestKind, body: SqliteRequests[SqliteRequestKind]): Promise<unknown> {
    // 发给已结束的线程的消息会被悄悄丢掉，永远等不到回应
    if (this.closed) return Promise.reject(new Error('连接已断开'))
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ kind, id, ...body })
    })
  }

  query(sql: string, params: unknown[] = [], maxRows?: number): Promise<QueryOutcome> {
    return this.send('query', { sql, params, maxRows })
  }

  /** 把查询结果写到文件（在线程里边读边写），返回写了多少行。 */
  exportTo(sql: string, file: string, format: ExportFormat, target: InsertTarget): Promise<number> {
    return this.send('export', { sql, file, format, target })
  }

  /** 连接上是否开着事务（控制台里 BEGIN 之后、COMMIT / ROLLBACK 之前）：这时结束线程会把事务悄悄回滚。 */
  inTransaction(): Promise<boolean> {
    return this.send('inTransaction', {})
  }

  /**
   * 结束线程：还在等结果的查询当场以「查询已取消」失败，不等线程真正结束。线程回到 JS 时即结束、锁随之释放；正停在
   * 一步原生调用里（一步就要算很久的 count、聚合、不出行的递归 CTE）时要等这一步做完——better-sqlite3 没有
   * sqlite3_interrupt，打断不了，这一步若是自动提交的写入，照样会提交。
   */
  close(): void {
    this.abandon()
    void this.worker.terminate()
  }
}
