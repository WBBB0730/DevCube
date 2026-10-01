// 导出（docs/prd/database.md「导出」）：一条查询的结果边读边写到文件。PostgreSQL 用游标分批读；MySQL 用 mysql2 的
// 流式读取，写不及时暂停连接（背压）；SQLite 在查询线程里自己读写，数据不经过主线程。
// 文件打不开、写入出错（没有权限、被别的程序占用、磁盘满）都以 reject 报给调用方。写入出错时 PostgreSQL、SQLite 的
// 语句随之结束；MySQL 没法在同一条连接上中途结束语句，要调用方另开连接 KILL QUERY（见 exportQuery）。

import { open, writeFile } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import type { FieldPacket } from 'mysql2'
import type pg from 'pg'
import Cursor from 'pg-cursor'
import type { SqlKind } from '../shared/data-source'
import {
  CONSOLE_EXPORT_TABLE,
  exportWriter,
  type ExportFormat,
  type ExportWriter,
  type InsertTarget
} from '../shared/data-source-export'
import {
  dialectOf,
  quoteIdent,
  type ExportResult,
  type ResultSet,
  type ResultValue
} from '../shared/data-source-query'
import {
  mysqlColumns,
  mysqlRow,
  PG_RAW_TYPES,
  pgColumns,
  watchMysqlLost,
  type SqlClient
} from './data-source-connect'

/** 每批这么多行：PostgreSQL 的游标每次读这么多，MySQL 攒够这么多行写一次。 */
const BATCH_ROWS = 1000

/**
 * 先打开文件（打不开即失败，语句还没开始执行），再把 chunks 边生成边写进去。pipeline 管背压；任何一方出错即 reject，
 * 写入出错时提前结束 chunks，由它的 finally 收尾。chunks 是还没开始执行的生成器。
 */
async function writeChunks(file: string, chunks: AsyncGenerator<string>): Promise<void> {
  const handle = await open(file, 'w')
  await pipeline(chunks, handle.createWriteStream())
}

async function exportPostgres(
  c: Extract<SqlClient, { kind: 'postgresql' }>,
  sql: string,
  file: string,
  format: ExportFormat,
  target: InsertTarget
): Promise<number> {
  let count = 0
  async function* chunks(): AsyncGenerator<string> {
    const cursor = c.client.query(new Cursor(sql, [], { rowMode: 'array', types: PG_RAW_TYPES }))
    // 语句已经结束（读完，或读取出错）；否则是写入出错、提前停下，要关掉游标结束语句
    let ended = false
    try {
      let writer: ExportWriter | null = null
      for (;;) {
        const { rows, fields } = await new Promise<{ rows: unknown[][]; fields: pg.FieldDef[] }>(
          (resolve, reject) =>
            cursor.read(BATCH_ROWS, (error, rows, result) =>
              error ? reject(error) : resolve({ rows, fields: result.fields })
            )
        )
        if (writer === null) {
          writer = exportWriter(format, 'postgresql', pgColumns(fields), target)
          yield writer.head
        }
        if (rows.length > 0) {
          const rowWriter = writer
          // 游标用原样取文字的类型解析，每一格都是 ResultValue
          yield rows.map((row) => rowWriter.row(row as ResultValue[])).join('')
          count += rows.length
        }
        // 不满一批即已读完：游标这时已经结束，再读回的只有空行、不带结果信息（取不到 fields）
        if (rows.length < BATCH_ROWS) break
      }
      ended = true
      yield writer.tail
    } catch (error) {
      ended = true
      throw error
    } finally {
      if (!ended) await cursor.close()
    }
  }
  await writeChunks(file, chunks())
  return count
}

async function exportMysql(
  c: Extract<SqlClient, { kind: 'mysql' }>,
  sql: string,
  file: string,
  format: ExportFormat,
  target: InsertTarget
): Promise<number> {
  let count = 0
  async function* chunks(): AsyncGenerator<string> {
    // 发出查询前挂上：查询期间连接断开时以断开的原因结束行流（见 watchMysqlLost）
    const { lost, unwatch } = watchMysqlLost(c.connection)
    // 这边没来取下一行（写不及时）时 mysql2 暂停连接
    const rows = c.connection.query({ sql, rowsAsArray: true }).stream()
    lost.catch((error: Error) => rows.destroy(error))
    // 列信息先于各行到达，到了就备好表头；没有结果集的语句（只有一个 OK 包）没有列信息，什么也不写
    const result: { fields: FieldPacket[]; writer: ExportWriter | null } = {
      fields: [],
      writer: null
    }
    let text = ''
    rows.once('fields', (fields: FieldPacket[]) => {
      result.fields = fields
      result.writer = exportWriter(format, 'mysql', mysqlColumns(fields), target)
      text = result.writer.head
    })
    // 语句已经结束（读完，或出错）；否则是写入出错、提前停下
    let ended = false
    try {
      for await (const row of rows) {
        const { fields, writer } = result
        if (writer === null || !Array.isArray(row)) continue
        text += writer.row(mysqlRow(row, fields))
        count += 1
        if (count % BATCH_ROWS === 0) {
          yield text
          text = ''
        }
      }
      ended = true
      if (result.writer !== null) yield text + result.writer.tail
    } catch (error) {
      ended = true
      throw error
    } finally {
      unwatch()
      // 提前停下时结束 for await 即销毁行流，之后到达的行都丢弃（mysql2 随之恢复读取连接，并不停止接收）。destroy()
      // 只是半关：此后不再发新命令，但在途结果仍会从网络上收完；要服务器停下，须调用方另发 KILL QUERY（见 exportQuery）
      if (!ended) c.connection.destroy()
    }
  }
  await writeChunks(file, chunks())
  return count
}

/**
 * 把一条查询的结果边读边写到文件，返回写了多少行；出错即 reject。target 为 SQL INSERT 写进哪张表（见 InsertTarget）。
 * c 是导出专用的连接。MySQL 出错 reject 时服务器上的语句可能还在执行、结果还在发来（mysql2 没法在同一条连接上中途
 * 结束语句）：调用方须在 reject 之后、closeClient 之前另开连接对 c.connection.threadId 发 KILL QUERY（与取消控制台
 * 同一套做法），服务器才会结束语句、不再发剩下的结果。
 */
export function exportQuery(
  c: SqlClient,
  sql: string,
  file: string,
  format: ExportFormat,
  target: InsertTarget
): Promise<number> {
  switch (c.kind) {
    case 'postgresql':
      return exportPostgres(c, sql, file, format, target)
    case 'mysql':
      return exportMysql(c, sql, file, format, target)
    case 'sqlite':
      return c.client.exportTo(sql, file, format, target)
  }
}

/**
 * 控制台、运行会话已取回的结果直接写成文件（最多 1 万行），按 kind 的方言写；不知道来自哪张表，SQL INSERT 的表名
 * 写成 CONSOLE_EXPORT_TABLE。文件写不了（没有权限、被占用、磁盘满）作为结果交回。
 */
export async function exportResultRows(
  kind: SqlKind,
  result: ResultSet,
  format: ExportFormat,
  file: string
): Promise<ExportResult> {
  const dialect = dialectOf(kind)
  const writer = exportWriter(format, dialect, result.columns, {
    table: quoteIdent(dialect, CONSOLE_EXPORT_TABLE),
    generated: [],
    alwaysIdentity: []
  })
  try {
    await writeFile(file, writer.head + result.rows.map(writer.row).join('') + writer.tail)
    return { path: file }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}
