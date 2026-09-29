// SFTP 客户端（ADR-0041）：协议由 ssh2 的 SFTP 通道来说，这里在它的基本读写之上做分块流水线（每块 32 KiB）；
// 同时在途的块数按往返时延自适应（SftpWindow）：快线路跑满带宽，慢线路上服务器那边只排着一两块，
// 下载时别的请求、取消后的下一个请求都不用久等。ssh2 自带的 fastGet / fastPut 固定 64 块在途、中途停不下来，不用。
// 通道结束（出错、被关、连接断开）后所有请求立即失败，由调用方重开通道。

import type { FileEntryWithStats, SFTPWrapper, Stats } from 'ssh2'
import {
  SftpTransferPlan,
  SftpWindow,
  sftpStatusMessage,
  type SftpAttrs,
  type SftpName
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

/** 传输进度回调：参数为已传的字节数。 */
export type SftpProgress = (doneBytes: number) => void

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('已取消')
}

/** ssh2 的错误：服务器回了状态码的换成 SftpStatusError（中文原因），其余原样。 */
function toError(error: Error & { code?: unknown }): Error {
  return typeof error.code === 'number'
    ? new SftpStatusError(error.code, sftpStatusMessage(error.code, error.message))
    : error
}

function attrsOf(stats: Stats | FileEntryWithStats['attrs']): SftpAttrs {
  return {
    size: stats.size,
    uid: stats.uid,
    gid: stats.gid,
    permissions: stats.mode,
    atime: stats.atime,
    mtime: stats.mtime
  }
}

export class SftpClient {
  /** 同时在途的数据块数：按往返时延自适应，一个通道一个（见 SftpWindow） */
  private readonly window = new SftpWindow()
  private ended: Error | null = null

  constructor(private readonly sftp: SFTPWrapper) {
    const end = (): void => {
      this.ended ??= new Error('连接已断开')
    }
    sftp.once('close', end)
    // 服务器回了坏报文：ssh2 报错并关掉通道。必须接住，否则成了主进程未处理的错误
    sftp.on('error', end)
  }

  /** 通道已结束（出错、被关或连接断开）：该重开了。 */
  get closed(): boolean {
    return this.ended !== null
  }

  /** 关掉通道；之后的请求立即失败。 */
  end(): void {
    this.ended ??= new Error('连接已断开')
    this.sftp.end()
  }

  /**
   * 发一个请求、等它的结果；往返时间交给在途窗口（读写块据此加减，其余只更新基准）。
   * call 按 ssh2 的回调风格发请求。
   */
  private request<T>(
    kind: 'data' | 'other',
    call: (
      done: (error: (Error & { code?: unknown }) | null | undefined, result?: T) => void
    ) => void
  ): Promise<T> {
    if (this.ended) return Promise.reject(this.ended)
    const sentAt = performance.now()
    return new Promise((resolve, reject) => {
      call((error, result) => {
        const rtt = performance.now() - sentAt
        if (kind === 'data') this.window.adapt(rtt)
        else this.window.observe(rtt)
        if (error) reject(toError(error))
        else resolve(result as T)
      })
    })
  }

  realpath(path: string): Promise<string> {
    return this.request('other', (done) => this.sftp.realpath(path, done))
  }

  async stat(path: string): Promise<SftpAttrs> {
    return attrsOf(await this.request<Stats>('other', (done) => this.sftp.stat(path, done)))
  }

  async lstat(path: string): Promise<SftpAttrs> {
    return attrsOf(await this.request<Stats>('other', (done) => this.sftp.lstat(path, done)))
  }

  /** 列目录（不含 `.` 与 `..`）；条目属性来自 lstat（符号链接本身）。 */
  async readdir(path: string): Promise<SftpName[]> {
    const list = await this.request<FileEntryWithStats[]>('other', (done) =>
      this.sftp.readdir(path, done)
    )
    return list
      .filter((e) => e.filename !== '.' && e.filename !== '..')
      .map((e) => ({ filename: e.filename, attrs: attrsOf(e.attrs) }))
  }

  mkdir(path: string): Promise<void> {
    return this.request('other', (done) => this.sftp.mkdir(path, done))
  }

  rmdir(path: string): Promise<void> {
    return this.request('other', (done) => this.sftp.rmdir(path, done))
  }

  remove(path: string): Promise<void> {
    return this.request('other', (done) => this.sftp.unlink(path, done))
  }

  /** 改名；SFTP v3 的 RENAME 在目标已存在时失败。 */
  rename(from: string, to: string): Promise<void> {
    return this.request('other', (done) => this.sftp.rename(from, to, done))
  }

  /** 新建空文件；已存在即失败。 */
  async createFile(path: string): Promise<void> {
    const handle = await this.open(path, 'wx')
    await this.closeHandle(handle)
  }

  /** 读文件开头至多 length 字节（嗅探类型用）。 */
  async readHead(path: string, length: number): Promise<Uint8Array> {
    return this.withHandle(path, 'r', async (handle) => {
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
    return this.withHandle(path, 'r', async (handle) => {
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
    handle: Buffer,
    size: number,
    sink: (offset: number, data: Uint8Array) => void | Promise<void>,
    onProgress?: SftpProgress,
    signal?: AbortSignal
  ): Promise<number> {
    const plan = new SftpTransferPlan(size)
    let done = 0
    await this.pipeline(plan, signal, async ({ offset, length }) => {
      const buffer = Buffer.allocUnsafe(length)
      const got = await this.request<number>('data', (finish) =>
        this.sftp.read(handle, buffer, 0, length, offset, (error, bytesRead) =>
          finish(error, bytesRead)
        )
      )
      // ssh2 读到文件尾时给 0 字节
      if (got === 0) {
        plan.endAt(offset)
        return
      }
      await sink(offset, buffer.subarray(0, got))
      done += got
      onProgress?.(done)
      plan.shortRead(offset, length, got)
    })
    return Math.min(done, plan.size)
  }

  /** 写入流水线：source 按偏移给出每块数据，按块并发写。 */
  async writeFrom(
    handle: Buffer,
    size: number,
    source: (offset: number, length: number) => Promise<Uint8Array> | Uint8Array,
    onProgress?: SftpProgress,
    signal?: AbortSignal
  ): Promise<void> {
    let done = 0
    await this.pipeline(new SftpTransferPlan(size), signal, async ({ offset, length }) => {
      const data = await source(offset, length)
      const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
      await this.request('data', (finish) =>
        this.sftp.write(handle, buffer, 0, buffer.length, offset, finish)
      )
      done += length
      onProgress?.(done)
    })
  }

  /** 整个写入（覆盖原内容，保住文件本身的权限与属主）。 */
  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await this.withHandle(path, 'w', (handle) =>
      this.writeFrom(handle, data.length, (offset, length) =>
        data.subarray(offset, offset + length)
      )
    )
  }

  /** 打开文件：r 读；w 写（不存在则建、已存在则清空）；wx 新建（已存在即失败）。 */
  open(path: string, flags: 'r' | 'w' | 'wx'): Promise<Buffer> {
    return this.request('other', (done) => this.sftp.open(path, flags, done))
  }

  /** 关句柄；通道已结束等失败一律忽略（句柄随通道一起失效）。 */
  async closeHandle(handle: Buffer): Promise<void> {
    await this.request('other', (done) => this.sftp.close(handle, done)).catch(() => undefined)
  }

  /**
   * 打开 path，跑完 run 再关。正常结束时等关闭的结果；出错或被取消时照发关闭但不等：服务器按序回复，
   * 它排在还没回来的读写之后，慢线路上要等好几秒。
   */
  async withHandle<T>(
    path: string,
    flags: 'r' | 'w' | 'wx',
    run: (handle: Buffer) => Promise<T>
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
