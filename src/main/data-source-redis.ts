// Redis 的 Data Source Tab（docs/prd/database.md「Redis」）：SCAN 列键（不用会阻塞服务器的 KEYS）、按类型读一个键的值、
// 控制台执行命令与补全用的命令表，键列表顶栏的库编号下拉（各库键数、切库、回查所在的库）。都走 sendCommand（原样的
// RESP 回复），读值与列键都有上限；切库用客户端的 select（它记着所在的库）。

import { RESP_TYPES } from '@redis/client'
import type { ResultColumn, ResultSet } from '../shared/data-source-query'
import {
  DEFAULT_REDIS_DATABASES,
  formatRedisReply,
  parseClientInfoDatabase,
  parseRedisCommand,
  parseRedisCommandDocs,
  parseRedisCommandTable,
  parseRedisDatabaseCount,
  parseRedisKeyspace,
  parseRedisScanReply,
  REDIS_IN_TRANSACTION,
  REDIS_KEY_LIMIT,
  REDIS_QUEUED,
  REDIS_VALUE_LIMIT,
  redisConsoleRefusal,
  redisRawOutput,
  type RedisArg,
  type RedisCommandResult,
  type RedisDatabases,
  type RedisKeyDetail,
  redisZsetRows
} from '../shared/redis'
import type { RedisClient } from './data-source-connect'

type Reply = unknown

function send(client: RedisClient, args: string[]): Promise<Reply> {
  return client.sendCommand(args)
}

/** 键还在不在（EXISTS）。 */
export async function keyExists(client: RedisClient, key: string): Promise<boolean> {
  return (await send(client, ['EXISTS', key])) === 1
}

/**
 * SCAN 列出键（最多 REDIS_KEY_LIMIT 个）；pattern 为空即全部。回复格式不对时报错（不按它接着翻：如翻到一半控制台
 * 执行了 MULTI，SCAN 只回 QUEUED，照旧翻下去会一直排进事务；开着事务时本不发，见 withRedisClient）。
 */
export async function scanKeys(
  client: RedisClient,
  pattern: string
): Promise<{ keys: string[]; truncated: boolean }> {
  const keys: string[] = []
  let cursor = '0'
  do {
    const reply = await send(client, [
      'SCAN',
      cursor,
      'MATCH',
      pattern === '' ? '*' : pattern,
      'COUNT',
      '1000'
    ])
    const page = parseRedisScanReply(reply)
    if (page === null) {
      throw new Error(reply === REDIS_QUEUED ? REDIS_IN_TRANSACTION : 'SCAN 的回复格式不对')
    }
    cursor = page.cursor
    keys.push(...page.keys)
    if (keys.length >= REDIS_KEY_LIMIT)
      return { keys: keys.slice(0, REDIS_KEY_LIMIT), truncated: true }
  } while (cursor !== '0')
  return { keys, truncated: false }
}

/** HSCAN / SSCAN 一类的游标遍历，读够 REDIS_VALUE_LIMIT 项即停（hash 每项两格：字段与值）。 */
async function scanValues(
  client: RedisClient,
  command: 'HSCAN' | 'SSCAN',
  key: string,
  width: number
): Promise<{ items: string[]; truncated: boolean }> {
  const items: string[] = []
  let cursor = '0'
  do {
    const [next, batch] = (await send(client, [command, key, cursor, 'COUNT', '1000'])) as [
      string,
      string[]
    ]
    cursor = next
    items.push(...batch)
    if (items.length / width >= REDIS_VALUE_LIMIT) {
      return { items: items.slice(0, REDIS_VALUE_LIMIT * width), truncated: true }
    }
  } while (cursor !== '0')
  return { items, truncated: false }
}

function table(names: [string, ResultColumn['type']][], rows: string[][]): ResultSet {
  return { columns: names.map(([name, type]) => ({ name, type })), rows }
}

/** 把一维回复按 width 个一组切成行。 */
function chunks(items: string[], width: number): string[][] {
  const rows: string[][] = []
  for (let i = 0; i < items.length; i += width) rows.push(items.slice(i, i + width))
  return rows
}

/** 读一个键：类型、剩余过期时间与值（集合类最多 REDIS_VALUE_LIMIT 项）；键已不存在时为 null。 */
export async function readKey(client: RedisClient, key: string): Promise<RedisKeyDetail | null> {
  const [type, ttl] = (await Promise.all([
    send(client, ['TYPE', key]),
    send(client, ['PTTL', key])
  ])) as [string, number]
  const detail = (value: RedisKeyDetail['value']): RedisKeyDetail => ({
    type,
    ttl: Number(ttl),
    value
  })
  const limit = String(REDIS_VALUE_LIMIT - 1)
  switch (type) {
    case 'none':
      return null
    case 'string':
      return detail({ kind: 'text', text: String((await send(client, ['GET', key])) ?? '') })
    case 'hash': {
      const { items, truncated } = await scanValues(client, 'HSCAN', key, 2)
      return detail({
        kind: 'rows',
        result: table(
          [
            ['字段', 'text'],
            ['值', 'text']
          ],
          chunks(items, 2)
        ),
        truncated
      })
    }
    case 'set': {
      const { items, truncated } = await scanValues(client, 'SSCAN', key, 1)
      return detail({
        kind: 'rows',
        result: table([['成员', 'text']], chunks(items, 1)),
        truncated
      })
    }
    case 'list': {
      const [items, length] = (await Promise.all([
        send(client, ['LRANGE', key, '0', limit]),
        send(client, ['LLEN', key])
      ])) as [string[], number]
      const rows = items.map((item, i) => [String(i), item])
      return detail({
        kind: 'rows',
        result: table(
          [
            ['下标', 'number'],
            ['值', 'text']
          ],
          rows
        ),
        truncated: Number(length) > items.length
      })
    }
    case 'zset': {
      const [reply, length] = await Promise.all([
        send(client, ['ZRANGE', key, '0', limit, 'WITHSCORES']),
        send(client, ['ZCARD', key])
      ])
      const rows = redisZsetRows(reply)
      return detail({
        kind: 'rows',
        result: table(
          [
            ['成员', 'text'],
            ['分数', 'number']
          ],
          rows
        ),
        truncated: Number(length) > rows.length
      })
    }
    case 'stream': {
      const [entries, length] = (await Promise.all([
        send(client, ['XRANGE', key, '-', '+', 'COUNT', String(REDIS_VALUE_LIMIT)]),
        send(client, ['XLEN', key])
      ])) as [[string, string[]][], number]
      // 每条的字段写成一个 JSON 对象
      const rows = entries.map(([id, fields]) => [
        id,
        JSON.stringify(Object.fromEntries(chunks(fields, 2)))
      ])
      return detail({
        kind: 'rows',
        result: table(
          [
            ['ID', 'text'],
            ['内容', 'text']
          ],
          rows
        ),
        truncated: Number(length) > rows.length
      })
    }
    default:
      return detail({ kind: 'unsupported' })
  }
}

/** 控制台取回复时批量字符串取成字节：与状态回复（简单字符串，照旧是文字）分得开，显示时一个加引号、一个不加。 */
const CONSOLE_TYPE_MAPPING = { [RESP_TYPES.BLOB_STRING]: Buffer }

/** 连接时的账号（同 node-redis 连接时发的 AUTH：有用户名或密码才发）；不用认证为 null。 */
export type RedisAuth = { username?: string; password: string } | null

export interface RunCommandsOptions {
  /** 命令出错是不是因为执行被叫停（连接被断开），是则那条记为「已取消」 */
  isCanceled?: () => boolean
  /**
   * RESET 之后重新认证用：RESET 把连接退回未认证的 default 用户，而键列表、看键与控制台共用这条连接，所以照连接时的
   * 账号再认证一次（协议本就是 RESP2，RESET 不改；库回到 0 号，由调用方回查）
   */
  auth: RedisAuth
}

/**
 * 依次执行各行命令（空行跳过），遇错即停；回复照 redis-cli 显示（见 formatRedisReply）。会让连接转为推送模式的命令
 * 不执行、报出原因（见 redisConsoleRefusal）。参数里 `\xHH` 写出的字节原样发出。
 */
export async function runCommands(
  client: RedisClient,
  lines: string[],
  { isCanceled, auth }: RunCommandsOptions
): Promise<RedisCommandResult[]> {
  const results: RedisCommandResult[] = []
  for (const command of lines) {
    const args = parseRedisCommand(command)
    if (Array.isArray(args) && args.length === 0) continue
    const started = performance.now()
    let reply: string
    let error = false
    // 解析不了、不执行的命令：报出原因
    const failure = Array.isArray(args) ? redisConsoleRefusal(args) : args.error
    if (failure !== null || !Array.isArray(args)) {
      reply = `(error) ${failure}`
      error = true
    } else {
      try {
        reply = await runCommand(client, args, auth)
      } catch (e) {
        reply = isCanceled?.() ? '已取消' : `(error) ${messageOf(e)}`
        error = true
      }
    }
    results.push({ command, ms: Math.round(performance.now() - started), reply, error })
    if (error) break
  }
  return results
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 执行一条命令，交回照 redis-cli 显示好的回复；执行成功的 RESET 随即重新认证（见 RunCommandsOptions.auth）。 */
async function runCommand(client: RedisClient, args: RedisArg[], auth: RedisAuth): Promise<string> {
  const reply = await client.sendCommand(
    args.map((arg) => (typeof arg === 'string' ? arg : Buffer.from(arg))),
    { typeMapping: CONSOLE_TYPE_MAPPING }
  )
  const isReset =
    args.length === 1 && typeof args[0] === 'string' && args[0].toUpperCase() === 'RESET'
  if (isReset && auth !== null) {
    await client.auth(auth).catch((error: unknown) => {
      throw new Error(`已重置连接，但重新认证失败：${messageOf(error)}`)
    })
  }
  return formatRedisReply(reply, redisRawOutput(args))
}

/**
 * 库的个数（CONFIG GET databases）与各库的键数（INFO keyspace）。托管的 Redis 常禁用 CONFIG：个数取不到按
 * DEFAULT_REDIS_DATABASES；键数取不到就不带。
 */
export async function readDatabases(client: RedisClient): Promise<RedisDatabases> {
  const [count, keys] = await Promise.all([
    send(client, ['CONFIG', 'GET', 'databases']).then(parseRedisDatabaseCount, () => null),
    send(client, ['INFO', 'keyspace']).then(
      (info) => parseRedisKeyspace(String(info)),
      () => ({})
    )
  ])
  return { count: count ?? DEFAULT_REDIS_DATABASES, keys }
}

/** 控制台补全用的命令名（服务器的命令表）：COMMAND DOCS，Redis 7 以前没有它时用 COMMAND。 */
export async function readCommandNames(client: RedisClient): Promise<string[]> {
  try {
    return parseRedisCommandDocs(await send(client, ['COMMAND', 'DOCS']))
  } catch {
    return parseRedisCommandTable(await send(client, ['COMMAND']))
  }
}

/** 连接当前所在的库（CLIENT INFO，Redis 6.2 起有）；问不到为 null。 */
export async function readSelectedDatabase(client: RedisClient): Promise<number | null> {
  try {
    return parseClientInfoDatabase(String(await send(client, ['CLIENT', 'INFO'])))
  } catch {
    return null
  }
}

/** 切到库 database（库编号超出范围等由服务器报错，照常抛出）。 */
export function selectDatabase(client: RedisClient, database: number): Promise<void> {
  return client.select(database)
}
