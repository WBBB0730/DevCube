// git-checks 纯函数测试：各时机挑哪些提交去查、远程分支指向签名、详情各项检查是否还要重查、轮询挡位与各项签名。
import { describe, expect, it } from 'vitest'
import { UNCOMMITTED, type GitCommit } from '@shared/git'
import type { CheckRun, CheckRunState } from '@shared/github'
import {
  checkRunsInProgress,
  checkRunsSignature,
  hashesToQuery,
  pollDelay,
  remoteTipsSignature
} from './git-checks'

function commit(hash: string, patch: Partial<GitCommit> = {}): GitCommit {
  return {
    hash,
    parents: [],
    author: '张三',
    email: 'zs@example.com',
    date: 0,
    message: 'msg',
    heads: [],
    tags: [],
    remotes: [],
    stash: null,
    ...patch
  }
}

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)
const D = 'd'.repeat(40)

const commits: GitCommit[] = [
  commit(UNCOMMITTED),
  commit(A, { remotes: [{ name: 'origin/main', remote: 'origin' }] }),
  commit(B),
  commit(C, { stash: { selector: 'refs/stash@{0}', baseHash: B, untrackedFilesHash: null } }),
  commit(D)
]

describe('hashesToQuery', () => {
  it('unknown 只取没查过的，跳过未提交行与贮藏', () => {
    expect(hashesToQuery(commits, { [A]: 'success' }, 'unknown')).toEqual([B, D])
  })

  it('all 取全部可查的提交', () => {
    expect(hashesToQuery(commits, { [A]: 'success', [B]: 'none' }, 'all')).toEqual([A, B, D])
  })

  it('poll 取进行中的；recheckTips 时再加远程分支末端上没有检查的', () => {
    const states = { [A]: 'none', [B]: 'pending', [D]: 'none' } as const
    expect(hashesToQuery(commits, states, 'poll')).toEqual([B])
    expect(hashesToQuery(commits, states, 'poll', true)).toEqual([A, B])
  })
})

describe('remoteTipsSignature', () => {
  it('远程分支移动或增减即变化，与本地提交无关', () => {
    const before = remoteTipsSignature(commits)
    expect(remoteTipsSignature([commit(D), ...commits.slice(1)])).toBe(before)
    const moved = commits.map((c) =>
      c.hash === A
        ? { ...c, remotes: [] }
        : c.hash === D
          ? { ...c, remotes: [{ name: 'origin/main', remote: 'origin' }] }
          : c
    )
    expect(remoteTipsSignature(moved)).not.toBe(before)
    expect(remoteTipsSignature([commit(A)])).toBe('')
  })
})

describe('checkRunsInProgress', () => {
  const runs = (...states: CheckRunState[]): CheckRun[] =>
    states.map((state, i) => ({
      name: `job ${i}`,
      state,
      url: null,
      durationSec: null,
      runningSince: null
    }))

  it('汇总已是失败、但还有项目在跑时仍要重查（失败优先的汇总）', () => {
    expect(checkRunsInProgress('failure', runs('failure', 'pending'))).toBe(true)
  })

  it('汇总进行中但列表还没拉到时要重查', () => {
    expect(checkRunsInProgress('pending', null)).toBe(true)
  })

  it('全部结束即停，不算成败的不算没结束', () => {
    expect(checkRunsInProgress('failure', runs('failure', 'success', 'neutral'))).toBe(false)
    expect(checkRunsInProgress('success', runs('success'))).toBe(false)
    expect(checkRunsInProgress(undefined, null)).toBe(false)
  })
})

describe('pollDelay', () => {
  const MIN = 60_000

  it('5 分钟内 5 秒、15 分钟内 10 秒、30 分钟内 15 秒，再往后 30 秒（边界归下一挡）', () => {
    expect(pollDelay(0)).toBe(5_000)
    expect(pollDelay(5 * MIN - 1)).toBe(5_000)
    expect(pollDelay(5 * MIN)).toBe(10_000)
    expect(pollDelay(15 * MIN - 1)).toBe(10_000)
    expect(pollDelay(15 * MIN)).toBe(15_000)
    expect(pollDelay(30 * MIN - 1)).toBe(15_000)
    expect(pollDelay(30 * MIN)).toBe(30_000)
    expect(pollDelay(120 * MIN)).toBe(30_000)
  })
})

describe('checkRunsSignature', () => {
  const run = (patch: Partial<CheckRun> = {}): CheckRun => ({
    name: 'CI / build',
    state: 'pending',
    url: 'https://github.com/o/r/actions/runs/1/job/2',
    durationSec: null,
    runningSince: null,
    ...patch
  })

  it('开始运行、结束、出现或消失时变化', () => {
    const queued = checkRunsSignature([run()])
    expect(checkRunsSignature([run({ runningSince: 100 })])).not.toBe(queued)
    expect(checkRunsSignature([run({ state: 'success', durationSec: 5 })])).not.toBe(queued)
    expect(checkRunsSignature([run(), run({ name: 'CI / test' })])).not.toBe(queued)
    expect(checkRunsSignature([])).not.toBe(queued)
  })

  it('同样的结果签名相同，没拉到为空串', () => {
    expect(checkRunsSignature([run({ runningSince: 100 })])).toBe(
      checkRunsSignature([run({ runningSince: 100 })])
    )
    expect(checkRunsSignature(null)).toBe('')
  })
})
