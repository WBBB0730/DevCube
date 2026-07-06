// GitDialogs 纯函数层测试：ref 名校验（照参考 REF_INVALID_REGEX）、中文列表串、
// 最近标签提取、push remote 默认值求值链、提交面板危险确认的 buildSpec 描述。
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GIT_VIEW_PREFS,
  type GitAction,
  type GitCommit,
  type GitRepoConfig
} from '@shared/git'
import {
  buildSpec,
  defaultPushRemote,
  formatCommaList,
  isRefInvalid,
  latestTagNames,
  type DialogEnv
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
    remotes: [],
    user: { name: { local: null, global: null }, email: { local: null, global: null } },
    ...partial
  }
}

describe('defaultPushRemote', () => {
  const remotes = ['up', 'origin', 'fork']

  it('branch 的 pushRemote 优先于其余所有来源', () => {
    const c = config({
      branches: { dev: { remote: 'fork', pushRemote: 'up' } },
      pushDefault: 'fork'
    })
    expect(defaultPushRemote('dev', remotes, c)).toBe('up')
  })

  it('无 pushRemote 时回退 branch 的 remote，再回退 push.default', () => {
    expect(
      defaultPushRemote(
        'dev',
        remotes,
        config({ branches: { dev: { remote: 'fork', pushRemote: null } } })
      )
    ).toBe('fork')
    expect(defaultPushRemote('dev', remotes, config({ pushDefault: 'up' }))).toBe('up')
  })

  it('config 未加载（null）时回退 origin，无 origin 则取第一个 remote', () => {
    expect(defaultPushRemote('dev', remotes, null)).toBe('origin')
    expect(defaultPushRemote('dev', ['up', 'fork'], null)).toBe('up')
  })

  it('配置指向的 remote 已不存在时跳过该级回退', () => {
    const c = config({ branches: { dev: { remote: 'gone', pushRemote: 'gone2' } } })
    expect(defaultPushRemote('dev', remotes, c)).toBe('origin')
  })

  it('remote 列表为空时返回空串', () => {
    expect(defaultPushRemote('dev', [], null)).toBe('')
  })
})

/** 记录式对话框环境：动作出口只往数组里记（构造输入 → 断言输出，零 mock）。 */
function makeEnv(): { env: DialogEnv; quiet: GitAction[]; closed: () => number } {
  const quiet: GitAction[] = []
  let closedCount = 0
  const env: DialogEnv = {
    projectPath: '/repo',
    commits: [],
    branches: [],
    tags: [],
    remotes: [],
    currentBranch: null,
    config: null,
    settings: null,
    viewPrefs: DEFAULT_GIT_VIEW_PREFS,
    closeDialog: () => {
      closedCount++
    },
    runAction: async () => ({ status: 'ok' }),
    runQuietAction: async (action) => {
      quiet.push(action)
      return { status: 'ok' }
    },
    clearActionErrors: () => {},
    openChase: () => {},
    setViewPrefs: () => {}
  }
  return { env, quiet, closed: () => closedCount }
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
