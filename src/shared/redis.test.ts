import { describe, expect, it } from 'vitest'
import {
  redisZsetRows,
  buildRedisKeyTree,
  parseClientInfoDatabase,
  parseRedisDatabaseCount,
  parseRedisKeyspace,
  recheckRedisDatabase,
  redisDatabaseAfter,
  redisDatabaseIndexes,
  flattenRedisKeyTree,
  formatRedisReply,
  formatRedisTtl,
  parseRedisCommand,
  parseRedisCommandDocs,
  parseRedisCommandTable,
  parseRedisScanReply,
  redisCommandLines,
  redisCommandWordBefore,
  redisInTransactionAfter,
  redisConsoleRefusal,
  redisKeyFolders,
  redisKeyName,
  redisRawOutput,
  redisRunSummary,
  type RedisCommandResult
} from './redis'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('redisKeyName', () => {
  it('最后一个 : 之后的部分；没有 : 时为键名本身；以 : 结尾时为空', () => {
    expect(redisKeyName('user:1:name')).toBe('name')
    expect(redisKeyName('config')).toBe('config')
    expect(redisKeyName('queue:')).toBe('')
  })

  it('与键树里键行的名字一致', () => {
    const keys = ['user:1:name', 'config', 'a:b']
    const names: string[] = []
    const walk = (nodes: ReturnType<typeof buildRedisKeyTree>): void => {
      for (const node of nodes) {
        if (node.kind === 'key') names.push(`${node.key}=${node.name}`)
        else walk(node.children)
      }
    }
    walk(buildRedisKeyTree(keys))
    expect(names.sort()).toEqual(keys.map((key) => `${key}=${redisKeyName(key)}`).sort())
  })
})

describe('buildRedisKeyTree', () => {
  it('按 : 分组；文件夹在前、键在后；数字按大小排；文件夹带键数', () => {
    const tree = buildRedisKeyTree(['user:10', 'user:2', 'user:2:name', 'config', 'session:a'])
    expect(tree.map((n) => [n.kind, n.name])).toEqual([
      ['folder', 'session'],
      ['folder', 'user'],
      ['key', 'config']
    ])
    const user = tree[1]!
    expect(user).toMatchObject({ kind: 'folder', prefix: 'user:', count: 3 })
    if (user.kind !== 'folder') throw new Error()
    expect(user.children.map((n) => [n.kind, n.name])).toEqual([
      ['folder', '2'],
      ['key', '2'],
      ['key', '10']
    ])
    expect(user.children[1]).toEqual({ kind: 'key', name: '2', key: 'user:2' })
  })

  it('空的段也算一层（如 a::b）', () => {
    expect(buildRedisKeyTree(['a::b'])[0]).toMatchObject({ kind: 'folder', name: 'a', count: 1 })
  })
})

describe('flattenRedisKeyTree', () => {
  it('只展开记着的文件夹，逐层加深', () => {
    const tree = buildRedisKeyTree(['a:b:c', 'a:d', 'e'])
    const rows = (expanded: string[]): [string, string, number][] =>
      flattenRedisKeyTree(tree, new Set(expanded)).map((r) => [r.kind, r.node.name, r.depth])
    expect(rows([])).toEqual([
      ['folder', 'a', 0],
      ['key', 'e', 0]
    ])
    expect(rows(['a:', 'a:b:'])).toEqual([
      ['folder', 'a', 0],
      ['folder', 'b', 1],
      ['key', 'c', 2],
      ['key', 'd', 1],
      ['key', 'e', 0]
    ])
  })
})

describe('redisKeyFolders', () => {
  it('各级前缀，键名本身不算', () => {
    expect(redisKeyFolders('user:1:name')).toEqual(['user:', 'user:1:'])
    expect(redisKeyFolders('plain')).toEqual([])
    expect(redisKeyFolders('a::b')).toEqual(['a:', 'a::'])
  })

  it('按它展开后键列表里出现这个键', () => {
    const tree = buildRedisKeyTree(['user:1:name', 'user:2:name', 'config'])
    const rows = flattenRedisKeyTree(tree, new Set(redisKeyFolders('user:2:name')))
    expect(rows.some((row) => row.kind === 'key' && row.node.key === 'user:2:name')).toBe(true)
  })
})

describe('parseRedisCommand', () => {
  it("空白分隔；双引号认转义与 \\xHH；单引号只认 \\'", () => {
    expect(parseRedisCommand('  SET  key "a b\\n\\x41" ')).toEqual(['SET', 'key', 'a b\nA'])
    expect(parseRedisCommand("SET k 'it\\'s \\n'")).toEqual(['SET', 'k', "it's \\n"])
    expect(parseRedisCommand('GET a"b c"d')).toEqual(['GET', 'ab cd'])
  })

  it('引号没配对报错；空行为空', () => {
    expect(parseRedisCommand('GET "a')).toEqual({ error: '引号没有配对' })
    expect(parseRedisCommand('   ')).toEqual([])
  })

  it('\\xHH 是一个字节：拼出的不是 UTF-8 时为字节，是 UTF-8 时为文字', () => {
    expect(parseRedisCommand('SET k "\\xff\\x00ab"')).toEqual([
      'SET',
      'k',
      Uint8Array.of(0xff, 0x00, 0x61, 0x62)
    ])
    expect(parseRedisCommand('SET k "\\xe4\\xb8\\xad文"')).toEqual(['SET', 'k', '中文'])
    expect(parseRedisCommand('SET k "\\x80🚀"')).toEqual([
      'SET',
      'k',
      Uint8Array.of(0x80, ...bytes('🚀'))
    ])
  })
})

describe('formatRedisReply', () => {
  it('同 redis-cli：状态回复原样、字符串（字节）加引号、整数、nil、空数组', () => {
    expect(formatRedisReply('OK')).toBe('OK')
    expect(formatRedisReply(bytes('OK'))).toBe('"OK"')
    expect(formatRedisReply(bytes('张三\n'))).toBe('"张三\\n"')
    expect(formatRedisReply(42)).toBe('(integer) 42')
    expect(formatRedisReply(null)).toBe('(nil)')
    expect(formatRedisReply([])).toBe('(empty array)')
  })

  it('数组逐项编号，嵌套缩进对齐；分数这类小数是字符串', () => {
    expect(formatRedisReply([bytes('a'), [bytes('b'), 1]])).toBe(
      '1) "a"\n2) 1) "b"\n   2) (integer) 1'
    )
    expect(formatRedisReply([bytes('bob'), bytes('250.5')])).toBe('1) "bob"\n2) "250.5"')
  })

  it('数组里的错误（如 EXEC 里执行出错的那条）带 (error)', () => {
    const error = new Error('ERR value is not an integer or out of range')
    expect(formatRedisReply([bytes('1'), error])).toBe(
      '1) "1"\n2) (error) ERR value is not an integer or out of range'
    )
  })

  it('原样输出时字符串分行显示，换行统一、去掉结尾的换行', () => {
    expect(formatRedisReply(bytes('# Keyspace\r\ndb0:keys=1\r\n'), true)).toBe(
      '# Keyspace\ndb0:keys=1'
    )
    expect(formatRedisReply('id=1 db=0\n', true)).toBe('id=1 db=0')
    expect(formatRedisReply(3, true)).toBe('(integer) 3')
  })
})

describe('redisRawOutput', () => {
  it('同 redis-cli 按原样输出的几条（不分大小写，看参数个数）', () => {
    const raw = (line: string): boolean => {
      const args = parseRedisCommand(line)
      return Array.isArray(args) && redisRawOutput(args)
    }
    expect(raw('INFO keyspace')).toBe(true)
    expect(raw('info')).toBe(true)
    expect(raw('client info')).toBe(true)
    expect(raw('CLIENT LIST TYPE normal')).toBe(true)
    expect(raw('MEMORY DOCTOR')).toBe(true)
    expect(raw('LATENCY DOCTOR')).toBe(true)
    expect(raw('LATENCY DOCTOR x')).toBe(false)
    expect(raw('LATENCY GRAPH command')).toBe(true)
    expect(raw('CLUSTER NODES')).toBe(true)
    expect(raw('CLUSTER INFO x')).toBe(false)
    expect(raw('CLIENT GETNAME')).toBe(false)
    expect(raw('GET info')).toBe(false)
  })
})

describe('redisConsoleRefusal', () => {
  const refusal = (line: string): string | null => {
    const args = parseRedisCommand(line)
    return Array.isArray(args) ? redisConsoleRefusal(args) : null
  }

  it('进入订阅、监视、复制流的命令不执行，写明原因；别的为 null', () => {
    for (const line of [
      'SUBSCRIBE ch',
      'psubscribe c*',
      'SSUBSCRIBE ch',
      'monitor',
      'SYNC',
      'PSYNC ? -1'
    ]) {
      expect(refusal(line)).toMatch(/^控制台不支持 [A-Z]+：/)
    }
    expect(refusal('UNSUBSCRIBE')).toBeNull()
    expect(refusal('PUBLISH ch x')).toBeNull()
    expect(refusal('GET monitor')).toBeNull()
  })

  it('把协议切到 RESP3 的 HELLO 不执行；不切协议的照常', () => {
    expect(refusal('HELLO 3')).toMatch(/^控制台不支持 HELLO 3：/)
    expect(refusal('hello 3 AUTH default secret')).toMatch(/^控制台不支持 HELLO 3：/)
    expect(refusal('HELLO')).toBeNull()
    expect(refusal('HELLO 2')).toBeNull()
  })
})

describe('formatRedisTtl', () => {
  it('不过期 / 已过期 / 取最大的两级', () => {
    expect(formatRedisTtl(-1)).toBe('不过期')
    expect(formatRedisTtl(-2)).toBe('已过期')
    expect(formatRedisTtl(1500)).toBe('2 秒后过期')
    expect(formatRedisTtl(3_725_000)).toBe('1 小时 2 分后过期')
    expect(formatRedisTtl(90_000_000)).toBe('1 天 1 小时后过期')
    expect(formatRedisTtl(86_400_000)).toBe('1 天后过期')
  })
})

describe('redisCommandLines', () => {
  it('一行一条；去掉首尾空白（含 CRLF 的回车）；空行不算', () => {
    expect(redisCommandLines('SET a 1\r\n\r\n  GET a  \n\t\n')).toEqual(['SET a 1', 'GET a'])
    expect(redisCommandLines('  \n')).toEqual([])
  })
})

describe('redisRunSummary', () => {
  const result = (ms: number): RedisCommandResult => ({
    command: 'PING',
    ms,
    reply: 'PONG',
    error: false
  })

  it('没有命令为 null；一条为用时；多条为条数与总用时', () => {
    expect(redisRunSummary([])).toBeNull()
    expect(redisRunSummary([result(4)])).toBe('4 毫秒')
    expect(redisRunSummary([result(4), result(6)])).toBe('2 条命令 · 10 毫秒')
  })
})

/** 执行成功的一条命令：回复按 formatRedisReply 显示好（默认 OK） */
const ran = (command: string, reply: unknown = 'OK'): RedisCommandResult => ({
  command,
  ms: 1,
  reply: formatRedisReply(reply),
  error: false
})
const failed = (command: string): RedisCommandResult => ({
  command,
  ms: 1,
  reply: '(error) ERR',
  error: true
})

describe('recheckRedisDatabase', () => {
  it('执行了 SELECT、RESET、EXEC、DISCARD 算（不分大小写），别的不算', () => {
    expect(recheckRedisDatabase([ran('SELECT 1')], false)).toBe(true)
    expect(recheckRedisDatabase([ran('GET a', 'x'), ran('select 2')], false)).toBe(true)
    expect(recheckRedisDatabase([ran('reset', 'RESET')], false)).toBe(true)
    expect(recheckRedisDatabase([ran('EXEC', [])], true)).toBe(true)
    expect(recheckRedisDatabase([ran('DISCARD')], true)).toBe(true)
    expect(recheckRedisDatabase([ran('GET select', null)], false)).toBe(false)
    expect(recheckRedisDatabase([ran('"unclosed')], false)).toBe(false)
    expect(recheckRedisDatabase([], false)).toBe(false)
  })

  it('出错的 SELECT 不算；出错的 EXEC 算（事务整个作废，同样结束了）', () => {
    expect(recheckRedisDatabase([failed('SELECT 99')], false)).toBe(false)
    expect(recheckRedisDatabase([failed('EXEC')], true)).toBe(true)
  })

  it('事务里排队的 SELECT（回复 QUEUED）不算，EXEC 执行了才算', () => {
    expect(recheckRedisDatabase([ran('MULTI'), ran('SELECT 1', 'QUEUED')], false)).toBe(false)
    // 上一次执行开的事务：这次只看得到排队的回复
    expect(recheckRedisDatabase([ran('SELECT 1', 'QUEUED')], true)).toBe(false)
    expect(
      recheckRedisDatabase([ran('MULTI'), ran('SELECT 1', 'QUEUED'), ran('EXEC', ['OK'])], false)
    ).toBe(true)
  })

  it('执行完还在事务里时不回查（回查的命令也会排进事务），结束事务的那次再回查', () => {
    expect(recheckRedisDatabase([ran('SELECT 1'), ran('MULTI')], false)).toBe(false)
    expect(recheckRedisDatabase([ran('SELECT 1'), ran('MULTI'), ran('DISCARD')], false)).toBe(true)
    expect(recheckRedisDatabase([ran('MULTI'), ran('reset', 'RESET')], false)).toBe(true)
    // 上一次执行开的事务还没结束
    expect(recheckRedisDatabase([ran('SELECT 1')], true)).toBe(false)
  })
})

describe('redisDatabaseAfter', () => {
  it('最后一条成功的 SELECT n 为 n，RESET 为 0', () => {
    expect(redisDatabaseAfter([ran('SELECT 3'), ran('GET a', 'x')], 0)).toBe(3)
    expect(redisDatabaseAfter([ran('select 3'), ran('RESET', 'RESET')], 5)).toBe(0)
    expect(redisDatabaseAfter([ran('RESET', 'RESET'), ran('SELECT 2')], 5)).toBe(2)
  })

  it('出错的与参数不是编号的不算；都没有时为原来的', () => {
    expect(redisDatabaseAfter([failed('SELECT 99')], 1)).toBe(1)
    expect(redisDatabaseAfter([ran('SELECT x')], 1)).toBe(1)
    expect(redisDatabaseAfter([ran('GET a', 'x')], 4)).toBe(4)
  })

  it('事务里排着的 SELECT 到 EXEC 执行了事务才算', () => {
    const queued = [ran('MULTI'), ran('SELECT 1', 'QUEUED')]
    expect(redisDatabaseAfter(queued, 0)).toBe(0)
    expect(redisDatabaseAfter([...queued, ran('EXEC', ['OK'])], 0)).toBe(1)
    // WATCH 的键被改过，事务没有执行
    expect(redisDatabaseAfter([...queued, ran('EXEC', null)], 0)).toBe(0)
    expect(redisDatabaseAfter([...queued, ran('DISCARD')], 0)).toBe(0)
    expect(redisDatabaseAfter([...queued, ran('RESET', 'RESET')], 3)).toBe(0)
  })
})

describe('parseClientInfoDatabase', () => {
  it('取 db=N', () => {
    expect(
      parseClientInfoDatabase(
        'id=3 addr=127.0.0.1:52555 laddr=127.0.0.1:6379 fd=8 name= db=5 sub=0\n'
      )
    ).toBe(5)
    expect(parseClientInfoDatabase('id=3 xdb=5')).toBeNull()
    expect(parseClientInfoDatabase('')).toBeNull()
  })
})

describe('parseRedisDatabaseCount', () => {
  it('[名, 值] 里的值', () => {
    expect(parseRedisDatabaseCount(['databases', '16'])).toBe(16)
  })

  it('取不到、不是正整数为 null', () => {
    expect(parseRedisDatabaseCount([])).toBeNull()
    expect(parseRedisDatabaseCount(null)).toBeNull()
    expect(parseRedisDatabaseCount(['databases', 'x'])).toBeNull()
    expect(parseRedisDatabaseCount(['databases', '0'])).toBeNull()
  })
})

describe('parseRedisKeyspace', () => {
  it('各库的键数（按 CRLF 分行）', () => {
    const info =
      '# Keyspace\r\ndb0:keys=12,expires=1,avg_ttl=0\r\ndb3:keys=4,expires=0,avg_ttl=0\r\n'
    expect(parseRedisKeyspace(info)).toEqual({ 0: 12, 3: 4 })
    expect(parseRedisKeyspace('# Keyspace\r\n')).toEqual({})
  })
})

describe('redisDatabaseIndexes', () => {
  it('0 到 count - 1', () => {
    expect(redisDatabaseIndexes({ count: 4, keys: {} }, 0)).toEqual([0, 1, 2, 3])
  })

  it('补上有键的与当前所在的', () => {
    expect(redisDatabaseIndexes({ count: 2, keys: { 4: 1 } }, 0)).toEqual([0, 1, 2, 3, 4])
    expect(redisDatabaseIndexes({ count: 2, keys: {} }, 3)).toEqual([0, 1, 2, 3])
  })
})

describe('parseRedisScanReply', () => {
  it('游标与这一批的键', () => {
    expect(parseRedisScanReply(['17', ['a', 'b']])).toEqual({ cursor: '17', keys: ['a', 'b'] })
    expect(parseRedisScanReply(['0', []])).toEqual({ cursor: '0', keys: [] })
  })

  it('格式不对为 null：事务里的 QUEUED、项数不对、键不是字符串', () => {
    expect(parseRedisScanReply('QUEUED')).toBeNull()
    expect(parseRedisScanReply(['0'])).toBeNull()
    expect(parseRedisScanReply([0, ['a']])).toBeNull()
    expect(parseRedisScanReply(['0', 'a'])).toBeNull()
    expect(parseRedisScanReply(['0', ['a', 1]])).toBeNull()
  })
})

describe('redisInTransactionAfter', () => {
  it('成功的 MULTI 开始事务，EXEC、DISCARD、RESET 结束（不分大小写）', () => {
    expect(redisInTransactionAfter([ran('MULTI')], false)).toBe(true)
    expect(redisInTransactionAfter([ran('multi'), ran('SET a 1', 'QUEUED')], false)).toBe(true)
    expect(redisInTransactionAfter([ran('MULTI'), ran('EXEC', ['OK'])], false)).toBe(false)
    expect(redisInTransactionAfter([ran('MULTI'), ran('discard')], false)).toBe(false)
    expect(redisInTransactionAfter([ran('MULTI'), ran('RESET', 'RESET')], false)).toBe(false)
  })

  it('跨几次执行：接着上一次的状态', () => {
    expect(redisInTransactionAfter([ran('GET a', 'QUEUED')], true)).toBe(true)
    expect(redisInTransactionAfter([ran('EXEC', ['x'])], true)).toBe(false)
    expect(redisInTransactionAfter([ran('GET a', 'x')], false)).toBe(false)
    expect(redisInTransactionAfter([], true)).toBe(true)
  })

  it('出错的 MULTI 不改变；出错的 EXEC、DISCARD 同样结束了事务', () => {
    expect(redisInTransactionAfter([failed('MULTI')], false)).toBe(false)
    expect(redisInTransactionAfter([failed('MULTI')], true)).toBe(true)
    expect(redisInTransactionAfter([failed('EXEC')], true)).toBe(false)
    expect(redisInTransactionAfter([failed('DISCARD')], true)).toBe(false)
  })
})

describe('parseRedisCommandDocs', () => {
  it('命令名与说明交替，取命令名，大写、去重、排序', () => {
    const reply = ['set', ['summary', 'x'], 'get', ['summary', 'y'], 'json.get', [], 'GET', []]
    expect(parseRedisCommandDocs(reply)).toEqual(['GET', 'JSON.GET', 'SET'])
  })

  it('取不到为空（如事务里只回 QUEUED）', () => {
    expect(parseRedisCommandDocs('QUEUED')).toEqual([])
    expect(parseRedisCommandDocs(null)).toEqual([])
  })
})

describe('parseRedisCommandTable', () => {
  it('每项第一格为命令名', () => {
    const reply = [
      ['get', 2, ['readonly'], 1, 1, 1],
      ['set', -3, ['write'], 1, 1, 1]
    ]
    expect(parseRedisCommandTable(reply)).toEqual(['GET', 'SET'])
  })

  it('取不到为空；格式不对的项略过', () => {
    expect(parseRedisCommandTable('QUEUED')).toEqual([])
    expect(parseRedisCommandTable([['ping'], 'bad', [3]])).toEqual(['PING'])
  })
})

describe('redisCommandWordBefore', () => {
  it('光标在行首的第一个词里：词的起点与已输入的部分', () => {
    expect(redisCommandWordBefore('')).toEqual({ from: 0, word: '' })
    expect(redisCommandWordBefore('hg')).toEqual({ from: 0, word: 'hg' })
    expect(redisCommandWordBefore('  json.g')).toEqual({ from: 2, word: 'json.g' })
    expect(redisCommandWordBefore('   ')).toEqual({ from: 3, word: '' })
  })

  it('光标在参数里为 null', () => {
    expect(redisCommandWordBefore('GET ')).toBeNull()
    expect(redisCommandWordBefore('HGET user')).toBeNull()
    expect(redisCommandWordBefore('"quoted')).toBeNull()
  })
})

describe('redisZsetRows', () => {
  it('成员与分数交替的一维数组整理成两列', () => {
    expect(redisZsetRows(['carol', '75', 'bob', '250.5', 'max', 'inf'])).toEqual([
      ['carol', '75'],
      ['bob', '250.5'],
      ['max', 'inf']
    ])
  })

  it('不是数组为空', () => {
    expect(redisZsetRows(null)).toEqual([])
  })
})
