// Data Source Tab 的连接（docs/prd/database.md「Tab」「连接数」）：每个 Tab 一条，Tab 键即会话键。
// 点「连接」才建立、切走不断；意外断开后 Tab 保留并显示原因，点一下重连。
// PostgreSQL 一条连接只通一个库：目录展开到别的库时按需另连并缓存，随会话一起断开。
// Files 面板（与 Preview Window）里直接打开的 SQLite 文件也是一条会话，随打开它的页面关闭、重载一并关掉。
// 数据源上的配置每次运行也开一条（键为运行会话键，编排见 data-source-runs），运行结束即断开。
// 同服务器的状态连接：数据源的连接信息被改即 reset（回到未连接；运行会话的连接除外）、被移除即 dispose，
// 退出时 disposeAll（还在执行的语句先叫停，有时限）。
// 登记的数据源的 Data Source Tab 读到的结构（目录各层、对象定义、补全）写进表结构缓存（data-source-schema-cache），
// Files 面板里直接打开的 SQLite 文件读到的只放在会话内存里；界面先取缓存显示、同时现查。连上后、刷新目录时另开临时
// 连接分两批一次读完显示的库（数据源登记里记着，见 catalogShownDatabases；PostgreSQL 一个库一条临时连接、依次读）的
// 主体结构写进缓存（连接所在的库两批之间读补全）；勾上新的显示的库时也在后台读一遍。写进一批、读取结束时推给这个 Tab，
// 其间读同样内容的等它、不另查。连接信息被改、数据源被移除时删掉缓存。表的主键在会话里记住（翻页、导出用），刷新目录时
// 忘掉。
// 控制台上下文（shared/data-source-context：控制台在哪个库上执行，Redis 另为键列表所在的库）以服务器实际状态为准：
// 连上后先应用 Tab 记住的，界面切换、控制台执行了改它的语句后回查并推送、按 Tab 记住（PostgreSQL 在事务里读到的还会被
// 撤销，等事务结束再记）。PostgreSQL 的控制台在别的库上时用那个库的按库连接执行；补全按控制台所在的库读。Redis 的控制台
// 开着事务（MULTI 之后还没 EXEC / DISCARD）时不切库。

import { setTimeout as delay } from 'node:timers/promises'
import type { WebContents } from 'electron'
import {
  dataSourceFailureMessage,
  defaultDatabaseOf,
  isPasswordRejected,
  type DataSource,
  type DataSourceConnectPassword,
  type DataSourceSessionEvent,
  type DataSourceSessionState,
  type DataSourceTarget,
  type SqlServerTarget,
  type SqlTarget
} from '../shared/data-source'
import {
  consoleContextKind,
  prependSearchPath,
  savedConsoleContext,
  type ConsoleContext,
  type ConsoleContextChange,
  type ConsoleContextEvent,
  type ConsoleContextFailure,
  type SavedConsoleContext
} from '../shared/data-source-context'
import {
  CATALOG_BULK_BATCHES,
  catalogBulkBatchOf,
  catalogBulkReads,
  catalogLayerKey,
  catalogNodeKey,
  catalogShownDatabases,
  isPermissionDenied,
  type CatalogBulkBatch,
  type CatalogBulkRead,
  type CatalogCachedLayers,
  type CatalogLayersEvent,
  type CatalogNode,
  type CatalogPath,
  type CatalogResult
} from '../shared/data-source-catalog'
import type { ExportFormat } from '../shared/data-source-export'
import {
  changesConsoleContext,
  consoleSearchPath,
  CONSOLE_ROW_LIMIT,
  dialectOf,
  qualifiedName,
  tableCountSql,
  tableSelectSql,
  tablePageSql,
  type CompletionSchema,
  type ConsoleRun,
  type ConsoleStatementResult,
  type DataSourceExecutedEvent,
  type ExportResult,
  type ObjectDetail,
  type ResultSet,
  type QueryFailure,
  type SqlDialect,
  type TableCountResult,
  type TablePageRequest,
  type TableExportRequest,
  type TablePageResult,
  type TableRef
} from '../shared/data-source-query'
import { dataSourceRunTarget } from '../shared/data-source-run'
import {
  recheckRedisDatabase,
  REDIS_IN_TRANSACTION,
  redisDatabaseAfter,
  redisInTransactionAfter,
  type RedisCommandResult,
  type RedisDatabasesResult,
  type RedisFailure,
  type RedisKeyList,
  type RedisKeyResult
} from '../shared/redis'
import {
  readCatalog,
  readCatalogBulk,
  readCompletionSchema,
  readConsoleContext,
  readSearchPath,
  setSearchPath,
  switchDatabase
} from './data-source-catalog'
import { exportQuery } from './data-source-export'
import {
  alwaysIdentityColumnsOf,
  generatedColumnsOf,
  objectDetailOf,
  primaryKeyOf
} from './data-source-objects'
import {
  keyExists,
  readCommandNames,
  readDatabases,
  readKey,
  readSelectedDatabase,
  runCommands,
  scanKeys,
  selectDatabase,
  type RedisAuth
} from './data-source-redis'
import {
  deleteSchemaCache,
  emptySchemaCache,
  readSchemaCache,
  readSchemaCacheSection,
  writeSchemaCache,
  type SchemaCache,
  type SchemaCacheSection,
  type SchemaCacheValue
} from './data-source-schema-cache'
import {
  closeClient,
  onClientLost,
  openClient,
  openSqlClient,
  resultOf,
  runQuery,
  type DataSourceClient,
  type RedisClient,
  type SqlClient
} from './data-source-connect'
import {
  applyDataSourcePassword,
  findDataSource,
  pruneDataSourceShownDatabases,
  readDataSourcePassword
} from './data-sources'
import { getSavedConsoleContext, setSavedConsoleContext } from './store'

interface Session {
  /** 登记的数据源；Files 面板里直接打开的 SQLite 文件没有（不登记、不落盘） */
  dataSourceId: string | null
  /** Files 面板里直接打开的 SQLite 文件：打开它的页面（页面关闭、重载时一并关掉）；登记的数据源没有 */
  owner: WebContents | null
  /** 运行会话的连接：连接信息被改时不断开，这一次照旧跑完（同服务器上的配置） */
  run: boolean
  /**
   * 连接时的目标与密码：PostgreSQL 按需连别的库、另开临时连接要用。连接信息被改会断开各个 Tab 的会话，目标不会
   * 过时（运行会话照旧按连接时的目标跑完）；编辑时只改了密码不断开，换成新密码（见 updateDataSourceSessionsPassword）
   */
  target: DataSourceTarget
  password: string | null
  state: DataSourceSessionState
  client: DataSourceClient | null
  /**
   * PostgreSQL：默认连接所在的库、它的后端进程号（叫停控制台语句用），与按需另连的其他库的按库连接（连同后端进程号，
   * 控制台在那个库上时叫停要用）
   */
  database: string
  backendPid: number | null
  databases: Map<string, Promise<CancelableClient>>
  /** PostgreSQL：控制台在哪个库上执行（默认连接所在的库，或切到的别的库） */
  consoleDatabase: string
  /**
   * 控制台上下文（见 shared/data-source-context）：服务器上的实际状态，连上、切换、执行了改它的语句后回查。运行会话与
   * SQLite 没有（null）
   */
  context: ConsoleContext | null
  /** 连上后应用记住的控制台上下文（见 initContext）：控制台执行、补全、Redis 的读取都先等它；它不会失败 */
  ready: Promise<void>
  /**
   * Redis：控制台的连接在事务里（执行了 MULTI、还没 EXEC / DISCARD，可以跨几次执行，见 redisInTransactionAfter）。
   * 这时不切库：SELECT 会排进事务、并不生效
   */
  redisTransaction: boolean
  /** 记住的表的主键（按库 / 模式 / 表，见 primaryKeyFor） */
  primaryKeys: Map<string, Promise<string[]>>
  /**
   * Files 面板里直接打开的 SQLite 文件读到的结构：它不是登记的数据源，没有落盘的表结构缓存，只存在这里（用法同缓存，
   * 随会话丢掉，见 schemaCacheOf）。其余会话没有（null）
   */
  memoryCache: SchemaCache | null
}

const sessions = new Map<string, Session>()

/** 一次控制台执行：取消、断开时标记为已取消；busy 为正在执行语句的连接（叫停要用；Redis 没有）。 */
interface ConsoleJob {
  canceled: boolean
  busy: CancelableClient | null
}

/** 各 Tab（与运行会话）进行中的控制台执行。 */
const running = new Map<string, ConsoleJob>()

export interface DataSourceSessionSink {
  /** 某个 Tab 的连接状态变了 */
  state: (event: DataSourceSessionEvent) => void
  /** 数据源列表变了：连接时记住或忘掉了密码，显示的库里去掉了已删掉的库 */
  dataSourcesChanged: () => void
  /** 某个 Tab 的控制台上下文变了 */
  context: (event: ConsoleContextEvent) => void
  /** 登记的数据源执行成功了一些 SQL 语句（控制台与运行配置）：交给补全计数 */
  executed: (event: DataSourceExecutedEvent) => void
  /** 某个 Tab 一次读完主体结构写进了一批、或读取结束了：进行中的目录筛选重取缓存 */
  catalogLayers: (event: CatalogLayersEvent) => void
}

let sink: DataSourceSessionSink | null = null

/** 连接状态与列表变化推给谁：由 ipc 绑定。 */
export function setDataSourceSessionSink(next: DataSourceSessionSink): void {
  sink = next
}

function setState(tabKey: string, session: Session, state: DataSourceSessionState): void {
  session.state = state
  sink?.state({ tabKey, state })
}

export function getDataSourceSession(tabKey: string): DataSourceSessionState {
  return sessions.get(tabKey)?.state ?? { phase: 'idle' }
}

/** 抛出的东西整理成带 message 的错误（驱动的错误原样保留，带着 code 等）。 */
function errorOf(error: unknown): Error | { message: string } {
  return error instanceof Error ? error : { message: String(error) }
}

/** 出错的说明文字：网络错误、SQLite 的常见错误给中文，其余照原话（见 dataSourceFailureMessage）。 */
function failureMessage(target: DataSourceTarget, error: unknown): string {
  return dataSourceFailureMessage(target, errorOf(error))
}

/**
 * 断开并忘掉这个 Tab 的连接；进行中的连接随后发现自己已被取代，连上即关。还在执行的控制台语句（PostgreSQL 可能在按库
 * 连接上）、数总行数、读主体结构先叫停再关（服务器上的语句才会停下；不等叫停发完即返回，见 cancelThenClose），其余
 * 连接直接关。
 */
async function drop(tabKey: string): Promise<void> {
  stopJob(counting, tabKey, true)
  stopPreload(tabKey)
  const session = sessions.get(tabKey)
  sessions.delete(tabKey)
  if (session === undefined) return
  const run = running.get(tabKey)
  if (run !== undefined) run.canceled = true
  // SQLite 关掉即结束查询线程，不用叫停
  const busy = run?.busy != null && run.busy.client.kind !== 'sqlite' ? run.busy : null
  if (busy !== null) cancelThenClose(session, busy)
  for (const pending of session.databases.values()) {
    void pending.then(
      ({ client }) => (client === busy?.client ? undefined : closeClient(client)),
      () => {}
    )
  }
  session.databases.clear()
  const { client } = session
  if (client !== null && client !== busy?.client) await closeClient(client)
}

/**
 * 连接。password 是未连接页密码框交上来的（没出密码框时为 null，用记住的）；连上后按勾选记住或忘掉它。
 * 失败时区分是不是密码被拒，未连接页据此再出密码框。
 */
export async function connectDataSourceSession(
  tabKey: string,
  dataSourceId: string,
  password: DataSourceConnectPassword | null
): Promise<void> {
  const dataSource = findDataSource(dataSourceId)
  if (dataSource === null) return
  await connect(tabKey, dataSourceId, null, dataSource.target, password, false)
}

/**
 * 数据源上的配置运行时的连接（键为运行会话键）：库按配置覆盖，密码同 Data Source Tab（password 为密码框交上来的，
 * 没出密码框时为 null，用记住的）。交回连接的结果：连上，或断开（带原因与是否密码被拒）；被取代、被关掉时为 idle。
 */
export async function connectDataSourceRun(
  key: string,
  dataSource: DataSource,
  database: string | undefined,
  password: DataSourceConnectPassword | null
): Promise<DataSourceSessionState> {
  await connect(
    key,
    dataSource.id,
    null,
    dataSourceRunTarget(dataSource.target, database),
    password,
    true
  )
  return getDataSourceSession(key)
}

/**
 * Files 面板（与 Preview Window）里直接打开的 SQLite 文件：临时数据源，不登记、不落盘。resolveFile 给出系统路径，
 * 路径越界、根未授权时抛出，即打不开、显示原因（这时不留会话：页面重载后组件重新打开）。
 * 会话记住打开它的页面：页面关闭、重载时组件来不及卸载，由主进程一并关掉（见 watchOwner）。
 */
export async function connectSqliteFileSession(
  owner: WebContents,
  tabKey: string,
  resolveFile: () => string
): Promise<void> {
  watchOwner(owner)
  let file: string
  try {
    file = resolveFile()
  } catch (error) {
    await drop(tabKey)
    const message = errorOf(error).message
    sink?.state({ tabKey, state: { phase: 'disconnected', message, passwordRejected: false } })
    return
  }
  await connect(tabKey, null, owner, { kind: 'sqlite', file }, null, false)
}

/** 已挂上收尾监听的页面。 */
const watchedOwners = new WeakSet<WebContents>()

/** 页面销毁（窗口关闭）或重新导航（重载）时，关掉它打开的 SQLite 文件会话（同 Preview Window 在窗口关闭时回收）。 */
function watchOwner(owner: WebContents): void {
  if (watchedOwners.has(owner)) return
  watchedOwners.add(owner)
  const release = (): void => {
    for (const [tabKey, session] of sessions) {
      if (session.owner === owner) closeDataSourceSession(tabKey)
    }
  }
  owner.on('did-navigate', release)
  owner.once('destroyed', release)
}

/** 建立会话的连接。password 同 connectDataSourceSession：没出密码框（null）时用登记的数据源记住的。 */
async function connect(
  tabKey: string,
  dataSourceId: string | null,
  owner: WebContents | null,
  target: DataSourceTarget,
  password: DataSourceConnectPassword | null,
  run: boolean
): Promise<void> {
  await drop(tabKey)
  const session: Session = {
    dataSourceId,
    owner,
    run,
    target,
    password:
      password?.value ?? (dataSourceId === null ? null : readDataSourcePassword(dataSourceId)),
    state: { phase: 'connecting' },
    client: null,
    database: '',
    backendPid: null,
    databases: new Map(),
    consoleDatabase: '',
    context: null,
    ready: Promise.resolve(),
    redisTransaction: false,
    primaryKeys: new Map(),
    memoryCache: dataSourceId === null ? emptySchemaCache() : null
  }
  sessions.set(tabKey, session)
  setState(tabKey, session, { phase: 'connecting' })
  const current = (): boolean => sessions.get(tabKey) === session
  try {
    const client = await openClient(session.target, session.password)
    if (client.kind === 'postgresql') {
      const { rows } = await client.client
        .query('select current_database() as name, pg_backend_pid() as pid')
        .catch((error: unknown) => {
          void closeClient(client)
          throw error
        })
      session.database = String(rows[0].name)
      session.consoleDatabase = session.database
      session.backendPid = Number(rows[0].pid)
    }
    if (!current()) {
      await closeClient(client)
      return
    }
    if (dataSourceId !== null && password !== null) {
      applyDataSourcePassword(dataSourceId, password.remember ? password.value : null)
      sink?.dataSourcesChanged()
    }
    setState(tabKey, session, {
      phase: 'connected',
      database: defaultDatabaseOf(session.target, session.database)
    })
    attach(tabKey, session, client)
    session.ready = initContext(tabKey, session)
    preloadSchema(tabKey, session, bulkReadsOf(session), 'connect')
  } catch (error) {
    if (!current()) return
    setState(tabKey, session, {
      phase: 'disconnected',
      message: failureMessage(session.target, error),
      passwordRejected: isPasswordRejected(session.target.kind, errorOf(error))
    })
  }
}

/** 会话用上一条连接（连上、SQLite 换了查询线程）：之后它意外断开即摘下、推送断开与原因。 */
function attach(tabKey: string, session: Session, client: DataSourceClient): void {
  session.client = client
  onClientLost(client, (error) => {
    if (sessions.get(tabKey) !== session || session.client !== client) return
    session.client = null
    setState(tabKey, session, {
      phase: 'disconnected',
      message: failureMessage(session.target, error),
      passwordRejected: false
    })
  })
}

/**
 * SQLite 换一个查询线程：先摘下旧的并结束它（进行中的查询当场以已取消失败，不等旧线程真正结束，见
 * SqliteClient.close），再重新打开文件；打不开（如文件已被删掉）即断开、显示原因。
 */
async function reopenSqlite(
  tabKey: string,
  session: Session,
  client: Extract<DataSourceClient, { kind: 'sqlite' }>
): Promise<void> {
  session.client = null
  await closeClient(client)
  if (sessions.get(tabKey) !== session) return
  try {
    const next = await openClient(session.target, null)
    if (sessions.get(tabKey) === session) attach(tabKey, session, next)
    else await closeClient(next)
  } catch (error) {
    if (sessions.get(tabKey) !== session) return
    setState(tabKey, session, {
      phase: 'disconnected',
      message: failureMessage(session.target, error),
      passwordRejected: false
    })
  }
}

/**
 * 刷新目录前（手动刷新、执行了改结构或结束事务的语句后）：SQLite 重新打开文件，文件被整个替换后也能读到新内容（见
 * reopenSqlite）——但连接上开着事务（如控制台里 `begin; …; create table …` 还没提交）时不重开，重开会把它连同之前的
 * 改动悄悄回滚；这时只重跑主体结构读取（在另开的临时连接上，看不到事务里还没提交的改动，提交后那次重读才看得到），等
 * 结束事务的语句触发的那次重读再重开。忘掉记住的主键；重跑一次读完主体结构（见 preloadSchema），目录重读它涵盖的层、
 * 补全重读都等它，不另查。
 */
export async function reopenDataSourceSession(tabKey: string): Promise<void> {
  const session = sessions.get(tabKey)
  if (session === undefined) return
  session.primaryKeys.clear()
  const { client } = session
  if (client?.kind === 'sqlite') {
    // 问不到（查询线程已结束：被取消换了线程、意外退出）为 null，这时会话已换了连接或已摘下，不用重开；问的这会儿
    // 换了连接的也不重开
    const inTransaction = await client.client.inTransaction().catch(() => null)
    if (inTransaction === false && session.client === client) {
      await reopenSqlite(tabKey, session, client)
    }
  }
  if (sessions.get(tabKey) === session && session.client !== null) {
    preloadSchema(tabKey, session, bulkReadsOf(session), 'refresh')
  }
}

/** 手动断开：回到未连接。 */
export async function disconnectDataSourceSession(tabKey: string): Promise<void> {
  await drop(tabKey)
  sink?.state({ tabKey, state: { phase: 'idle' } })
}

/** Tab 关闭（或打开 SQLite 文件的页面关闭、重载）：断开并忘掉。 */
export function closeDataSourceSession(tabKey: string): void {
  void drop(tabKey)
}

/**
 * 运行会话的连接用完了（运行结束、被重跑取代）：断开并忘掉，同时推送未连接（同手动断开）。渲染端就不会留着上一次的
 * 连接状态（如密码被拒），重跑时不会先闪出密码框。
 */
export function closeDataSourceRunSession(key: string): void {
  void drop(key)
  sink?.state({ tabKey: key, state: { phase: 'idle' } })
}

/**
 * 数据源被编辑、连接信息变了：它的各个 Tab 都断开，回到未连接，表结构缓存删掉（连的可能已是别的库）。运行会话的连接
 * 不断开（这一次照旧跑完），下次运行才用新的连接信息。先断开再删：断开前发出的读取回来时会话已不在，不会写回缓存。
 */
export function resetDataSourceSessions(dataSourceId: string): void {
  for (const [tabKey, session] of sessions) {
    if (session.dataSourceId === dataSourceId && !session.run) {
      void disconnectDataSourceSession(tabKey)
    }
  }
  void deleteSchemaCache(dataSourceId)
}

/**
 * 数据源被编辑、连接信息没变但换了密码：它的各个 Tab 已建立的连接照旧，之后另开的连接（PostgreSQL 连别的库、
 * 数总行数、导出、叫停语句）改用新密码。
 */
export function updateDataSourceSessionsPassword(dataSourceId: string, password: string): void {
  for (const session of sessions.values()) {
    if (session.dataSourceId === dataSourceId) session.password = password
  }
}

/** 数据源被移除：断开并忘掉连到它的各个 Tab（Tab 随之关掉），删掉它的表结构缓存。 */
export function disposeDataSourceSessions(dataSourceId: string): void {
  for (const [tabKey, session] of sessions) {
    if (session.dataSourceId === dataSourceId) closeDataSourceSession(tabKey)
  }
  void deleteSchemaCache(dataSourceId)
}

/** 退出时等叫停发完最多这么久：网络不好时不拖住退出，到点没发完的直接关掉。 */
const QUIT_CANCEL_TIMEOUT_MS = 2000

/**
 * 退出时一并关掉：各会话（含运行会话）的连接与查询线程、会话以外的连接。还在执行语句的先叫停再关，服务器上已发出的
 * 语句才会停下（同退出确认说的「结束这些会话」）：控制台与运行会话的语句、数总行数、读主体结构同断开（见 drop），
 * 导出等执行语句用的临时连接见 openStatementClient；SQLite 关掉即结束查询线程。叫停最多等 QUIT_CANCEL_TIMEOUT_MS，
 * 余下的直接关掉。
 */
export async function disposeAllDataSourceSessions(): Promise<void> {
  const dropped = [...sessions.keys()].map((tabKey) => drop(tabKey))
  for (const { session, busy } of [...statementClients.values()]) cancelThenClose(session, busy)
  await Promise.race([
    Promise.all([...dropped, ...canceling.values()]),
    delay(QUIT_CANCEL_TIMEOUT_MS)
  ])
  await Promise.all([...looseClients].map(closeLoose))
}

/**
 * 通到某个库的连接与它的后端进程号：PostgreSQL 的其他库按需另连（断了下次再连，见 openDatabaseConnection），其余类型与
 * 默认库就是会话的连接。
 */
function connectionFor(
  session: Session,
  client: SqlClient,
  database?: string
): Promise<CancelableClient> {
  const { target } = session
  if (target.kind !== 'postgresql' || database === undefined || database === session.database) {
    return Promise.resolve({ client, backendPid: session.backendPid })
  }
  let pending = session.databases.get(database)
  if (pending === undefined) {
    pending = openDatabaseConnection(session, target, database)
    pending.catch(() => session.databases.delete(database))
    session.databases.set(database, pending)
  }
  return pending
}

/** 通到某个库的连接（同 connectionFor，只要连接）。 */
async function clientFor(
  session: Session,
  client: SqlClient,
  database?: string
): Promise<SqlClient> {
  return (await connectionFor(session, client, database)).client
}

/**
 * PostgreSQL 连到别的库（按库连接）：取到后端进程号（控制台在这个库上时叫停要用）。是控制台所在的库时（按库连接断了
 * 又连上）把控制台的 search_path 重新设上，控制台上下文不因重连而变。它意外断开即忘掉，下次用到再连。
 */
async function openDatabaseConnection(
  session: Session,
  target: SqlServerTarget,
  database: string
): Promise<CancelableClient> {
  const client = await openSqlClient(target, session.password, database)
  onClientLost(client, () => session.databases.delete(database))
  try {
    const backendPid = await readBackendPid(client)
    const { context } = session
    if (context?.kind === 'postgresql' && context.database === database) {
      await setSearchPath(client, context.searchPath)
    }
    return { client, backendPid }
  } catch (error) {
    void closeClient(client)
    throw error
  }
}

/** PostgreSQL 连接的后端进程号（叫停它上面的语句要用）；其余类型没有（null）。 */
async function readBackendPid(client: SqlClient): Promise<number | null> {
  if (client.kind !== 'postgresql') return null
  const { rows } = await client.client.query('select pg_backend_pid() as pid')
  return Number(rows[0].pid)
}

/** 连着的 SQL 会话：会话、它的连接与连接目标；没连上、是 Redis 的会话为 null。 */
function sqlSessionOf(
  tabKey: string
): { session: Session; client: SqlClient; target: SqlTarget } | null {
  const session = sessions.get(tabKey)
  const client = session?.client
  if (session === undefined || client == null || client.kind === 'redis') return null
  const { target } = session
  return target.kind === 'redis' ? null : { session, client, target }
}

/**
 * 在会话的连接上执行（PostgreSQL 为 database 所在的库）；未连接、无权读取、别的错误都作为结果交回，不抛出。
 */
async function withSqlClient<T>(
  tabKey: string,
  database: string | undefined,
  run: (client: SqlClient, dialect: SqlDialect, session: Session) => Promise<T>
): Promise<T | QueryFailure> {
  const sql = sqlSessionOf(tabKey)
  if (sql === null) return { error: '未连接' }
  const { session, target } = sql
  try {
    const client = await clientFor(session, sql.client, database)
    return await run(client, dialectOf(target.kind), session)
  } catch (error) {
    return failureOf(target, error)
  }
}

/** 查询出错作为结果交回：无权另报（界面说「无权查看」），其余为说明文字。 */
function failureOf(target: DataSourceTarget, error: unknown): QueryFailure {
  if (isPermissionDenied(target.kind, errorOf(error))) return { denied: true }
  return { error: failureMessage(target, error) }
}

// —— 表结构缓存 ——

/**
 * 会话读到的结构存进哪个数据源的缓存：登记的数据源的 Data Source Tab 才存进落盘的缓存；Files 面板里直接打开的 SQLite
 * 文件存在会话内存里（Session.memoryCache），运行会话不缓存，都为 null。Redis 不经这里（它的键属于数据）。
 */
function schemaCacheOf(session: Session | undefined): string | null {
  return session === undefined || session.run ? null : session.dataSourceId
}

/**
 * 读到的结构写回缓存（Files 面板里直接打开的 SQLite 文件写进会话内存里的那份）。读的这会儿会话已断开或重连的不写：
 * 连接信息被改时缓存已删（见 resetDataSourceSessions），免得旧的结构写进新缓存。
 */
function saveSchema<S extends SchemaCacheSection>(
  tabKey: string,
  session: Session,
  section: S,
  key: string,
  value: SchemaCacheValue<S>
): void {
  if (sessions.get(tabKey) !== session) return
  const cacheId = schemaCacheOf(session)
  if (cacheId !== null) writeSchemaCache(cacheId, section, key, value)
  else session.memoryCache?.[section].set(key, value)
}

/** 取缓存里的一项（不访问数据库；同 saveSchema 存在哪里）；没有缓存、不缓存的会话为 null。 */
async function peekSchema<S extends SchemaCacheSection>(
  tabKey: string,
  section: S,
  key: (session: Session) => string
): Promise<SchemaCacheValue<S> | null> {
  const session = sessions.get(tabKey)
  if (session === undefined) return null
  const cacheId = schemaCacheOf(session)
  if (cacheId !== null) return readSchemaCache(cacheId, section, key(session))
  return session.memoryCache?.[section].get(key(session)) ?? null
}

/** 对象在缓存里的键：它在目录里的节点键。 */
function objectKeyOf(path: CatalogPath, name: string, detail?: string): string {
  return catalogNodeKey(path, { kind: 'object', name, detail })
}

/** 补全在缓存里的键（按库）：PostgreSQL 为读它的库（各库各一份）；其余类型一条连接看得到全部库，只有一份。 */
function completionKey(target: DataSourceTarget, database: string): string {
  return target.kind === 'postgresql' ? database : ''
}

/**
 * 读目录的一层（显示在目录里），读到的写回缓存；读到根这一层时，显示的库里已不在的去掉（见 forgetGoneDatabases）。刷新时
 * 重跑的主体结构读取里有这一层的，等它读到的，不另查。
 */
export async function readDataSourceCatalog(
  tabKey: string,
  path: CatalogPath
): Promise<CatalogResult> {
  const preloaded = await preloadedLayer(tabKey, path)
  if (preloaded !== undefined) return { nodes: preloaded }
  return withSqlClient(tabKey, path.database, async (client, _dialect, session) => {
    const nodes = await readCatalog(client, path)
    const key = catalogLayerKey(path)
    saveSchema(tabKey, session, 'catalog', key, nodes)
    if (key === '') forgetGoneDatabases(tabKey, session, nodes)
    return { nodes }
  })
}

/**
 * 读到了根这一层 root：登记的数据源的显示的库里，根这一层不再列出的（已删掉）去掉，推送数据源列表。读的这会儿会话已断开
 * 或重连的不改（同 saveSchema）。
 */
function forgetGoneDatabases(tabKey: string, session: Session, root: CatalogNode[]): void {
  const { dataSourceId } = session
  if (dataSourceId === null || sessions.get(tabKey) !== session) return
  if (pruneDataSourceShownDatabases(dataSourceId, root)) sink?.dataSourcesChanged()
}

/** 目录一层的缓存（不访问数据库）：界面先显示它、同时现查；没有为 null。 */
export async function peekDataSourceCatalog(
  tabKey: string,
  path: CatalogPath
): Promise<CatalogResult | null> {
  const nodes = await peekSchema(tabKey, 'catalog', () => catalogLayerKey(path))
  return nodes === null ? null : { nodes }
}

/**
 * 目录各层的缓存（不访问数据库；按层键，同 catalogLayerKey；同 saveSchema 存在哪里），连同一次读完主体结构还在不在进行
 * （最后一次读取的第二批目录最后读，读取还在进行即还有层要写进缓存）：目录按名称筛选时连同已读取的各层一起找；写进一批、
 * 读取结束时推送（见 runPreload），筛选随之重取。没有缓存、不缓存的会话，各层为空。
 */
export async function peekDataSourceCatalogLayers(tabKey: string): Promise<CatalogCachedLayers> {
  const session = sessions.get(tabKey)
  const cacheId = schemaCacheOf(session)
  const layers =
    cacheId !== null
      ? await readSchemaCacheSection(cacheId, 'catalog')
      : (session?.memoryCache?.catalog ?? new Map<string, CatalogNode[]>())
  return {
    layers: Object.fromEntries([...layers].map(([key, nodes]) => [key, { nodes }])),
    reading: preloading.has(tabKey)
  }
}

/**
 * 表的主键（翻页、导出时排在 ORDER BY 最后）：会话里按库 / 模式 / 表记住，不必每次现查；刷新目录（含执行了改结构的
 * 语句后）时忘掉，重连、断开时随会话丢掉。查不出来的不记。不写盘。
 */
function primaryKeyFor(
  session: Session,
  client: SqlClient,
  dialect: SqlDialect,
  table: TableRef
): Promise<string[]> {
  const key = [table.database, table.schema, table.name].map((part) => part ?? '').join('\0')
  let pending = session.primaryKeys.get(key)
  if (pending === undefined) {
    const read = primaryKeyOf(client, dialect, table)
    read.catch(() => {
      if (session.primaryKeys.get(key) === read) session.primaryKeys.delete(key)
    })
    session.primaryKeys.set(key, read)
    pending = read
  }
  return pending
}

/** 翻表的一页：主键排在 ORDER BY 最后（ORDER BY 为空时只按主键排），保证翻页稳定。 */
export function readDataSourceTablePage(
  tabKey: string,
  request: TablePageRequest
): Promise<TablePageResult> {
  return withSqlClient(tabKey, request.table.database, async (client, dialect, session) => {
    const primaryKey = await primaryKeyFor(session, client, dialect, request.table)
    const outcome = await runQuery(client, tablePageSql(dialect, { ...request, primaryKey }))
    return { result: resultOf(outcome) }
  })
}

/** 表与视图以外对象的定义或信息表，读到的写回缓存。 */
export function readDataSourceObjectDetail(
  tabKey: string,
  path: CatalogPath,
  name: string,
  detail?: string
): Promise<ObjectDetail> {
  return withSqlClient(tabKey, path.database, async (client, dialect, session) => {
    const result = await objectDetailOf(client, dialect, path, name, detail)
    if ('definition' in result || 'result' in result) {
      saveSchema(tabKey, session, 'objects', objectKeyOf(path, name, detail), result)
    }
    return result
  })
}

/** 对象定义或信息表的缓存（不访问数据库）；没有为 null。 */
export function peekDataSourceObjectDetail(
  tabKey: string,
  path: CatalogPath,
  name: string,
  detail?: string
): Promise<ObjectDetail | null> {
  return peekSchema(tabKey, 'objects', () => objectKeyOf(path, name, detail))
}

// —— 会话以外的连接 ——

/**
 * 会话以外还开着的连接：临时连接（数总行数、导出、读主体结构、叫停语句用，不挡着会话的连接），与等语句
 * 叫停后再关的连接。用完即关（closeLoose）；退出时一并关掉，还在执行语句的先叫停（见 disposeAllDataSourceSessions）。
 */
const looseClients = new Set<DataSourceClient>()

/** 可以叫停的连接：叫停它正在执行的语句时，PostgreSQL 要用它的后端进程号，MySQL / MariaDB 用连接自带的线程号。 */
interface CancelableClient {
  client: SqlClient
  backendPid: number | null
}

/**
 * 其中执行语句用的临时连接（数总行数、导出、读主体结构）与叫停它要用的：所属会话、连接与后端进程号。
 * 开着即可能还在执行，退出时先叫停再关。
 */
const statementClients = new Map<DataSourceClient, { session: Session; busy: CancelableClient }>()

/** 关掉会话以外的一条连接（关过的不再关）。 */
async function closeLoose(client: DataSourceClient): Promise<void> {
  statementClients.delete(client)
  if (looseClients.delete(client)) await closeClient(client)
}

/**
 * 另开一条临时连接，连到会话的连接目标 target（调用方已确认是 SQL 类型）；PostgreSQL 连在 database 所在的库，缺省为
 * 会话的默认库。
 */
async function openLooseClient(
  session: Session,
  target: SqlTarget,
  database = session.database
): Promise<SqlClient> {
  const client = await openSqlClient(target, session.password, database)
  looseClients.add(client)
  return client
}

/**
 * 另开一条执行语句用的临时连接（数总行数、导出、读主体结构）：PostgreSQL 先取到它的后端进程号（叫停
 * 要用）。登记下来，退出时它还开着即先叫停再关。
 */
async function openStatementClient(
  session: Session,
  target: SqlTarget,
  database: string | undefined
): Promise<CancelableClient> {
  const client = await openLooseClient(session, target, database)
  const backendPid = await readBackendPid(client).catch((error: unknown) => {
    void closeLoose(client)
    throw error
  })
  const busy = { client, backendPid }
  statementClients.set(client, { session, busy })
  return busy
}

/**
 * 叫停 busy 上正在执行的语句，服务器上的语句才会停下（关连接并不会让它停）：另开一条临时连接，PostgreSQL 对它的
 * 后端进程号发 pg_cancel_backend，MySQL / MariaDB 对它的线程号发 KILL QUERY。SQLite 不经这里（结束查询线程即中止）。
 * 叫停失败（如连不上）作为结果交回。
 */
async function cancelStatement(
  session: Session,
  busy: CancelableClient
): Promise<QueryFailure | null> {
  const { client, backendPid } = busy
  const { target } = session
  // SQLite 不经这里（见上）；Redis 会话没有 SQL 语句
  if (client.kind === 'sqlite' || target.kind === 'redis') return null
  try {
    const other = await openLooseClient(session, target)
    try {
      if (client.kind === 'postgresql') {
        await runQuery(other, 'select pg_cancel_backend($1)', [backendPid])
      } else {
        await runQuery(other, `kill query ${client.connection.threadId}`)
      }
    } finally {
      await closeLoose(other)
    }
    return null
  } catch (error) {
    return failureOf(session.target, error)
  }
}

/** 正在叫停的连接 → 叫停发完再关掉它的那一步。 */
const canceling = new Map<DataSourceClient, Promise<void>>()

/**
 * 先叫停连接上正在执行的语句再关掉它（不等）；等的这会儿它算会话以外的连接，退出时等叫停发完（有时限，见
 * disposeAllDataSourceSessions）。已在叫停的不再叫停。
 */
function cancelThenClose(session: Session, busy: CancelableClient): void {
  const { client } = busy
  if (canceling.has(client)) return
  looseClients.add(client)
  const done = cancelStatement(session, busy).then(() => closeLoose(client))
  canceling.set(client, done)
  void done.then(() => canceling.delete(client))
}

/** 一件在临时连接上进行的事（数总行数、读主体结构），各 Tab 各一件。 */
interface StatementJob {
  session: Session
  /** 它眼下的临时连接（连上、PostgreSQL 取到后端进程号后才有；读主体结构每读一个库换一条） */
  connection: Promise<CancelableClient>
  /** 语句已经发出：取消时要叫停服务器上的语句 */
  started: boolean
}

/** 结束 jobs 里这个 Tab 进行中的那件：cancel 时语句已发出的先叫停再关，否则直接关掉临时连接。 */
function stopJob(jobs: Map<string, StatementJob>, tabKey: string, cancel: boolean): void {
  const job = jobs.get(tabKey)
  if (job === undefined) return
  jobs.delete(tabKey)
  void job.connection.then(
    (busy) =>
      cancel && job.started ? cancelThenClose(job.session, busy) : void closeLoose(busy.client),
    () => {}
  )
}

// —— 数总行数 ——

/** 各 Tab 进行中的数总行数：换表、改筛选、断开、关 Tab 时取消。 */
const counting = new Map<string, StatementJob>()

/** 取消数总行数（换表、改筛选时）：叫停服务器上的语句再关掉临时连接。 */
export function cancelDataSourceTableCount(tabKey: string): void {
  stopJob(counting, tabKey, true)
}

/**
 * 数总行数（带同样的筛选）：另开一条临时连接，不挡着翻页；同一个 Tab 新数一次就取消上一次。
 */
export async function countDataSourceTableRows(
  tabKey: string,
  table: TableRef,
  where: string
): Promise<TableCountResult> {
  cancelDataSourceTableCount(tabKey)
  const sql = sqlSessionOf(tabKey)
  if (sql === null) return { error: '未连接' }
  const { session, target } = sql
  const count: StatementJob = {
    session,
    connection: openStatementClient(session, target, table.database),
    started: false
  }
  counting.set(tabKey, count)
  try {
    const { client } = await count.connection
    if (counting.get(tabKey) !== count) return { canceled: true }
    count.started = true
    const outcome = await runQuery(client, tableCountSql(dialectOf(target.kind), table, where))
    return { count: outcome.kind === 'rows' ? Number(outcome.rows[0]?.[0] ?? 0) : 0 }
  } catch (error) {
    if (counting.get(tabKey) !== count) return { canceled: true }
    return failureOf(target, error)
  } finally {
    // 数完或出错：关掉临时连接（被取消的由取消那边处理）
    if (counting.get(tabKey) === count) stopJob(counting, tabKey, false)
  }
}

// —— 一次读完主体结构 ——

/** 一批读到的目录各层（按层键）。 */
type CatalogBulkLayers = ReadonlyMap<string, CatalogNode[]>

/** 一次读取的两批各自读到的各层：读完那一批时交出（读不出来、被叫停时交出 null）。 */
type CatalogBulkWaits = Record<CatalogBulkBatch, PromiseWithResolvers<CatalogBulkLayers | null>>

/**
 * 进行中的主体结构读取：依次进行各次读取（见 catalogBulkReads），读到的在读完每次读取的每一批目录、读完补全时各自交出
 * （读不出来、被叫停时交出 null），读同样内容的等它、不另查（见 preloadedLayer、readDataSourceCompletionSchema）。临时
 * 连接为正在进行的那次读取的。
 */
interface SchemaPreload extends StatementJob {
  /** 第一次读取：根下不属于某个库的层（角色、用户）等它（见 catalogBulkBatchOf），要读补全时也在它上面读 */
  first: CatalogBulkRead
  /**
   * 还没开始的各次读取，依次进行：读的这会儿勾上了新的显示的库，追加在最后（见 updateDataSourceSessionsShown）；取消了
   * 勾选的，轮到时跳过（见 preloadRead）
   */
  queue: CatalogBulkRead[]
  /**
   * 各次读取两批读到的各层（按库，一起读的各库共用一份）：刷新时重跑的才交出，目录重读它涵盖的层时等那个库的那一批；
   * 连上时的不交（展开照旧逐层现查，先显示要紧），勾上新的库时读的与读的这会儿追加的也不交（照常现查）
   */
  layers: Map<string, CatalogBulkWaits> | null
  /** 读到的补全（见 preloadSchema；不读时为 null）：控制台读补全时等它、只用其中的列 */
  completion: PromiseWithResolvers<CompletionSchema | null> | null
}

/** 各 Tab 进行中的主体结构读取：断开、关 Tab、重连时叫停；刷新目录时叫停并重跑。 */
const preloading = new Map<string, SchemaPreload>()

/**
 * 显示的库（见 catalogShownDatabases）：登记的数据源记下的，从没设置过时为默认库。Files 面板里直接打开的 SQLite 文件
 * 没有登记，按默认库（SQLite 用不到）。
 */
function shownDatabasesOf(session: Session): readonly string[] {
  const { dataSourceId, target, database } = session
  const saved = dataSourceId === null ? undefined : findDataSource(dataSourceId)?.shownDatabases
  return catalogShownDatabases(saved, defaultDatabaseOf(target, database))
}

/** 连上后、刷新目录时一次读完主体结构的各次读取：读显示的库（见 catalogBulkReads）。Redis 没有。 */
function bulkReadsOf(session: Session): CatalogBulkRead[] {
  const { target } = session
  if (target.kind === 'redis') return []
  return catalogBulkReads(target.kind, session.database, shownDatabasesOf(session))
}

/** 刷新时各次读取两批的等待（按库，一起读的各库共用一份）。 */
function bulkWaitsOf(reads: readonly CatalogBulkRead[]): Map<string, CatalogBulkWaits> {
  return new Map(
    reads.flatMap((read) => {
      const waits: CatalogBulkWaits = { 0: Promise.withResolvers(), 1: Promise.withResolvers() }
      return read.map((database) => [database, waits] as const)
    })
  )
}

/** 为什么读主体结构：连上后、刷新目录时（目录重读它涵盖的层时等它）、勾上了新的显示的库时（只读这些库）。 */
type PreloadReason = 'connect' | 'refresh' | 'show'

/**
 * 在后台依次进行各次读取 reads（见 catalogBulkReads），读完主体结构写进缓存（见 readCatalogBulk）：连上后读一次显示的库，
 * 之后展开即从缓存显示、在后台核对，读完之前展开照旧逐层现查；刷新目录（含执行了改结构的语句后）时叫停进行中的并重跑
 * （没有要读的库时只叫停），没展开的缓存层也跟着更新；勾上新的显示的库而没在读时，另起一次只读这些库。每次读取分两批；
 * 连上与刷新时，第一次读取在连接所在的库上的（MySQL / MariaDB 与 SQLite 一条连接看得到全部库，总是），两批之间读补全
 * 用的列（同控制台现查补全的查询）：它要的表与视图在第一批，不被第二批拖慢；其余不读补全。运行会话不读；Files 面板里
 * 直接打开的 SQLite 文件读到的只放在会话内存里（见 schemaCacheOf）。每次读取另开一条临时连接（同数总行数），不占 Tab 的
 * 连接；断开、关 Tab 时叫停再关，退出时同其他临时连接（有时限）。读不出来不管，等它的照常现查。
 */
function preloadSchema(
  tabKey: string,
  session: Session,
  reads: CatalogBulkRead[],
  reason: PreloadReason
): void {
  const { target } = session
  const [first, ...queue] = reads
  if (session.run || target.kind === 'redis' || first === undefined) {
    // 刷新时没有要读的库：进行中的照样叫停
    stopPreload(tabKey)
    return
  }
  const preload: SchemaPreload = {
    session,
    connection: openStatementClient(session, target, first[0]),
    started: false,
    first,
    queue,
    layers: reason === 'refresh' ? bulkWaitsOf(reads) : null,
    completion:
      reason !== 'show' && (target.kind !== 'postgresql' || first[0] === session.database)
        ? Promise.withResolvers()
        : null
  }
  stopPreload(tabKey, preload)
  preloading.set(tabKey, preload)
  void runPreload(tabKey, preload, target)
}

/**
 * 叫停这个 Tab 进行中的主体结构读取：等它的改等 next（刷新时重跑的那一次）里同一个库的同一批，没有 next 或 next 不读那个
 * 库时照常现查。
 */
function stopPreload(tabKey: string, next?: SchemaPreload): void {
  const preload = preloading.get(tabKey)
  if (preload === undefined) return
  stopJob(preloading, tabKey, true)
  for (const [database, waits] of preload.layers ?? []) {
    for (const batch of CATALOG_BULK_BATCHES) {
      waits[batch].resolve(next?.layers?.get(database)?.[batch].promise ?? null)
    }
  }
  preload.completion?.resolve(next?.completion?.promise ?? null)
}

/**
 * 读主体结构（见 preloadSchema）：依次进行各次读取（见 preloadRead），全部读完时推送。被叫停后不再往下读，也不推送（接着
 * 重跑的那一次，或会话已断开）。
 */
async function runPreload(
  tabKey: string,
  preload: SchemaPreload,
  target: SqlTarget
): Promise<void> {
  const current = (): boolean => preloading.get(tabKey) === preload
  try {
    // 读的这会儿可能追加读取（见 updateDataSourceSessionsShown）：每读完一次重看还有没有
    for (
      let read: CatalogBulkRead | undefined = preload.first;
      read !== undefined && current();
      read = preload.queue.shift()
    ) {
      await preloadRead(tabKey, preload, target, read)
    }
  } finally {
    // 读完：关掉最后一条临时连接（被叫停的由叫停那边处理）并推送
    if (current()) {
      stopJob(preloading, tabKey, false)
      sink?.catalogLayers({ tabKey })
    }
  }
}

/**
 * 一次读取 read：依次读第一批目录、补全（第一次读取且要读时）、第二批目录，读到的写进缓存、交给等它的；每写进一批即推给
 * 这个 Tab（后面没有排着的读取时，第二批与读取结束合为一次推送）。不是第一次读取的，先关掉上一次的临时连接、另开一条
 * （PostgreSQL 连到这个库）；轮到时已取消勾选的库不读。读不出来（连不上、已删掉、无权读系统目录等）不管。被叫停后读到的
 * 不写也不交。
 */
async function preloadRead(
  tabKey: string,
  preload: SchemaPreload,
  target: SqlTarget,
  read: CatalogBulkRead
): Promise<void> {
  const { session } = preload
  const current = (): boolean => preloading.get(tabKey) === preload
  const first = read === preload.first
  const waits = preload.layers?.get(read[0]!)
  try {
    if (!first) {
      // 排着的这会儿取消了勾选：不读
      const shown = shownDatabasesOf(session)
      if (!read.some((database) => shown.includes(database))) return
      void preload.connection.then(
        ({ client }) => closeLoose(client),
        () => {}
      )
      preload.connection = openStatementClient(session, target, read[0])
      preload.started = false
    }
    const { client } = await preload.connection
    if (!current()) return
    preload.started = true
    /** 读一批目录：写进缓存、交给等它的 */
    const readBatch = async (batch: CatalogBulkBatch): Promise<void> => {
      const bulk = await readCatalogBulk(client, read, batch)
      if (!current()) return
      const layers = new Map(bulk.map(({ path, nodes }) => [catalogLayerKey(path), nodes]))
      for (const [key, nodes] of layers) saveSchema(tabKey, session, 'catalog', key, nodes)
      waits?.[batch].resolve(layers)
    }
    await readBatch(0)
    if (!current()) return
    sink?.catalogLayers({ tabKey })
    if (first && preload.completion !== null) {
      const completion = await readCompletionSchema(client)
      if (!current()) return
      const key = completionKey(session.target, session.database)
      saveSchema(tabKey, session, 'completion', key, completion)
      preload.completion.resolve(completion)
    }
    await readBatch(1)
    if (!current()) return
    if (preload.queue.length > 0) sink?.catalogLayers({ tabKey })
  } catch {
    // 这次读不出来不管：等它的照常现查，接着读下一次（被叫停的不再往下读）
  } finally {
    // 这次还没交出的交出 null（已交出的不变）
    for (const batch of CATALOG_BULK_BATCHES) waits?.[batch].resolve(null)
    if (first) preload.completion?.resolve(null)
  }
}

/**
 * 刷新时重跑的主体结构读取里 path 这一层：在它读的范围里（见 catalogBulkBatchOf：这一层所在的库这次也读）即等读它的那次
 * 读取的这一批。不在范围里、读不出来、被叫停、没读到这一层（如刚删掉的模式）为 undefined，照常现查。
 */
async function preloadedLayer(
  tabKey: string,
  path: CatalogPath
): Promise<CatalogNode[] | undefined> {
  const preload = preloading.get(tabKey)
  if (preload?.layers == null) return undefined
  const { target } = preload.session
  if (target.kind === 'redis') return undefined
  const read = catalogBulkBatchOf(target.kind, preload.first[0]!, path)
  if (read === null) return undefined
  const layers = await preload.layers.get(read.database)?.[read.batch].promise
  return layers?.get(catalogLayerKey(path))
}

/**
 * 数据源的显示的库变了（before 为改之前记的，从没设置过为 undefined）：它连着的各个 Data Source Tab 在后台把新勾上的库读
 * 一遍，写进缓存、推送同连上时——正在读时排在最后，没在读时另起一次只读这些库（都不读补全，见 preloadSchema）。取消勾选的
 * 库还排着的，轮到时跳过（正在读的读完为止，见 preloadRead），缓存照留。SQLite 只有一个库，没有显示的库。
 */
export function updateDataSourceSessionsShown(
  dataSourceId: string,
  before: readonly string[] | undefined
): void {
  for (const [tabKey, session] of sessions) {
    const { target } = session
    if (session.dataSourceId !== dataSourceId || session.run || session.client === null) continue
    if (target.kind === 'redis' || target.kind === 'sqlite') continue
    const was = catalogShownDatabases(before, defaultDatabaseOf(target, session.database))
    const preload = preloading.get(tabKey)
    // 还排着的不再追加（取消勾选后又勾上）
    const added = shownDatabasesOf(session).filter(
      (database) =>
        !was.includes(database) && !preload?.queue.some((read) => read.includes(database))
    )
    if (added.length === 0) continue
    const reads = catalogBulkReads(target.kind, session.database, added)
    if (preload === undefined) preloadSchema(tabKey, session, reads, 'show')
    else preload.queue.push(...reads)
  }
}

// —— 控制台 ——

/** PostgreSQL：控制台所在的库（补全、控制台执行都在它上面）；其余类型只有一条连接，为 undefined。 */
function consoleDatabaseOf(session: Session): string | undefined {
  return session.target.kind === 'postgresql' ? session.consoleDatabase : undefined
}

/**
 * 控制台执行用的连接：PostgreSQL 为控制台所在的库上的（见 connectionFor），其余类型为会话的连接（每次现取：取消 SQLite
 * 会换一个查询线程，换的这会儿没有连接）；没有连接时为 null。
 */
async function consoleConnection(session: Session): Promise<CancelableClient | null> {
  const { client } = session
  if (client === null || client.kind === 'redis') return null
  return connectionFor(session, client, consoleDatabaseOf(session))
}

/**
 * 在控制台所在的库上依次执行各条语句（先等应用完记住的控制台上下文），遇错即停；每条最多取回 CONSOLE_ROW_LIMIT 行
 * （读够即结束语句）。表格显示最后一个结果集。执行成功的语句里有改控制台上下文的（见 changesConsoleContext），执行完
 * 回查并推送。登记的数据源（控制台与运行配置）执行成功的语句推送出去，交给补全计数。
 */
export async function runDataSourceConsole(
  tabKey: string,
  statements: string[]
): Promise<ConsoleRun | QueryFailure> {
  const sql = sqlSessionOf(tabKey)
  if (sql === null) return { error: '未连接' }
  const { session, target } = sql
  const run: ConsoleJob = { canceled: false, busy: null }
  running.set(tabKey, run)
  const results: ConsoleStatementResult[] = []
  let result: (ResultSet & { truncated: boolean }) | null = null
  let contextChanged = false
  try {
    await session.ready
    for (const statement of statements) {
      // 断开时标记为已取消：不再为它取连接（PostgreSQL 会另连按库连接）
      if (run.canceled) break
      let busy: CancelableClient | null
      try {
        busy = await consoleConnection(session)
      } catch (error) {
        // PostgreSQL 连不上控制台所在的库
        const message = failureMessage(target, error)
        results.push({ sql: statement, ms: 0, outcome: { kind: 'error', message } })
        break
      }
      if (run.canceled || busy === null) break
      run.busy = busy
      const started = performance.now()
      try {
        const outcome = await runQuery(busy.client, statement, [], CONSOLE_ROW_LIMIT)
        const ms = Math.round(performance.now() - started)
        // 叫停后正常返回的也是被打断的：MySQL 的 SLEEP() 被 KILL QUERY 打断时不报错、照常返回 1
        if (run.canceled) {
          results.push({ sql: statement, ms, outcome: { kind: 'canceled' } })
          break
        }
        if (outcome.kind === 'rows') {
          const { columns, rows, truncated } = outcome
          result = { columns, rows, truncated }
          results.push({
            sql: statement,
            ms,
            outcome: { kind: 'rows', count: rows.length, truncated }
          })
        } else {
          results.push({ sql: statement, ms, outcome })
        }
        if (changesConsoleContext(dialectOf(target.kind), statement)) contextChanged = true
      } catch (error) {
        const ms = Math.round(performance.now() - started)
        const message = failureMessage(target, error)
        results.push({
          sql: statement,
          ms,
          outcome: run.canceled ? { kind: 'canceled' } : { kind: 'error', message }
        })
        break
      }
    }
  } finally {
    if (running.get(tabKey) === run) running.delete(tabKey)
  }
  const succeeded = results.flatMap((r) =>
    r.outcome.kind === 'error' || r.outcome.kind === 'canceled' ? [] : [r.sql]
  )
  if (session.dataSourceId !== null && succeeded.length > 0) {
    sink?.executed({ dataSourceId: session.dataSourceId, kind: target.kind, statements: succeeded })
  }
  if (contextChanged) await refreshContext(tabKey, session)
  return { statements: results, result }
}

/**
 * 取消控制台正在执行的语句：PostgreSQL、MySQL / MariaDB 叫停服务器上的语句（在执行它的那条连接上，见
 * cancelStatement）；SQLite 换一个查询线程（进行中的查询随旧线程中止，见 reopenSqlite）。叫停失败作为结果交回；没在
 * 执行（或还没发出语句）时为 null。
 */
export async function cancelDataSourceConsole(tabKey: string): Promise<QueryFailure | null> {
  const run = running.get(tabKey)
  const session = sessions.get(tabKey)
  if (run === undefined || session?.client == null || session.client.kind === 'redis') return null
  run.canceled = true
  const { client } = session
  if (client.kind === 'sqlite') {
    await reopenSqlite(tabKey, session, client)
    return null
  }
  return run.busy === null ? null : cancelStatement(session, run.busy)
}

/**
 * 补全用的表结构（系统库与系统模式不算，见 readCompletionSchema），范围跟着控制台上下文：PostgreSQL 在控制台所在的
 * 库上读、按库写回缓存；MySQL / MariaDB 为全部库，不写前缀时补全到控制台所在的库。先等应用完记住的控制台上下文。
 * 后台正在一次读完主体结构时（连上后、刷新目录时；它只在连接所在的库上读补全，PostgreSQL 的这个库没显示、控制台在别的
 * 库上时不等它）等它读到的、不另查（它已写进缓存）。它读不出来、被叫停时照常现查。不写前缀时查找的模式或库都在控制台的
 * 连接上另读：控制台里 use、set search_path 过后与新连接不同（见 readSearchPath；缓存里存新连接上的，见
 * readCompletionSchema）。
 * PostgreSQL 给了 requested 即读这个库的那份（表数据的 WHERE / ORDER BY 框，表不在控制台所在的库上时）：在它的按库
 * 连接上读（翻页查询也在这条连接上），同样按库写回缓存，不写前缀时查找的模式为这条连接的。
 */
export async function readDataSourceCompletionSchema(
  tabKey: string,
  requested?: string
): Promise<CompletionSchema | QueryFailure> {
  const session = sessions.get(tabKey)
  if (session === undefined) return { error: '未连接' }
  await session.ready
  const database = requestedDatabase(session, requested) ?? consoleDatabaseOf(session)
  const preload =
    database === undefined || database === session.database ? preloading.get(tabKey) : undefined
  const preloaded = preload?.completion == null ? null : await preload.completion.promise
  return withSqlClient(tabKey, database, async (client, _dialect, session) => {
    let schema = preloaded
    if (schema === null) {
      schema = await readCompletionSchema(client)
      saveSchema(
        tabKey,
        session,
        'completion',
        completionKey(session.target, database ?? session.database),
        schema
      )
    }
    return { ...schema, searchPath: await readSearchPath(client) }
  })
}

/**
 * 补全的缓存（不访问数据库；PostgreSQL 为控制台所在的库的那份）；没有为 null。不写前缀时查找的模式或库以控制台
 * 上下文为准（缓存里的是读它时的，见 consoleSearchPath）。PostgreSQL 给了 requested 即这个库的那份；不是控制台所在的库
 * 时，不写前缀时查找的模式用缓存里的（新连接上的，同它的按库连接，见 readDataSourceCompletionSchema）。
 */
export async function peekDataSourceCompletionSchema(
  tabKey: string,
  requested?: string
): Promise<CompletionSchema | null> {
  const session = sessions.get(tabKey)
  if (session === undefined) return null
  const consoleDatabase = consoleDatabaseOf(session)
  const database = requestedDatabase(session, requested) ?? consoleDatabase
  const cached = await peekSchema(tabKey, 'completion', () =>
    completionKey(session.target, database ?? session.database)
  )
  const { context } = session
  if (cached === null || database !== consoleDatabase || context == null) return cached
  return { ...cached, searchPath: consoleSearchPath(context) }
}

/** PostgreSQL 要读补全的那个库（见 readDataSourceCompletionSchema 的 requested）；其余类型只有一份，为 undefined。 */
function requestedDatabase(session: Session, requested: string | undefined): string | undefined {
  return session.target.kind === 'postgresql' ? requested : undefined
}

/**
 * 运行配置对话框的「库」选项：表结构缓存里目录根这一层的库（不访问数据库）；没有缓存、SQLite 与 Redis 为空。
 */
export async function peekDataSourceDatabases(dataSourceId: string): Promise<string[]> {
  const nodes = await readSchemaCache(dataSourceId, 'catalog', catalogLayerKey({}))
  return (nodes ?? []).flatMap((node) => (node.kind === 'database' ? [node.name] : []))
}

/** 数据源连着的一个 Data Source Tab（运行会话不算）：借它的连接现查。没有为 null。 */
function connectedTabOf(dataSourceId: string): { tabKey: string; session: Session } | null {
  for (const [tabKey, session] of sessions) {
    if (session.dataSourceId === dataSourceId && !session.run && session.client !== null) {
      return { tabKey, session }
    }
  }
  return null
}

/**
 * 运行配置对话框里的补全（不依赖 Tab）：按「数据源 + 库」取表结构缓存；缓存里没有时借一个连着的 Data Source Tab 现查
 * （读到的写回缓存）。database 为空即数据源的默认库：PostgreSQL 取连接目标写的库，没写时取连着的 Tab 默认连接所在的
 * 库，不写前缀时补全到新连接上的模式（运行配置在新连接上跑，见 readCompletionSchema）；MySQL / MariaDB 与 SQLite
 * 只有一份，不写前缀时补全到 database（空即连接目标写的库）。Redis、PostgreSQL 不知道默认库是哪个、没有缓存也没有
 * 连着的 Tab 时为 null。
 */
export async function readDataSourceCompletionFor(
  dataSourceId: string,
  database: string
): Promise<CompletionSchema | null> {
  const dataSource = findDataSource(dataSourceId)
  if (dataSource === null || dataSource.target.kind === 'redis') return null
  const { target } = dataSource
  const tab = connectedTabOf(dataSourceId)
  let scope = ''
  if (target.kind === 'postgresql') {
    const pgDatabase = database || target.database || tab?.session.database
    if (!pgDatabase) return null
    scope = pgDatabase
  }
  const withDefault = (schema: CompletionSchema): CompletionSchema => {
    if (target.kind !== 'mysql' && target.kind !== 'mariadb') return schema
    const current = database || target.database
    return { ...schema, searchPath: current === '' ? [] : [current] }
  }
  const key = completionKey(target, scope)
  const cached = await readSchemaCache(dataSourceId, 'completion', key)
  if (cached !== null) return withDefault(cached)
  if (tab === null) return null
  const result = await withSqlClient(
    tab.tabKey,
    target.kind === 'postgresql' ? scope : undefined,
    async (client, _dialect, session) => {
      const schema = await readCompletionSchema(client)
      saveSchema(tab.tabKey, session, 'completion', key, schema)
      return schema
    }
  )
  return 'schemas' in result ? withDefault(result) : null
}

// —— 控制台上下文 ——

/**
 * 回查到的控制台上下文。settled：已不会被撤销、可以记住——PostgreSQL 的控制台连接在事务里时不算（事务里的 SET 随回滚
 * 撤销，SET LOCAL 随事务结束失效；等结束事务的语句触发的那次回查）；MySQL / MariaDB 的 USE、Redis 的 SELECT 不随事务撤销。
 */
interface ReadContext {
  context: ConsoleContext
  settled: boolean
}

/**
 * 记下控制台上下文并推送给界面；remember 时（用户切换过、执行了改它的语句、应用了记住的）且已不会被撤销，登记的数据源
 * 按 Tab 记住（跨重启、重连后重新应用，见 initContext）。
 */
function setContext(tabKey: string, session: Session, read: ReadContext, remember: boolean): void {
  const { context } = read
  session.context = context
  if (remember && read.settled && session.dataSourceId !== null) {
    setSavedConsoleContext(tabKey, savedConsoleContext(context))
  }
  sink?.context({ tabKey, context })
}

/**
 * 回查控制台上下文：在控制台的连接上读（Redis 问 CLIENT INFO，问不到时为 redisFallback，再没有就不变，还没有时为连接
 * 目标的库编号）。会话已断开、被取代（这时不再为它另连按库连接）或没有连接为 null；读不出来照常抛出。
 */
async function readContextOf(
  tabKey: string,
  session: Session,
  redisFallback?: number
): Promise<ReadContext | null> {
  const { client, target, context } = session
  if (sessions.get(tabKey) !== session || client === null) return null
  if (client.kind === 'redis') {
    const selected = await readSelectedDatabase(client.client)
    const before =
      context?.kind === 'redis'
        ? context.database
        : Number(target.kind === 'redis' ? target.database || '0' : '0')
    return {
      context: { kind: 'redis', database: selected ?? redisFallback ?? before },
      settled: true
    }
  }
  const busy = await consoleConnection(session)
  if (busy === null) return null
  const read = await readConsoleContext(busy.client)
  if (read === null) return null
  // 读完即是连接眼下的事务状态（pg 记着服务器每次交回的：I 为不在事务里）
  const settled =
    busy.client.kind !== 'postgresql' || busy.client.client.getTransactionStatus() === 'I'
  return { context: read, settled }
}

/**
 * 执行了改控制台上下文的语句、命令后回查，推送并记住（还会被撤销的不记，见 ReadContext）。读不出来（如连接这会儿断了）
 * 不管：断开另有推送。
 */
async function refreshContext(
  tabKey: string,
  session: Session,
  redisFallback?: number
): Promise<void> {
  if (session.context === null) return
  try {
    const read = await readContextOf(tabKey, session, redisFallback)
    if (read !== null && sessions.get(tabKey) === session) {
      setContext(tabKey, session, read, true)
    }
  } catch {
    // 见上
  }
}

/** 要切到的控制台上下文：PostgreSQL 的 searchPath 由改之前的 search_path 算出要设的（不给即不改）。 */
type ContextTarget =
  | { kind: 'postgresql'; database: string; searchPath?: (current: string) => string }
  | { kind: 'mysql'; database: string }
  | { kind: 'redis'; database: number }

/**
 * 在控制台的连接上切换上下文（界面切换、应用记住的）：PostgreSQL 切到那个库的按库连接，给了 searchPath 即按它改
 * search_path（传进来的是改之前的）；MySQL / MariaDB 发 USE；Redis 发 SELECT。切不过去时交回原因，上下文不变；出错在
 * 改 search_path 那一步（库已连上）的另记 searchPath，界面据它说是模式没切过去（见 consoleContextFailureLevel）。
 */
async function applyContext(
  session: Session,
  target: ContextTarget
): Promise<ConsoleContextFailure | null> {
  const { client } = session
  if (client === null) return { error: '未连接' }
  try {
    if (target.kind === 'redis') {
      if (client.kind === 'redis') await selectDatabase(client.client, target.database)
      return null
    }
    if (client.kind === 'redis' || client.kind === 'sqlite') return null
    if (target.kind === 'mysql') {
      await switchDatabase(client, target.database)
      return null
    }
    const busy = await connectionFor(session, client, target.database)
    if (target.searchPath !== undefined) {
      try {
        const current = await readConsoleContext(busy.client)
        if (current?.kind === 'postgresql') {
          await setSearchPath(busy.client, target.searchPath(current.searchPath))
        }
      } catch (error) {
        return { ...failureOf(session.target, error), searchPath: true }
      }
    }
    session.consoleDatabase = target.database
    return null
  } catch (error) {
    return failureOf(session.target, error)
  }
}

/** 记住的控制台上下文要切到的：PostgreSQL 的 search_path 整个设成记住的那一份。 */
function savedTarget(saved: SavedConsoleContext): ContextTarget {
  if (saved.kind !== 'postgresql') return saved
  const { database, searchPath } = saved
  return { kind: 'postgresql', database, searchPath: () => searchPath }
}

/** 界面切换要切到的：PostgreSQL 选了模式即把它放到 search_path 最前，没选不改 search_path。 */
function changeTarget(change: ConsoleContextChange): ContextTarget {
  if (change.kind !== 'postgresql') return change
  const { database, schema } = change
  if (schema === undefined) return { kind: 'postgresql', database }
  return {
    kind: 'postgresql',
    database,
    searchPath: (current) => prependSearchPath(current, schema)
  }
}

/**
 * 连上后定下控制台上下文：Data Source Tab 先应用这个 Tab 记住的（跨重启、重连）；记住的库已不在、切不过去时这一次
 * 就用默认的（记住的留着，下次连上再试）。之后回查并推送。运行会话与 SQLite 没有。不会失败：读不出来即没有上下文。
 */
async function initContext(tabKey: string, session: Session): Promise<void> {
  const kind = consoleContextKind(session.target.kind)
  if (session.run || kind === null) return
  const stored = session.dataSourceId === null ? null : getSavedConsoleContext(tabKey)
  // 数据源改过类型时旧的对不上（连接信息被改时本已删掉）
  const saved = stored?.kind === kind ? stored : null
  const applied = saved !== null && (await applyContext(session, savedTarget(saved))) === null
  try {
    const read = await readContextOf(
      tabKey,
      session,
      applied && saved?.kind === 'redis' ? saved.database : undefined
    )
    if (read !== null && sessions.get(tabKey) === session) {
      setContext(tabKey, session, read, applied)
    }
  } catch {
    // 读不出来：没有上下文（界面不出下拉）
  }
}

/** 控制台上下文：先等连上后应用完记住的；没有（SQLite、运行会话、没连上、读不出来）为 null。 */
export async function getDataSourceConsoleContext(tabKey: string): Promise<ConsoleContext | null> {
  const session = sessions.get(tabKey)
  if (session === undefined) return null
  await session.ready
  return sessions.get(tabKey) === session ? session.context : null
}

/**
 * 界面上切换控制台上下文：先在控制台的连接上执行（PostgreSQL 选了模式即把它放到 search_path 最前，没选则不改
 * search_path），再回查、记住并推送。切不过去（库连不上、库编号超出范围、无权；Redis 的控制台开着事务）时交回原因
 * （见 applyContext），上下文不变。
 */
export async function switchDataSourceConsoleContext(
  tabKey: string,
  change: ConsoleContextChange
): Promise<ConsoleContextFailure | null> {
  const session = sessions.get(tabKey)
  if (session === undefined) return { error: '未连接' }
  await session.ready
  // 等的这会儿断开了：不再为它另连按库连接
  if (sessions.get(tabKey) !== session || session.client === null) return { error: '未连接' }
  if (change.kind === 'redis' && session.redisTransaction) return { error: REDIS_IN_TRANSACTION }
  const failure = await applyContext(session, changeTarget(change))
  if (failure !== null) return failure
  try {
    const read = await readContextOf(
      tabKey,
      session,
      change.kind === 'redis' ? change.database : undefined
    )
    if (read !== null && sessions.get(tabKey) === session) {
      setContext(tabKey, session, read, true)
    }
    return null
  } catch (error) {
    return failureOf(session.target, error)
  }
}

// —— 导出 ——

/**
 * 导出整张表（带当前的 WHERE 与 ORDER BY，主键排在最后）：另开临时连接边读边写，不挡着当前 Tab 的其他查询。导出为
 * SQL INSERT 时先读出这张表的生成列（INSERT 里不写）与总是自动生成的标识列（INSERT 里加 OVERRIDING SYSTEM VALUE），
 * 见 InsertTarget。连不上、读出错、文件写不了都作为结果交回。
 */
export async function exportDataSourceTable(
  tabKey: string,
  request: TableExportRequest,
  format: ExportFormat,
  file: string
): Promise<ExportResult> {
  const sql = sqlSessionOf(tabKey)
  if (sql === null) return { error: '未连接' }
  const { session, target } = sql
  const dialect = dialectOf(target.kind)
  let client: SqlClient | null = null
  /** 导出语句已发出、还没顺利结束 */
  let exporting = false
  try {
    client = (await openStatementClient(session, target, request.table.database)).client
    const primaryKey = await primaryKeyFor(session, client, dialect, request.table)
    const sql = tableSelectSql(dialect, { ...request, primaryKey })
    const generated =
      format === 'sql' ? await generatedColumnsOf(client, dialect, request.table) : []
    const alwaysIdentity =
      format === 'sql' ? await alwaysIdentityColumnsOf(client, dialect, request.table) : []
    exporting = true
    await exportQuery(client, sql, file, format, {
      table: qualifiedName(dialect, request.table),
      generated,
      alwaysIdentity
    })
    exporting = false
    return { path: file }
  } catch (error) {
    return failureOf(target, error)
  } finally {
    if (client !== null) {
      // MySQL 导出出错时服务器上的语句可能还在执行、结果还在发来（见 exportQuery）：先叫停再关
      if (exporting && client.kind === 'mysql')
        cancelThenClose(session, { client, backendPid: null })
      else void closeLoose(client)
    }
  }
}

// —— Redis ——

/**
 * 在 Redis 会话的连接上执行（先等应用完记住的库编号：键都按所在的库读）；未连接、出错都作为结果交回（Redis 的无权
 * 报错原话就说得清，不另分「无权」）。控制台开着事务时只发控制台执行的命令（fromConsole）：其余的读取（键列表、看键、
 * 核对键在不在、库编号下拉、命令表）与控制台共用这条连接，发了会排进用户的事务、只回 QUEUED（EXEC 时多出结果），
 * 不发，交回「事务还没结束」。
 */
async function withRedisClient<T>(
  tabKey: string,
  run: (client: RedisClient) => Promise<T>,
  fromConsole = false
): Promise<T | RedisFailure> {
  const session = sessions.get(tabKey)
  if (session === undefined) return { error: '未连接' }
  await session.ready
  const client = sessions.get(tabKey) === session ? session.client : null
  if (client?.kind !== 'redis') return { error: '未连接' }
  if (session.redisTransaction && !fromConsole) return { error: REDIS_IN_TRANSACTION }
  try {
    return await run(client.client)
  } catch (error) {
    return { error: failureMessage(session.target, error) }
  }
}

export function scanRedisKeys(tabKey: string, pattern: string): Promise<RedisKeyList> {
  return withRedisClient(tabKey, (client) => scanKeys(client, pattern))
}

export function readRedisKey(tabKey: string, key: string): Promise<RedisKeyResult> {
  return withRedisClient(tabKey, async (client) => {
    const detail = await readKey(client, key)
    return detail ?? { error: '这个键已不存在' }
  })
}

/** 键还在不在（恢复上次的键、点最近打开时核对）。 */
export function hasRedisKey(tabKey: string, key: string): Promise<boolean | RedisFailure> {
  return withRedisClient(tabKey, (client) => keyExists(client, key))
}

/** Redis 会话连接时的账号（控制台执行 RESET 之后照它重新认证，见 runCommands）。 */
function redisAuthOf(session: Session): RedisAuth {
  const { target, password } = session
  if (target.kind !== 'redis' || (target.user === '' && password === null)) return null
  return { username: target.user || undefined, password: password ?? '' }
}

/**
 * 依次执行各行命令，遇错即停；执行中断开（关 Tab、停止运行会话）时，被打断的那条记为已取消。执行成功的 RESET 随即
 * 照连接时的账号重新认证（这条连接与键列表、看键共用）。执行完记下连接是否还在事务里（见 redisInTransactionAfter）；
 * 执行了切库的命令、且执行完不在事务里（见 recheckRedisDatabase）时回查库编号并推送（键列表随之换库）。
 */
export async function runRedisCommands(
  tabKey: string,
  lines: string[]
): Promise<RedisCommandResult[] | RedisFailure> {
  const session = sessions.get(tabKey)
  const run: ConsoleJob = { canceled: false, busy: null }
  running.set(tabKey, run)
  let results: RedisCommandResult[] | RedisFailure
  try {
    results = await withRedisClient(
      tabKey,
      (client) =>
        runCommands(client, lines, {
          isCanceled: () => run.canceled,
          auth: session === undefined ? null : redisAuthOf(session)
        }),
      true
    )
  } finally {
    if (running.get(tabKey) === run) running.delete(tabKey)
  }
  // 执行的这会儿断开或重连了：结果属于旧的连接
  if (session === undefined || sessions.get(tabKey) !== session || !Array.isArray(results)) {
    return results
  }
  const before = session.redisTransaction
  session.redisTransaction = redisInTransactionAfter(results, before)
  const { context } = session
  if (context?.kind === 'redis' && recheckRedisDatabase(results, before)) {
    await refreshContext(tabKey, session, redisDatabaseAfter(results, context.database))
  }
  return results
}

/** 库的个数与各库的键数（键列表顶栏的库编号下拉）。 */
export function readRedisDatabases(tabKey: string): Promise<RedisDatabasesResult> {
  return withRedisClient(tabKey, readDatabases)
}

/** 控制台补全用的命令名（服务器的命令表，见 readCommandNames）。 */
export function readRedisCommands(tabKey: string): Promise<string[] | RedisFailure> {
  return withRedisClient(tabKey, readCommandNames)
}
