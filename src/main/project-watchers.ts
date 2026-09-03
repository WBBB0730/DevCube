// 每项目一条 @parcel/watcher 原生递归订阅（VS Code 同栈：macOS FSEvents /
// Windows ReadDirectoryChangesW / Linux inotify）。C++ 侧合并节流事件，避免
// chokidar 在 Windows 上逐目录挂 fs.watch 拖垮主进程。
//
// 通道划分在 classify 纯函数里完成；git 工作区是否刷新仍经 git check-ignore
// （零硬编码生态目录）。discovery / files / git 共用同一条订阅。
// 链接工作树（`.git` 为文件、refs 与各工作树 HEAD 都在主仓库的公共 gitdir 里）再加一条
// 只驱动 git 通道的公共 gitdir 订阅；主工作树的公共 gitdir 就在监听根内，不需要。
// Git 写动作期间（含余震）整条订阅静音，避免动作自身事件打到任一通道。

import parcelWatcher, { type AsyncSubscription, type Event } from '@parcel/watcher'
import { isAppQuitting } from './app-shutdown'
import { isGitActionRunning } from './git-actions'
import { execGit, type GitDirs } from './git-exec'
import {
  classifyCommonDirPath,
  classifyWatchPathAll,
  isPathInside,
  resolveWatchRoot
} from './project-watch-classify'

const FILES_DEBOUNCE_MS = 750
const GIT_DEBOUNCE_MS = 750
/** 防抖窗口内待 check-ignore 的路径上限；超过则本轮直接刷新。 */
const PENDING_PATHS_MAX = 200

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

/** git 防抖桶：强制刷新（meta/probe）或待 check-ignore 的工作区相对路径。 */
type GitPending = { mode: 'force' } | { mode: 'paths'; paths: Set<string> }

interface ProjectWatcherEntry {
  projectPath: string
  repoRoot: string | null
  watchRoot: string
  /** 链接工作树额外盯的公共 gitdir；主工作树 / 非仓库为 null */
  commonDir: string | null
  gitDir: string | null
  subscription: AsyncSubscription | null
  commonSubscription: AsyncSubscription | null
  closed: boolean
  filesTimer: ReturnType<typeof setTimeout> | null
  gitTimer: ReturnType<typeof setTimeout> | null
  gitPending: GitPending
}

const watchers = new Map<string, ProjectWatcherEntry>()

function clearTimer(timer: ReturnType<typeof setTimeout> | null): void {
  if (timer) clearTimeout(timer)
}

async function disposeEntry(projectPath: string, entry: ProjectWatcherEntry): Promise<void> {
  entry.closed = true
  clearTimer(entry.filesTimer)
  clearTimer(entry.gitTimer)
  entry.filesTimer = null
  entry.gitTimer = null
  watchers.delete(projectPath)
  const subs = [entry.subscription, entry.commonSubscription]
  entry.subscription = null
  entry.commonSubscription = null
  await Promise.all(subs.map((sub) => (sub ? sub.unsubscribe() : Promise.resolve())))
}

function scheduleFiles(entry: ProjectWatcherEntry, onFilesChange: (p: string) => void): void {
  clearTimer(entry.filesTimer)
  entry.filesTimer = setTimeout(() => {
    entry.filesTimer = null
    if (!entry.closed) onFilesChange(entry.projectPath)
  }, FILES_DEBOUNCE_MS)
}

function scheduleGit(
  entry: ProjectWatcherEntry,
  onGitChange: (p: string) => void,
  relPath: string | null
): void {
  if (relPath === null || entry.gitPending.mode === 'force') {
    entry.gitPending = { mode: 'force' }
  } else if (entry.gitPending.paths.size >= PENDING_PATHS_MAX) {
    entry.gitPending = { mode: 'force' }
  } else {
    entry.gitPending.paths.add(relPath)
  }
  clearTimer(entry.gitTimer)
  entry.gitTimer = setTimeout(() => {
    entry.gitTimer = null
    if (entry.closed) return
    const pending = entry.gitPending
    entry.gitPending = { mode: 'paths', paths: new Set() }
    if (pending.mode === 'force' || entry.repoRoot === null) {
      onGitChange(entry.projectPath)
      return
    }
    void notifyIfNotIgnored(entry.projectPath, entry.repoRoot, [...pending.paths], onGitChange)
  }, GIT_DEBOUNCE_MS)
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

function handleEvents(
  entry: ProjectWatcherEntry,
  events: Event[],
  handlers: ProjectWatchHandlers
): void {
  if (entry.closed || isAppQuitting()) return
  // 写动作期间（含余震）整条订阅静音：discovery / files / git 一律不调度。
  if (isGitActionRunning()) return

  let discovery = false
  let files = false
  let gitForceRefresh = false
  const worktreeRels: string[] = []

  for (const event of events) {
    for (const cls of classifyWatchPathAll(entry.projectPath, entry.repoRoot, event.path)) {
      switch (cls.kind) {
        case 'discovery':
          discovery = true
          break
        case 'files':
          files = true
          break
        case 'git-meta':
        case 'git-probe':
          gitForceRefresh = true
          break
        case 'git-worktree':
          worktreeRels.push(cls.relPath)
          break
      }
    }
  }

  if (discovery) handlers.onDiscoveryChange()
  if (files) scheduleFiles(entry, handlers.onFilesChange)
  if (gitForceRefresh) scheduleGit(entry, handlers.onGitChange, null)
  else {
    for (const rel of worktreeRels) scheduleGit(entry, handlers.onGitChange, rel)
  }
}

/** 公共 gitdir 订阅的事件：只有白名单元数据（共享 refs、各工作树 HEAD、worktrees 增删）才强制刷新。 */
function handleCommonDirEvents(
  entry: ProjectWatcherEntry,
  events: Event[],
  handlers: ProjectWatchHandlers
): void {
  if (entry.closed || isAppQuitting() || isGitActionRunning()) return
  if (entry.commonDir === null || entry.gitDir === null) return
  const meta = events.some(
    (event) => classifyCommonDirPath(entry.commonDir!, entry.gitDir!, event.path).length > 0
  )
  if (meta) scheduleGit(entry, handlers.onGitChange, null)
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
    watchRoot,
    commonDir: extra ? gitDirs!.commonDir : null,
    gitDir: extra ? gitDirs!.gitDir : null,
    subscription: null,
    commonSubscription: null,
    closed: false,
    filesTimer: null,
    gitTimer: null,
    gitPending: { mode: 'paths', paths: new Set() }
  }
  watchers.set(projectPath, entry)

  const stale = (): boolean =>
    entry.closed || isAppQuitting() || watchers.get(projectPath) !== entry
  try {
    const subscription = await parcelWatcher.subscribe(watchRoot, (err, events) => {
      if (err || entry.closed) return
      handleEvents(entry, events, handlers)
    })
    if (stale()) {
      await subscription.unsubscribe()
      return
    }
    entry.subscription = subscription
    if (entry.commonDir !== null) {
      const commonSubscription = await parcelWatcher.subscribe(entry.commonDir, (err, events) => {
        if (err || entry.closed) return
        handleCommonDirEvents(entry, events, handlers)
      })
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

/** 订阅形态是否一致：仓库根与公共 gitdir 任一变化（init / 删 .git / 变成或不再是链接工作树）即重建。 */
function sameShape(entry: ProjectWatcherEntry, target: ProjectWatchTarget): boolean {
  if (entry.repoRoot !== target.repoRoot) return false
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
