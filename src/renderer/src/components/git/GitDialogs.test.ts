// GitDialogs 纯函数层测试：ref 名校验（照参考 REF_INVALID_REGEX）、中文列表串、
// 最近标签提取、危险确认与重名确认的 buildSpec 描述（拉取 / 推送默认值见 git-pull-push.test.ts）。
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GIT_VIEW_PREFS,
  type GitAction,
  type GitActionResult,
  type GitCommit,
  type GitWorktree
} from '@shared/git'
import {
  buildSpec,
  formatCommaList,
  isRefInvalid,
  latestTagNames,
  type DialogConfirm,
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
    updateSettings: () => {},
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

/** 不该叠确认的按钮：真弹了即失败 */
const noConfirm = (): void => {
  throw new Error('不应弹出确认')
}
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('buildSpec：提交面板的危险确认', () => {
  it('discard-file：无输入项，主按钮「撤销」先关对话框再静默执行', () => {
    const { env, quiet, closed } = makeEnv()
    const spec = buildSpec({ kind: 'discard-file', paths: ['src/a.ts'] }, env)
    expect(spec).not.toBeNull()
    expect(spec!.inputs).toEqual([])
    expect(spec!.buttons.map((b) => b.label)).toEqual(['撤销'])
    spec!.buttons[0].onClick({}, noConfirm)
    expect(closed()).toBe(1)
    expect(quiet).toEqual([{ kind: 'discard-file', paths: ['src/a.ts'] }])
  })

  it('discard-file：多文件时主动作把整组路径静默传下', () => {
    const { env, quiet } = makeEnv()
    const spec = buildSpec({ kind: 'discard-file', paths: ['a.ts', 'b.ts'] }, env)
    spec!.buttons[0].onClick({}, noConfirm)
    expect(quiet).toEqual([{ kind: 'discard-file', paths: ['a.ts', 'b.ts'] }])
  })

  it('delete-untracked-file：无输入项，主按钮「删除」先关对话框再静默执行', () => {
    const { env, quiet, closed } = makeEnv()
    const spec = buildSpec({ kind: 'delete-untracked-file', paths: ['tmp/n.log'] }, env)
    expect(spec).not.toBeNull()
    expect(spec!.inputs).toEqual([])
    expect(spec!.buttons.map((b) => b.label)).toEqual(['删除'])
    spec!.buttons[0].onClick({}, noConfirm)
    expect(closed()).toBe(1)
    expect(quiet).toEqual([{ kind: 'delete-untracked-file', paths: ['tmp/n.log'] }])
  })

  it('delete-untracked-file：多文件时主动作把整组路径静默传下', () => {
    const { env, quiet } = makeEnv()
    const spec = buildSpec({ kind: 'delete-untracked-file', paths: ['x.log', 'y.log'] }, env)
    spec!.buttons[0].onClick({}, noConfirm)
    expect(quiet).toEqual([{ kind: 'delete-untracked-file', paths: ['x.log', 'y.log'] }])
  })
})

describe('buildSpec：op-abort 中止确认（操作进行中状态条）', () => {
  it('中止变基：无输入项，单按钮「中止」先关对话框再执行 op-abort', () => {
    const { env, ran, closed } = makeEnv()
    const spec = buildSpec({ kind: 'op-abort', op: 'rebase' }, env)
    expect(spec).not.toBeNull()
    expect(spec!.inputs).toEqual([])
    expect(spec!.buttons.map((b) => b.label)).toEqual(['中止'])
    spec!.buttons[0].onClick({}, noConfirm)
    expect(closed()).toBe(1)
    expect(ran).toEqual([{ kind: 'op-abort', op: 'rebase' }])
  })

  it('中止合并 / 拣选 / 回滚：动作携带对应操作类型', () => {
    for (const op of ['merge', 'cherry-pick', 'revert'] as const) {
      const { env, ran } = makeEnv()
      const spec = buildSpec({ kind: 'op-abort', op }, env)
      spec!.buttons[0].onClick({}, noConfirm)
      expect(ran).toEqual([{ kind: 'op-abort', op }])
    }
  })
})

describe('buildSpec：分支已在其他工作树检出', () => {
  it('branch-in-worktree：无输入项，主按钮「转到项目」先关对话框再转到，不发任何 git 动作', () => {
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
    expect(spec!.buttons.map((b) => b.label)).toEqual(['转到项目'])
    spec!.buttons[0].onClick({}, noConfirm)
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

  it('worktree-remove：未登记为项目 → 先关框再删，成功后不动项目', async () => {
    const { env, ran, closed, removed } = makeEnv()
    const spec = buildSpec({ kind: 'worktree-remove', worktree: wt }, env)
    expect(spec!.buttons.map((b) => b.label)).toEqual(['删除'])
    spec!.buttons[0].onClick({}, noConfirm)
    await flush()
    expect(closed()).toBe(1)
    expect(ran).toEqual([{ kind: 'worktree-remove', path: '/wt/feat', force: false }])
    expect(removed).toEqual([])
  })

  it('worktree-remove：已登记且空闲 → 主进程要求强制时追问并带 force 重发，成功后移除项目', async () => {
    const { env, ran, closed, removed, chased } = makeEnv({
      projectState: () => 'idle',
      runResult: (a) =>
        a.kind === 'worktree-remove' && !a.force
          ? { status: 'worktree-remove-needs-force' }
          : { status: 'ok' }
    })
    const spec = buildSpec({ kind: 'worktree-remove', worktree: wt }, env)
    spec!.buttons[0].onClick({}, noConfirm)
    await flush()
    expect(removed).toEqual([])
    expect(chased).toHaveLength(1)
    expect(chased[0].buttons.map((b) => b.label)).toEqual(['强制删除'])
    chased[0].buttons[0].onClick({}, noConfirm)
    await flush()
    expect(closed()).toBe(2)
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
    expect(spec!.buttons.map((b) => b.label)).toEqual(['清理'])
    spec!.buttons[0].onClick({}, noConfirm)
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

describe('buildSpec：重名时叠在表单上确认', () => {
  it('create-branch：重名先确认替换，确认后带 force 创建；不重名直接创建', () => {
    const { env, ran, closed } = makeEnv()
    const spec = buildSpec(
      { kind: 'create-branch', hash: 'abcdef1234' },
      { ...env, branches: ['dev'] }
    )
    expect(spec!.buttons.map((b) => b.label)).toEqual(['创建'])
    const confirms: DialogConfirm[] = []
    spec!.buttons[0].onClick({ name: 'dev', checkout: false }, (c) => confirms.push(c))
    expect(closed()).toBe(0)
    expect(ran).toEqual([])
    expect(confirms).toHaveLength(1)
    expect(confirms[0]).toMatchObject({ title: '替换分支 “dev”？', label: '替换' })
    confirms[0].onConfirm()
    expect(closed()).toBe(1)
    expect(ran).toEqual([
      { kind: 'create-branch', hash: 'abcdef1234', name: 'dev', checkout: false, force: true }
    ])
    spec!.buttons[0].onClick({ name: 'feat', checkout: true }, noConfirm)
    expect(ran[1]).toEqual({
      kind: 'create-branch',
      hash: 'abcdef1234',
      name: 'feat',
      checkout: true,
      force: false
    })
  })

  it('add-tag：重名先确认替换，确认后带 force 添加', () => {
    const { env, ran, closed } = makeEnv()
    const spec = buildSpec({ kind: 'add-tag', hash: 'abcdef1234' }, { ...env, tags: ['v1'] })
    expect(spec!.buttons.map((b) => b.label)).toEqual(['添加'])
    const confirms: DialogConfirm[] = []
    spec!.buttons[0].onClick({ name: 'v1', type: 'lightweight', message: '' }, (c) =>
      confirms.push(c)
    )
    expect(closed()).toBe(0)
    expect(ran).toEqual([])
    expect(confirms[0]).toMatchObject({ title: '替换标签 “v1”？', label: '替换' })
    confirms[0].onConfirm()
    expect(closed()).toBe(1)
    expect(ran).toEqual([expect.objectContaining({ kind: 'add-tag', name: 'v1', force: true })])
  })

  it('checkout-remote-branch：本地已有同名分支时确认改为检出现有分支，成功后随即拉取', async () => {
    const { env, ran, closed } = makeEnv()
    const spec = buildSpec(
      { kind: 'checkout-remote-branch', remoteRef: 'origin/dev', remote: 'origin' },
      { ...env, branches: ['dev'] }
    )
    expect(spec!.buttons.map((b) => b.label)).toEqual(['检出'])
    const confirms: DialogConfirm[] = []
    spec!.buttons[0].onClick({ name: 'dev' }, (c) => confirms.push(c))
    expect(closed()).toBe(0)
    expect(confirms[0]).toMatchObject({
      title: '检出现有分支 “dev”？',
      message: '本地已有同名分支，检出后会从 “origin/dev” 拉取更改。',
      label: '检出'
    })
    confirms[0].onConfirm()
    await flush()
    expect(closed()).toBe(1)
    expect(ran).toEqual([
      { kind: 'checkout-branch', branch: 'dev', remoteBranch: null },
      { kind: 'pull-branch', remote: 'origin', branch: 'dev', mode: 'merge', noFastForward: false }
    ])
  })
})
