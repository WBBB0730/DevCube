// 服务器文件的副本账（docs/prd/server-files.md「打开」；纯逻辑，供 server-files 与单测）：打开过的文件按
// 「服务器 + 路径」留一份，记下下载时服务器上的版本（修改时间与大小）；再打开时版本对得上才复用，对不上即作废。
// 只记账、不碰磁盘：一份用不上了交给 discard（磁盘上的删目录，内存里的什么都不用做）。

import { childPathPrefix } from '../shared/files-path'
import type { FilesOpenKind } from '../shared/files-kind'
import { sameServerFileVersion, type ServerFileVersion } from '../shared/server-files'

export interface ServerFileCopy<T> {
  serverId: string
  /** 服务器上的路径 */
  path: string
  /** 下载时服务器上的版本 */
  version: ServerFileVersion
  /** 按内容判出的类型：复用时不必再读开头嗅探 */
  kind: FilesOpenKind
  /** 计入上限的字节数 */
  bytes: number
  data: T
}

const copyKey = (serverId: string, path: string): string => `${serverId}\n${path}`

export class ServerFileCopies<T> {
  /** 账上的副本：按最近使用排序，最久没用的在前 */
  private readonly copies = new Map<string, ServerFileCopy<T>>()
  /** 各台服务器正文区正在显示的那份：淘汰、作废都先不丢弃，换下来再丢 */
  private readonly shown = new Map<string, ServerFileCopy<T>>()
  /** 各台服务器的改动计数：下载期间变过，下到的就不收（见 keep） */
  private readonly epochs = new Map<string, number>()
  private bytes = 0

  constructor(
    /** 所有服务器合计的上限 */
    private readonly maxBytes: number,
    private readonly discard: (copy: ServerFileCopy<T>) => void
  ) {}

  /** 版本对得上的那份，并记为最近使用；对不上的已经过期，随即作废。 */
  take(serverId: string, path: string, version: ServerFileVersion): ServerFileCopy<T> | null {
    const key = copyKey(serverId, path)
    const copy = this.copies.get(key)
    if (!copy) return null
    if (!sameServerFileVersion(copy.version, version)) {
      this.remove(key, copy)
      return null
    }
    this.copies.delete(key)
    this.copies.set(key, copy)
    return copy
  }

  /** 下载前取一次，下载完连同副本交给 keep。 */
  epoch(serverId: string): number {
    return this.epochs.get(serverId) ?? 0
  }

  /**
   * 收下一份新下载的，返回是否收下。下载期间这台服务器上有过自己的改动（epoch 变了）、或它本身就超过上限，
   * 不收，只用这一次。收下后超出上限，按最久没用的淘汰（正在显示的除外）。
   */
  keep(copy: ServerFileCopy<T>, epoch: number): boolean {
    if (epoch !== this.epoch(copy.serverId) || copy.bytes > this.maxBytes) return false
    const key = copyKey(copy.serverId, copy.path)
    const old = this.copies.get(key)
    if (old) this.remove(key, old)
    this.copies.set(key, copy)
    this.bytes += copy.bytes
    for (const [k, c] of this.copies) {
      if (this.bytes <= this.maxBytes) break
      if (c !== copy && !this.isShown(c)) this.remove(k, c)
    }
    return true
  }

  /** 正文区换成了 copy（null = 换成了别的内容）：原先显示的那份若已不在账上，这时丢弃。 */
  show(serverId: string, copy: ServerFileCopy<T> | null): void {
    const prev = this.shown.get(serverId)
    if (copy) this.shown.set(serverId, copy)
    else this.shown.delete(serverId)
    if (prev && prev !== copy) this.settle(prev)
  }

  /** 一份用完了（没收下、被取消或出错）：既不在账上、也不在显示，就丢弃。 */
  settle(copy: ServerFileCopy<T>): void {
    if (this.copies.get(copyKey(copy.serverId, copy.path)) === copy || this.isShown(copy)) return
    this.discard(copy)
  }

  /** 自己改过服务器上的这些路径（含其下的一切）：作废，进行中的下载也不再收下。 */
  forget(serverId: string, paths: string[]): void {
    this.bump(serverId)
    const prefixes = paths.map(childPathPrefix)
    for (const [key, copy] of this.copies) {
      if (copy.serverId !== serverId) continue
      if (paths.includes(copy.path) || prefixes.some((p) => copy.path.startsWith(p))) {
        this.remove(key, copy)
      }
    }
  }

  /** 丢掉某台服务器的全部（手动断开、编辑或移除服务器），连同正在显示的那份。 */
  drop(serverId: string): void {
    this.bump(serverId)
    const gone = new Set<ServerFileCopy<T>>()
    for (const [key, copy] of this.copies) {
      if (copy.serverId !== serverId) continue
      this.copies.delete(key)
      this.bytes -= copy.bytes
      gone.add(copy)
    }
    const shown = this.shown.get(serverId)
    if (shown) gone.add(shown)
    this.shown.delete(serverId)
    for (const copy of gone) this.discard(copy)
  }

  private isShown(copy: ServerFileCopy<T>): boolean {
    return this.shown.get(copy.serverId) === copy
  }

  private remove(key: string, copy: ServerFileCopy<T>): void {
    this.copies.delete(key)
    this.bytes -= copy.bytes
    this.settle(copy)
  }

  private bump(serverId: string): void {
    this.epochs.set(serverId, this.epoch(serverId) + 1)
  }
}
