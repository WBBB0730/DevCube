// SFTP v3 客户端的协议层（ADR-0040）：报文编解码与读写分块计划，纯函数、不碰 IO。
// 协议见 draft-ietf-secsh-filexfer-02；OpenSSH 只实现 v3，客户端只用基本报文，不依赖扩展。
// 报文：uint32 长度 + byte 类型 + 内容；除 INIT / VERSION 外，请求与回复都以 uint32 请求号开头。
// 这里只用 Uint8Array / DataView（shared 也被渲染端编译，不能依赖 Node 的 Buffer）。

export const SFTP_VERSION = 3

/** 报文类型 */
export const SFTP_PACKET = {
  INIT: 1,
  VERSION: 2,
  OPEN: 3,
  CLOSE: 4,
  READ: 5,
  WRITE: 6,
  LSTAT: 7,
  FSTAT: 8,
  OPENDIR: 11,
  READDIR: 12,
  REMOVE: 13,
  MKDIR: 14,
  RMDIR: 15,
  REALPATH: 16,
  STAT: 17,
  RENAME: 18,
  STATUS: 101,
  HANDLE: 102,
  DATA: 103,
  NAME: 104,
  ATTRS: 105
} as const

/** STATUS 回复的状态码 */
export const SFTP_STATUS = {
  OK: 0,
  EOF: 1,
  NO_SUCH_FILE: 2,
  PERMISSION_DENIED: 3,
  FAILURE: 4,
  BAD_MESSAGE: 5,
  NO_CONNECTION: 6,
  CONNECTION_LOST: 7,
  OP_UNSUPPORTED: 8
} as const

/** OPEN 的打开标志 */
export const SFTP_OPEN = {
  READ: 0x01,
  WRITE: 0x02,
  CREAT: 0x08,
  TRUNC: 0x10,
  EXCL: 0x20
} as const

const ATTR_SIZE = 0x1
const ATTR_UIDGID = 0x2
const ATTR_PERMISSIONS = 0x4
const ATTR_ACMODTIME = 0x8
const ATTR_EXTENDED = 0x80000000

/** 流水线参数（ADR-0040）：每块 32 KiB（同 OpenSSH `sftp`）；在途块数按时延自适应（SftpWindow），至多 64 块。 */
export const SFTP_CHUNK_BYTES = 32 * 1024
export const SFTP_MAX_INFLIGHT = 64

/**
 * 单个报文的长度上限，同 OpenSSH `sftp` 的 SFTP_MAX_MSG_LENGTH（256 KiB）。超出即说明数据流已错乱，
 * 最常见的原因是服务器的登录脚本往 SFTP 通道里打印了内容。
 */
export const SFTP_MAX_PACKET_BYTES = 256 * 1024

export interface SftpAttrs {
  size?: number
  uid?: number
  gid?: number
  permissions?: number
  atime?: number
  /** 修改时间（秒） */
  mtime?: number
}

export interface SftpName {
  filename: string
  attrs: SftpAttrs
}

/** 客户端用到的请求（文件名按 UTF-8 编码）。 */
export type SftpRequest =
  | { op: 'open'; path: string; flags: number }
  | { op: 'close'; handle: Uint8Array }
  | { op: 'read'; handle: Uint8Array; offset: number; length: number }
  | { op: 'write'; handle: Uint8Array; offset: number; data: Uint8Array }
  | { op: 'readdir'; handle: Uint8Array }
  | {
      op: 'stat' | 'lstat' | 'opendir' | 'remove' | 'mkdir' | 'rmdir' | 'realpath'
      path: string
    }
  | { op: 'rename'; from: string; to: string }

export type SftpReply =
  | { type: 'version'; version: number; extensions: Record<string, string> }
  | { type: 'status'; id: number; code: number; message: string }
  | { type: 'handle'; id: number; handle: Uint8Array }
  | { type: 'data'; id: number; data: Uint8Array }
  | { type: 'name'; id: number; names: SftpName[] }
  | { type: 'attrs'; id: number; attrs: SftpAttrs }

/** 数据流不是合法的 SFTP 报文（如登录脚本的输出混进了通道）。 */
export class SftpProtocolError extends Error {}

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

function u32(n: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, n)
  return out
}

function u64(n: number): Uint8Array {
  const out = new Uint8Array(8)
  new DataView(out.buffer).setBigUint64(0, BigInt(n))
  return out
}

function bytesField(data: Uint8Array): Uint8Array[] {
  return [u32(data.length), data]
}

function stringField(s: string): Uint8Array[] {
  return bytesField(utf8Encoder.encode(s))
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

/** 一个完整报文：长度 + 类型 + 内容。 */
function packet(type: number, body: Uint8Array[]): Uint8Array {
  const payload = concat([Uint8Array.of(type), ...body])
  return concat([u32(payload.length), payload])
}

/** 握手：INIT 带上客户端版本（v3）。 */
export function encodeSftpInit(): Uint8Array {
  return packet(SFTP_PACKET.INIT, [u32(SFTP_VERSION)])
}

/** 编码一个请求；属性一律发空（flags 为 0），由服务器按默认权限创建。 */
export function encodeSftpRequest(id: number, request: SftpRequest): Uint8Array {
  const head = u32(id)
  switch (request.op) {
    case 'open':
      return packet(SFTP_PACKET.OPEN, [
        head,
        ...stringField(request.path),
        u32(request.flags),
        u32(0)
      ])
    case 'close':
      return packet(SFTP_PACKET.CLOSE, [head, ...bytesField(request.handle)])
    case 'read':
      return packet(SFTP_PACKET.READ, [
        head,
        ...bytesField(request.handle),
        u64(request.offset),
        u32(request.length)
      ])
    case 'write':
      return packet(SFTP_PACKET.WRITE, [
        head,
        ...bytesField(request.handle),
        u64(request.offset),
        ...bytesField(request.data)
      ])
    case 'readdir':
      return packet(SFTP_PACKET.READDIR, [head, ...bytesField(request.handle)])
    case 'mkdir':
      return packet(SFTP_PACKET.MKDIR, [head, ...stringField(request.path), u32(0)])
    case 'rename':
      return packet(SFTP_PACKET.RENAME, [
        head,
        ...stringField(request.from),
        ...stringField(request.to)
      ])
    default: {
      const type = {
        stat: SFTP_PACKET.STAT,
        lstat: SFTP_PACKET.LSTAT,
        opendir: SFTP_PACKET.OPENDIR,
        remove: SFTP_PACKET.REMOVE,
        rmdir: SFTP_PACKET.RMDIR,
        realpath: SFTP_PACKET.REALPATH
      }[request.op]
      return packet(type, [head, ...stringField(request.path)])
    }
  }
}

/**
 * 把字节流切成一个个报文（不含长度头，首字节即类型）。返回的函数每喂一块数据，交出其中已完整的报文；
 * 报文长度为 0 或超过上限时抛 SftpProtocolError。
 */
export function createSftpFrameReader(
  maxPacketBytes = SFTP_MAX_PACKET_BYTES
): (chunk: Uint8Array) => Uint8Array[] {
  let pending = new Uint8Array(0)
  return (chunk) => {
    const buf = pending.length === 0 ? chunk : concat([pending, chunk])
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    const out: Uint8Array[] = []
    let offset = 0
    while (buf.length - offset >= 4) {
      const length = view.getUint32(offset)
      if (length === 0 || length > maxPacketBytes) {
        throw new SftpProtocolError(
          '服务器返回了无法识别的数据，可能是登录脚本往 SFTP 通道里输出了内容'
        )
      }
      if (buf.length - offset - 4 < length) break
      out.push(buf.subarray(offset + 4, offset + 4 + length))
      offset += 4 + length
    }
    // 留下的半个报文拷出来，不拖住整块缓冲
    pending = buf.slice(offset)
    return out
  }
}

class Reader {
  private offset = 0
  private readonly view: DataView

  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  }

  get done(): boolean {
    return this.offset >= this.buf.length
  }

  u32(): number {
    this.need(4)
    const v = this.view.getUint32(this.offset)
    this.offset += 4
    return v
  }

  u64(): number {
    this.need(8)
    const v = Number(this.view.getBigUint64(this.offset))
    this.offset += 8
    return v
  }

  bytes(): Uint8Array {
    const n = this.u32()
    this.need(n)
    const v = this.buf.subarray(this.offset, this.offset + n)
    this.offset += n
    return v
  }

  string(): string {
    return utf8Decoder.decode(this.bytes())
  }

  attrs(): SftpAttrs {
    const flags = this.u32()
    const attrs: SftpAttrs = {}
    if (flags & ATTR_SIZE) attrs.size = this.u64()
    if (flags & ATTR_UIDGID) {
      attrs.uid = this.u32()
      attrs.gid = this.u32()
    }
    if (flags & ATTR_PERMISSIONS) attrs.permissions = this.u32()
    if (flags & ATTR_ACMODTIME) {
      attrs.atime = this.u32()
      attrs.mtime = this.u32()
    }
    if (flags & ATTR_EXTENDED) {
      const count = this.u32()
      for (let i = 0; i < count; i++) {
        this.bytes()
        this.bytes()
      }
    }
    return attrs
  }

  private need(n: number): void {
    if (this.offset + n > this.buf.length) throw new SftpProtocolError('SFTP 报文不完整')
  }
}

/** 解码一个报文（createSftpFrameReader 交出的内容：首字节即类型）。 */
export function decodeSftpReply(payload: Uint8Array): SftpReply {
  const r = new Reader(payload.subarray(1))
  const type = payload[0]
  if (type === SFTP_PACKET.VERSION) {
    const version = r.u32()
    const extensions: Record<string, string> = {}
    while (!r.done) extensions[r.string()] = r.string()
    return { type: 'version', version, extensions }
  }
  const id = r.u32()
  switch (type) {
    case SFTP_PACKET.STATUS: {
      const code = r.u32()
      // v3 的状态说明与语言标签是可选的
      const message = r.done ? '' : r.string()
      return { type: 'status', id, code, message }
    }
    case SFTP_PACKET.HANDLE:
      return { type: 'handle', id, handle: r.bytes() }
    case SFTP_PACKET.DATA:
      return { type: 'data', id, data: r.bytes() }
    case SFTP_PACKET.NAME: {
      const count = r.u32()
      const names: SftpName[] = []
      for (let i = 0; i < count; i++) {
        const filename = r.string()
        r.bytes() // longname：给人看的 `ls -l` 行，不用
        names.push({ filename, attrs: r.attrs() })
      }
      return { type: 'name', id, names }
    }
    case SFTP_PACKET.ATTRS:
      return { type: 'attrs', id, attrs: r.attrs() }
    default:
      throw new SftpProtocolError(`未知的 SFTP 报文类型 ${type}`)
  }
}

const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000
const S_IFREG = 0o100000

/** 按权限位里的文件类型区分条目（服务器没给权限时按普通文件看）。 */
export function sftpEntryKind(attrs: SftpAttrs): 'directory' | 'symlink' | 'file' | 'other' {
  if (attrs.permissions === undefined) return 'file'
  const type = attrs.permissions & S_IFMT
  if (type === S_IFDIR) return 'directory'
  if (type === S_IFLNK) return 'symlink'
  if (type === S_IFREG) return 'file'
  return 'other'
}

/** 状态码 → 给用户看的原因（OpenSSH 的说明文字是笼统的英文，常见的几种改用中文）。 */
export function sftpStatusMessage(code: number, message: string): string {
  switch (code) {
    case SFTP_STATUS.NO_SUCH_FILE:
      return '文件或文件夹不存在'
    case SFTP_STATUS.PERMISSION_DENIED:
      return '没有权限'
    case SFTP_STATUS.FAILURE:
      return '操作失败'
    case SFTP_STATUS.BAD_MESSAGE:
      return '服务器无法识别这个请求'
    case SFTP_STATUS.NO_CONNECTION:
    case SFTP_STATUS.CONNECTION_LOST:
      return '连接已断开'
    case SFTP_STATUS.OP_UNSUPPORTED:
      return '服务器不支持这个操作'
    default:
      return message.trim() || `操作失败（SFTP 状态码 ${code}）`
  }
}

/**
 * 同时在途的数据块数（ADR-0040）：让服务器那边只排着一两块——快线路照样跑满带宽；慢线路上排队短，
 * 下载时别的请求、取消后的下一个请求都不用久等。思路同 TCP Vegas：以见过的最短往返为不排队的基准，
 * 估出排着的块数 = 在途块数 ×（1 − 基准 ÷ 本次往返），少于 1 块加一块，多于 2 块减一块。
 * 一条连接一个，跨传输沿用；从 1 块起步，线路空闲时每个回复加一块（每个往返约翻一倍）。
 */
export class SftpWindow {
  size = 1
  private baseRtt = Infinity

  /** 任一请求的往返时间（毫秒）：更新不排队时的基准。 */
  observe(rttMs: number): void {
    this.baseRtt = Math.min(this.baseRtt, rttMs)
  }

  /** 一个数据块（读 / 写）的往返时间（毫秒）：据此加减在途块数。 */
  adapt(rttMs: number): void {
    this.observe(rttMs)
    if (rttMs <= 0) return
    const queued = this.size * (1 - this.baseRtt / rttMs)
    if (queued < 1) this.size = Math.min(SFTP_MAX_INFLIGHT, this.size + 1)
    else if (queued > 2) this.size = Math.max(1, this.size - 1)
  }
}

/**
 * 按块切分一个文件的读写：顺序出块；短读（回来的比请求的少、又没到文件尾）时，余下部分优先补上；
 * 读到文件尾（文件比开始时变短了）后不再出更靠后的块。
 */
export class SftpTransferPlan {
  private next = 0
  private end: number
  private readonly gaps: { offset: number; length: number }[] = []

  constructor(
    size: number,
    private readonly chunk = SFTP_CHUNK_BYTES
  ) {
    this.end = size
  }

  /** 下一个要请求的区间；没有了为 null。 */
  take(): { offset: number; length: number } | null {
    const gap = this.gaps.shift()
    if (gap) return gap
    if (this.next >= this.end) return null
    const range = { offset: this.next, length: Math.min(this.chunk, this.end - this.next) }
    this.next += range.length
    return range
  }

  /** 请求了 requested 字节只回来 got 字节：余下部分排进补读。 */
  shortRead(offset: number, requested: number, got: number): void {
    if (got < requested) this.gaps.push({ offset: offset + got, length: requested - got })
  }

  /** 在 offset 处读到了文件尾：之后的块都不必再读。 */
  endAt(offset: number): void {
    this.end = Math.min(this.end, offset)
    this.next = Math.min(this.next, this.end)
    for (let i = this.gaps.length - 1; i >= 0; i--) {
      const gap = this.gaps[i]!
      if (gap.offset >= this.end) this.gaps.splice(i, 1)
      else gap.length = Math.min(gap.length, this.end - gap.offset)
    }
  }

  /** 按目前所知的文件大小（读到文件尾后会变小）。 */
  get size(): number {
    return this.end
  }
}
