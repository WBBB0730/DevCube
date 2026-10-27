// git-pull-push 纯函数测试：push remote 与 pull 表单（remote / 远程分支 / 整合方式）默认值求值链、
// 点法与开关的组合、直接拉取 / 推送的动作（= 对话框默认值，拿不准为 null）。
import { describe, expect, it } from 'vitest'
import { DEFAULT_GIT_REPO_SETTINGS, type GitRepoConfig } from '@shared/git'
import {
  defaultPullBranch,
  defaultPullMode,
  defaultPullRemote,
  defaultPushRemote,
  directPullAction,
  directPushAction,
  prefersDirect,
  remoteBranchesOf,
  type DirectActionState
} from './git-pull-push'

function config(partial: Partial<GitRepoConfig>): GitRepoConfig {
  return {
    branches: {},
    pushDefault: null,
    pullRebase: null,
    remotes: [],
    user: { name: { local: null, global: null }, email: { local: null, global: null } },
    ...partial
  }
}

/** 分支配置条目：未给的子键补 null。 */
function branchCfg(
  partial: Partial<GitRepoConfig['branches'][string]>
): GitRepoConfig['branches'][string] {
  return { remote: null, pushRemote: null, merge: null, rebase: null, ...partial }
}

describe('defaultPushRemote', () => {
  const remotes = ['up', 'origin', 'fork']

  it('branch 的 pushRemote 优先于其余所有来源', () => {
    const c = config({
      branches: { dev: branchCfg({ remote: 'fork', pushRemote: 'up' }) },
      pushDefault: 'fork'
    })
    expect(defaultPushRemote('dev', remotes, c)).toBe('up')
  })

  it('无 pushRemote 时回退 branch 的 remote，再回退 push.default', () => {
    expect(
      defaultPushRemote(
        'dev',
        remotes,
        config({ branches: { dev: branchCfg({ remote: 'fork' }) } })
      )
    ).toBe('fork')
    expect(defaultPushRemote('dev', remotes, config({ pushDefault: 'up' }))).toBe('up')
  })

  it('config 未加载（null）时回退 origin，无 origin 则取第一个 remote', () => {
    expect(defaultPushRemote('dev', remotes, null)).toBe('origin')
    expect(defaultPushRemote('dev', ['up', 'fork'], null)).toBe('up')
  })

  it('配置指向的 remote 已不存在时跳过该级回退', () => {
    const c = config({ branches: { dev: branchCfg({ remote: 'gone', pushRemote: 'gone2' }) } })
    expect(defaultPushRemote('dev', remotes, c)).toBe('origin')
  })

  it('remote 列表为空时返回空串', () => {
    expect(defaultPushRemote('dev', [], null)).toBe('')
  })
})

describe('defaultPullRemote', () => {
  const remotes = ['up', 'origin', 'fork']

  it('取当前分支上游 remote（branch.<name>.remote 且仍在 remotes 中）', () => {
    const c = config({ branches: { dev: branchCfg({ remote: 'fork' }) } })
    expect(defaultPullRemote('dev', remotes, c)).toBe('fork')
  })

  it('无上游配置 / 上游 remote 已删除 / config 未加载时都取第一个 remote', () => {
    expect(defaultPullRemote('dev', remotes, config({}))).toBe('up')
    expect(
      defaultPullRemote(
        'dev',
        remotes,
        config({ branches: { dev: branchCfg({ remote: 'gone' }) } })
      )
    ).toBe('up')
    expect(defaultPullRemote(null, remotes, null)).toBe('up')
  })

  it('remote 列表为空时返回空串', () => {
    expect(defaultPullRemote('dev', [], null)).toBe('')
  })
})

describe('remoteBranchesOf', () => {
  it('只取该 remote 的远程分支并剥掉 remotes/<remote>/ 前缀', () => {
    const branches = ['main', 'remotes/origin/main', 'remotes/origin/dev', 'remotes/fork/main']
    expect(remoteBranchesOf(branches, 'origin')).toEqual(['main', 'dev'])
    expect(remoteBranchesOf(branches, 'up')).toEqual([])
  })

  it('剔除 HEAD 符号引用伪条目（clone 仓库都带 remotes/<remote>/HEAD，它不是分支）', () => {
    const branches = ['remotes/origin/HEAD', 'remotes/origin/main', 'remotes/origin/feature/HEAD']
    // 子目录里叫 HEAD 的真分支（feature/HEAD）不受影响
    expect(remoteBranchesOf(branches, 'origin')).toEqual(['main', 'feature/HEAD'])
  })
})

describe('defaultPullBranch', () => {
  const options = ['main', 'dev', 'renamed']

  it('上游分支（branch.<name>.merge 的 refs/heads/X → X）在选项中时优先于同名', () => {
    const c = config({ branches: { dev: branchCfg({ merge: 'refs/heads/renamed' }) } })
    expect(defaultPullBranch('dev', options, c)).toBe('renamed')
  })

  it('无上游配置或上游不在选项中时回退与当前分支同名者', () => {
    expect(defaultPullBranch('dev', options, null)).toBe('dev')
    const c = config({ branches: { dev: branchCfg({ merge: 'refs/heads/gone' }) } })
    expect(defaultPullBranch('dev', options, c)).toBe('dev')
  })

  it('都不在选项中（或 detached HEAD）时返回空串（确认按钮禁用兜底）', () => {
    expect(defaultPullBranch('feature', options, null)).toBe('')
    expect(defaultPullBranch(null, options, null)).toBe('')
  })
})

describe('defaultPullMode', () => {
  it('本项目的记忆值优先于仓库 git 配置', () => {
    const c = config({ pullRebase: 'true' })
    expect(defaultPullMode('squash', 'dev', c)).toBe('squash')
  })

  it('branch.<name>.rebase 的 true/interactive/merges 解释为变基', () => {
    for (const raw of ['true', 'interactive', 'merges']) {
      const c = config({ branches: { dev: branchCfg({ rebase: raw }) } })
      expect(defaultPullMode(null, 'dev', c)).toBe('rebase')
    }
  })

  it('branch 级 false 覆盖 pull.rebase=true（对齐 git 的覆盖顺序）', () => {
    const c = config({
      branches: { dev: branchCfg({ rebase: 'false' }) },
      pullRebase: 'true'
    })
    expect(defaultPullMode(null, 'dev', c)).toBe('merge')
    expect(defaultPullMode(null, 'other', c)).toBe('rebase')
  })

  it('无记忆且无任何配置（或 config 未加载）时回退合并', () => {
    expect(defaultPullMode(null, 'dev', config({}))).toBe('merge')
    expect(defaultPullMode(null, null, null)).toBe('merge')
  })
})

describe('prefersDirect', () => {
  it('单击照开关，按住修饰键反过来，一律打开对话框时不直接执行', () => {
    expect(prefersDirect(true, 'follow')).toBe(true)
    expect(prefersDirect(false, 'follow')).toBe(false)
    expect(prefersDirect(true, 'invert')).toBe(false)
    expect(prefersDirect(false, 'invert')).toBe(true)
    expect(prefersDirect(true, 'dialog')).toBe(false)
    expect(prefersDirect(false, 'dialog')).toBe(false)
  })
})

describe('directPullAction / directPushAction', () => {
  const remotes = ['origin', 'fork']
  const remoteBranches = ['remotes/origin/HEAD', 'remotes/origin/dev', 'remotes/fork/dev']
  /** dev 跟踪 origin/dev 的标准快照；over 覆盖个别字段 */
  const state = (over: Partial<DirectActionState> = {}): DirectActionState => ({
    currentBranch: 'dev',
    remotes,
    remoteBranches,
    config: config({
      branches: { dev: branchCfg({ remote: 'origin', merge: 'refs/heads/dev' }) }
    }),
    settings: DEFAULT_GIT_REPO_SETTINGS,
    ...over
  })

  it('有上游时直接拉取 = 对话框默认值：上游 remote 与分支、不创建新的合并提交', () => {
    expect(directPullAction(state())).toEqual({
      kind: 'pull-branch',
      remote: 'origin',
      branch: 'dev',
      mode: 'merge',
      noFastForward: false
    })
  })

  it('直接拉取的整合方式取本项目记忆值，其次仓库 git 配置', () => {
    const remembered = { ...DEFAULT_GIT_REPO_SETTINGS, pullIntegrationMode: 'squash' as const }
    expect(directPullAction(state({ settings: remembered }))?.mode).toBe('squash')
    const c = config({
      branches: { dev: branchCfg({ remote: 'origin', merge: 'refs/heads/dev' }) },
      pullRebase: 'true'
    })
    expect(directPullAction(state({ config: c }))?.mode).toBe('rebase')
  })

  it('上游与本地同名且在默认推送 remote 上时直接推送 = 对话框默认值', () => {
    expect(directPushAction(state())).toEqual({
      kind: 'push-branch',
      remote: 'origin',
      localBranch: 'dev',
      targetBranch: 'dev',
      setUpstream: true,
      pushTags: false,
      mode: 'normal'
    })
  })

  it('拿不准时都为 null：detached HEAD、config 未加载、无上游、上游远程或远程分支已不在', () => {
    const cases = [
      state({ currentBranch: null }),
      state({ config: null }),
      state({ config: config({}) }),
      state({ remotes: ['fork'] }),
      state({ remoteBranches: ['remotes/fork/dev'] })
    ]
    for (const st of cases) {
      expect(directPullAction(st)).toBeNull()
      expect(directPushAction(st)).toBeNull()
    }
  })

  it('上游与本地不同名、或默认推送 remote 不是上游 remote 时只能直接拉取，推送为 null', () => {
    const renamed = config({
      branches: { dev: branchCfg({ remote: 'origin', merge: 'refs/heads/main' }) }
    })
    const st = state({ config: renamed, remoteBranches: ['remotes/origin/main'] })
    expect(directPullAction(st)?.branch).toBe('main')
    expect(directPushAction(st)).toBeNull()

    const triangular = config({
      branches: {
        dev: branchCfg({ remote: 'origin', pushRemote: 'fork', merge: 'refs/heads/dev' })
      }
    })
    expect(directPullAction(state({ config: triangular }))?.remote).toBe('origin')
    expect(directPushAction(state({ config: triangular }))).toBeNull()
  })
})
