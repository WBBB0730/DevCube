// Redis 的 Data Source Tab（docs/prd/database.md「Redis」）：键按 `:` 分组成树；控制台一行一条命令，
// 解析、回复的显示与命令名补全照 redis-cli；控制台的连接开着事务时不切库。

import type { ResultSet } from './data-source-query'

/** 最多列出的键（SCAN 读够即停） */
export const REDIS_KEY_LIMIT = 10_000
/** 看一个键的值时最多取的项（哈希的字段、列表与集合的元素、流的条目） */
export const REDIS_VALUE_LIMIT = 1000

export interface RedisFailure {
  error: string
}

export type RedisKeyList = { keys: string[]; truncated: boolean } | RedisFailure

/** SCAN 的一次回复：下一个游标与这一批的键；格式不对（如事务里只回 QUEUED）为 null。 */
export function parseRedisScanReply(reply: unknown): { cursor: string; keys: string[] } | null {
  if (!Array.isArray(reply) || reply.length !== 2) return null
  const [cursor, keys] = reply as [unknown, unknown]
  if (typeof cursor !== 'string' || !Array.isArray(keys)) return null
  return keys.every((key) => typeof key === 'string') ? { cursor, keys } : null
}

/** 一个键：类型、剩余过期时间（毫秒；不过期为 -1，键已不存在为 -2）与值。 */
export interface RedisKeyDetail {
  type: string
  ttl: number
  value:
    | { kind: 'text'; text: string }
    | { kind: 'rows'; result: ResultSet; truncated: boolean }
    | { kind: 'unsupported' }
}

export type RedisKeyResult = RedisKeyDetail | RedisFailure

/** 控制台一条命令的结果：按 redis-cli 显示好的回复，或报错。 */
export interface RedisCommandResult {
  command: string
  ms: number
  reply: string
  error: boolean
}

// —— 键树 ——

export type RedisKeyNode =
  | { kind: 'folder'; name: string; prefix: string; count: number; children: RedisKeyNode[] }
  | { kind: 'key'; name: string; key: string }

/** 键在键列表里显示的名字：去掉各级文件夹的前缀，即最后一个 `:` 之后的部分（同 buildRedisKeyTree）。 */
export function redisKeyName(key: string): string {
  return key.slice(key.lastIndexOf(':') + 1)
}

const byName = (a: RedisKeyNode, b: RedisKeyNode): number =>
  a.name.localeCompare(b.name, undefined, { numeric: true })

/**
 * 键按 `:` 分组成树：`user:1:name` 放在 user → 1 下面。同一层文件夹在前、键在后，按名称自然排序（数字按大小）；
 * 文件夹的 count 为它下面键的个数。
 */
export function buildRedisKeyTree(keys: readonly string[]): RedisKeyNode[] {
  interface Folder {
    folders: Map<string, Folder>
    keys: string[]
  }
  const root: Folder = { folders: new Map(), keys: [] }
  for (const key of keys) {
    const parts = key.split(':')
    let folder = root
    for (const part of parts.slice(0, -1)) {
      let next = folder.folders.get(part)
      if (next === undefined) {
        next = { folders: new Map(), keys: [] }
        folder.folders.set(part, next)
      }
      folder = next
    }
    folder.keys.push(key)
  }
  const build = (folder: Folder, prefix: string): { nodes: RedisKeyNode[]; count: number } => {
    let count = folder.keys.length
    const folders: RedisKeyNode[] = []
    for (const [name, child] of folder.folders) {
      const childPrefix = `${prefix}${name}:`
      const built = build(child, childPrefix)
      count += built.count
      folders.push({
        kind: 'folder',
        name,
        prefix: childPrefix,
        count: built.count,
        children: built.nodes
      })
    }
    const keyNodes: RedisKeyNode[] = folder.keys.map((key) => ({
      kind: 'key',
      name: key.slice(prefix.length),
      key
    }))
    return { nodes: [...folders.sort(byName), ...keyNodes.sort(byName)], count }
  }
  return build(root, '').nodes
}

/** 键列表里要展开的各级文件夹（以前缀记，同 buildRedisKeyTree）：`user:1:name` 为 `user:`、`user:1:`。 */
export function redisKeyFolders(key: string): string[] {
  const parts = key.split(':')
  return parts.slice(0, -1).map((_, i) => `${parts.slice(0, i + 1).join(':')}:`)
}

export type RedisKeyRow =
  | { kind: 'folder'; depth: number; node: Extract<RedisKeyNode, { kind: 'folder' }> }
  | { kind: 'key'; depth: number; node: Extract<RedisKeyNode, { kind: 'key' }> }

/** 按展开着的文件夹（以前缀记）把键树拍平成行。 */
export function flattenRedisKeyTree(
  nodes: readonly RedisKeyNode[],
  expanded: { has: (prefix: string) => boolean },
  depth = 0
): RedisKeyRow[] {
  return nodes.flatMap((node): RedisKeyRow[] =>
    node.kind === 'key'
      ? [{ kind: 'key', depth, node }]
      : [
          { kind: 'folder', depth, node },
          ...(expanded.has(node.prefix)
            ? flattenRedisKeyTree(node.children, expanded, depth + 1)
            : [])
        ]
  )
}

// —— 命令行 ——

const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', a: '\x07' }

/**
 * 一个参数：文字；用 `\xHH` 写出的字节拼起来不是合法的 UTF-8 时为这些字节（原样发给服务器，同 redis-cli 的
 * `"\xff"` 是一个字节 0xFF，而不是字符 ÿ 的 UTF-8 编码）。
 */
export type RedisArg = string | Uint8Array

const utf8Encoder = new TextEncoder()
const strictUtf8 = new TextDecoder('utf-8', { fatal: true })

/** 一个参数的各段字节拼起来：是合法的 UTF-8 时交回文字（发出去字节相同），否则交回字节。 */
function argOf(chunks: readonly Uint8Array[]): RedisArg {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  try {
    return strictUtf8.decode(bytes)
  } catch {
    return bytes
  }
}

/**
 * 把一行命令拆成参数（同 redis-cli）：空白分隔；双引号里认 `\"`、`\\`、`\n` 这类转义与 `\xHH`（一个字节）；单引号里
 * 只认 `\'`。引号没配对时报错。
 */
export function parseRedisCommand(line: string): RedisArg[] | { error: string } {
  const args: RedisArg[] = []
  let i = 0
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i]!)) i++
    if (i >= line.length) break
    // 普通文字攒成一段；遇到 `\xHH` 时把攒下的按 UTF-8 编码成字节（不拆开代理对），`\xHH` 本身是一个字节
    const chunks: Uint8Array[] = []
    let text = ''
    const flush = (): void => {
      chunks.push(utf8Encoder.encode(text))
      text = ''
    }
    while (i < line.length && !/\s/.test(line[i]!)) {
      const quote = line[i]
      if (quote !== '"' && quote !== "'") {
        text += line[i++]
        continue
      }
      i++
      let closed = false
      while (i < line.length) {
        const ch = line[i]!
        if (ch === quote) {
          closed = true
          i++
          break
        }
        if (ch === '\\' && i + 1 < line.length) {
          const next = line[i + 1]!
          if (quote === "'") {
            text += next === "'" ? "'" : `\\${next}`
            i += 2
          } else if (next === 'x' && /^[0-9a-fA-F]{2}$/.test(line.slice(i + 2, i + 4))) {
            flush()
            chunks.push(Uint8Array.of(parseInt(line.slice(i + 2, i + 4), 16)))
            i += 4
          } else {
            text += ESCAPES[next] ?? next
            i += 2
          }
          continue
        }
        text += ch
        i++
      }
      if (!closed) return { error: '引号没有配对' }
    }
    // 没有 `\xHH` 的就是这段文字
    if (chunks.length === 0) {
      args.push(text)
    } else {
      flush()
      args.push(argOf(chunks))
    }
  }
  return args
}

/** 参数的大写文字（比较命令名、子命令用）；是字节的不算，为空串。 */
function upperArg(arg: RedisArg | undefined): string {
  return typeof arg === 'string' ? arg.toUpperCase() : ''
}

/**
 * 控制台不执行的命令与原因：进入订阅、监视或复制流的命令让连接只收服务器推送的内容，不再一问一答（同 RedisInsight 的
 * 控制台不支持的这几条）；HELLO 3 把连接的协议切到 RESP3，回复换了格式（连接固定用 RESP2，见 connectRedis）。键列表、
 * 看键与控制台共用这条连接，之后的回复就对不上了。其余为 null。
 */
export function redisConsoleRefusal(args: readonly RedisArg[]): string | null {
  const name = upperArg(args[0])
  if (['SUBSCRIBE', 'PSUBSCRIBE', 'SSUBSCRIBE', 'MONITOR', 'SYNC', 'PSYNC'].includes(name)) {
    return `控制台不支持 ${name}：执行后连接只收服务器推送的内容，不再按命令回复`
  }
  if (name === 'HELLO' && args[1] === '3') {
    return '控制台不支持 HELLO 3：连接固定使用 RESP2 协议，不能切换'
  }
  return null
}

/**
 * redis-cli 按原样输出（不加引号、不转义，分行显示）的命令：INFO、CLIENT LIST 这类回复是给人看的多行文字。清单与
 * 参数个数的条件同 redis-cli（cliSendCommand 里设 output_raw 的那几条）。
 */
export function redisRawOutput(args: readonly RedisArg[]): boolean {
  const name = upperArg(args[0])
  const sub = upperArg(args[1])
  const count = args.length
  switch (name) {
    case 'INFO':
    case 'LOLWUT':
      return true
    case 'DEBUG':
      return count >= 2 && ['HTSTATS', 'HTSTATS-KEY', 'CLIENT-EVICTION'].includes(sub)
    case 'MEMORY':
      return count >= 2 && ['MALLOC-STATS', 'DOCTOR'].includes(sub)
    case 'CLUSTER':
      return count === 2 && ['NODES', 'INFO'].includes(sub)
    case 'CLIENT':
      return count >= 2 && ['LIST', 'INFO'].includes(sub)
    case 'LATENCY':
      return (count === 3 && sub === 'GRAPH') || (count === 2 && sub === 'DOCTOR')
    case 'PROXY':
      return count >= 2 && sub === 'INFO'
    default:
      return false
  }
}

/** 一段文字里要执行的命令：一行一条，去掉首尾空白（含 CRLF 的 \r），空行不算。 */
export function redisCommandLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/** 一次执行的摘要：一条为用时，多条为「N 条命令 · 总用时」；没有命令为 null。 */
export function redisRunSummary(results: readonly RedisCommandResult[]): string | null {
  if (results.length === 0) return null
  if (results.length === 1) return `${results[0]!.ms} 毫秒`
  return `${results.length} 条命令 · ${results.reduce((sum, r) => sum + r.ms, 0)} 毫秒`
}

// —— 命令名补全（服务器的命令表）——

/** 命令名：大写（同 redis-cli 的补全）、去重、按字母排序。 */
function commandNames(names: readonly unknown[]): string[] {
  const upper = names.flatMap((name) =>
    typeof name === 'string' && name !== '' ? [name.toUpperCase()] : []
  )
  return [...new Set(upper)].sort()
}

/**
 * COMMAND DOCS（Redis 7 起）回复里的命令名：「命令名, 说明」交替的数组。子命令（如 CONFIG GET）在说明里，不算。取不到
 * 为空。
 */
export function parseRedisCommandDocs(reply: unknown): string[] {
  if (!Array.isArray(reply)) return []
  return commandNames(reply.filter((_, i) => i % 2 === 0))
}

/** COMMAND（Redis 7 以前取命令表用）回复里的命令名：每项是一个数组，第一格为命令名。取不到为空。 */
export function parseRedisCommandTable(reply: unknown): string[] {
  if (!Array.isArray(reply)) return []
  return commandNames(reply.map((item: unknown) => (Array.isArray(item) ? item[0] : null)))
}

/**
 * 控制台里补命令名的位置：光标在一行的第一个词里（前面只有空白）时，为这个词的起点（在 before 里的下标）与已输入的
 * 部分；否则（光标在参数里）为 null。before 为这一行在光标之前的文字。命令名由字母、数字与 `_ . -` 组成（模块的命令
 * 如 JSON.GET）。
 */
export function redisCommandWordBefore(before: string): { from: number; word: string } | null {
  const match = /^\s*([\w.-]*)$/.exec(before)
  if (match === null) return null
  const word = match[1]!
  return { from: before.length - word.length, word }
}

// —— 回复 ——

const utf8Decoder = new TextDecoder()

function formatLines(reply: unknown): string[] {
  if (reply === null || reply === undefined) return ['(nil)']
  if (typeof reply === 'number' || typeof reply === 'bigint') return [`(integer) ${reply}`]
  // 状态回复（简单字符串）原样；批量字符串取成字节（见 formatRedisReply），加引号
  if (typeof reply === 'string') return [reply]
  if (reply instanceof Uint8Array) return [JSON.stringify(utf8Decoder.decode(reply))]
  // 数组里的错误回复（如 EXEC 里执行出错的那条）：驱动交回错误对象，不抛出
  if (reply instanceof Error) return [`(error) ${reply.message}`]
  if (Array.isArray(reply)) {
    if (reply.length === 0) return ['(empty array)']
    const width = String(reply.length).length
    return reply.flatMap((item, i) => {
      const label = `${String(i + 1).padStart(width)}) `
      const [first, ...rest] = formatLines(item)
      return [`${label}${first}`, ...rest.map((line) => `${' '.repeat(label.length)}${line}`)]
    })
  }
  return [String(reply)]
}

/**
 * 按 redis-cli 的样子显示回复（RESP2，redis-cli 默认的协议）：状态回复（OK、PONG、类型名这类简单字符串，为 string）
 * 原样，批量字符串（为字节：控制台取回复时把它映射成 Buffer，才与状态回复分得开）加引号，整数带 (integer)、空为 (nil)、
 * 错误带 (error)，数组逐项编号并缩进；有序集合的分数这类小数是批量字符串，同样加引号。raw（见 redisRawOutput）时字符串
 * 原样分行显示。
 */
export function formatRedisReply(reply: unknown, raw = false): string {
  if (raw && (typeof reply === 'string' || reply instanceof Uint8Array)) {
    const text = typeof reply === 'string' ? reply : utf8Decoder.decode(reply)
    return text.replace(/\r\n/g, '\n').replace(/\n$/, '')
  }
  return formatLines(reply).join('\n')
}

const TTL_UNITS: [number, string][] = [
  [86_400, '天'],
  [3600, '小时'],
  [60, '分'],
  [1, '秒']
]

/** 剩余过期时间的说明：不过期；或从最大的单位起，最多写两级（如「1 小时 2 分后过期」）。 */
export function formatRedisTtl(ms: number): string {
  if (ms === -1) return '不过期'
  if (ms < 0) return '已过期'
  let rest = Math.ceil(ms / 1000)
  const first = TTL_UNITS.findIndex(([size]) => rest >= size)
  if (first < 0) return '0 秒后过期'
  const parts: string[] = []
  for (const [size, label] of TTL_UNITS.slice(first, first + 2)) {
    const n = Math.floor(rest / size)
    rest -= n * size
    if (n > 0) parts.push(`${n} ${label}`)
  }
  return `${parts.join(' ')}后过期`
}

// —— 库编号（键列表顶栏的下拉与控制台上下文，见 data-source-context）——

/** 取不到库的个数（无权执行 CONFIG，如云上的 Redis）时按这么多（Redis 的默认配置） */
export const DEFAULT_REDIS_DATABASES = 16

/** 库的个数与各库的键数（只有有键的库；按库编号）。 */
export interface RedisDatabases {
  count: number
  keys: Record<number, number>
}

export type RedisDatabasesResult = RedisDatabases | RedisFailure

/** 命令名（大写）；解析不了、空行为 null。 */
function commandName(command: string): string | null {
  const args = parseRedisCommand(command)
  return Array.isArray(args) && args.length > 0 ? upperArg(args[0]) : null
}

/** 事务（MULTI 之后）里的命令只是排进队列、EXEC 时才执行：这时的回复（原样的与照 formatRedisReply 显示好的） */
export const REDIS_QUEUED = 'QUEUED'
const QUEUED_REPLY = formatRedisReply(REDIS_QUEUED)
/** EXEC 没有执行事务（WATCH 的键被改过）时的回复 */
const NIL_REPLY = formatRedisReply(null)

/**
 * 一次执行完要不要回查库编号：执行成功的 SELECT，或 RESET（回到 0 号库）、结束事务的 EXEC（事务里排着的 SELECT 这时才
 * 生效）与 DISCARD（事务开着时没回查，结束后补上）——后三者出错的也算（事务因排队时的错误整个作废，同样结束了）。事务里
 * 排队的 SELECT 回复 QUEUED、并未执行，不算。执行完连接还在事务里（见 redisInTransactionAfter，before 为执行前的）时
 * 不回查：回查的命令也会排进事务，等结束事务的那次。
 */
export function recheckRedisDatabase(
  results: readonly RedisCommandResult[],
  before: boolean
): boolean {
  const changed = results.some((r) => {
    const name = commandName(r.command)
    if (name === 'SELECT') return !r.error && r.reply !== QUEUED_REPLY
    return name === 'EXEC' || name === 'DISCARD' || name === 'RESET'
  })
  return changed && !redisInTransactionAfter(results, before)
}

/** 控制台的连接还在事务里时，切库、读键列表不做（命令会排进用户的事务）的原因。 */
export const REDIS_IN_TRANSACTION = '事务还没结束（先 EXEC 或 DISCARD）'

/**
 * 执行完这些命令后连接是否还在事务里（MULTI 之后还没 EXEC / DISCARD）；before 为执行前的（事务可以跨几次执行）。执行
 * 成功的 MULTI 开始事务（已在事务里时 MULTI 报错，不变）；EXEC、DISCARD 结束事务，出错的也算（事务因排队时的错误整个
 * 作废，同样结束了；不在事务里时报错，本就不在）；RESET 也结束事务。
 */
export function redisInTransactionAfter(
  results: readonly RedisCommandResult[],
  before: boolean
): boolean {
  let inTransaction = before
  for (const r of results) {
    const name = commandName(r.command)
    if (name === 'MULTI' && !r.error) inTransaction = true
    else if (name === 'EXEC' || name === 'DISCARD' || name === 'RESET') inTransaction = false
  }
  return inTransaction
}

/**
 * 回查不到库编号时（Redis 6.2 以前没有 CLIENT INFO），按执行成功的命令推算：SELECT n 为 n、RESET 为 0；事务里排着的
 * SELECT n（回复 QUEUED）到 EXEC 执行了事务才算，DISCARD、RESET 即作废。都没有为 before。
 */
export function redisDatabaseAfter(results: readonly RedisCommandResult[], before: number): number {
  let database = before
  /** 事务里排着的最后一条 SELECT 的库编号 */
  let queued: number | null = null
  for (const r of results) {
    if (r.error) continue
    const args = parseRedisCommand(r.command)
    if (!Array.isArray(args) || args.length === 0) continue
    const name = upperArg(args[0])
    const index = args[1]
    if (name === 'SELECT' && typeof index === 'string' && /^\d+$/.test(index)) {
      if (r.reply === QUEUED_REPLY) queued = Number(index)
      else database = Number(index)
    } else if (name === 'RESET') {
      database = 0
      queued = null
    } else if (name === 'EXEC' || name === 'DISCARD') {
      if (name === 'EXEC' && r.reply !== NIL_REPLY && queued !== null) database = queued
      queued = null
    }
  }
  return database
}

/** CLIENT INFO 回复里的库编号（`db=N`）；没有为 null。 */
export function parseClientInfoDatabase(info: string): number | null {
  const match = /(?:^|\s)db=(\d+)(?:\s|$)/.exec(info)
  return match === null ? null : Number(match[1])
}

/** CONFIG GET databases 的回复（[名, 值]）里库的个数；取不到为 null。 */
export function parseRedisDatabaseCount(reply: unknown): number | null {
  const count = Number(Array.isArray(reply) ? reply[1] : undefined)
  return Number.isInteger(count) && count > 0 ? count : null
}

/** INFO keyspace 回复里各库的键数（`db0:keys=12,expires=0,avg_ttl=0` 一行一个库）。 */
export function parseRedisKeyspace(info: string): Record<number, number> {
  const keys: Record<number, number> = {}
  for (const match of info.matchAll(/^db(\d+):keys=(\d+)/gm))
    keys[Number(match[1])] = Number(match[2])
  return keys
}

/** 下拉里列出的库编号：0 到 count - 1，另补上有键的与当前所在的（配置改小过、或取不到个数时按默认值猜少了）。 */
export function redisDatabaseIndexes(databases: RedisDatabases, current: number): number[] {
  const last = Math.max(databases.count - 1, current, ...Object.keys(databases.keys).map(Number))
  return Array.from({ length: last + 1 }, (_, i) => i)
}

/** ZRANGE … WITHSCORES 的回复（成员与分数交替的一维数组，分数为文字）整理成「成员、分数」两列。 */
export function redisZsetRows(reply: unknown): string[][] {
  if (!Array.isArray(reply)) return []
  const rows: string[][] = []
  for (let i = 0; i + 1 < reply.length; i += 2) {
    rows.push([String(reply[i]), String(reply[i + 1])])
  }
  return rows
}
