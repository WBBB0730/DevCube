import { describe, expect, it } from 'vitest'
import {
  SFTP_MAX_INFLIGHT,
  SFTP_OPEN,
  SFTP_PACKET,
  SFTP_STATUS,
  SftpProtocolError,
  SftpTransferPlan,
  SftpWindow,
  createSftpFrameReader,
  decodeSftpReply,
  encodeSftpInit,
  encodeSftpRequest,
  sftpEntryKind,
  sftpStatusMessage
} from './sftp'

/** 按字段拼报文内容（不含长度头）：数字按 uint32，bigint 按 uint64，字符串 / 字节按 SSH string。 */
function body(...fields: (number | bigint | string | Uint8Array)[]): number[] {
  const out: number[] = []
  const pushU32 = (n: number): void => {
    out.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff)
  }
  for (const f of fields) {
    if (typeof f === 'number') pushU32(f)
    else if (typeof f === 'bigint') {
      pushU32(Number(f >> 32n))
      pushU32(Number(f & 0xffffffffn))
    } else {
      const bytes = typeof f === 'string' ? new TextEncoder().encode(f) : f
      pushU32(bytes.length)
      out.push(...bytes)
    }
  }
  return out
}

/** 完整报文：长度头 + 类型 + 内容。 */
function framed(type: number, ...fields: (number | bigint | string | Uint8Array)[]): Uint8Array {
  const payload = [type, ...body(...fields)]
  return Uint8Array.from([...body(payload.length), ...payload])
}

/** 报文内容（createSftpFrameReader 交出的形状：首字节即类型）。 */
function payload(type: number, ...fields: (number | bigint | string | Uint8Array)[]): Uint8Array {
  return framed(type, ...fields).subarray(4)
}

describe('encodeSftpInit / encodeSftpRequest', () => {
  it('握手声明 v3', () => {
    expect(encodeSftpInit()).toEqual(framed(SFTP_PACKET.INIT, 3))
  })

  it('路径类请求：请求号 + UTF-8 路径', () => {
    expect(encodeSftpRequest(7, { op: 'stat', path: '/home/用户' })).toEqual(
      framed(SFTP_PACKET.STAT, 7, '/home/用户')
    )
    expect(encodeSftpRequest(8, { op: 'realpath', path: '.' })).toEqual(
      framed(SFTP_PACKET.REALPATH, 8, '.')
    )
  })

  it('打开：标志位 + 空属性', () => {
    const flags = SFTP_OPEN.WRITE | SFTP_OPEN.CREAT | SFTP_OPEN.TRUNC
    expect(encodeSftpRequest(1, { op: 'open', path: '/tmp/a', flags })).toEqual(
      framed(SFTP_PACKET.OPEN, 1, '/tmp/a', flags, 0)
    )
  })

  it('读写：句柄 + 64 位偏移', () => {
    const handle = Uint8Array.of(1, 2, 3)
    const offset = 2 ** 32 + 5
    expect(encodeSftpRequest(2, { op: 'read', handle, offset, length: 32768 })).toEqual(
      framed(SFTP_PACKET.READ, 2, handle, BigInt(offset), 32768)
    )
    const data = Uint8Array.of(9, 9)
    expect(encodeSftpRequest(3, { op: 'write', handle, offset: 0, data })).toEqual(
      framed(SFTP_PACKET.WRITE, 3, handle, 0n, data)
    )
  })

  it('新建目录带空属性，改名带两条路径', () => {
    expect(encodeSftpRequest(4, { op: 'mkdir', path: '/a' })).toEqual(
      framed(SFTP_PACKET.MKDIR, 4, '/a', 0)
    )
    expect(encodeSftpRequest(5, { op: 'rename', from: '/a', to: '/b' })).toEqual(
      framed(SFTP_PACKET.RENAME, 5, '/a', '/b')
    )
  })
})

describe('createSftpFrameReader', () => {
  it('跨块拼出完整报文、一块里的多个报文依次交出', () => {
    const a = framed(SFTP_PACKET.STATUS, 1, 0, 'ok', '')
    const b = framed(SFTP_PACKET.STATUS, 2, 0, 'ok', '')
    const all = Uint8Array.from([...a, ...b])
    const read = createSftpFrameReader()
    expect(read(all.subarray(0, 3))).toEqual([])
    expect(read(all.subarray(3, a.length + 2))).toEqual([a.subarray(4)])
    expect(read(all.subarray(a.length + 2))).toEqual([b.subarray(4)])
  })

  it('长度超限或为 0：视为数据流错乱', () => {
    const read = createSftpFrameReader(1024)
    // 登录脚本打印的 "Welcome" 被当成长度：0x57656c63
    expect(() => read(new TextEncoder().encode('Welcome\n'))).toThrow(SftpProtocolError)
    expect(() => createSftpFrameReader()(Uint8Array.of(0, 0, 0, 0))).toThrow(SftpProtocolError)
  })
})

describe('decodeSftpReply', () => {
  it('VERSION：版本号与扩展', () => {
    expect(
      decodeSftpReply(
        payload(SFTP_PACKET.VERSION, 3, 'posix-rename@openssh.com', '1', 'limits@openssh.com', '1')
      )
    ).toEqual({
      type: 'version',
      version: 3,
      extensions: { 'posix-rename@openssh.com': '1', 'limits@openssh.com': '1' }
    })
  })

  it('STATUS：说明文字可缺省', () => {
    expect(decodeSftpReply(payload(SFTP_PACKET.STATUS, 9, 2, 'No such file', ''))).toEqual({
      type: 'status',
      id: 9,
      code: 2,
      message: 'No such file'
    })
    expect(decodeSftpReply(payload(SFTP_PACKET.STATUS, 9, 1))).toEqual({
      type: 'status',
      id: 9,
      code: 1,
      message: ''
    })
  })

  it('HANDLE / DATA', () => {
    expect(decodeSftpReply(payload(SFTP_PACKET.HANDLE, 1, Uint8Array.of(0, 1)))).toEqual({
      type: 'handle',
      id: 1,
      handle: Uint8Array.of(0, 1)
    })
    expect(decodeSftpReply(payload(SFTP_PACKET.DATA, 2, Uint8Array.of(5, 6, 7)))).toEqual({
      type: 'data',
      id: 2,
      data: Uint8Array.of(5, 6, 7)
    })
  })

  it('NAME：逐项解出文件名与属性，跳过 longname 与扩展属性', () => {
    const allFlags = 0x1 | 0x2 | 0x4 | 0x8 | 0x80000000
    const reply = decodeSftpReply(
      payload(
        SFTP_PACKET.NAME,
        3,
        2,
        // 条目一：全部属性，外加一条扩展属性
        'etc',
        'drwxr-xr-x 1 root root 4096 Jan 1 etc',
        allFlags,
        4096n,
        0,
        0,
        0o40755,
        1700000000,
        1700000001,
        1,
        'ext@x',
        'data',
        // 条目二：只有大小
        '笔记.md',
        '-rw-r--r-- …',
        0x1,
        12n
      )
    )
    expect(reply).toEqual({
      type: 'name',
      id: 3,
      names: [
        {
          filename: 'etc',
          attrs: {
            size: 4096,
            uid: 0,
            gid: 0,
            permissions: 0o40755,
            atime: 1700000000,
            mtime: 1700000001
          }
        },
        { filename: '笔记.md', attrs: { size: 12 } }
      ]
    })
  })

  it('ATTRS；截断的报文与未知类型报错', () => {
    expect(decodeSftpReply(payload(SFTP_PACKET.ATTRS, 4, 0x4, 0o100644))).toEqual({
      type: 'attrs',
      id: 4,
      attrs: { permissions: 0o100644 }
    })
    expect(() => decodeSftpReply(payload(SFTP_PACKET.HANDLE, 1).subarray(0, 3))).toThrow(
      SftpProtocolError
    )
    expect(() => decodeSftpReply(payload(99, 1))).toThrow(SftpProtocolError)
  })
})

describe('sftpEntryKind', () => {
  it('按权限位的文件类型', () => {
    expect(sftpEntryKind({ permissions: 0o40755 })).toBe('directory')
    expect(sftpEntryKind({ permissions: 0o120777 })).toBe('symlink')
    expect(sftpEntryKind({ permissions: 0o100644 })).toBe('file')
    expect(sftpEntryKind({ permissions: 0o20620 })).toBe('other')
    expect(sftpEntryKind({})).toBe('file')
  })
})

describe('sftpStatusMessage', () => {
  it('常见状态码给中文原因，其余用服务器的说明', () => {
    expect(sftpStatusMessage(SFTP_STATUS.NO_SUCH_FILE, 'No such file')).toBe('文件或文件夹不存在')
    expect(sftpStatusMessage(SFTP_STATUS.PERMISSION_DENIED, 'Permission denied')).toBe('没有权限')
    expect(sftpStatusMessage(SFTP_STATUS.FAILURE, 'Failure')).toBe('操作失败')
    expect(sftpStatusMessage(42, 'Quota exceeded')).toBe('Quota exceeded')
    expect(sftpStatusMessage(42, '')).toBe('操作失败（SFTP 状态码 42）')
  })
})

describe('SftpTransferPlan', () => {
  const drain = (plan: SftpTransferPlan): { offset: number; length: number }[] => {
    const out: { offset: number; length: number }[] = []
    for (let r = plan.take(); r !== null; r = plan.take()) out.push(r)
    return out
  }

  it('按块顺序切分，末块取余下的', () => {
    expect(drain(new SftpTransferPlan(10, 4))).toEqual([
      { offset: 0, length: 4 },
      { offset: 4, length: 4 },
      { offset: 8, length: 2 }
    ])
    expect(drain(new SftpTransferPlan(0, 4))).toEqual([])
  })

  it('短读的余下部分优先补读', () => {
    const plan = new SftpTransferPlan(12, 4)
    const first = plan.take()!
    plan.shortRead(first.offset, first.length, 1)
    expect(plan.take()).toEqual({ offset: 1, length: 3 })
    expect(plan.take()).toEqual({ offset: 4, length: 4 })
    plan.shortRead(4, 4, 4)
    expect(plan.take()).toEqual({ offset: 8, length: 4 })
    expect(plan.take()).toBeNull()
  })

  it('读到文件尾：不再出更靠后的块，补读裁到文件尾', () => {
    const plan = new SftpTransferPlan(16, 4)
    plan.take()
    const second = plan.take()!
    plan.shortRead(second.offset, second.length, 1)
    plan.endAt(6)
    expect(plan.size).toBe(6)
    expect(plan.take()).toEqual({ offset: 5, length: 1 })
    expect(plan.take()).toBeNull()
  })
})

describe('SftpWindow', () => {
  it('从 1 块起步；不排队时每个回复加一块，至多 SFTP_MAX_INFLIGHT', () => {
    const w = new SftpWindow()
    expect(w.size).toBe(1)
    w.observe(40)
    for (let i = 0; i < 100; i++) w.adapt(40)
    expect(w.size).toBe(SFTP_MAX_INFLIGHT)
  })

  it('排着的块数在 1 与 2 之间时不动', () => {
    const w = new SftpWindow()
    w.observe(40)
    for (let i = 0; i < 7; i++) w.adapt(40)
    expect(w.size).toBe(8)
    // 8 × (1 − 40 / 50) = 1.6 块
    w.adapt(50)
    expect(w.size).toBe(8)
  })

  it('排队多了就减，最少 1 块', () => {
    const w = new SftpWindow()
    w.observe(40)
    for (let i = 0; i < 7; i++) w.adapt(40)
    // 8 × (1 − 40 / 400) = 7.2 块
    for (let i = 0; i < 20; i++) w.adapt(400)
    expect(w.size).toBe(2)
    // 慢线路：一块本身就要传很久，窗口停在一两块
    const slow = new SftpWindow()
    slow.observe(40)
    for (let i = 0; i < 20; i++) slow.adapt(1100)
    expect(slow.size).toBeLessThanOrEqual(2)
    expect(slow.size).toBeGreaterThanOrEqual(1)
  })

  it('基准取见过的最短往返（小请求也算）', () => {
    const w = new SftpWindow()
    w.adapt(100)
    w.adapt(100)
    expect(w.size).toBe(3)
    // 小请求见到更短的往返：原来的 100 其实排着队
    w.observe(10)
    // 3 × (1 − 10 / 100) = 2.7 块
    w.adapt(100)
    expect(w.size).toBe(2)
  })
})
