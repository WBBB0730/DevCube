// 任务登记处（docs/prd/task-progress.md、ADR-0058）：主进程里唯一持有 Task 状态的地方。
// 执行方只往里报进度值；速度与剩余时间在这里统一算。状态变化立即推、进度按 200ms 节流推全量快照。
// 不依赖 electron：推送、Dock 进度、退出确认由 IPC 层与退出流程订阅 / 读取后接线。

import { randomUUID } from 'crypto'
import type { GitCloneInput } from '../shared/git-clone'
import {
  addSpeedSample,
  isTaskActive,
  NO_PROGRESS,
  remainingSecondsOf,
  speedOf,
  type SpeedSample,
  type TaskInfo,
  type TaskProgress,
  type TaskTitle
} from '../shared/task'

/** 进度推送的最短间隔（同服务器传输）。 */
const PUSH_INTERVAL_MS = 200
/** 有传数据的 Task 在跑时，每隔这么久补一个样本：停住时速度也会回落。 */
const SPEED_TICK_MS = 1000
/** 退出时等各 Task 收尾（结束进程树、删半成品目录）的上限。 */
const SETTLE_TIMEOUT_MS = 3000

/** Task 属于谁：Git 动作属于某个 Project；克隆带着原输入（失败后找回时填回表单）。 */
export type TaskOwner =
  { kind: 'git'; projectPath: string } | { kind: 'clone'; input: GitCloneInput }

/** 执行的终局：成功、取消即移除；失败留到被关掉。 */
export type TaskOutcome =
  { status: 'ok' } | { status: 'canceled' } | { status: 'failed'; errors: string[] }

/** 执行方手里的一个 Task。 */
export interface TaskHandle {
  readonly id: string
  /** 取消信号：等待中、进行中被取消都会触发 */
  readonly signal: AbortSignal
  /** 此刻是否被隐藏 */
  readonly hidden: boolean
  /** 轮到它执行（等待中 → 进行中） */
  start(): void
  report(progress: TaskProgress): void
  /** reason：不能取消的原因（「取消」的悬停说明） */
  setCancellable(cancellable: boolean, reason?: string): void
  /** 收口；已被取消的一律按取消收口。重复调用无效 */
  finish(outcome: TaskOutcome): void
}

export interface TaskRegistry {
  create(owner: TaskOwner, title: TaskTitle, options: { queued: boolean }): TaskHandle
  list(): TaskInfo[]
  /** 取消：等待中的立即移除；进行中的叫停，由执行方以取消收口 */
  cancel(id: string): void
  hide(id: string): void
  /** 找回：不再算被隐藏（进行中的回到进度弹窗，失败的以失败界面呈现） */
  reveal(id: string): void
  /** 关掉一个失败的 */
  dismiss(id: string): void
  /** 排队或进行中的个数（退出确认） */
  activeCount(): number
  /** 退出前：叫停能取消的，等全部收尾（有上限） */
  cancelAll(): Promise<void>
  subscribe(listener: (tasks: TaskInfo[]) => void): () => void
}

interface Entry {
  info: TaskInfo
  controller: AbortController
  samples: SpeedSample[]
  finished: boolean
  settled: Promise<void>
  settle: () => void
}

export function createTaskRegistry(): TaskRegistry {
  const entries = new Map<string, Entry>()
  const listeners = new Set<(tasks: TaskInfo[]) => void>()
  let pushTimer: ReturnType<typeof setTimeout> | null = null
  let speedTimer: ReturnType<typeof setInterval> | null = null

  const list = (): TaskInfo[] => [...entries.values()].map((e) => e.info)

  const push = (): void => {
    const snapshot = list()
    for (const listener of listeners) listener(snapshot)
  }

  /** 状态变化立即推（并顶掉待推的进度）；进度按 PUSH_INTERVAL_MS 节流。 */
  const emit = (immediate: boolean): void => {
    if (immediate) {
      if (pushTimer !== null) clearTimeout(pushTimer)
      pushTimer = null
      push()
      return
    }
    if (pushTimer !== null) return
    pushTimer = setTimeout(() => {
      pushTimer = null
      push()
    }, PUSH_INTERVAL_MS)
  }

  const update = (entry: Entry, patch: Partial<TaskInfo>): void => {
    entry.info = { ...entry.info, ...patch } as TaskInfo
  }

  /** 按新样本重算速度与剩余时间。 */
  const sample = (entry: Entry, doneBytes: number | null): void => {
    entry.samples =
      doneBytes === null ? [] : addSpeedSample(entry.samples, { at: Date.now(), bytes: doneBytes })
    const speed = speedOf(entry.samples)
    update(entry, {
      speed,
      remainingSeconds: remainingSecondsOf(doneBytes, entry.info.progress.totalBytes, speed)
    })
  }

  const sampling = (): Entry[] =>
    [...entries.values()].filter((e) => e.info.status === 'running' && e.samples.length > 0)

  /** 有在传数据的就定时补样本，没有了就停。 */
  const syncSpeedTimer = (): void => {
    if (sampling().length === 0) {
      if (speedTimer !== null) clearInterval(speedTimer)
      speedTimer = null
      return
    }
    if (speedTimer !== null) return
    speedTimer = setInterval(() => {
      const active = sampling()
      for (const entry of active) sample(entry, entry.info.progress.doneBytes)
      if (active.length > 0) emit(false)
      syncSpeedTimer()
    }, SPEED_TICK_MS)
  }

  const finish = (entry: Entry, outcome: TaskOutcome): void => {
    if (entry.finished) return
    entry.finished = true
    entry.settle()
    if (entry.controller.signal.aborted || outcome.status !== 'failed') {
      entries.delete(entry.info.id)
    } else {
      entry.samples = []
      update(entry, {
        status: 'failed',
        errors: outcome.errors,
        cancellable: false,
        cancelBlockedReason: null,
        speed: null,
        remainingSeconds: null
      })
    }
    syncSpeedTimer()
    emit(true)
  }

  const cancel = (id: string): void => {
    const entry = entries.get(id)
    if (!entry || entry.finished || !entry.info.cancellable) return
    entry.controller.abort()
    if (entry.info.status === 'queued') {
      // 还没轮到：立即移除；执行方轮到时见已取消即不执行，它的收口不再生效
      finish(entry, { status: 'canceled' })
      return
    }
    // 叫停中：不能再点取消，等执行方以取消收口
    update(entry, { cancellable: false, cancelBlockedReason: null })
    emit(true)
  }

  const setHidden = (id: string, hidden: boolean): void => {
    const entry = entries.get(id)
    if (!entry || entry.info.hidden === hidden) return
    update(entry, { hidden })
    emit(true)
  }

  return {
    create: (owner, title, { queued }) => {
      const id = randomUUID()
      let settle = (): void => {}
      const settled = new Promise<void>((resolve) => (settle = resolve))
      const entry: Entry = {
        info: {
          ...owner,
          id,
          title,
          status: queued ? 'queued' : 'running',
          progress: NO_PROGRESS,
          speed: null,
          remainingSeconds: null,
          cancellable: true,
          cancelBlockedReason: null,
          hidden: false,
          createdAt: Date.now(),
          errors: []
        },
        controller: new AbortController(),
        samples: [],
        finished: false,
        settled,
        settle
      }
      entries.set(id, entry)
      emit(true)
      return {
        id,
        signal: entry.controller.signal,
        get hidden() {
          return entry.info.hidden
        },
        start: () => {
          if (entry.finished || entry.info.status !== 'queued') return
          update(entry, { status: 'running' })
          emit(true)
        },
        report: (progress) => {
          if (entry.finished) return
          update(entry, { progress })
          sample(entry, progress.doneBytes)
          syncSpeedTimer()
          emit(false)
        },
        setCancellable: (cancellable, reason) => {
          if (entry.finished || entry.controller.signal.aborted) return
          if (entry.info.cancellable === cancellable) return
          update(entry, { cancellable, cancelBlockedReason: cancellable ? null : (reason ?? null) })
          emit(true)
        },
        finish: (outcome) => finish(entry, outcome)
      }
    },
    list,
    cancel,
    hide: (id) => setHidden(id, true),
    reveal: (id) => setHidden(id, false),
    dismiss: (id) => {
      const entry = entries.get(id)
      if (!entry || entry.info.status !== 'failed') return
      entries.delete(id)
      emit(true)
    },
    activeCount: () => list().filter(isTaskActive).length,
    cancelAll: async () => {
      const active = [...entries.values()].filter((e) => !e.finished)
      for (const entry of active) cancel(entry.info.id)
      await Promise.race([
        Promise.all(active.map((e) => e.settled)),
        new Promise<void>((resolve) => setTimeout(resolve, SETTLE_TIMEOUT_MS))
      ])
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

/** 应用里唯一的任务登记处。 */
export const tasks = createTaskRegistry()
