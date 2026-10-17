// 任务登记处：状态流转、节流推送、取消 / 隐藏 / 找回 / 关掉、计速与退出收尾（假时钟）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NO_PROGRESS, type TaskInfo } from '../shared/task'
import { createTaskRegistry } from './tasks'

const owner = { kind: 'git' as const, projectPath: '/p' }
const title = { action: '推送', target: 'main → origin/main' }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function setup(): { registry: ReturnType<typeof createTaskRegistry>; pushes: TaskInfo[][] } {
  const registry = createTaskRegistry()
  const pushes: TaskInfo[][] = []
  registry.subscribe((list) => pushes.push(list))
  return { registry, pushes }
}

describe('任务登记处', () => {
  it('等待中 → 进行中 → 成功即移除，状态变化立即推送', () => {
    const { registry, pushes } = setup()
    const task = registry.create(owner, title, { queued: true })
    expect(pushes.at(-1)?.[0]).toMatchObject({ status: 'queued', projectPath: '/p', title })
    task.start()
    expect(pushes.at(-1)?.[0].status).toBe('running')
    task.finish({ status: 'ok' })
    expect(pushes.at(-1)).toEqual([])
    expect(registry.activeCount()).toBe(0)
  })

  it('进度按 200ms 节流推送', () => {
    const { registry, pushes } = setup()
    const task = registry.create(owner, title, { queued: false })
    const before = pushes.length
    task.report({ ...NO_PROGRESS, percent: 10 })
    task.report({ ...NO_PROGRESS, percent: 20 })
    expect(pushes.length).toBe(before)
    vi.advanceTimersByTime(200)
    expect(pushes.length).toBe(before + 1)
    expect(pushes.at(-1)?.[0].progress.percent).toBe(20)
  })

  it('失败的留下原因，不算未完成；关掉才移除', () => {
    const { registry } = setup()
    const task = registry.create(owner, title, { queued: false })
    task.finish({ status: 'failed', errors: ['rejected'] })
    expect(registry.list()[0]).toMatchObject({ status: 'failed', errors: ['rejected'] })
    expect(registry.activeCount()).toBe(0)
    registry.dismiss(task.id)
    expect(registry.list()).toEqual([])
  })

  it('取消等待中的：立即移除，执行方轮到时见已取消', () => {
    const { registry } = setup()
    const task = registry.create(owner, title, { queued: true })
    registry.cancel(task.id)
    expect(registry.list()).toEqual([])
    expect(task.signal.aborted).toBe(true)
    task.start()
    task.finish({ status: 'ok' })
    expect(registry.list()).toEqual([])
  })

  it('取消进行中的：叫停中不能再点取消，执行方收口一律按取消', () => {
    const { registry } = setup()
    const task = registry.create(owner, title, { queued: false })
    registry.cancel(task.id)
    expect(task.signal.aborted).toBe(true)
    expect(registry.list()[0]).toMatchObject({ cancellable: false, cancelBlockedReason: null })
    task.finish({ status: 'failed', errors: ['killed'] })
    expect(registry.list()).toEqual([])
  })

  it('不能取消时（拉取在合并）忽略取消，并带出原因', () => {
    const { registry } = setup()
    const task = registry.create(owner, title, { queued: false })
    task.setCancellable(false, '正在合并，无法取消')
    expect(registry.list()[0]).toMatchObject({
      cancellable: false,
      cancelBlockedReason: '正在合并，无法取消'
    })
    registry.cancel(task.id)
    expect(task.signal.aborted).toBe(false)
  })

  it('隐藏与找回', () => {
    const { registry } = setup()
    const task = registry.create(owner, title, { queued: false })
    registry.hide(task.id)
    expect(task.hidden).toBe(true)
    expect(registry.list()[0].hidden).toBe(true)
    registry.reveal(task.id)
    expect(task.hidden).toBe(false)
  })

  it('按已完成字节计速：只有一个样本时没有，停住后回落；知道总量才有剩余时间', () => {
    const { registry } = setup()
    const task = registry.create(owner, title, { queued: false })
    const report = (doneBytes: number, totalBytes: number | null = null): void =>
      task.report({ ...NO_PROGRESS, doneBytes, totalBytes })
    report(0, 1000)
    expect(registry.list()[0].speed).toBeNull()
    vi.advanceTimersByTime(1000)
    report(100, 1000)
    expect(registry.list()[0]).toMatchObject({ speed: 100, remainingSeconds: 9 })
    // 停住：定时补样本，5 秒窗口滑过后速度回落到 0
    vi.advanceTimersByTime(7000)
    expect(registry.list()[0].speed).toBe(0)
    expect(registry.list()[0].remainingSeconds).toBeNull()
  })

  it('退出前：叫停能取消的，等全部收尾', async () => {
    const { registry } = setup()
    const pushing = registry.create(owner, title, { queued: false })
    const merging = registry.create(owner, title, { queued: false })
    merging.setCancellable(false)
    pushing.signal.addEventListener('abort', () => pushing.finish({ status: 'canceled' }))
    const done = registry.cancelAll()
    expect(pushing.signal.aborted).toBe(true)
    expect(merging.signal.aborted).toBe(false)
    merging.finish({ status: 'ok' })
    await done
    expect(registry.list()).toEqual([])
  })

  it('退出前等收尾有上限', async () => {
    const { registry } = setup()
    registry.create(owner, title, { queued: false })
    const done = registry.cancelAll()
    vi.advanceTimersByTime(3000)
    await expect(done).resolves.toBeUndefined()
  })
})
