// 每项目一条 @parcel/watcher 原生递归订阅（VS Code 同栈：macOS FSEvents /
// Windows ReadDirectoryChangesW / Linux inotify）。C++ 侧合并节流事件，避免
// chokidar 在 Windows 上逐目录挂 fs.watch 拖垮主进程。WSL 项目改由发行版里的小助手监听（dir-watch）。
//
// 通道划分在 classify 纯函数里完成；git 工作区是否刷新仍经 git check-ignore
// （零硬编码生态目录）。discovery / files / git 共用同一条订阅与同一轮调度（见 schedule）。
// 一个项目里可有多个仓库（项目自己所在的仓库、嵌套仓库、子模块，见 git-repos）：git 通道按仓库分发，
// 子模块的变化顺带通知它的上级仓库。gitdir 在监听根之外的（链接工作树的公共 gitdir 等）再各加一条只驱动 git
// 通道的订阅；主工作树与子模块的 gitdir 就在监听根内，不需要。
// 项目里任一仓库有写动作排队 / 执行中（含余震）时，到点的通知挂起不发，转闲后补发一次——
// 不与动作抢锁，也不丢动作期间的外部变化。
// Files 经符号链接列到监听根以外的目录时，另起只驱动 files 通道的监听（linked-dir-watch，ADR-0059）。

import { promises as fs } from 'original-fs'
import { wslDistroOf } from '../shared/wsl-path'
import { isAppQuitting } from './app-shutdown'
import { subscribeDir, type DirSubscription, type DirWatchEvent } from './dir-watch'
import { isRepoBusy, onRepoIdle } from './git-actions'
import { execGit, repoKeyOf } from './git-exec'
import { LinkedDirWatches, hostLinkedDirs } from './linked-dir-watch'
import {
  classifyWatchPathAll,
  isPathInside,
  pathHasIdeIgnoredSegment,
  resolveWatchRoot,
  type WatchRepo
} from './project-watch-classify'
import {
  addWatchChange,
  emptyPending,
  hasPending,
  markRescan,
  watchFlushDelay,
  type PendingChanges
} from './project-watch-schedule'
import { toSlashPath, toSysPath } from './sys-path'

export type ProjectWatchHandlers = {
  /** 项目根的清单 / lockfile / 约定指纹变了（WSL 项目要先重读它的探测缓存） */
  onDiscoveryChange: (projectPath: string) => void
  onFilesChange: (projectPath: string) => void
  /** 某仓库的内容变了（键为 WatchRepo.path） */
  onGitChange: (repoPath: string) => void
  /** 项目的仓库清单可能变了：重新发现 */
  onReposProbe: (projectPath: string) => void
}

/** 对齐监听所需的每项目仓库形态。 */
export interface ProjectWatchTarget {
  projectPath: string
  /** 项目自己所在仓库的根（监听根）；不在仓库里为 null */
  ownRoot: string | null
  repos: WatchRepo[]
}

interface ProjectWatcherEntry {
  projectPath: string
  repos: WatchRepo[]
  /** 与写动作队列同键：项目里任一仓库忙时本项目的通知挂起（含项目路径本身，init 用它） */
  repoKeys: string[]
  watchRoot: string
  /** gitdir 在监听根之外、另起订阅的目录 */
  extraDirs: string[]
  handlers: ProjectWatchHandlers
  subscriptions: DirSubscription[]
  /** 经符号链接列到监听根以外的目录另起的监听；WSL 项目为 null */
  linked: LinkedDirWatches | null
  /** 撤销 linked 的宿主登记 */
  unhostLinked: (() => void) | null
  closed: boolean
  /** 本轮待发通知 */
  pending: PendingChanges
  /** 本轮首个事件时刻（最长等待的起点）；无待发为 null */
  firstEventAt: number | null
  timer: ReturnType<typeof setTimeout> | null
  /** 到点时仓库忙：挂起，等转闲补发 */
  held: boolean
}

const watchers = new Map<string, ProjectWatcherEntry>()

function clearTimer(timer: ReturnType<typeof setTimeout> | null): void {
  if (timer) clearTimeout(timer)
}

async function disposeEntry(projectPath: string, entry: ProjectWatcherEntry): Promise<void> {
  entry.closed = true
  clearTimer(entry.timer)
  entry.timer = null
  watchers.delete(projectPath)
  const subs = entry.subscriptions
  entry.subscriptions = []
  entry.unhostLinked?.()
  await Promise.all([...subs.map((sub) => sub.unsubscribe()), entry.linked?.dispose()])
}

/** 工作区路径里有没被忽略的：git check-ignore 在仓库根跑（路径相对它）。 */
async function hasUnignored(repoRoot: string, paths: string[]): Promise<boolean> {
  // -z 只能配合 --stdin（ADR-0009）：路径经标准输入传入。分隔符统一为 `/`：WSL 仓库的 git 在发行版里执行，
  // 只认 `/`（Windows 版 git 两种都认）
  const input = paths.map(toSlashPath).join('\0') + '\0'
  const result = await execGit(
    repoRoot,
    ['check-ignore', '--stdin', '-z'],
    Buffer.from(input, 'utf8')
  )
  if (result.code !== 0) return true
  const ignored = result.stdout
    .toString('utf8')
    .split('\0')
    .filter((p) => p !== '')
  return ignored.length < paths.length
}

/** 通知某仓库变了，并顺着子模块链通知上级（子模块的提交、改动都会改上级的工作区状态）。 */
function notifyRepo(entry: ProjectWatcherEntry, repoPath: string, notified: Set<string>): void {
  let path: string | null = repoPath
  while (path !== null && !notified.has(path)) {
    notified.add(path)
    entry.handlers.onGitChange(path)
    path = entry.repos.find((r) => r.path === path)?.superPath ?? null
  }
}

/** 发出本轮待发通知并清空本轮状态。 */
function flush(entry: ProjectWatcherEntry): void {
  clearTimer(entry.timer)
  entry.timer = null
  entry.held = false
  entry.firstEventAt = null
  const { discovery, files, git, probe, rescan } = entry.pending
  entry.pending = emptyPending()
  if (entry.closed || isAppQuitting()) return
  const { handlers, projectPath } = entry
  if (discovery) handlers.onDiscoveryChange(projectPath)
  if (files) handlers.onFilesChange(projectPath)
  if (probe) handlers.onReposProbe(projectPath)
  const notified = new Set<string>()
  for (const repo of entry.repos) {
    const pending = rescan ? ({ mode: 'force' } as const) : git.get(repo.path)
    if (pending === undefined) continue
    if (pending.mode === 'force') {
      notifyRepo(entry, repo.path, notified)
      continue
    }
    void hasUnignored(repo.root, [...pending.paths]).then((changed) => {
      if (changed && !entry.closed) notifyRepo(entry, repo.path, notified)
    })
  }
}

function isEntryBusy(entry: ProjectWatcherEntry): boolean {
  return entry.repoKeys.some((key) => isRepoBusy(key))
}

/** 有新变化并入后排期：尾沿防抖 + 最长等待；已挂起则只并入，等转闲一起补发。 */
function schedule(entry: ProjectWatcherEntry): void {
  if (entry.held || !hasPending(entry.pending)) return
  const now = Date.now()
  entry.firstEventAt ??= now
  clearTimer(entry.timer)
  entry.timer = setTimeout(
    () => {
      entry.timer = null
      if (entry.closed) return
      if (isEntryBusy(entry)) entry.held = true
      else flush(entry)
    },
    watchFlushDelay(entry.firstEventAt, now)
  )
}

// 仓库转闲：补发含该仓库、且已没有别的仓库在忙的项目挂起的通知（动作期间的外部变化与动作自身的文件变化都在其中）
onRepoIdle((repoKey) => {
  for (const entry of watchers.values()) {
    if (entry.held && entry.repoKeys.includes(repoKey) && !isEntryBusy(entry)) flush(entry)
  }
})

function handleEvents(
  entry: ProjectWatcherEntry,
  err: Error | null,
  events: DirWatchEvent[]
): void {
  if (entry.closed || isAppQuitting()) return
  // 监听报错（如 FSEvents 丢事件需重扫）：这批不完整，各通道强制刷新；事件照常并入
  if (err) markRescan(entry.pending)
  for (const event of events) {
    for (const cls of classifyWatchPathAll(entry.projectPath, entry.repos, event.path)) {
      addWatchChange(entry.pending, cls)
    }
  }
  schedule(entry)
}

/** 另起的链接目录监听：里面任何不在 IDE 忽略名下的变化（或报错）都只刷新 files 通道。 */
function handleLinkedEvents(
  entry: ProjectWatcherEntry,
  err: Error | null,
  events: DirWatchEvent[]
): void {
  if (entry.closed || isAppQuitting()) return
  if (err === null && events.every((event) => pathHasIdeIgnoredSegment(event.path))) return
  addWatchChange(entry.pending, { kind: 'files' })
  schedule(entry)
}

function watchReposOf(target: ProjectWatchTarget): WatchRepo[] {
  return target.repos.map((repo) => ({
    path: repo.path,
    // 换成与监听事件同口径的本平台路径（仓库根来自 git，是 `/` 分隔的）
    root: toSysPath(repo.root),
    gitDirs:
      repo.gitDirs === null
        ? null
        : { gitDir: toSysPath(repo.gitDirs.gitDir), commonDir: toSysPath(repo.gitDirs.commonDir) },
    superPath: repo.superPath
  }))
}

/** gitdir 在监听根之外、要另起订阅的目录：链接工作树的公共 gitdir 等（主工作树、子模块的就在根内）。 */
function extraDirsOf(watchRoot: string, repos: readonly WatchRepo[]): string[] {
  const dirs = new Set<string>()
  for (const repo of repos) {
    if (repo.gitDirs === null) continue
    const { gitDir, commonDir } = repo.gitDirs
    if (!isPathInside(watchRoot, commonDir)) dirs.add(commonDir)
    if (!isPathInside(watchRoot, gitDir) && !isPathInside(commonDir, gitDir)) dirs.add(gitDir)
  }
  return [...dirs].sort()
}

/** 写动作队列的键：按 git 给出的原样路径算（与 git-actions 同口径，不能用换成本平台写法的）。 */
function repoKeysOf(projectPath: string, repos: readonly WatchRepo[]): string[] {
  return [projectPath, ...repos.map((repo) => repoKeyOf(repo.path, repo.root, repo.gitDirs))]
}

async function startEntry(
  target: ProjectWatchTarget,
  handlers: ProjectWatchHandlers
): Promise<void> {
  if (isAppQuitting()) return
  const { projectPath } = target
  const watchRoot = resolveWatchRoot(
    projectPath,
    target.ownRoot === null ? null : toSysPath(target.ownRoot)
  )
  const repos = watchReposOf(target)
  const entry: ProjectWatcherEntry = {
    projectPath,
    repos,
    repoKeys: repoKeysOf(projectPath, target.repos),
    watchRoot,
    extraDirs: extraDirsOf(watchRoot, repos),
    handlers,
    subscriptions: [],
    linked: null,
    unhostLinked: null,
    closed: false,
    pending: emptyPending(),
    firstEventAt: null,
    timer: null,
    held: false
  }
  watchers.set(projectPath, entry)
  if (wslDistroOf(projectPath) === null) {
    const covered = fs.realpath(watchRoot).catch(() => watchRoot)
    entry.linked = new LinkedDirWatches(covered, (err, events) =>
      handleLinkedEvents(entry, err, events)
    )
    entry.unhostLinked = hostLinkedDirs(projectPath, entry.linked)
  }

  const stale = (): boolean =>
    entry.closed || isAppQuitting() || watchers.get(projectPath) !== entry
  try {
    // 监听根与另起的 gitdir 订阅共用同一套分类（gitdir 里的路径只会归到 git 通道）
    for (const dir of [watchRoot, ...entry.extraDirs]) {
      const subscription = await subscribeDir(dir, (err, events) =>
        handleEvents(entry, err, events)
      )
      if (stale()) {
        await subscription.unsubscribe()
        return
      }
      entry.subscriptions.push(subscription)
    }
  } catch {
    entry.unhostLinked?.()
    void entry.linked?.dispose()
    void Promise.all(entry.subscriptions.map((sub) => sub.unsubscribe()))
    entry.subscriptions = []
    if (watchers.get(projectPath) === entry) watchers.delete(projectPath)
  }
}

/** 订阅是否要重建：监听根或另起的 gitdir 订阅变了（init / 删 .git / 新增链接工作树等）。 */
function needsResubscribe(entry: ProjectWatcherEntry, target: ProjectWatchTarget): boolean {
  const watchRoot = resolveWatchRoot(
    target.projectPath,
    target.ownRoot === null ? null : toSysPath(target.ownRoot)
  )
  if (entry.watchRoot !== watchRoot) return true
  return entry.extraDirs.join('\0') !== extraDirsOf(watchRoot, watchReposOf(target)).join('\0')
}

/**
 * 与当前项目集合对齐：新增起听，移除关闭；订阅形态变化则重建，只是仓库清单变了就原地换上（不丢事件）。
 * subscribe 异步完成；退出/替换时用 closed 标志丢弃过期订阅。
 */
export function syncProjectWatchers(
  projects: ProjectWatchTarget[],
  handlers: ProjectWatchHandlers
): void {
  if (isAppQuitting()) return

  const wanted = new Map<string, ProjectWatchTarget>()
  for (const p of projects) wanted.set(p.projectPath, p)

  for (const [projectPath, entry] of watchers) {
    const target = wanted.get(projectPath)
    if (target === undefined || needsResubscribe(entry, target)) {
      void disposeEntry(projectPath, entry)
    } else {
      entry.repos = watchReposOf(target)
      entry.repoKeys = repoKeysOf(projectPath, target.repos)
    }
  }

  for (const [projectPath, target] of wanted) {
    if (watchers.has(projectPath)) continue
    void startEntry(target, handlers)
  }
}

/** 关闭全部项目监听；await 后再退出，避免原生 addon 在进程销毁时 abort。 */
export async function closeAllProjectWatchers(): Promise<void> {
  const closing = [...watchers.entries()].map(([projectPath, entry]) =>
    disposeEntry(projectPath, entry)
  )
  await Promise.all(closing)
}
