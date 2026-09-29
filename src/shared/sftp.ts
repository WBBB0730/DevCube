// SFTP 的共用部分（ADR-0041）：协议由 ssh2 来说，这里只有状态码（SFTP v3 的取值，ssh2 同）、
// 条目属性、给用户看的错误说明，以及读写的分块计划与在途窗口。纯函数、不碰 IO。

/** SFTP 的状态码（ssh2 的错误里 code 即此值） */
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

/** 读写参数：每块 32 KiB（同 OpenSSH `sftp`）；在途块数按时延自适应（SftpWindow），至多 64 块。 */
export const SFTP_CHUNK_BYTES = 32 * 1024
export const SFTP_MAX_INFLIGHT = 64

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
 * 同时在途的数据块数：让服务器那边只排着一两块——快线路照样跑满带宽；慢线路上排队短，
 * 下载时别的请求、取消后的下一个请求都不用久等。思路同 TCP Vegas：以见过的最短往返为不排队的基准，
 * 估出排着的块数 = 在途块数 ×（1 − 基准 ÷ 本次往返），少于 1 块加一块，多于 2 块减一块。
 * 一个通道一个，跨传输沿用；从 1 块起步，线路空闲时每个回复加一块（每个往返约翻一倍）。
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
