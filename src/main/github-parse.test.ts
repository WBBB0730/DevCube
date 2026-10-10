import { describe, expect, it } from 'vitest'
import {
  buildRollupQuery,
  deviceFlowErrorMessage,
  isCommitHash,
  parseCheckRuns,
  parseGitHubRemote,
  parseRemoteList,
  parseRollupResponse,
  pickGitHubRepo,
  rollupState,
  type CheckContextNode
} from './github-parse'

const HASH_A = 'a'.repeat(40)
const HASH_B = 'b'.repeat(40)
const HASH_C = 'c'.repeat(40)

describe('parseGitHubRemote', () => {
  it('认 https 与 http，容许 .git、末尾斜杠与用户信息', () => {
    expect(parseGitHubRemote('https://github.com/owner/repo.git')).toEqual({
      owner: 'owner',
      name: 'repo'
    })
    expect(parseGitHubRemote('https://github.com/owner/repo')).toEqual({
      owner: 'owner',
      name: 'repo'
    })
    expect(parseGitHubRemote('https://github.com/owner/repo.git/')).toEqual({
      owner: 'owner',
      name: 'repo'
    })
    expect(parseGitHubRemote('http://user:pw@github.com/owner/repo')).toEqual({
      owner: 'owner',
      name: 'repo'
    })
    expect(parseGitHubRemote('  https://www.github.com/owner/my.repo.git  ')).toEqual({
      owner: 'owner',
      name: 'my.repo'
    })
  })

  it('认 scp 形式与 ssh / git 协议（含 443 端口的 ssh.github.com）', () => {
    expect(parseGitHubRemote('git@github.com:owner/repo.git')).toEqual({
      owner: 'owner',
      name: 'repo'
    })
    expect(parseGitHubRemote('org-123@github.com:owner/repo')).toEqual({
      owner: 'owner',
      name: 'repo'
    })
    expect(parseGitHubRemote('ssh://git@github.com/owner/repo.git')).toEqual({
      owner: 'owner',
      name: 'repo'
    })
    expect(parseGitHubRemote('ssh://git@ssh.github.com:443/owner/repo.git')).toEqual({
      owner: 'owner',
      name: 'repo'
    })
    expect(parseGitHubRemote('git://github.com/owner/repo.git')).toEqual({
      owner: 'owner',
      name: 'repo'
    })
    expect(parseGitHubRemote('git@GitHub.com:owner/repo.git')).toEqual({
      owner: 'owner',
      name: 'repo'
    })
  })

  it('不是 github.com 的仓库、路径层级不对、本地路径一律为 null', () => {
    expect(parseGitHubRemote('git@gitlab.com:owner/repo.git')).toBeNull()
    expect(parseGitHubRemote('https://ghe.example.com/owner/repo.git')).toBeNull()
    expect(parseGitHubRemote('git@github-work:owner/repo.git')).toBeNull()
    expect(parseGitHubRemote('https://github.com/owner')).toBeNull()
    expect(parseGitHubRemote('https://github.com/owner/repo/tree/main')).toBeNull()
    expect(parseGitHubRemote('/srv/git/repo.git')).toBeNull()
    expect(parseGitHubRemote('C:\\repos\\repo')).toBeNull()
    expect(parseGitHubRemote('')).toBeNull()
  })
})

describe('parseRemoteList / pickGitHubRepo', () => {
  it('只取获取地址', () => {
    const stdout = [
      'origin\tgit@github.com:me/fork.git (fetch)',
      'origin\tgit@github.com:me/fork.git (push)',
      'upstream\thttps://github.com/org/repo.git (fetch)',
      'upstream\thttps://github.com/org/repo.git (push)',
      ''
    ].join('\n')
    expect(parseRemoteList(stdout)).toEqual([
      { name: 'origin', url: 'git@github.com:me/fork.git' },
      { name: 'upstream', url: 'https://github.com/org/repo.git' }
    ])
  })

  it('origin 指向 GitHub 时优先，否则取第一个指向 GitHub 的远程', () => {
    expect(
      pickGitHubRepo([
        { name: 'upstream', url: 'https://github.com/org/repo.git' },
        { name: 'origin', url: 'git@github.com:me/fork.git' }
      ])
    ).toEqual({ owner: 'me', name: 'fork' })
    expect(
      pickGitHubRepo([
        { name: 'origin', url: 'git@gitlab.com:me/repo.git' },
        { name: 'mirror', url: 'https://github.com/org/repo.git' }
      ])
    ).toEqual({ owner: 'org', name: 'repo' })
    expect(pickGitHubRepo([{ name: 'origin', url: 'git@gitlab.com:me/repo.git' }])).toBeNull()
    expect(pickGitHubRepo([])).toBeNull()
  })
})

describe('isCommitHash / buildRollupQuery', () => {
  it('只放行 40 位小写十六进制', () => {
    expect(isCommitHash(HASH_A)).toBe(true)
    expect(isCommitHash('*')).toBe(false)
    expect(isCommitHash('A'.repeat(40))).toBe(false)
    expect(isCommitHash('a'.repeat(64))).toBe(false)
    expect(isCommitHash(`${'a'.repeat(39)}"`)).toBe(false)
  })

  it('每个提交一个按下标编号的别名', () => {
    const query = buildRollupQuery([HASH_A, HASH_B])
    expect(query).toContain(`c0: object(oid: "${HASH_A}")`)
    expect(query).toContain(`c1: object(oid: "${HASH_B}")`)
    expect(query).toContain('repository(owner: $owner, name: $name)')
  })
})

describe('rollupState / parseRollupResponse', () => {
  it('成功、失败（含出错）、进行中（含等待），不认识的按没有检查', () => {
    expect(rollupState('SUCCESS')).toBe('success')
    expect(rollupState('FAILURE')).toBe('failure')
    expect(rollupState('ERROR')).toBe('failure')
    expect(rollupState('PENDING')).toBe('pending')
    expect(rollupState('EXPECTED')).toBe('pending')
    expect(rollupState('SOMETHING_NEW')).toBe('none')
    expect(rollupState(undefined)).toBe('none')
  })

  it('GitHub 上没有的提交与没有检查的提交为 none；响应里缺的别名不进结果', () => {
    const states = parseRollupResponse(
      {
        c0: { statusCheckRollup: { state: 'SUCCESS' } },
        c1: { statusCheckRollup: null },
        c2: null
      },
      [HASH_A, HASH_B, HASH_C, 'd'.repeat(40)]
    )
    expect(states).toEqual({ [HASH_A]: 'success', [HASH_B]: 'none', [HASH_C]: 'none' })
  })
})

describe('parseCheckRuns', () => {
  const run = (
    patch: Partial<Extract<CheckContextNode, { __typename: 'CheckRun' }>>
  ): CheckContextNode =>
    ({
      __typename: 'CheckRun',
      name: 'build',
      status: 'COMPLETED',
      conclusion: 'SUCCESS',
      detailsUrl: 'https://github.com/o/r/actions/runs/1/job/2',
      permalink: 'https://github.com/o/r/runs/2',
      startedAt: '2026-10-09T08:00:00Z',
      completedAt: '2026-10-09T08:02:13Z',
      checkSuite: { workflowRun: { workflow: { name: 'CI' } } },
      ...patch
    }) as CheckContextNode

  it('Actions 作业带上工作流名并算出耗时', () => {
    expect(parseCheckRuns([run({})])).toEqual([
      {
        name: 'CI / build',
        state: 'success',
        url: 'https://github.com/o/r/actions/runs/1/job/2',
        durationSec: 133,
        runningSince: null
      }
    ])
  })

  it('没完成为进行中且无耗时；第三方检查无工作流名，无详情地址时退回 permalink', () => {
    expect(
      parseCheckRuns([
        run({ status: 'IN_PROGRESS', conclusion: null, completedAt: null }),
        run({ checkSuite: { workflowRun: null }, name: 'Vercel', detailsUrl: null })
      ])
    ).toEqual([
      {
        name: 'CI / build',
        state: 'pending',
        url: 'https://github.com/o/r/actions/runs/1/job/2',
        durationSec: null,
        runningSince: Date.parse('2026-10-09T08:00:00Z') / 1000
      },
      {
        name: 'Vercel',
        state: 'success',
        url: 'https://github.com/o/r/runs/2',
        durationSec: 133,
        runningSince: null
      }
    ])
  })

  it('只有正在运行的带开始时间：排队中的不算，开始时间缺失或解析不了也没有', () => {
    const since = (patch: Parameters<typeof run>[0]): number | null =>
      parseCheckRuns([run({ conclusion: null, completedAt: null, ...patch })])[0].runningSince
    expect(since({ status: 'QUEUED' })).toBeNull()
    expect(since({ status: 'WAITING' })).toBeNull()
    expect(since({ status: 'IN_PROGRESS', startedAt: null })).toBeNull()
    expect(since({ status: 'IN_PROGRESS', startedAt: 'not a date' })).toBeNull()
    expect(since({ status: 'IN_PROGRESS', startedAt: '2026-10-09T08:00:00.900Z' })).toBe(
      Date.parse('2026-10-09T08:00:00Z') / 1000
    )
  })

  it('结论分成功、失败、不算成败三类', () => {
    const states = [
      'FAILURE',
      'TIMED_OUT',
      'STARTUP_FAILURE',
      'ACTION_REQUIRED',
      'CANCELLED',
      'SKIPPED',
      'NEUTRAL',
      'STALE'
    ].map((conclusion) => parseCheckRuns([run({ conclusion })])[0].state)
    expect(states).toEqual([
      'failure',
      'failure',
      'failure',
      'failure',
      'neutral',
      'neutral',
      'neutral',
      'neutral'
    ])
  })

  it('提交状态按状态值映射，没有耗时与开始时间', () => {
    expect(
      parseCheckRuns([
        {
          __typename: 'StatusContext',
          context: 'ci/jenkins',
          state: 'ERROR',
          targetUrl: 'https://ci.example.com/1'
        },
        { __typename: 'StatusContext', context: 'deploy', state: 'PENDING', targetUrl: null }
      ])
    ).toEqual([
      {
        name: 'ci/jenkins',
        state: 'failure',
        url: 'https://ci.example.com/1',
        durationSec: null,
        runningSince: null
      },
      { name: 'deploy', state: 'pending', url: null, durationSec: null, runningSince: null }
    ])
  })
})

describe('deviceFlowErrorMessage', () => {
  it('拒绝授权与代码过期给出说明，其余交给调用方', () => {
    expect(deviceFlowErrorMessage('access_denied')).toBe('已在 GitHub 上拒绝授权')
    expect(deviceFlowErrorMessage('expired_token')).toBe('代码已过期，请重新登录')
    expect(deviceFlowErrorMessage('unsupported_grant_type')).toBeNull()
    expect(deviceFlowErrorMessage(undefined)).toBeNull()
  })
})
