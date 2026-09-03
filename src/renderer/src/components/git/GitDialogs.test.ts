// GitDialogs 纯函数层测试：ref 名校验（照参考 REF_INVALID_REGEX）、中文列表串、
// 最近标签提取、push remote 与 pull 表单（remote / 远程分支 / 整合方式）默认值求值链、
// 提交面板危险确认的 buildSpec 描述。
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GIT_VIEW_PREFS,
  type GitAction,
  type GitActionResult,
  type GitCommit,
  type GitRepoConfig,
  type GitViewPrefs,
  type GitWorktree
} from '@shared/git'
import {
  buildSpec,
  defaultPullBranch,
  defaultPullMode,
  defaultPullRemote,
  defaultPushRemote,
  formatCommaList,
  isRefInvalid,
  latestTagNames,
  remoteBranchesOf,
  type DialogEnv,
  type DialogSpec
} from './GitDialogs'

describe('isRefInvalid', () => {
  it('常规分支名与带斜杠的层级名合法', () => {
    expect(isRefInvalid('main')).toBe(false)
    expect(isRefInvalid('feature/some-thing_2')).toBe(false)
    expect(isRefInvalid('v1.2.3')).toBe(false)
  })

  it('以 - 或 / 开头、以 . 或 / 结尾、以 .lock 结尾均非法', () => {
    expect(isRefInvalid('-lead')).toBe(true)
    expect(isRefInvalid('/lead')).toBe(true)
    expect(isRefInvalid('tail.')).toBe(true)
    expect(isRefInvalid('tail/')).toBe(true)
    expect(isRefInvalid('name.lock')).toBe(true)
  })

  it('含空格、通配、控制性符号（\\ " > < ~ ^ : ? * [）非法', () => {
    for (const ch of ['\\', '"', ' ', '>', '<', '~', '^', ':', '?', '*', '[']) {
      expect(isRefInvalid(`a${ch}b`)).toBe(true)
    }
  })

  it('含 .. // /. @{ 与整体为 @ 非法', () => {
    expect(isRefInvalid('a..b')).toBe(true)
    expect(isRefInvalid('a//b')).toBe(true)
    expect(isRefInvalid('a/.b')).toBe(true)
    expect(isRefInvalid('a@{b')).toBe(true)
    expect(isRefInvalid('@')).toBe(true)
  })

  it('连续调用无状态残留（正则不带 g 标志）', () => {
    expect(isRefInvalid('a b')).toBe(true)
    expect(isRefInvalid('a b')).toBe(true)
  })
})

describe('formatCommaList', () => {
  it('零项空串、单项原样、两项用「和」、多项顿号加「和」', () => {
    expect(formatCommaList([])).toBe('')
    expect(formatCommaList(['a'])).toBe('a')
    expect(formatCommaList(['a', 'b'])).toBe('a 和 b')
    expect(formatCommaList(['a', 'b', 'c'])).toBe('a、b 和 c')
  })
})

function commitWithTags(hash: string, date: number, tags: string[]): GitCommit {
  return {
    hash,
    parents: [],
    author: '',
    email: '',
    date,
    message: '',
    heads: [],
    tags: tags.map((name) => ({ name, annotated: true })),
    remotes: [],
    stash: null
  }
}

describe('latestTagNames', () => {
  it('取日期最大且带标签的提交的全部标签名', () => {
    const commits = [
      commitWithTags('a', 300, []),
      commitWithTags('b', 200, ['v2.0', 'stable']),
      commitWithTags('c', 100, ['v1.0'])
    ]
    expect(latestTagNames(commits)).toEqual(['v2.0', 'stable'])
  })

  it('没有任何带标签的提交时返回空列表', () => {
    expect(latestTagNames([commitWithTags('a', 300, [])])).toEqual([])
  })
})

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
  const prefs = (mode: GitViewPrefs['pullIntegrationMode']): GitViewPrefs => ({
    ...DEFAULT_GIT_VIEW_PREFS,
    pullIntegrationMode: mode
  })

  it('viewPrefs 记忆值优先于仓库 git 配置', () => {
    const c = config({ pullRebase: 'true' })
    expect(defaultPullMode(prefs('squash'), 'dev', c)).toBe('squash')
  })

  it('branch.<name>.rebase 的 true/interactive/merges 解释为变基', () => {
    for (const raw of ['true', 'interactive', 'merges']) {
      const c = config({ branches: { dev: branchCfg({ rebase: raw }) } })
      expect(defaultPullMode(prefs(null), 'dev', c)).toBe('rebase')
    }
  })

  it('branch 级 false 覆盖 pull.rebase=true（对齐 git 的覆盖顺序）', () => {
    const c = config({
      branches: { dev: branchCfg({ rebase: 'false' }) },
      pullRebase: 'true'
    })
    expect(defaultPullMode(prefs(null), 'dev', c)).toBe('merge')
    expect(defaultPullMode(prefs(null), 'other', c)).toBe('rebase')
  })

  it('无记忆且无任何配置（或 config 未加载）时回退合并', () => {
    expect(defaultPullMode(prefs(null), 'dev', config({}))).toBe('merge')
    expect(defaultPullMode(prefs(null), null, null)).toBe('merge')
  })
})

/** 记录式对话框环境：动作出口只往数组里记（构造输入 → 断言输出，零 mock）。 */
function makeEnv(
  opts: {
    projectState?: DialogEnv['projectState']
    /** 定制动作结果（默认全部 ok）：测「需要强制」等分叉 */
    runResult?: (action: GitAction) => GitActionResult
  } = {}
): {
  env: DialogEnv
  quiet: GitAction[]
  ran: GitAction[]
  closed: () => number
  opened: string[]
  removed: string[]
  chased: DialogSpec[]
} {
  const quiet: GitAction[] = []
  const ran: GitAction[] = []
  const opened: string[] = []
  const removed: string[] = []
  const chased: DialogSpec[] = []
  let closedCount = 0
  const env: DialogEnv = {
    projectPath: '/repo',
    commits: [],
    branches: [],
    remoteBranches: [],
    tags: [],
    remotes: [],
    currentBranch: null,
    config: null,
    settings: null,
    viewPrefs: DEFAULT_GIT_VIEW_PREFS,
    opInProgress: null,
    worktrees: [],
    closeDialog: () => {
      closedCount++
    },
    runAction: async (action) => {
      ran.push(action)
      return opts.runResult?.(action) ?? { status: 'ok' }
    },
    runQuietAction: async (action) => {
      quiet.push(action)
      return { status: 'ok' }
    },
    clearActionErrors: () => {},
    openChase: (spec) => {
      chased.push(spec)
    },
    setViewPrefs: () => {},
    openProject: (path) => {
      opened.push(path)
    },
    projectState: opts.projectState ?? (() => null),
    removeProject: (path) => {
      removed.push(path)
    }
  }
  return { env, quiet, ran, closed: () => closedCount, opened, removed, chased }
}

describe('buildSpec：提交面板的危险确认', () => {
  it('discard-file：无输入项，主按钮「是，撤销更改」先关对话框再静默执行', () => {
    const { env, quiet, closed } = makeEnv()
    const spec = buildSpec({ kind: 'discard-file', paths: ['src/a.ts'] }, env)
    expect(spec).not.toBeNull()
    expect(spec!.inputs).toEqual([])
    expect(spec!.buttons.map((b) => b.label)).toEqual(['是，撤销更改'])
    spec!.buttons[0].onClick({})
    expect(closed()).toBe(1)
    expect(quiet).toEqual([{ kind: 'discard-file', paths: ['src/a.ts'] }])
  })

  it('discard-file：多文件时主动作把整组路径静默传下', () => {
    const { env, quiet } = makeEnv()
    const spec = buildSpec({ kind: 'discard-file', paths: ['a.ts', 'b.ts'] }, env)
    spec!.buttons[0].onClick({})
    expect(quiet).toEqual([{ kind: 'discard-file', paths: ['a.ts', 'b.ts'] }])
  })

  it('delete-untracked-file：无输入项，主按钮「是，删除」先关对话框再静默执行', () => {
    const { env, quiet, closed } = makeEnv()
    const spec = buildSpec({ kind: 'delete-untracked-file', paths: ['tmp/n.log'] }, env)
    expect(spec).not.toBeNull()
    expect(spec!.inputs).toEqual([])
    expect(spec!.buttons.map((b) => b.label)).toEqual(['是，删除'])
    spec!.buttons[0].onClick({})
    expect(closed()).toBe(1)
    expect(quiet).toEqual([{ kind: 'delete-untracked-file', paths: ['tmp/n.log'] }])
  })

  it('delete-untracked-file：多文件时主动作把整组路径静默传下', () => {
    const { env, quiet } = makeEnv()
    const spec = buildSpec({ kind: 'delete-untracked-file', paths: ['x.log', 'y.log'] }, env)
    spec!.buttons[0].onClick({})
    expect(quiet).toEqual([{ kind: 'delete-untracked-file', paths: ['x.log', 'y.log'] }])
  })
})

describe('buildSpec：op-abort 中止确认（操作进行中状态条）', () => {
  it('中止变基：无输入项，单按钮「是，中止」先关对话框再执行 op-abort', () => {
    const { env, ran, closed } = makeEnv()
    const spec = buildSpec({ kind: 'op-abort', op: 'rebase' }, env)
    expect(spec).not.toBeNull()
    expect(spec!.inputs).toEqual([])
    expect(spec!.buttons.map((b) => b.label)).toEqual(['是，中止'])
    spec!.buttons[0].onClick({})
    expect(closed()).toBe(1)
    expect(ran).toEqual([{ kind: 'op-abort', op: 'rebase' }])
  })

  it('中止合并 / 拣选 / 回滚：动作携带对应操作类型', () => {
    for (const op of ['merge', 'cherry-pick', 'revert'] as const) {
      const { env, ran } = makeEnv()
      const spec = buildSpec({ kind: 'op-abort', op }, env)
      spec!.buttons[0].onClick({})
      expect(ran).toEqual([{ kind: 'op-abort', op }])
    }
  })
})

describe('buildSpec：分支已在其他工作树检出', () => {
  it('branch-in-worktree：无输入项，主按钮「前往该项目」先关对话框再前往，不发任何 git 动作', () => {
    const { env, quiet, ran, closed, opened } = makeEnv()
    const worktree: GitWorktree = {
      path: '/code/worktrees/app/feat-x',
      head: '2222',
      branch: 'feat/x',
      isMain: false,
      bare: false,
      prunable: false,
      isCurrent: false
    }
    const spec = buildSpec({ kind: 'branch-in-worktree', branch: 'feat/x', worktree }, env)
    expect(spec).not.toBeNull()
    expect(spec!.inputs).toEqual([])
    expect(spec!.buttons.map((b) => b.label)).toEqual(['前往该项目'])
    spec!.buttons[0].onClick({})
    expect(closed()).toBe(1)
    expect(opened).toEqual(['/code/worktrees/app/feat-x'])
    expect(ran).toEqual([])
    expect(quiet).toEqual([])
  })
})

describe('buildSpec：工作树删除与清理', () => {
  const wt: GitWorktree = {
    path: '/wt/feat',
    head: '1',
    branch: 'feat',
    isMain: false,
    bare: false,
    prunable: false,
    isCurrent: false
  }
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

  it('worktree-remove：未登记为项目 → 先关框再删，成功后不动项目', async () => {
    const { env, ran, closed, removed } = makeEnv()
    const spec = buildSpec({ kind: 'worktree-remove', worktree: wt }, env)
    expect(spec!.buttons.map((b) => b.label)).toEqual(['是，删除'])
    spec!.buttons[0].onClick({})
    await flush()
    expect(closed()).toBe(1)
    expect(ran).toEqual([{ kind: 'worktree-remove', path: '/wt/feat', force: false }])
    expect(removed).toEqual([])
  })

  it('worktree-remove：已登记且空闲 → 主进程要求强制时追问并带 force 重发，成功后移除项目', async () => {
    const { env, ran, removed, chased } = makeEnv({
      projectState: () => 'idle',
      runResult: (a) =>
        a.kind === 'worktree-remove' && !a.force
          ? { status: 'worktree-remove-needs-force' }
          : { status: 'ok' }
    })
    const spec = buildSpec({ kind: 'worktree-remove', worktree: wt }, env)
    spec!.buttons[0].onClick({})
    await flush()
    expect(removed).toEqual([])
    expect(chased).toHaveLength(1)
    expect(chased[0].buttons.map((b) => b.label)).toEqual(['强制删除'])
    chased[0].buttons[0].onClick({})
    await flush()
    expect(ran).toEqual([
      { kind: 'worktree-remove', path: '/wt/feat', force: false },
      { kind: 'worktree-remove', path: '/wt/feat', force: true }
    ])
    expect(removed).toEqual(['/wt/feat'])
  })

  it('worktree-remove：已登记且有运行中会话 → 只提示，不给删除按钮', () => {
    const { env, ran } = makeEnv({ projectState: () => 'busy' })
    const spec = buildSpec({ kind: 'worktree-remove', worktree: wt }, env)
    expect(spec!.messageOnly).toBe(true)
    expect(spec!.buttons).toEqual([])
    expect(ran).toEqual([])
  })

  it('worktree-prune：确认后先关框再执行；worktree-add 交组件层渲染（spec 为 null）', () => {
    const { env, ran, closed } = makeEnv()
    const spec = buildSpec({ kind: 'worktree-prune' }, env)
    expect(spec!.buttons.map((b) => b.label)).toEqual(['是，清理'])
    spec!.buttons[0].onClick({})
    expect(closed()).toBe(1)
    expect(ran).toEqual([{ kind: 'worktree-prune' }])
    expect(
      buildSpec(
        {
          kind: 'worktree-add',
          start: { ref: 'HEAD', label: 'main' },
          checkout: 'new-branch',
          branch: null
        },
        env
      )
    ).toBeNull()
  })
})
