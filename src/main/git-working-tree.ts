// 工作区快照（ADR-0056）：同一仓库的工作区状态（git status）与未提交详情只算一份，Files Tab 着色、提交面板、
// 图谱的未提交计数共用。仓库有变化即作废（监听通知、DevCube 的写操作、主动刷新），作废后的第一次读取才重算；
// 读取在途时同一代的请求共用它，作废后到的请求排在它后面——同一仓库同时最多一轮在跑、一轮排队，排队那轮把之后
// 到的请求都并进去（同 VS Code / JetBrains）。

import { resolveRepoRoot } from './git-exec'

/** 每仓库的作废代际：作废一次 +1；读取结果按开始读时的代际记账，代际变了即不再复用。 */
const generations = new Map<string, number>()

function generationOf(root: string): number {
  return generations.get(root) ?? 0
}

/** 作废项目所在仓库的工作区快照（不在仓库里则无事可做）。 */
export async function invalidateWorkingTree(projectPath: string): Promise<void> {
  const root = await resolveRepoRoot(projectPath)
  if (root !== null) generations.set(root, generationOf(root) + 1)
}

interface Slot<T> {
  /** 最近一轮可复用的结果及其代际 */
  value: { generation: number; result: T } | null
  /** 在跑的一轮 */
  running: { generation: number; promise: Promise<T> } | null
  /** 排在在跑那轮之后的一轮：之后到的请求都并进来 */
  queued: Promise<T> | null
}

/** 一种工作区读物（status、未提交详情）：按仓库根各存一份，作废前复用，读取合并。 */
export class WorkingTreeReads<T> {
  private readonly slots = new Map<string, Slot<T>>()

  /** reusable：结果能否复用——读失败的不留，下次再读 */
  constructor(private readonly reusable: (result: T) => boolean) {}

  read(root: string, load: () => Promise<T>): Promise<T> {
    const slot = this.slotOf(root)
    const generation = generationOf(root)
    if (slot.value?.generation === generation) return Promise.resolve(slot.value.result)
    if (slot.running === null) return this.start(root, slot, load)
    if (slot.running.generation === generation) return slot.running.promise
    // 在跑的那轮开始于最近一次作废之前：等它结束再读一轮
    const next = (): Promise<T> => {
      slot.queued = null
      return this.read(root, load)
    }
    slot.queued ??= slot.running.promise.then(next, next)
    return slot.queued
  }

  private slotOf(root: string): Slot<T> {
    let slot = this.slots.get(root)
    if (slot === undefined) {
      slot = { value: null, running: null, queued: null }
      this.slots.set(root, slot)
    }
    return slot
  }

  private start(root: string, slot: Slot<T>, load: () => Promise<T>): Promise<T> {
    const generation = generationOf(root)
    const promise = load()
      .then((result) => {
        slot.value = this.reusable(result) ? { generation, result } : null
        return result
      })
      .finally(() => {
        slot.running = null
      })
    slot.running = { generation, promise }
    return promise
  }
}
