/**
 * **Task**（用户发起的、会报进度的耗时操作，术语见 CONTEXT.md）的共享层：快照类型、计速、格式化与 Dock 进度汇总。
 * 纯函数，main / renderer 均可导入。范围与界面见 docs/prd/task-progress.md，架构见 ADR-0058。
 */

import type { GitCloneInput } from './git-clone'
import { formatBytes } from './server-status'

/** 一个 Task 此刻的进度：都可能没有（阶段未知、不报百分比、不传数据、不知道总量）。 */
export interface TaskProgress {
  /** 阶段名（如「接收对象」「合并」） */
  phase: string | null
  /** 总百分比 0–100；null 为不确定 */
  percent: number | null
  doneBytes: number | null
  totalBytes: number | null
}

export const NO_PROGRESS: TaskProgress = {
  phase: null,
  percent: null,
  doneBytes: null,
  totalBytes: null
}

/** 动作 + 对象（对象等宽显示），如「拉取」+「origin/main」。 */
export interface TaskTitle {
  action: string
  target: string
}

/** 等待中（排在同仓库前一个操作之后）/ 进行中 / 失败（留到被关掉）。成功与取消即移除。 */
export type TaskStatus = 'queued' | 'running' | 'failed'

interface TaskBase {
  id: string
  title: TaskTitle
  status: TaskStatus
  progress: TaskProgress
  /** 每秒字节数；算不出为 null */
  speed: number | null
  /** 剩余秒数；不知道总量或速度时为 null */
  remainingSeconds: number | null
  /** 此刻能否取消（拉取进入合并 / 变基后不能，叫停中也不能） */
  cancellable: boolean
  /** 不能取消的原因（「取消」悬停说明，如「正在合并，无法取消」）；叫停中没有 */
  cancelBlockedReason: string | null
  /** 被隐藏：列在顶栏的任务清单里，不在前台显示 */
  hidden: boolean
  /** 创建时刻（毫秒）：进度弹窗据此延迟出现 */
  createdAt: number
  /** 失败原因（失败时才有） */
  errors: string[]
}

/** 推给渲染端的 Task 快照：Git 动作属于某个 Project；克隆不属于任何 Project，带着原输入（失败后找回时填回表单）。 */
export type TaskInfo =
  | (TaskBase & { kind: 'git'; projectPath: string })
  | (TaskBase & { kind: 'clone'; input: GitCloneInput })

/** 正在做或排着队的（退出确认、Dock 进度只算它们）。 */
export function isTaskActive(task: TaskInfo): boolean {
  return task.status !== 'failed'
}

/** 阶段名：等待中（排在同仓库前一个操作之后）；还没有进度时为「准备中」。 */
export function taskPhaseLabel(task: TaskInfo): string {
  if (task.status === 'queued') return '等待中'
  return task.progress.phase ?? '准备中'
}

/** 进度条的值：等待中轨道空着、不动（0）；null 为不确定。 */
export function taskBarValue(task: TaskInfo): number | null {
  return task.status === 'queued' ? 0 : task.progress.percent
}

/** 进度明细用的数字（已传、总量、速度、剩余）。 */
export function taskDetailStats(task: TaskInfo): Parameters<typeof progressDetail>[0] {
  return {
    doneBytes: task.progress.doneBytes,
    totalBytes: task.progress.totalBytes,
    speed: task.speed,
    remainingSeconds: task.remainingSeconds
  }
}

// —— 计速 ——

/** 计速只看最近这么久的样本：够平滑，停住时也回落得快。 */
const SPEED_WINDOW_MS = 5000

export interface SpeedSample {
  at: number
  bytes: number
}

/**
 * 记一个「已完成字节」样本：丢掉窗口外的旧样本，但留下窗口起点前的最后一个，让窗口始终撑满。
 * 字节数变少（换了一条命令、重新计数）即从这个样本重新开始。
 */
export function addSpeedSample(samples: SpeedSample[], sample: SpeedSample): SpeedSample[] {
  const last = samples[samples.length - 1]
  if (last !== undefined && sample.bytes < last.bytes) return [sample]
  const next = [...samples, sample]
  const windowStart = sample.at - SPEED_WINDOW_MS
  const firstInside = next.findIndex((s) => s.at >= windowStart)
  return next.slice(Math.max(0, firstInside - 1))
}

/**
 * 窗口内的平均速度（字节 / 秒）；只有一个样本时为 null。来源在开始传输时先记一个 0 字节的样本，
 * 第一份已传字节到来时即有速度（开始以来的平均）。
 */
export function speedOf(samples: SpeedSample[]): number | null {
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (first === undefined || last === undefined) return null
  const span = last.at - first.at
  if (span <= 0) return null
  return ((last.bytes - first.bytes) * 1000) / span
}

/** 剩余秒数：知道总量、速度大于 0 时才有。 */
export function remainingSecondsOf(
  doneBytes: number | null,
  totalBytes: number | null,
  speed: number | null
): number | null {
  if (doneBytes === null || totalBytes === null || speed === null || speed <= 0) return null
  return Math.max(0, totalBytes - doneBytes) / speed
}

// —— 格式化 ——

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}

/**
 * 「还剩 N 秒」：不足 1 分钟写秒，不足 1 小时写分钟，再长写「N 小时 M 分」（整小时不写「0 分」）。
 * 都向上取整，不说「还剩 0 秒」。
 */
export function formatRemaining(seconds: number): string {
  const total = Math.max(1, Math.ceil(seconds))
  if (total < 60) return `还剩 ${total} 秒`
  const minutes = Math.ceil(total / 60)
  if (minutes < 60) return `还剩 ${minutes} 分钟`
  const rest = minutes % 60
  return `还剩 ${Math.floor(minutes / 60)} 小时${rest === 0 ? '' : ` ${rest} 分`}`
}

/**
 * 进度明细：「已传（速度）」，知道总量时「已传 / 总量（速度）· 还剩」。
 * 速度、剩余都由已传字节算出，没有已传字节、或还一个字节都没传出时没有明细（null）——已传与速度一起出现；
 * 算不出的项不写。
 */
export function progressDetail(stats: {
  doneBytes: number | null
  totalBytes: number | null
  speed: number | null
  remainingSeconds: number | null
}): string | null {
  if (stats.doneBytes === null || stats.doneBytes === 0) return null
  let text =
    stats.totalBytes === null
      ? formatBytes(stats.doneBytes)
      : `${formatBytes(stats.doneBytes)} / ${formatBytes(stats.totalBytes)}`
  if (stats.speed === null) return text
  text += `（${formatSpeed(stats.speed)}）`
  // 剩余时间由速度算出，总跟在括号后面；全角括号自带间距，「·」前不再空格
  if (stats.remainingSeconds !== null) text += `· ${formatRemaining(stats.remainingSeconds)}`
  return text
}

// —— Dock / 任务栏进度 ——

/** Dock / 任务栏上的进度：不显示、不确定、或 0–1 的比例。 */
export type DockProgress =
  { kind: 'none' } | { kind: 'indeterminate' } | { kind: 'value'; value: number }

/**
 * 只在 DevCube 不在前台时显示：取进行中 Task 的平均总百分比（没有百分比的不计入）；全都没有百分比时为不确定。
 * 等待中的不算（还没开始）。
 */
export function dockProgressOf(tasks: TaskInfo[], appFocused: boolean): DockProgress {
  if (appFocused) return { kind: 'none' }
  const running = tasks.filter((t) => t.status === 'running')
  if (running.length === 0) return { kind: 'none' }
  const percents = running.flatMap((t) => (t.progress.percent === null ? [] : [t.progress.percent]))
  if (percents.length === 0) return { kind: 'indeterminate' }
  const average = percents.reduce((sum, p) => sum + p, 0) / percents.length
  return { kind: 'value', value: average / 100 }
}
