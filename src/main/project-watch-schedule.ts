// 项目监听的通知调度（纯函数，供 project-watchers 与单测）：discovery / files / git 三个通道
// 共用一轮待发——尾沿防抖 + 最长等待；git 通道攒待 check-ignore 的工作区路径。
// 仓库忙时挂起、转闲补发由 project-watchers 负责（依赖写动作队列的运行期状态）。

import type { WatchEventClass } from './project-watch-classify'

/** 尾沿防抖：本轮最后一个事件后安静这么久才发出。 */
export const WATCH_DEBOUNCE_MS = 750
/** 最长等待：从本轮首个事件起最多这么久必发一次（持续有事件也不无限推迟）。 */
export const WATCH_MAX_WAIT_MS = 2000
/** 一轮内待 check-ignore 的工作区路径上限；超过则本轮直接强制刷新。 */
export const PENDING_PATHS_MAX = 200

/** git 通道：强制刷新（元数据 / 探测 / 需重扫），或待 check-ignore 的工作区相对路径。 */
export type GitPending = { mode: 'force' } | { mode: 'paths'; paths: Set<string> }

/** 一轮待发的通知：各通道是否有变化；git 为 null 表示无。 */
export interface PendingChanges {
  discovery: boolean
  files: boolean
  git: GitPending | null
}

export function emptyPending(): PendingChanges {
  return { discovery: false, files: false, git: null }
}

export function hasPending(pending: PendingChanges): boolean {
  return pending.discovery || pending.files || pending.git !== null
}

function addGitPath(pending: PendingChanges, relPath: string): void {
  const git = pending.git
  if (git === null) {
    pending.git = { mode: 'paths', paths: new Set([relPath]) }
  } else if (git.mode === 'paths') {
    if (git.paths.size >= PENDING_PATHS_MAX) pending.git = { mode: 'force' }
    else git.paths.add(relPath)
  }
}

/** 把一条已分类的事件并入本轮待发（原地更新）。 */
export function addWatchChange(pending: PendingChanges, cls: WatchEventClass): void {
  switch (cls.kind) {
    case 'discovery':
      pending.discovery = true
      return
    case 'files':
      pending.files = true
      return
    case 'git-meta':
    case 'git-probe':
      pending.git = { mode: 'force' }
      return
    case 'git-worktree':
      addGitPath(pending, cls.relPath)
      return
  }
}

/** 监听报「事件已丢、需重扫」：这批不可信，三个通道都强制刷新。 */
export function markRescan(pending: PendingChanges): void {
  pending.discovery = true
  pending.files = true
  pending.git = { mode: 'force' }
}

/** 距发出的延迟：尾沿防抖，但不超过本轮首个事件起的最长等待。 */
export function watchFlushDelay(firstEventAt: number, now: number): number {
  return Math.max(0, Math.min(WATCH_DEBOUNCE_MS, firstEventAt + WATCH_MAX_WAIT_MS - now))
}
