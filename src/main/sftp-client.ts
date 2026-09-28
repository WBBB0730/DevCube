// SFTP v3 客户端（ADR-0040）：跑在系统 ssh 的 sftp 子系统的标准输入输出上，协议编解码在 shared/sftp。
// 读写分块流水线化（每块 32 KiB）；同时在途的块数按往返时延自适应（SftpWindow）：快线路跑满带宽，
// 慢线路上服务器那边只排着一两块，下载时别的请求、取消后的下一个请求都不用久等。
// 连接断开或数据流错乱时，所有未完成的请求一起失败；之后的请求立即失败。

import type { Readable, Writable } from 'node:stream'
import {
  SFTP_OPEN,
  SFTP_STATUS,
  SftpProtocolError,
  SftpTransferPlan,
  SftpWindow,
  createSftpFrameReader,
  decodeSftpReply,
  encodeSftpInit,
  encodeSftpRequest,
  sftpStatusMessage,
  type SftpAttrs,
  type SftpName,
  type SftpReply,
  type SftpRequest
} from '../shared/sftp'

/** 服务器以状态码拒绝了请求（code 见 SFTP_STATUS；message 已是给用户看的中文原因）。 */
export class SftpStatusError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message)
  }
}

type ReplyOf<T extends SftpReply['type']> = Extract<SftpReply, { type: T }>

/** 传输进度回调：参数为已传的字节数。 */
export type SftpProgress = (doneBytes: number) => void

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('已取消')
}

export class SftpClient {
  private nextId = 1
  private readonly pending = new Map<
    number,
    { resolve: (reply: SftpReply) => void; reject: (error: Error) => void }
  >()
  private version: { resolve: () => void; reject: (error: Error) => void } | null = null
  private closed: Error | null = null
  /** 同时在途的数据块数：按往返时延自适应，整条连接共用（见 SftpWindow） */
  private readonly window = new SftpWindow()

  /** onFatal：数据流错乱（不是合法的 SFTP 报文），连接已不可用，由调用方结束 ssh。 */
  constructor(
    private readonly input: Writable,
    output: Readable,
    private readonly onFatal: (error: Error) => void
  ) {
    const read = createSftpFrameReader()
    output.on('data', (chunk: Buffer) => {
      if (this.closed) return
      try {
        for (const payload of read(chunk)) this.dispatch(decodeSftpReply(payload))
      } catch (error) {
        const e = error instanceof Error ? error : new SftpProtocolError(String(error))
        this.close(e)
        this.onFatal(e)
      }
    })
  }

  /** 握手：发 INIT，等服务器回 VERSION。 */
  init(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(this.closed)
      this.version = { resolve, reject }
      this.input.write(encodeSftpInit())
    })
  }

  /** 连接已结束：未完成的请求一起以 error 失败，之后的请求立即失败。 */
  close(error: Error): void {
    if (this.closed) return
    this.closed = error
    this.version?.reject(error)
    this.version = null
    for (const p of this.pending.values()) p.reject(error)
    this.pending.clear()
  }

  private dispatch(reply: SftpReply): void {
    if (reply.type === 'version') {
      this.version?.resolve()
      this.version = null
      return
    }
    const p = this.pending.get(reply.id)
    if (!p) return
    this.pending.delete(reply.id)
    p.resolve(reply)
  }

  /** 发一个请求、等它的回复；往返时间交给在途窗口（读写块据此加减，其余只更新基准）。 */
  private send(request: SftpRequest): Promise<SftpReply> {
    if (this.closed) return Promise.reject(this.closed)
    const id = this.nextId
    this.nextId = (this.nextId + 1) >>> 0 || 1
    const sentAt = performance.now()
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (reply) => {
          const rtt = performance.now() - sentAt
          if (request.op === 'read' || request.op === 'write') this.window.adapt(rtt)
          else this.window.observe(rtt)
          resolve(reply)
        },
        reject
      })
      this.input.write(encodeSftpRequest(id, request))
    })
  }

  /** 期望某类回复；服务器回了状态码则按它报错。 */
  private async expect<T extends SftpReply['type']>(
    request: SftpRequest,
    type: T
  ): Promise<ReplyOf<T>> {
    const reply = await this.send(request)
    if (reply.type === type) return reply as ReplyOf<T>
    if (reply.type === 'status') throw new SftpStatusError(reply.code, statusText(reply))
    throw new SftpProtocolError(`SFTP 回复类型不符：期望 ${type}，收到 ${reply.type}`)
  }

  /** 期望「成功」状态。 */
  private async expectOk(request: SftpRequest): Promise<void> {
    const reply = await this.expect(request, 'status')
    if (reply.code !== SFTP_STATUS.OK) throw new SftpStatusError(reply.code, statusText(reply))
  }

  async realpath(path: string): Promise<string> {
    const reply = await this.expect({ op: 'realpath', path }, 'name')
    const name = reply.names[0]
    if (!name) throw new SftpProtocolError('realpath 没有返回路径')
    return name.filename
  }

  async stat(path: string): Promise<SftpAttrs> {
    return (await this.expect({ op: 'stat', path }, 'attrs')).attrs
  }

  async lstat(path: string): Promise<SftpAttrs> {
    return (await this.expect({ op: 'lstat', path }, 'attrs')).attrs
  }

  /** 列目录（不含 `.` 与 `..`）；条目属性来自 lstat（符号链接本身）。 */
  async readdir(path: string): Promise<SftpName[]> {
    const { handle } = await this.expect({ op: 'opendir', path }, 'handle')
    try {
      const names: SftpName[] = []
      for (;;) {
        const reply = await this.send({ op: 'readdir', handle })
        if (reply.type === 'name') {
          names.push(...reply.names.filter((n) => n.filename !== '.' && n.filename !== '..'))
          continue
        }
        if (reply.type === 'status' && reply.code === SFTP_STATUS.EOF) return names
        if (reply.type === 'status') throw new SftpStatusError(reply.code, statusText(reply))
        throw new SftpProtocolError(`SFTP 回复类型不符：期望 name，收到 ${reply.type}`)
      }
    } finally {
      await this.closeHandle(handle)
    }
  }

  async mkdir(path: string): Promise<void> {
    await this.expectOk({ op: 'mkdir', path })
  }

  async rmdir(path: string): Promise<void> {
    await this.expectOk({ op: 'rmdir', path })
  }

  async remove(path: string): Promise<void> {
    await this.expectOk({ op: 'remove', path })
  }

  /** 改名；v3 的 RENAME 在目标已存在时失败。 */
  async rename(from: string, to: string): Promise<void> {
    await this.expectOk({ op: 'rename', from, to })
  }

  /** 新建空文件；已存在即失败（CREAT | EXCL）。 */
  async createFile(path: string): Promise<void> {
    const handle = await this.open(path, SFTP_OPEN.WRITE | SFTP_OPEN.CREAT | SFTP_OPEN.EXCL)
    await this.closeHandle(handle)
  }

  /** 读文件开头至多 length 字节（嗅探类型用）。 */
  async readHead(path: string, length: number): Promise<Uint8Array> {
    return this.withHandle(path, SFTP_OPEN.READ, async (handle) => {
      const out = new Uint8Array(length)
      const got = await this.readInto(handle, length, (offset, data) => out.set(data, offset))
      return out.subarray(0, got)
    })
  }

  /** 整个读进内存（size 为读前 stat 的大小；文件变短则以实际读到的为准）。 */
  async readFile(
    path: string,
    size: number,
    onProgress?: SftpProgress,
    signal?: AbortSignal
  ): Promise<Uint8Array> {
    return this.withHandle(path, SFTP_OPEN.READ, async (handle) => {
      const out = new Uint8Array(size)
      const got = await this.readInto(
        handle,
        size,
        (offset, data) => out.set(data, offset),
        onProgress,
        signal
      )
      return out.subarray(0, got)
    })
  }

  /**
   * 读取流水线：按块并发请求，sink 按偏移落下每块数据；短读的余下部分补读，读到文件尾即止。
   * 返回实际读到的总长度。
   */
  async readInto(
    handle: Uint8Array,
    size: number,
    sink: (offset: number, data: Uint8Array) => void | Promise<void>,
    onProgress?: SftpProgress,
    signal?: AbortSignal
  ): Promise<number> {
    const plan = new SftpTransferPlan(size)
    let done = 0
    await this.pipeline(plan, signal, async ({ offset, length }) => {
      const reply = await this.send({ op: 'read', handle, offset, length })
      if (reply.type === 'data' && reply.data.length > 0) {
        await sink(offset, reply.data)
        done += reply.data.length
        onProgress?.(done)
        plan.shortRead(offset, length, reply.data.length)
        return
      }
      if (reply.type === 'data' || (reply.type === 'status' && reply.code === SFTP_STATUS.EOF)) {
        plan.endAt(offset)
        return
      }
      if (reply.type === 'status') throw new SftpStatusError(reply.code, statusText(reply))
      throw new SftpProtocolError(`SFTP 回复类型不符：期望 data，收到 ${reply.type}`)
    })
    return Math.min(done, plan.size)
  }

  /** 写入流水线：source 按偏移给出每块数据，按块并发写。 */
  async writeFrom(
    handle: Uint8Array,
    size: number,
    source: (offset: number, length: number) => Promise<Uint8Array> | Uint8Array,
    onProgress?: SftpProgress,
    signal?: AbortSignal
  ): Promise<void> {
    let done = 0
    await this.pipeline(new SftpTransferPlan(size), signal, async ({ offset, length }) => {
      const data = await source(offset, length)
      await this.expectOk({ op: 'write', handle, offset, data })
      done += length
      onProgress?.(done)
    })
  }

  /** 整个写入（覆盖原内容，保住文件本身的权限与属主）。 */
  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const flags = SFTP_OPEN.WRITE | SFTP_OPEN.CREAT | SFTP_OPEN.TRUNC
    await this.withHandle(path, flags, (handle) =>
      this.writeFrom(handle, data.length, (offset, length) =>
        data.subarray(offset, offset + length)
      )
    )
  }

  async open(path: string, flags: number): Promise<Uint8Array> {
    return (await this.expect({ op: 'open', path, flags }, 'handle')).handle
  }

  /** 关句柄；连接已断开等失败一律忽略（句柄随连接一起失效）。 */
  async closeHandle(handle: Uint8Array): Promise<void> {
    await this.expectOk({ op: 'close', handle }).catch(() => undefined)
  }

  /**
   * 打开 path，跑完 run 再关。正常结束时等关闭的回复；出错或被取消时照发关闭但不等：服务器按序回复，
   * 它排在还没回来的读写之后，慢线路上要等好几秒。
   */
  async withHandle<T>(
    path: string,
    flags: number,
    run: (handle: Uint8Array) => Promise<T>
  ): Promise<T> {
    const handle = await this.open(path, flags)
    let result: T
    try {
      result = await run(handle)
    } catch (error) {
      void this.closeHandle(handle)
      throw error
    }
    await this.closeHandle(handle)
    return result
  }

  /**
   * 并发执行一个分块计划：同时在途的块数由在途窗口给出；任一块失败即整体失败，被取消则立即失败
   * （不等下一块回来）。已发出的请求照常收回复但不再理会。
   */
  private pipeline(
    plan: SftpTransferPlan,
    signal: AbortSignal | undefined,
    step: (range: { offset: number; length: number }) => Promise<void>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let active = 0
      let failed = false
      const onAbort = (): void => fail(abortReason(signal!))
      const fail = (error: unknown): void => {
        if (failed) return
        failed = true
        signal?.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
      const pump = (): void => {
        if (failed) return
        if (signal?.aborted) return fail(abortReason(signal))
        for (let range = plan.take(); range !== null; range = plan.take()) {
          active++
          step(range).then(() => {
            active--
            pump()
          }, fail)
          if (active >= this.window.size) break
        }
        if (active === 0) {
          signal?.removeEventListener('abort', onAbort)
          resolve()
        }
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      pump()
    })
  }
}

function statusText(reply: ReplyOf<'status'>): string {
  return sftpStatusMessage(reply.code, reply.message)
}
