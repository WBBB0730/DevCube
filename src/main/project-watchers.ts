// 每项目一条 @parcel/watcher 原生递归订阅（VS Code 同栈：macOS FSEvents /
// Windows ReadDirectoryChangesW / Linux inotify）。C++ 侧合并节流事件，避免
// chokidar 在 Windows 上逐目录挂 fs.watch 拖垮主进程。
//
// 通道划分在 classify 纯函数里完成；git 工作区是否刷新仍经 git check-ignore
// （零硬编码生态目录）。discovery / files / git 共用同一条订阅与同一轮调度（见 schedule）。
// 链接工作树（`.git` 为文件、refs 与各工作树 HEAD 都在主仓库的公共 gitdir 里）再加一条
// 只驱动 git 通道的公共 gitdir 订阅；主工作树的公共 gitdir 就在监听根内，不需要。
// 该仓库有写动作排队 / 执行中（含余震）时，到点的通知挂起不发，转闲后补发一次——
// 不与动作抢锁，也不丢动作期间的外部变化。

import parcelWatcher, { type AsyncSubscription, type Event } from '@parcel/watcher'
import { isAppQuitting } from './app-shutdown'
import { isRepoBusy, onRepoIdle } from './git-actions'
import { execGit, repoKeyOf, type GitDirs } from './git-exec'
import {
  classifyCommonDirPath,
  classifyWatchPathAll,
  isPathInside,
  resolveWatchRoot
} from './project-watch-classify'
import {
  addWatchChange,
  emptyPending,
  hasPending,
  markRescan,
  watchFlushDelay,
  type PendingChanges
} from './project-watch-schedule'

export type ProjectWatchHandlers = {
  onDiscoveryChange: () => void
  onFilesChange: (projectPath: string) => void
  onGitChange: (projectPath: string) => void
}

/** 对齐监听所需的每项目仓库形态：仓库根与两个 gitdir（非仓库 / 解析失败为 null）。 */
export interface ProjectWatchTarget {
  projectPath: string
  repoRoot: string | null
  gitDirs: GitDirs | null
}

interface ProjectWatcherEntry {
  projectPath: string
  repoRoot: string | null
  /** 与写动作队列同键：该仓库忙时本项目的通知挂起 */
  repoKey: string
  watchRoot: string
  /** 链接工作树额外盯的公共 gitdir；主工作树 / 非仓库为 null */
  commonDir: string | null
  gitDir: string | null
  handlers: ProjectWatchHandlers
  subscription: AsyncSubscription | null
  commonSubscription: AsyncSubscription | null
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
  const subs = [entry.subscription, entry.commonSubscription]
  entry.subscription = null
  entry.commonSubscription = null
  await Promise.all(subs.map((sub) => (sub ? sub.unsubscribe() : Promise.resolve())))
}

async function notifyIfNotIgnored(
  projectPath: string,
  repoRoot: string,
  paths: string[],
  onGitChange: (projectPath: string) => void
): Promise<void> {
  const result = await execGit(repoRoot, ['check-ignore', '-z', '--', ...paths])
  if (result.code === 0) {
    const ignored = result.stdout
      .toString('utf8')
      .split('\0')
      .filter((p) => p !== '')
    if (ignored.length >= paths.length) return
  }
  onGitChange(projectPath)
}

/** 发出本轮待发通知并清空本轮状态。 */
function flush(entry: ProjectWatcherEntry): void {
  clearTimer(entry.timer)
  entry.timer = null
  entry.held = false
  entry.firstEventAt = null
  const { discovery, files, git } = entry.pending
  entry.pending = emptyPending()
  if (entry.closed || isAppQuitting()) return
  const { handlers, projectPath, repoRoot } = entry
  if (discovery) handlers.onDiscoveryChange()
  if (files) handlers.onFilesChange(projectPath)
  if (git === null) return
  if (git.mode === 'force' || repoRoot === null) {
    handlers.onGitChange(projectPath)
    return
  }
  void notifyIfNotIgnored(projectPath, repoRoot, [...git.paths], handlers.onGitChange)
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
      if (isRepoBusy(entry.repoKey)) entry.held = true
      else flush(entry)
    },
    watchFlushDelay(entry.firstEventAt, now)
  )
}

// 仓库转闲：补发该仓库下挂起的通知（动作期间的外部变化与动作自身的文件变化都在其中）
onRepoIdle((repoKey) => {
  for (const entry of watchers.values()) {
    if (entry.repoKey === repoKey && entry.held) flush(entry)
  }
})

function handleEvents(entry: ProjectWatcherEntry, err: Error | null, events: Event[]): void {
  if (entry.closed || isAppQuitting()) return
  // 监听报错（如 FSEvents 丢事件需重扫）：这批不完整，各通道强制刷新；事件照常并入
  if (err) markRescan(entry.pending)
  for (const event of events) {
    for (const cls of classifyWatchPathAll(entry.projectPath, entry.repoRoot, event.path)) {
      addWatchChange(entry.pending, cls)
    }
  }
  schedule(entry)
}

/** 公共 gitdir 订阅的事件：只有白名单元数据（共享 refs、各工作树 HEAD、worktrees 增删）或报错才强制刷新 git。 */
function handleCommonDirEvents(
  entry: ProjectWatcherEntry,
  err: Error | null,
  events: Event[]
): void {
  if (entry.closed || isAppQuitting()) return
  if (entry.commonDir === null || entry.gitDir === null) return
  const meta =
    err !== null ||
    events.some(
      (event) => classifyCommonDirPath(entry.commonDir!, entry.gitDir!, event.path).length > 0
    )
  if (!meta) return
  addWatchChange(entry.pending, { kind: 'git-meta' })
  schedule(entry)
}

/** 链接工作树才需要额外盯公共 gitdir：它在监听根之外（主工作树的 .git 本就在根内）。 */
function needsCommonDirWatch(watchRoot: string, gitDirs: GitDirs | null): boolean {
  return gitDirs !== null && !isPathInside(watchRoot, gitDirs.commonDir)
}

async function startEntry(
  target: ProjectWatchTarget,
  handlers: ProjectWatchHandlers
): Promise<void> {
  if (isAppQuitting()) return
  const { projectPath, repoRoot, gitDirs } = target
  const watchRoot = resolveWatchRoot(projectPath, repoRoot)
  const extra = needsCommonDirWatch(watchRoot, gitDirs)
  const entry: ProjectWatcherEntry = {
    projectPath,
    repoRoot,
    repoKey: repoKeyOf(projectPath, repoRoot, gitDirs),
    watchRoot,
    commonDir: extra ? gitDirs!.commonDir : null,
    gitDir: extra ? gitDirs!.gitDir : null,
    handlers,
    subscription: null,
    commonSubscription: null,
    closed: false,
    pending: emptyPending(),
    firstEventAt: null,
    timer: null,
    held: false
  }
  watchers.set(projectPath, entry)

  const stale = (): boolean =>
    entry.closed || isAppQuitting() || watchers.get(projectPath) !== entry
  try {
    const subscription = await parcelWatcher.subscribe(watchRoot, (err, events) =>
      handleEvents(entry, err, events)
    )
    if (stale()) {
      await subscription.unsubscribe()
      return
    }
    entry.subscription = subscription
    if (entry.commonDir !== null) {
      const commonSubscription = await parcelWatcher.subscribe(entry.commonDir, (err, events) =>
        handleCommonDirEvents(entry, err, events)
      )
      if (stale()) {
        await commonSubscription.unsubscribe()
        return
      }
      entry.commonSubscription = commonSubscription
    }
  } catch {
    if (watchers.get(projectPath) === entry) watchers.delete(projectPath)
  }
}

/** 订阅形态是否一致：仓库根、仓库键与公共 gitdir 任一变化（init / 删 .git / 变成或不再是链接工作树）即重建。 */
function sameShape(entry: ProjectWatcherEntry, target: ProjectWatchTarget): boolean {
  if (entry.repoRoot !== target.repoRoot) return false
  if (entry.repoKey !== repoKeyOf(target.projectPath, target.repoRoot, target.gitDirs)) {
    return false
  }
  const wantCommon = needsCommonDirWatch(entry.watchRoot, target.gitDirs)
    ? target.gitDirs!.commonDir
    : null
  return entry.commonDir === wantCommon
}

/**
 * 与当前项目集合对齐：新增起听，移除关闭；形态变化则重建。
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
    if (target === undefined || !sameShape(entry, target)) {
      void disposeEntry(projectPath, entry)
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
