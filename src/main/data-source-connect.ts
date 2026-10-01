// 数据源的连接：按类型建立到数据库的连接（docs/prd/database.md「加密」「直连」，ADR-0043）。
// - 加密默认档「能加密就加密、不校验证书」：先按加密连，服务器明确回答不支持加密时改用不加密重连
//   （同 libpq 的 sslmode=prefer、MySQL 的 PREFERRED；pg 与 mysql2 自己没有这一档）。连接串写明的要求照办。
// - 绕开代理直连（ADR-0039）：从实体网卡连真实地址；驱动的 host 仍是原主机名，TLS 的 SNI 与证书校验不受影响。
// - 每条连接一建立就挂上 error 监听（见 listenErrors），不论是会话的连接还是临时连接。

import type { EventEmitter } from 'node:events'
import { Socket, connect as netConnect } from 'node:net'
import mysql, { type FieldPacket, type OkPacket } from 'mysql2'
import pg from 'pg'
import Cursor from 'pg-cursor'
import { createClient, type RedisClientType } from '@redis/client'
import { CONNECT_TIMEOUT_MS, type ConnectionTestResult } from '../shared/connection'
import {
  dataSourceFailureMessage,
  isTlsUnsupported,
  type DataSourceTarget,
  type DataSourceTestInput,
  type SqlServerTarget,
  type SqlTarget,
  type SslMode
} from '../shared/data-source'
import type {
  QueryOutcome,
  ResultColumn,
  ResultColumnType,
  ResultSet,
  ResultValue
} from '../shared/data-source-query'
import { createConnectionTester } from './connection-test'
import { readDataSourcePassword } from './data-sources'
import { SqliteClient } from './data-source-sqlite'
import { resolveDirectRoute, type DirectRoute } from './ssh-direct'

/** pg 对传入的 stream 调 connect(port, host)：改为按直连路线连接。 */
class DirectSocket extends Socket {
  constructor(private readonly route: DirectRoute) {
    super()
  }

  override connect(...args: unknown[]): this {
    return super.connect({
      port: args[0] as number,
      host: this.route.host,
      localAddress: this.route.localAddress
    })
  }
}

/**
 * 默认档（sslMode 为 null）：先按加密连，服务器明确回答不支持加密（见 isTlsUnsupported）时改用不加密重连；
 * 其余错误照常抛出，不退回明文。写明 disable 时直接不加密。
 */
async function withPreferredTls<T>(
  target: SqlServerTarget,
  connect: (tls: boolean) => Promise<T>
): Promise<T> {
  try {
    return await connect(target.sslMode !== 'disable')
  } catch (error) {
    if (target.sslMode === null && error instanceof Error && isTlsUnsupported(target.kind, error)) {
      return connect(false)
    }
    throw error
  }
}

/**
 * 给新建的连接挂上 error 监听（驱动的要求）：空闲时被服务器断开这类错误没有进行中的操作可报，没有监听时
 * EventEmitter 会把它当异常抛出、使主进程崩溃。进行中的操作出错照常由它自己报给调用方；会话的连接另由
 * onClientLost 上报断开。
 */
function listenErrors<T extends EventEmitter>(connection: T): T {
  connection.on('error', () => {})
  return connection
}

/** 按 libpq 语义：require 与默认档不校验证书；verify-ca 只校验证书链；verify-full 连同主机名一起校验。 */
function pgSsl(sslMode: SslMode | null): pg.ClientConfig['ssl'] {
  if (sslMode === 'verify-full') return { rejectUnauthorized: true }
  if (sslMode === 'verify-ca')
    return { rejectUnauthorized: true, checkServerIdentity: () => undefined }
  return { rejectUnauthorized: false }
}

function mysqlSsl(sslMode: SslMode | null): mysql.SslOptions {
  if (sslMode === 'verify-full') return { rejectUnauthorized: true, verifyIdentity: true }
  if (sslMode === 'verify-ca') return { rejectUnauthorized: true, verifyIdentity: false }
  return { rejectUnauthorized: false }
}

/** 结果一律取数据库给的文字，不经 JS 类型转换（时间、大整数、小数不失真）；bytea 转成十六进制（去掉 `\x`）。 */
export const PG_RAW_TYPES = {
  getTypeParser: (oid: number) =>
    oid === pg.types.builtins.BYTEA
      ? (value: string) => ({ hex: value.slice(2) })
      : (value: string) => value
} as pg.CustomTypesConfig

/** 连到 PostgreSQL 的某个库（缺省为 Data Source 的默认库）。 */
async function connectPostgres(
  target: SqlServerTarget,
  password: string | null,
  database = target.database
): Promise<pg.Client> {
  const route = await resolveDirectRoute(target.host, target.direct)
  return withPreferredTls(target, async (tls) => {
    const client = listenErrors(
      new pg.Client({
        host: target.host,
        port: target.port,
        user: target.user || undefined,
        password: password ?? undefined,
        database: database || undefined,
        ssl: tls ? pgSsl(target.sslMode) : false,
        connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
        types: PG_RAW_TYPES,
        ...(route === null ? {} : { stream: () => new DirectSocket(route) })
      })
    )
    await client.connect()
    return client
  })
}

/** 协议里 TEXT 与 BLOB 同属这几类，只能靠字段的字符集区分：先取原始字节，查完再按字符集转（见 mysqlValue）。 */
const MYSQL_BYTE_TYPES = new Set([
  'TINY_BLOB',
  'MEDIUM_BLOB',
  'LONG_BLOB',
  'BLOB',
  'VAR_STRING',
  'STRING',
  'BIT',
  'GEOMETRY',
  'VECTOR'
])

/**
 * 结果一律取数据库给的文字，不经 JS 类型转换；可能是二进制的几类先取原始字节。MySQL 的 JSON 列字符集总标成二进制，
 * 内容按规范是 UTF-8：照 mysql2 的建议按 UTF-8 解码（默认按二进制解码成乱码，且每格都打一条警告）。
 */
const MYSQL_RAW_TYPE_CAST: mysql.TypeCast = (field) => {
  if (MYSQL_BYTE_TYPES.has(field.type)) return field.buffer()
  return field.type === 'JSON' ? field.string('utf8') : field.string()
}

/**
 * 连到 MySQL / MariaDB（默认库为 Data Source 的默认库）。用回调接口（不是 mysql2/promise）：控制台要按事件逐行收、
 * 读够上限就不再留存（见 mysqlQuery）。
 */
async function connectMysql(
  target: SqlServerTarget,
  password: string | null
): Promise<mysql.Connection> {
  const route = await resolveDirectRoute(target.host, target.direct)
  return withPreferredTls(target, (tls) => {
    const connection = listenErrors(
      mysql.createConnection({
        host: target.host,
        port: target.port,
        user: target.user || undefined,
        password: password ?? undefined,
        database: target.database || undefined,
        ssl: tls ? mysqlSsl(target.sslMode) : undefined,
        connectTimeout: CONNECT_TIMEOUT_MS,
        typeCast: MYSQL_RAW_TYPE_CAST,
        ...(route === null
          ? {}
          : {
              // mysql2 只给自己建的连接开 TCP_NODELAY 与 keepalive，自建的照样开上
              stream: () =>
                netConnect({
                  host: route.host,
                  port: target.port,
                  localAddress: route.localAddress,
                  noDelay: true,
                  keepAlive: true
                })
            })
      })
    )
    return new Promise<mysql.Connection>((resolve, reject) =>
      connection.connect((error) => (error ? reject(error) : resolve(connection)))
    )
  })
}

/**
 * 连到 Redis。协议不能协商加密，TLS 与否按勾选；断线不自动重连（由 Tab 显示断开、用户重连）。用 RESP2（redis-cli 的
 * 默认；node-redis 默认 RESP3）：控制台照 redis-cli 显示回复——分数这类小数是字符串，不会与整数混同；HGETALL 这类
 * 映射是按服务器次序的数组，不解码成 JS 对象（那样会丢掉 __proto__ 字段、把数字字段提到前面）；RESET 也不会让协议
 * 与客户端对不上。
 */
async function connectRedis(
  target: Extract<DataSourceTarget, { kind: 'redis' }>,
  password: string | null
): Promise<RedisClient> {
  const route = await resolveDirectRoute(target.host, target.direct)
  // tls.connect 接受 net.connect 的全部选项（含 localAddress），@types/node 的 TLS 选项里没写这一项
  const socket = {
    host: route?.host ?? target.host,
    port: target.port,
    ...(route === null ? {} : { localAddress: route.localAddress }),
    ...(target.tls ? { tls: true as const, servername: target.host } : {}),
    connectTimeout: CONNECT_TIMEOUT_MS,
    reconnectStrategy: false as const
  }
  const client = listenErrors(
    createClient({
      socket,
      username: target.user || undefined,
      password: password ?? undefined,
      database: target.database === '' ? undefined : Number(target.database),
      RESP: 2
    })
  )
  await client.connect()
  return client
}

/** Redis 的连接（RESP2，见 connectRedis）。 */
export type RedisClient = RedisClientType<
  Record<never, never>,
  Record<never, never>,
  Record<never, never>,
  2
>

/** 一条活的连接（按类型）。PostgreSQL 的连接只通一个库，其余库由会话按需另建。 */
export type DataSourceClient =
  | { kind: 'postgresql'; client: pg.Client }
  | { kind: 'mysql'; connection: mysql.Connection }
  | { kind: 'redis'; client: RedisClient }
  | { kind: 'sqlite'; client: SqliteClient }

/** 执行 SQL 的连接（Redis 以外的）。 */
export type SqlClient = Exclude<DataSourceClient, { kind: 'redis' }>

export async function openClient(
  target: DataSourceTarget,
  password: string | null
): Promise<DataSourceClient> {
  return target.kind === 'redis'
    ? { kind: 'redis', client: await connectRedis(target, password) }
    : openSqlClient(target, password)
}

/**
 * 打开执行 SQL 的连接。database：PostgreSQL 连在哪个库（缺省为连接目标的默认库）；其余类型一条连接看得到全部库，
 * 照连接目标连。
 */
export async function openSqlClient(
  target: SqlTarget,
  password: string | null,
  database?: string
): Promise<SqlClient> {
  switch (target.kind) {
    case 'postgresql':
      return { kind: 'postgresql', client: await connectPostgres(target, password, database) }
    case 'mysql':
    case 'mariadb':
      return { kind: 'mysql', connection: await connectMysql(target, password) }
    case 'sqlite':
      return { kind: 'sqlite', client: await SqliteClient.open(target.file) }
  }
}

// —— 查询 ——

/** PostgreSQL 的数字类型。 */
const PG_NUMBER_TYPES = new Set<number>([
  pg.types.builtins.INT8,
  pg.types.builtins.INT2,
  pg.types.builtins.INT4,
  pg.types.builtins.OID,
  pg.types.builtins.FLOAT4,
  pg.types.builtins.FLOAT8,
  pg.types.builtins.NUMERIC
])

function pgColumnType(dataTypeID: number): ResultColumnType {
  if (PG_NUMBER_TYPES.has(dataTypeID)) return 'number'
  return dataTypeID === pg.types.builtins.BOOL ? 'boolean' : 'text'
}

export function pgColumns(fields: pg.FieldDef[]): ResultColumn[] {
  return fields.map((f) => ({ name: f.name, type: pgColumnType(f.dataTypeID) }))
}

function pgOutcome(result: pg.QueryResult, rows: unknown[][], truncated: boolean): QueryOutcome {
  // 没有列即不返回结果集的语句（INSERT / UPDATE / DDL 等）
  if (result.fields.length === 0) return { kind: 'affected', count: result.rowCount ?? 0 }
  return {
    kind: 'rows',
    truncated,
    columns: pgColumns(result.fields),
    rows: rows as ResultValue[][]
  }
}

/**
 * 限了行数时用游标读 maxRows + 1 行（多的那行只用来判断后面还有没有）。读够上限、后面还有时关游标、结束语句；
 * 没读够即已读完，语句已经结束。读取出错时不关：连接断开后 close() 要等的 readyForQuery 永远不会来，会一直挂起。
 */
async function pgQuery(
  client: pg.Client,
  sql: string,
  params: unknown[],
  maxRows: number | undefined
): Promise<QueryOutcome> {
  if (maxRows === undefined) {
    const result = await client.query({ text: sql, values: params, rowMode: 'array' })
    return pgOutcome(result, result.rows, false)
  }
  // 游标不继承连接上的类型解析，要另给
  const cursor = client.query(new Cursor(sql, params, { rowMode: 'array', types: PG_RAW_TYPES }))
  const { rows, result } = await new Promise<{ rows: unknown[][]; result: pg.QueryResult }>(
    (resolve, reject) =>
      cursor.read(maxRows + 1, (error, rows, result) =>
        error ? reject(error) : resolve({ rows, result })
      )
  )
  const truncated = rows.length > maxRows
  if (truncated) await cursor.close()
  return pgOutcome(result, rows.slice(0, maxRows), truncated)
}

/** MySQL 的数字类型。 */
const MYSQL_NUMBER_TYPES = new Set([
  mysql.Types.DECIMAL,
  mysql.Types.TINY,
  mysql.Types.SHORT,
  mysql.Types.LONG,
  mysql.Types.FLOAT,
  mysql.Types.DOUBLE,
  mysql.Types.LONGLONG,
  mysql.Types.INT24,
  mysql.Types.YEAR,
  mysql.Types.NEWDECIMAL
])

export function mysqlColumns(fields: FieldPacket[]): ResultColumn[] {
  return fields.map((f) => ({
    name: f.name,
    type: MYSQL_NUMBER_TYPES.has(f.columnType ?? -1) ? 'number' : 'text'
  }))
}

/** 一行的值：先取了原始字节的几类按字段的字符集转（二进制为十六进制，其余按 UTF-8 解码）。 */
export function mysqlRow(row: unknown[], fields: FieldPacket[]): ResultValue[] {
  return row.map((value, i) => mysqlValue(value, fields[i]!))
}

function mysqlValue(value: unknown, field: FieldPacket): ResultValue {
  if (value === null || value === undefined) return null
  if (Buffer.isBuffer(value)) {
    return field.characterSet === mysql.Charsets.BINARY
      ? { hex: value.toString('hex') }
      : value.toString('utf8')
  }
  return String(value)
}

/**
 * 事件式查询（含 stream()）期间连接断开的通知：lost 以断开的原因 reject。mysql2 把没有错误包的网络错误（ETIMEDOUT、
 * ECONNRESET 这类）只报给连接的 error 事件，不通知进行中的事件式查询（见 mysql2 Connection 的 _notifyError）；
 * 服务器关掉连接时连接先报 end。只等查询自己的 error / end 会永远等下去。
 * 要在发出查询之前调用（连接已经断开时 query() 当场把错误报给连接），查询结束后调 unwatch 移除监听。
 */
export function watchMysqlLost(connection: mysql.Connection): {
  lost: Promise<never>
  unwatch: () => void
} {
  const { promise, reject } = Promise.withResolvers<never>()
  const onEnd = (): void => reject(new Error('连接已断开'))
  connection.on('error', reject).on('end', onEnd)
  return {
    lost: promise,
    unwatch: () => {
      connection.off('error', reject).off('end', onEnd)
    }
  }
}

/**
 * 按事件逐行收；限了行数时超过的行不再留存（语句仍读到底：mysql2 中途结束语句要另开连接 KILL QUERY）。
 * 没有结果集的语句只有一个 OK 包（影响的行数）。CALL 可以返回几个结果集，之后还补发一个 OK 包：有结果集时取最后
 * 一个（同控制台显示最后一个结果集），没有才算影响的行数。查询期间连接断开也以出错收口（见 watchMysqlLost）。
 */
function mysqlQuery(
  connection: mysql.Connection,
  sql: string,
  params: unknown[],
  maxRows: number | undefined
): Promise<QueryOutcome> {
  const { lost, unwatch } = watchMysqlLost(connection)
  const done = new Promise<QueryOutcome>((resolve, reject) => {
    /** 最后一个结果集的列与行；还没有结果集时为 null */
    let fields: FieldPacket[] | null = null
    let rows: unknown[][] = []
    let truncated = false
    let affected = 0
    connection
      .query({ sql, values: params, rowsAsArray: true })
      .on('error', reject)
      .on('fields', (received: FieldPacket[] | undefined) => {
        // 每个结果集开头一次；OK 包也会带一次（没有列）
        if (received === undefined) return
        fields = received
        rows = []
        truncated = false
      })
      .on('result', (row) => {
        if (!Array.isArray(row)) affected = (row as OkPacket).affectedRows
        else if (maxRows !== undefined && rows.length === maxRows) truncated = true
        else rows.push(row)
      })
      .on('end', () => {
        if (fields === null) {
          resolve({ kind: 'affected', count: affected })
          return
        }
        const columns = fields
        resolve({
          kind: 'rows',
          truncated,
          columns: mysqlColumns(columns),
          rows: rows.map((row) => mysqlRow(row, columns))
        })
      })
  })
  return Promise.race([done, lost]).finally(unwatch)
}

/**
 * 执行一条语句。maxRows：最多取回的行数（控制台用；读够即结束语句，truncated 表示后面还有）；
 * 翻表的语句自带 LIMIT，不传。
 */
export function runQuery(
  c: SqlClient,
  sql: string,
  params: unknown[] = [],
  maxRows?: number
): Promise<QueryOutcome> {
  switch (c.kind) {
    case 'postgresql':
      return pgQuery(c.client, sql, params, maxRows)
    case 'mysql':
      return mysqlQuery(c.connection, sql, params, maxRows)
    case 'sqlite':
      return c.client.query(sql, params, maxRows)
  }
}

/** 执行结果里的结果集：没有结果集的语句为空表。 */
export function resultOf(outcome: QueryOutcome): ResultSet {
  return outcome.kind === 'rows'
    ? { columns: outcome.columns, rows: outcome.rows }
    : { columns: [], rows: [] }
}

/** 执行一条最简单的查询，确认连接可用（SQLite 读一下目录，确认读得出来）。 */
async function pingClient(c: DataSourceClient): Promise<void> {
  if (c.kind === 'redis') await c.client.ping()
  else await runQuery(c, c.kind === 'sqlite' ? 'select count(*) from sqlite_schema' : 'select 1')
}

/** 主动关闭的连接：它随后的 end / error 不算意外断开。 */
const closing = new WeakSet<DataSourceClient>()

/**
 * 关闭连接，不等进行中的语句，也不等服务器回应（网络断了时那要等很久）：PostgreSQL 有语句在跑时 end() 直接断开，
 * 空闲时发出退出消息即返回；Redis 的 destroy() 立即断开，在途命令随之失败。MySQL 用 destroy()（end() 会把退出命令
 * 排在当前语句之后），它只是半关：立即返回、不再发新命令，但在途语句的结果仍会收完，服务器发完才真正断开。
 * SQLite 结束查询线程，进行中的查询当场以已取消失败，也不等线程真正结束（见 SqliteClient.close）。服务器上还在执行的
 * 语句不因关闭而停下，要停须先另发取消（PostgreSQL 用 pg_cancel_backend，MySQL 用 KILL QUERY）。
 */
export async function closeClient(c: DataSourceClient): Promise<void> {
  closing.add(c)
  switch (c.kind) {
    case 'postgresql':
      void c.client.end()
      return
    case 'mysql':
      c.connection.destroy()
      return
    case 'redis':
      c.client.destroy()
      return
    case 'sqlite':
      c.client.close()
  }
}

/**
 * 连接意外断开（网络中断、服务器关闭连接；SQLite 为查询线程意外退出）时回调一次原因：驱动给的错误，带 code 的
 * 可译成中文（见 dataSourceFailureMessage）。主动 closeClient 的不算。
 * 只管上报：防崩溃的 error 监听在建立连接时已挂上（见 listenErrors）。
 */
export function onClientLost(
  c: DataSourceClient,
  cb: (error: { code?: string; message: string }) => void
): void {
  let reported = false
  const lost = (error: { code?: string; message: string }): void => {
    if (reported || closing.has(c)) return
    reported = true
    cb(error)
  }
  if (c.kind === 'sqlite') {
    c.client.onExit((crash) => lost(crash ?? { message: '查询线程意外退出' }))
    return
  }
  const emitter: EventEmitter = c.kind === 'mysql' ? c.connection : c.client
  emitter.on('error', (error: Error & { code?: string }) => lost(error))
  emitter.on('end', () => lost({ message: '连接已断开' }))
}

/** 连上并执行一条最简单的查询，随即断开。 */
async function ping(target: DataSourceTarget, password: string | null): Promise<void> {
  const c = await openClient(target, password)
  try {
    await pingClient(c)
  } finally {
    await closeClient(c)
  }
}

/** 等 promise 的结果，中途 signal 中止则立即以中止收口（进行中的连接自己完成后随即断开）。 */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    promise.then(resolve, reject)
  })
}

const dataSourceTester = createConnectionTester()

/**
 * 测试连接：用表单当前的内容连上、执行一条最简单的查询后断开。密码：表单填了用填的，
 * 没填时编辑中的数据源沿用记住的（undefined），null 为不用密码。同一时刻只测一个、有总时限（见 createConnectionTester）。
 */
export function testDataSourceConnection(
  input: DataSourceTestInput
): Promise<ConnectionTestResult> {
  const password =
    input.password !== undefined
      ? input.password
      : input.dataSourceId === null
        ? null
        : readDataSourcePassword(input.dataSourceId)
  return dataSourceTester.run(
    (signal) => untilAborted(ping(input.target, password), signal),
    (error) =>
      dataSourceFailureMessage(
        input.target,
        error instanceof Error ? error : { message: String(error) }
      )
  )
}

/** 取消进行中的测试连接（对话框关闭时）。 */
export function cancelDataSourceTest(): void {
  dataSourceTester.cancel()
}
