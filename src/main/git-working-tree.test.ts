import { describe, expect, it, vi } from 'vitest'

vi.mock('./git-exec', () => ({
  // 测试里项目路径即仓库根；'/not-repo' 不在仓库里
  resolveRepoRoot: vi.fn(async (dir: string) => (dir === '/not-repo' ? null : dir))
}))

import { invalidateWorkingTree, WorkingTreeReads } from './git-working-tree'

/** 可从外部 resolve / reject 的一次读取。 */
function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type Result = { ok: boolean; n: number }

describe('WorkingTreeReads', () => {
  it('同一代的并发读取共用一轮，读完后作废前直接复用', async () => {
    const reads = new WorkingTreeReads<Result>((r) => r.ok)
    const pending = deferred<Result>()
    const load = vi.fn(() => pending.promise)
    const a = reads.read('/r1', load)
    const b = reads.read('/r1', load)
    pending.resolve({ ok: true, n: 1 })
    expect(await a).toEqual({ ok: true, n: 1 })
    expect(await b).toEqual({ ok: true, n: 1 })
    expect(await reads.read('/r1', load)).toEqual({ ok: true, n: 1 })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('作废后的第一次读取重新取', async () => {
    const reads = new WorkingTreeReads<Result>((r) => r.ok)
    let n = 0
    const load = vi.fn(async () => ({ ok: true, n: ++n }))
    expect(await reads.read('/r2', load)).toEqual({ ok: true, n: 1 })
    await invalidateWorkingTree('/r2')
    expect(await reads.read('/r2', load)).toEqual({ ok: true, n: 2 })
    expect(await reads.read('/r2', load)).toEqual({ ok: true, n: 2 })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('在跑的一轮早于作废：之后到的读取都并进排在它后面的同一轮', async () => {
    const reads = new WorkingTreeReads<Result>((r) => r.ok)
    const first = deferred<Result>()
    const second = deferred<Result>()
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const early = reads.read('/r3', load)
    await invalidateWorkingTree('/r3')
    const late1 = reads.read('/r3', load)
    const late2 = reads.read('/r3', load)
    expect(load).toHaveBeenCalledTimes(1) // 排队的那轮等在跑的结束才开始
    first.resolve({ ok: true, n: 1 })
    expect(await early).toEqual({ ok: true, n: 1 })
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    second.resolve({ ok: true, n: 2 })
    expect(await late1).toEqual({ ok: true, n: 2 })
    expect(await late2).toEqual({ ok: true, n: 2 })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('读失败的结果不留，下次再读', async () => {
    const reads = new WorkingTreeReads<Result>((r) => r.ok)
    const load = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, n: 1 })
      .mockResolvedValueOnce({ ok: true, n: 2 })
    expect(await reads.read('/r4', load)).toEqual({ ok: false, n: 1 })
    expect(await reads.read('/r4', load)).toEqual({ ok: true, n: 2 })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('在跑的一轮抛错也不卡住排队的那轮', async () => {
    const reads = new WorkingTreeReads<Result>((r) => r.ok)
    const first = deferred<Result>()
    const load = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ ok: true, n: 2 })
    const early = reads.read('/r5', load)
    await invalidateWorkingTree('/r5')
    const late = reads.read('/r5', load)
    first.reject(new Error('boom'))
    await expect(early).rejects.toThrow('boom')
    expect(await late).toEqual({ ok: true, n: 2 })
  })

  it('各仓库各算各的', async () => {
    const reads = new WorkingTreeReads<Result>((r) => r.ok)
    const load = vi.fn(async () => ({ ok: true, n: 1 }))
    await reads.read('/r6', load)
    await reads.read('/r7', load)
    await invalidateWorkingTree('/r6')
    await reads.read('/r7', load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('不在仓库里的项目作废时无事可做', async () => {
    await expect(invalidateWorkingTree('/not-repo')).resolves.toBeUndefined()
  })
})
