// 数据源（Data Source）的域模型与纯函数；术语见 CONTEXT.md，产品范围见 docs/prd/database.md，
// 取舍见 ADR-0043。

import { networkErrorReason, portError, type PasswordChange } from './connection'
import { lastPathSegment } from './files-path'
import type { DataSourceRunConfig } from './types'

export type DataSourceKind = 'postgresql' | 'mysql' | 'mariadb' | 'sqlite' | 'redis'

/** 说 SQL、经网络连接的三种（MariaDB 与 MySQL 共用驱动，方言不同）。 */
export type SqlServerKind = 'postgresql' | 'mysql' | 'mariadb'

/** 说 SQL 的各种（Redis 以外）：有目录、控制台写 SQL。 */
export type SqlKind = Exclude<DataSourceKind, 'redis'>

export const DATA_SOURCE_KINDS: readonly DataSourceKind[] = [
  'postgresql',
  'mysql',
  'mariadb',
  'sqlite',
  'redis'
]

export const DATA_SOURCE_KIND_LABELS: Record<DataSourceKind, string> = {
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  sqlite: 'SQLite',
  redis: 'Redis'
}

export const DEFAULT_DATA_SOURCE_PORTS: Record<Exclude<DataSourceKind, 'sqlite'>, number> = {
  postgresql: 5432,
  mysql: 3306,
  mariadb: 3306,
  redis: 6379
}

/**
 * 连接串里写明的加密要求（libpq 的 sslmode 语义；MySQL 连接串的写法映射到同一套）。
 * 没写、或写的是 prefer / allow 时为 null，即默认档：能加密就加密、不校验证书。
 */
export type SslMode = 'disable' | 'require' | 'verify-ca' | 'verify-full'

export const SSL_MODE_LABELS: Record<SslMode, string> = {
  disable: '不加密',
  require: '必须加密',
  'verify-ca': '必须加密并校验证书',
  'verify-full': '必须加密并校验证书与主机名'
}

/** 经网络连接的数据源共有的字段。 */
interface NetworkFields {
  host: string
  port: number
  /** 空串 = 不指定（交给数据库的默认规则） */
  user: string
  /** 默认库；空串 = 不指定。Redis 为库编号（非负整数的文字） */
  database: string
  /** 绕开代理直连（ADR-0039）：只在 macOS / Windows 生效 */
  direct: boolean
}

/**
 * 连接所需的全部参数：连接目标（SQL 数据库、Redis 或本机 SQLite 文件，即连到哪里）之外，网络类还带着按类型不同的
 * 加密要求与是否直连。判重（sameDataSourceTarget）只比其中的连接目标部分。
 */
export type DataSourceTarget =
  | ({ kind: SqlServerKind; sslMode: SslMode | null } & NetworkFields)
  | ({ kind: 'redis'; tls: boolean } & NetworkFields)
  | { kind: 'sqlite'; file: string }

export type NetworkDataSourceTarget = Exclude<DataSourceTarget, { kind: 'sqlite' }>
export type SqlServerTarget = Extract<DataSourceTarget, { kind: SqlServerKind }>
/** 说 SQL 的连接目标（Redis 以外）。 */
export type SqlTarget = Exclude<DataSourceTarget, { kind: 'redis' }>

/** 被登记进 DevCube 的一个数据库连接（左树里与 Project、Server 并列的顶层条目）。 */
export interface DataSource {
  id: string
  /** 展示名；默认由连接目标派生，可改 */
  name: string
  target: DataSourceTarget
  /** 登记时间（epoch ms） */
  addedAt: number
  /** 最近打开时间（epoch ms）；登记时写入，之后每次选中刷新 */
  lastOpenedAt: number | null
  pinned: boolean
  /** 左树自定义序（与 Project、Server 共用一条序列，小的在前） */
  order: number
  /**
   * 显示的库（PostgreSQL、MySQL / MariaDB，按勾选的先后）：目录根下只列它们，后台只读它们。从没设置过时缺省，按默认库
   * 显示（见 catalogShownDatabases）；连接信息被改时回到缺省，根这一层不再列出的（已删掉）去掉
   */
  shownDatabases?: string[]
}

/** 渲染端看到的数据源：密文只留在主进程，这里只带「是否记住了密码」。 */
export interface DataSourceNode {
  dataSource: DataSource
  hasPassword: boolean
  /** 在它上面执行的命令型配置（按用户排的顺序） */
  configs: DataSourceRunConfig[]
}

/** 添加 / 编辑数据源的提交内容。 */
export interface DataSourceInput {
  name: string
  target: DataSourceTarget
  password?: PasswordChange
}

/** 添加数据源的结果：最新列表 + 新登记的数据源 id。 */
export interface DataSourceAddResult {
  dataSources: DataSourceNode[]
  focusId: string
}

/** 测试连接的输入：表单当前的连接目标与密码处理（undefined 时沿用 dataSourceId 记住的密码）。 */
export interface DataSourceTestInput {
  target: DataSourceTarget
  /** 编辑已登记的数据源时为其 id，添加时为 null */
  dataSourceId: string | null
  password: PasswordChange
}

/**
 * 一个 Data Source Tab 的连接状态：没连 / 连接中 / 已连接（带默认库，见 defaultDatabaseOf）/ 已断开（连接失败或意外
 * 断开，带原因）。
 */
export type DataSourceSessionState =
  | { phase: 'idle' }
  | { phase: 'connecting' }
  | { phase: 'connected'; database: string }
  | {
      phase: 'disconnected'
      message: string
      /** 数据库拒绝了密码（或需要密码却没给）：未连接页再出密码框 */
      passwordRejected: boolean
    }

export interface DataSourceSessionEvent {
  tabKey: string
  state: DataSourceSessionState
}

/** 点「连接」时从未连接页的密码框交上来的密码；没出密码框（已记住）时不传。 */
export interface DataSourceConnectPassword {
  value: string
  remember: boolean
}

/**
 * 连接失败是不是因为密码：PostgreSQL 的 28P01（或没给密码时驱动的报错）、MySQL / MariaDB 的 1045、
 * Redis 的 WRONGPASS / NOAUTH。
 */
export function isPasswordRejected(
  kind: DataSourceKind,
  error: { code?: unknown; errno?: unknown; message: string }
): boolean {
  switch (kind) {
    case 'postgresql':
      return error.code === '28P01' || error.message.includes('client password must be')
    case 'mysql':
    case 'mariadb':
      return error.errno === 1045
    case 'redis':
      return /^(WRONGPASS|NOAUTH)\b/.test(error.message)
    case 'sqlite':
      return false
  }
}

/**
 * 服务器是不是明确回答了不支持加密（默认档据此改用不加密重连）：PostgreSQL 对 SSLRequest 回答 N 时 pg 的报错、
 * MySQL / MariaDB 握手里没有 SSL 能力时 mysql2 的 HANDSHAKE_NO_SSL_SUPPORT。别的加密错误（证书不对等）都不算。
 */
export function isTlsUnsupported(
  kind: SqlServerKind,
  error: { code?: unknown; message: string }
): boolean {
  return kind === 'postgresql'
    ? error.message === 'The server does not support SSL connections'
    : error.code === 'HANDSHAKE_NO_SSL_SUPPORT'
}

/** IPv6 地址拼端口时要加方括号。 */
function hostWithPort(host: string, port: number, defaultPort: number): string {
  const shown = host.includes(':') ? `[${host}]` : host
  return port === defaultPort ? shown : `${shown}:${port}`
}

/** 连接目标的一行说明：SQLite 为文件路径；其余为 `用户@地址[:端口][/库]`，默认端口不写。 */
export function dataSourceTargetLabel(target: DataSourceTarget): string {
  if (target.kind === 'sqlite') return target.file
  const address = hostWithPort(target.host, target.port, DEFAULT_DATA_SOURCE_PORTS[target.kind])
  const base = target.user === '' ? address : `${target.user}@${address}`
  return target.database === '' ? base : `${base}/${target.database}`
}

/** 没填名称时的默认名：SQLite 为文件名；其余为 `地址[:端口][/库]`（不带用户）。 */
export function defaultDataSourceName(target: DataSourceTarget): string {
  if (target.kind === 'sqlite') return lastPathSegment(target.file)
  const address = hostWithPort(target.host, target.port, DEFAULT_DATA_SOURCE_PORTS[target.kind])
  return target.database === '' ? address : `${address}/${target.database}`
}

const SQLITE_REASONS: Record<string, string> = {
  SQLITE_CANTOPEN: '无法打开文件',
  SQLITE_NOTADB: '不是 SQLite 数据库文件',
  // 写入遇到锁，等了 5 秒仍拿不到（见 docs/prd/database.md「SQLite 并发」）
  SQLITE_BUSY: '数据库正被其他程序占用，请稍后重试'
}

/**
 * 驱动报的连接被关掉（不是 Node 的网络错误码）：mysql2 在服务器关掉连接（如被 KILL）时报 PROTOCOL_CONNECTION_LOST，
 * 先于连接的 end 事件到达。
 */
const CONNECTION_LOST_REASONS: Record<string, string> = {
  PROTOCOL_CONNECTION_LOST: '连接被服务器关闭'
}

/**
 * 连接失败的原因：网络错误写成「无法连接到 地址：原因」，服务器关掉了连接、SQLite 的常见错误给中文，
 * 其余（认证失败、库不存在、证书问题等）照数据库或驱动给的原话。
 */
export function dataSourceFailureMessage(
  target: DataSourceTarget,
  error: { code?: string; message: string }
): string {
  if (target.kind === 'sqlite') {
    return (error.code === undefined ? undefined : SQLITE_REASONS[error.code]) ?? error.message
  }
  const lost = error.code === undefined ? undefined : CONNECTION_LOST_REASONS[error.code]
  if (lost !== undefined) return lost
  const network = networkErrorReason(error.code)
  if (network === undefined) return error.message
  const address = hostWithPort(target.host, target.port, DEFAULT_DATA_SOURCE_PORTS[target.kind])
  return `无法连接到 ${address}：${network}`
}

/**
 * 连上后的默认库（CONTEXT.md）：连接信息里填的库；PostgreSQL 没填时为连上后所在的库 current（current_database()，填了时
 * 即填的那个），MySQL / MariaDB 没填时没有（空串）。SQLite、Redis 用不到，为空串。
 */
export function defaultDatabaseOf(target: DataSourceTarget, current: string): string {
  switch (target.kind) {
    case 'postgresql':
      return current
    case 'mysql':
    case 'mariadb':
      return target.database
    case 'sqlite':
    case 'redis':
      return ''
  }
}

/** 两个连接目标是否指向同一个库（允许重复登记，提交前据此二次确认）；加密与直连设置不参与比较。 */
export function sameDataSourceTarget(a: DataSourceTarget, b: DataSourceTarget): boolean {
  if (a.kind === 'sqlite' || b.kind === 'sqlite') {
    return a.kind === 'sqlite' && b.kind === 'sqlite' && a.file === b.file
  }
  return (
    a.kind === b.kind &&
    a.host.toLowerCase() === b.host.toLowerCase() &&
    a.port === b.port &&
    a.user === b.user &&
    a.database === b.database
  )
}

/**
 * 编辑前后连接信息是否变了（变了才断开已建立的连接）：连接目标连同加密与直连设置都算；只改名、只改记住的密码不算。
 */
export function dataSourceConnectionChanged(
  before: DataSourceTarget,
  after: DataSourceTarget
): boolean {
  if (!sameDataSourceTarget(before, after)) return true
  if (before.kind === 'sqlite' || after.kind === 'sqlite') return false
  const encryption = (t: NetworkDataSourceTarget): SslMode | boolean | null =>
    t.kind === 'redis' ? t.tls : t.sslMode
  return encryption(before) !== encryption(after) || before.direct !== after.direct
}

/** 连接目标校验；可以提交时为 null。 */
export function dataSourceTargetError(target: DataSourceTarget): string | null {
  if (target.kind === 'sqlite') return target.file.trim() === '' ? '请选择数据库文件' : null
  if (target.host === '') return '请填写地址'
  if (/\s/.test(target.host)) return '地址格式不正确'
  if (target.kind === 'redis') return portError(target.port) ?? redisDatabaseError(target.database)
  return portError(target.port)
}

/** Redis 的库编号校验（空串即不指定）：可以提交时为 null。连接目标与数据源上的配置共用。 */
export function redisDatabaseError(text: string): string | null {
  return text !== '' && !/^\d+$/.test(text) ? '库编号应为非负整数' : null
}

// —— 连接串 ——

/** 粘贴连接串拆出的内容：连接目标与密码（连接串里没写密码时为 null）。 */
export interface ParsedDataSourceUrl {
  target: NetworkDataSourceTarget
  password: string | null
}

const URL_SCHEMES: Record<string, { kind: Exclude<DataSourceKind, 'sqlite'>; tls?: boolean }> = {
  postgres: { kind: 'postgresql' },
  postgresql: { kind: 'postgresql' },
  mysql: { kind: 'mysql' },
  mariadb: { kind: 'mariadb' },
  redis: { kind: 'redis', tls: false },
  rediss: { kind: 'redis', tls: true }
}

const UNSUPPORTED_URL =
  '无法识别的连接串，支持 postgres://、mysql://、mariadb://、redis://、rediss://'

/** PostgreSQL 的 sslmode（libpq 取值；no-verify 是 node-postgres 的写法，等同 require）。 */
function postgresSslMode(value: string): SslMode | null | undefined {
  switch (value) {
    case 'disable':
      return 'disable'
    case 'allow':
    case 'prefer':
      return null
    case 'require':
    case 'no-verify':
      return 'require'
    case 'verify-ca':
      return 'verify-ca'
    case 'verify-full':
      return 'verify-full'
    default:
      return undefined
  }
}

/** MySQL / MariaDB 连接串的 `ssl-mode`（MySQL 官方取值，大小写不敏感）映射到同一套。 */
function mysqlSslMode(value: string): SslMode | null | undefined {
  switch (value.toUpperCase()) {
    case 'DISABLED':
      return 'disable'
    case 'PREFERRED':
      return null
    case 'REQUIRED':
      return 'require'
    case 'VERIFY_CA':
      return 'verify-ca'
    case 'VERIFY_IDENTITY':
      return 'verify-full'
    default:
      return undefined
  }
}

/** 百分号解码；连接串里写了不成对的 `%` 时原样保留。 */
function decodePart(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * 把 `postgres://…`、`mysql://…`、`mariadb://…`、`redis://…`、`rediss://…` 连接串拆成连接目标与密码。
 * 端口缺省取该类型的默认端口；路径是默认库（Redis 为库编号）；加密要求取 PostgreSQL 的 `sslmode`、
 * MySQL / MariaDB 的 `ssl-mode`，其余参数不认。
 */
export function parseDataSourceUrl(text: string): ParsedDataSourceUrl | { error: string } {
  const trimmed = text.trim()
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed)?.[1]?.toLowerCase()
  const spec = scheme === undefined ? undefined : URL_SCHEMES[scheme]
  if (spec === undefined) return { error: UNSUPPORTED_URL }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { error: '连接串格式不正确' }
  }
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1')
  if (host === '') return { error: '连接串里没有地址' }
  const port = url.port === '' ? DEFAULT_DATA_SOURCE_PORTS[spec.kind] : Number(url.port)
  const user = decodePart(url.username)
  const password = url.password === '' ? null : decodePart(url.password)
  const database = decodePart(url.pathname.replace(/^\//, ''))
  const fields = { host, port, user, database, direct: false }

  if (spec.kind === 'redis') {
    const error = redisDatabaseError(database)
    if (error !== null) return { error }
    return { target: { kind: 'redis', tls: spec.tls === true, ...fields }, password }
  }
  const param = spec.kind === 'postgresql' ? 'sslmode' : 'ssl-mode'
  const raw = url.searchParams.get(param)
  const sslMode =
    raw === null ? null : spec.kind === 'postgresql' ? postgresSslMode(raw) : mysqlSslMode(raw)
  if (sslMode === undefined) return { error: `不支持的 ${param}：${raw}` }
  return { target: { kind: spec.kind, sslMode, ...fields }, password }
}
