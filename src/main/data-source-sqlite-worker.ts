// SQLite 的查询线程（docs/prd/database.md「SQLite 并发」）：better-sqlite3 是同步接口，放在主线程里大查询会卡住整个
// 应用。一个线程持有一个数据库文件，逐条执行主线程发来的语句；限了行数的查询读够就结束语句，不长时间占着读锁。

import { closeSync, openSync, writeSync } from 'node:fs'
import { parentPort, workerData } from 'node:worker_threads'
import Database from 'better-sqlite3'
import { exportWriter, type ExportFormat, type InsertTarget } from '../shared/data-source-export'
import type { QueryOutcome, ResultColumnType, ResultValue } from '../shared/data-source-query'

export interface SqliteWorkerData {
  file: string
}

/** 各种请求带的内容（按种类）。 */
export interface SqliteRequests {
  query: { sql: string; params: unknown[]; maxRows?: number }
  /** 导出：在线程里边读边写文件，数据不经过主线程；target 为 SQL INSERT 写进哪张表 */
  export: { sql: string; file: string; format: ExportFormat; target: InsertTarget }
  /** 连接上是否开着事务（BEGIN 之后、COMMIT / ROLLBACK 之前） */
  inTransaction: Record<never, never>
}

/** 各种请求成功时的回复（按种类）；出错时回 error。 */
export interface SqliteReplies {
  query: QueryOutcome
  export: number
  inTransaction: boolean
}

export type SqliteRequestKind = keyof SqliteRequests

export type SqliteRequest = {
  [K in SqliteRequestKind]: { kind: K; id: number } & SqliteRequests[K]
}[SqliteRequestKind]

export type SqliteMessage =
  | { type: 'ready' }
  | { type: 'failed'; message: string; code?: string }
  | { type: 'reply'; id: number; value: SqliteReplies[SqliteRequestKind] }
  | { type: 'error'; id: number; message: string; code?: string }

const port = parentPort!
const post = (message: SqliteMessage): void => port.postMessage(message)

function toValue(value: unknown): ResultValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return { hex: value.toString('hex') }
  return String(value)
}

/**
 * 数字列：看取回的值——SQLite 按值存类型，声明类型不可靠（DATE、BOOLEAN 这类声明的亲和性是 NUMERIC，
 * 存的却多半是文字）。取回的非 NULL 值全是整数或实数才算数字列。
 */
function columnType(values: unknown[]): ResultColumnType {
  const present = values.filter((v) => v !== null && v !== undefined)
  return present.length > 0 && present.every((v) => typeof v === 'number' || typeof v === 'bigint')
    ? 'number'
    : 'text'
}

function errorOf(error: unknown): { message: string; code?: string } {
  const { message, code } = error as { message?: unknown; code?: unknown }
  return { message: String(message ?? error), ...(typeof code === 'string' ? { code } : {}) }
}

let db: Database.Database
try {
  // 文件不存在报错而不是新建；写入遇到锁最多等 5 秒
  db = new Database((workerData as SqliteWorkerData).file, { fileMustExist: true, timeout: 5_000 })
  // 打开时还没读文件：读一下文件头，不是数据库（SQLITE_NOTADB）时连接这一步就失败
  db.pragma('schema_version')
  post({ type: 'ready' })
} catch (error) {
  post({ type: 'failed', ...errorOf(error) })
  process.exit()
}

function query(sql: string, params: unknown[], maxRows?: number): QueryOutcome {
  const statement = db.prepare(sql)
  if (!statement.reader) return { kind: 'affected', count: statement.run(...params).changes }
  statement.raw(true).safeIntegers(true)
  const rows: unknown[][] = []
  let truncated = false
  for (const row of statement.iterate(...params) as Iterable<unknown[]>) {
    if (maxRows !== undefined && rows.length === maxRows) {
      truncated = true
      break
    }
    rows.push(row)
  }
  const columns = statement.columns().map((column, i) => ({
    name: column.name,
    type: columnType(rows.map((row) => row[i]))
  }))
  return { kind: 'rows', truncated, columns, rows: rows.map((row) => row.map(toValue)) }
}

/** 列的类型按前这么多行判断，之后边读边写 */
const EXPORT_SAMPLE_ROWS = 1000
/** 攒够这么多字再写一次盘 */
const EXPORT_CHUNK_CHARS = 1 << 16

function exportTo(sql: string, file: string, format: ExportFormat, target: InsertTarget): number {
  const statement = db.prepare(sql)
  statement.raw(true).safeIntegers(true)
  // 先打开文件：打不开即失败，语句还没开始执行
  const fd = openSync(file, 'w')
  try {
    return writeRows(statement, fd, format, target)
  } finally {
    closeSync(fd)
  }
}

/** 执行语句，边读边写进文件，返回写了多少行。 */
function writeRows(
  statement: Database.Statement,
  fd: number,
  format: ExportFormat,
  target: InsertTarget
): number {
  const rows = statement.iterate() as IterableIterator<unknown[]>
  try {
    // 取样用 next() 手动读：for-of 中途 break 会调迭代器的 return()，语句随之结束，后面的行就读不到了
    const sample: unknown[][] = []
    while (sample.length < EXPORT_SAMPLE_ROWS) {
      const next = rows.next()
      if (next.done) break
      sample.push(next.value)
    }
    const columns = statement.columns().map((column, i) => ({
      name: column.name,
      type: columnType(sample.map((row) => row[i]))
    }))
    const writer = exportWriter(format, 'sqlite', columns, target)
    let buffer = writer.head
    let count = 0
    const push = (row: unknown[]): void => {
      buffer += writer.row(row.map(toValue))
      count += 1
      if (buffer.length >= EXPORT_CHUNK_CHARS) {
        writeSync(fd, buffer)
        buffer = ''
      }
    }
    sample.forEach(push)
    for (const row of rows) push(row)
    writeSync(fd, buffer + writer.tail)
    return count
  } finally {
    // 写入出错提前停下时结束语句，否则连接一直忙着、之后的写入语句都执行不了；读完时语句已经结束，这一步什么也不做
    rows.return?.()
  }
}

/** 执行一个请求，交回它的回复；出错即抛出。 */
function handle(request: SqliteRequest): SqliteReplies[SqliteRequestKind] {
  switch (request.kind) {
    case 'query':
      return query(request.sql, request.params, request.maxRows)
    case 'export':
      return exportTo(request.sql, request.file, request.format, request.target)
    case 'inTransaction':
      return db.inTransaction
  }
}

port.on('message', (request: SqliteRequest) => {
  try {
    post({ type: 'reply', id: request.id, value: handle(request) })
  } catch (error) {
    post({ type: 'error', id: request.id, ...errorOf(error) })
  }
})
