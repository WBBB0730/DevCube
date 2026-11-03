// 经符号链接进到根监听范围以外的目录（ADR-0059）：Files 列过它（树上展开过），就为它另起一路递归监听，
// 只驱动文件通道（文件树重读、文件名索引作废）。宿主是一条根监听（项目监听 / Preview Window 的根监听），
// 按 Files 根登记；宿主释放时撤销它另起的全部监听，不随树上收起而撤销。WSL 里的目录不登记（未实测）。
// 指向自己上级的链接（所在的文件夹就在目标里，即循环链接）不另起：否则会把整个上级目录（乃至家目录）都盯上（同 JetBrains）。
import { dirname } from 'node:path'
import { promises as fs } from 'original-fs'
import { normalizePath } from '../shared/files-path'
import { subscribeDir, type DirSubscription, type DirWatchEvent } from './dir-watch'
import { isPathInside } from './project-watch-classify'

export class LinkedDirWatches {
  /** 已另起监听的目录（真实路径）→ 订阅；起不来为 null */
  private readonly subs = new Map<string, Promise<DirSubscription | null>>()
  private closed = false

  constructor(
    /** 根监听覆盖的范围（真实路径），在它里面的变化根监听已经收得到 */
    private readonly covered: Promise<string>,
    private readonly onEvents: (err: Error | null, events: DirWatchEvent[]) => void
  ) {}

  /**
   * 列过的目录（真实路径；realParent 为它所在文件夹的真实路径）：不在根监听与已另起的范围内、
   * 也不是循环链接（所在的文件夹在目标里）就另起一路；订阅就绪（或起不来）后返回
   */
  async add(realDir: string, realParent: string): Promise<void> {
    const covered = await this.covered
    if (this.closed || isPathInside(covered, realDir) || isPathInside(realDir, realParent)) return
    for (const dir of this.subs.keys()) {
      if (isPathInside(dir, realDir)) return
    }
    const pending = subscribeDir(realDir, (err, events) => {
      if (!this.closed) this.onEvents(err, events)
    }).catch(() => null)
    this.subs.set(realDir, pending)
    await pending
  }

  async dispose(): Promise<void> {
    this.closed = true
    const subs = [...this.subs.values()]
    this.subs.clear()
    await Promise.all(subs.map(async (pending) => (await pending)?.unsubscribe()))
  }
}

/** Files 根（规范化逻辑路径）→ 以它为根的监听宿主 */
const hosts = new Map<string, Set<LinkedDirWatches>>()

/** 登记一个宿主；返回撤销登记的函数（宿主自己负责 dispose）。 */
export function hostLinkedDirs(filesRoot: string, watches: LinkedDirWatches): () => void {
  const key = normalizePath(filesRoot)
  let set = hosts.get(key)
  if (set === undefined) {
    set = new Set()
    hosts.set(key, set)
  }
  set.add(watches)
  return () => {
    set.delete(watches)
    if (set.size === 0 && hosts.get(key) === set) hosts.delete(key)
  }
}

/** Files 在 filesRoot 下列了 sysDir：交给以它为根的宿主，真实路径在监听范围以外时另起监听。 */
export function noteListedDir(filesRoot: string, sysDir: string): void {
  const set = hosts.get(normalizePath(filesRoot))
  if (set === undefined) return
  void Promise.all([fs.realpath(sysDir), fs.realpath(dirname(sysDir))]).then(
    ([real, realParent]) => {
      for (const watches of set) void watches.add(real, realParent)
    },
    () => undefined
  )
}
