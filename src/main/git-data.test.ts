// git-data 纯参数构造与配置组装的测试 —— 只测纯函数（build* / assembleRepoConfig），
// IO 编排（loadRepo / getDetails 等）不 mock 不测，命令口径由这些构造函数保证。

import { describe, expect, it } from 'vitest'
import {
  assembleRepoConfig,
  buildDiffArgs,
  buildFileDiffArgs,
  buildLogArgs,
  buildShowRefArgs,
  buildStatusArgs
} from './git-data'
import { GIT_FORMAT_LOG } from './git-parse'
import type { GitDiffRequest, GitEffectiveSettings } from '../shared/git'

/** 参考实现默认值的有效设置（测试基准，逐项覆盖时在其上打补丁）。 */
const SETTINGS: GitEffectiveSettings = {
  showRemoteBranches: true,
  showStashes: true,
  showTags: true,
  includeCommitsMentionedByReflogs: false,
  onlyFollowFirstParent: false,
  commitOrdering: 'date',
  hideRemotes: []
}

describe('buildLogArgs', () => {
  it('显示全部 + 默认设置：--branches --tags --remotes HEAD 全套，哨兵多请求 1 条', () => {
    const args = buildLogArgs({ maxCommits: 300, branches: null }, SETTINGS, [], ['origin'])
    expect(args).toEqual([
      '-c',
      'log.showSignature=false',
      'log',
      '--max-count=301',
      `--format=${GIT_FORMAT_LOG}`,
      '--date-order',
      '--branches',
      '--tags',
      '--remotes',
      'HEAD',
      '--'
    ])
  })

  it('指定分支筛选：分支名与 --glob= 模式原样透传，不加 --branches/HEAD', () => {
    const args = buildLogArgs(
      { maxCommits: 300, branches: ['main', '--glob=refs/heads/feature/*'] },
      SETTINGS,
      [],
      ['origin']
    )
    expect(args).toContain('main')
    expect(args).toContain('--glob=refs/heads/feature/*')
    expect(args).not.toContain('--branches')
    expect(args).not.toContain('HEAD')
    expect(args[args.length - 1]).toBe('--')
  })

  it('有隐藏 remote 时不用 --remotes，改为逐个未隐藏 remote 的 --glob', () => {
    const args = buildLogArgs(
      { maxCommits: 300, branches: null },
      { ...SETTINGS, hideRemotes: ['upstream'] },
      [],
      ['origin', 'upstream']
    )
    expect(args).not.toContain('--remotes')
    expect(args).toContain('--glob=refs/remotes/origin')
    expect(args).not.toContain('--glob=refs/remotes/upstream')
  })

  it('stash 基点去重后作为起点 revision 追加在 HEAD 之前', () => {
    const args = buildLogArgs(
      { maxCommits: 300, branches: null },
      SETTINGS,
      ['aaa', 'aaa', 'bbb'],
      []
    )
    expect(args.filter((arg) => arg === 'aaa')).toHaveLength(1)
    expect(args.indexOf('bbb')).toBeLessThan(args.indexOf('HEAD'))
  })

  it('onlyFollowFirstParent 与 topo 排序：--first-parent 与 --topo-order', () => {
    const args = buildLogArgs(
      { maxCommits: 100, branches: null },
      { ...SETTINGS, onlyFollowFirstParent: true, commitOrdering: 'topo' },
      [],
      []
    )
    expect(args).toContain('--first-parent')
    expect(args).toContain('--topo-order')
    expect(args).not.toContain('--date-order')
  })

  it('关闭标签展示则不加 --tags，开启 reflog 则加 --reflog', () => {
    const args = buildLogArgs(
      { maxCommits: 300, branches: null },
      { ...SETTINGS, showTags: false, includeCommitsMentionedByReflogs: true },
      [],
      []
    )
    expect(args).not.toContain('--tags')
    expect(args).toContain('--reflog')
  })
})

describe('buildShowRefArgs', () => {
  it('显示远程分支时不限制 ref 类型', () => {
    expect(buildShowRefArgs(true)).toEqual(['show-ref', '-d', '--head'])
  })

  it('不显示远程分支时限制为 --heads --tags', () => {
    expect(buildShowRefArgs(false)).toEqual(['show-ref', '--heads', '--tags', '-d', '--head'])
  })
})

describe('buildDiffArgs', () => {
  it('from 与 to 相同（根提交 / stash 第三父）走 diff-tree --root', () => {
    expect(buildDiffArgs('--name-status', 'abc', 'abc')).toEqual({
      args: [
        'diff-tree',
        '--name-status',
        '-r',
        '--root',
        '--find-renames',
        '--diff-filter=AMDR',
        '-z',
        'abc'
      ],
      diffTree: true
    })
  })

  it('to 为空串表示与工作区比较，只传一个 revision', () => {
    expect(buildDiffArgs('--numstat', 'HEAD', '')).toEqual({
      args: ['diff', '--numstat', '--find-renames', '--diff-filter=AMDR', '-z', 'HEAD'],
      diffTree: false
    })
  })

  it('两提交间比较传两个 revision', () => {
    const { args, diffTree } = buildDiffArgs('--name-status', 'aaa', 'bbb')
    expect(args).toContain('aaa')
    expect(args).toContain('bbb')
    expect(diffTree).toBe(false)
  })
})

describe('buildFileDiffArgs', () => {
  const base: GitDiffRequest = {
    fromHash: 'aaa',
    toHash: 'bbb',
    oldFilePath: 'src/a.ts',
    newFilePath: 'src/a.ts',
    type: 'M'
  }

  it('工作区未跟踪文件用 --no-index 与 /dev/null 比较，并标记退出码 1 视为成功', () => {
    const { args, noIndex } = buildFileDiffArgs(
      {
        ...base,
        fromHash: 'HEAD',
        toHash: '*',
        type: 'U',
        oldFilePath: 'x.txt',
        newFilePath: 'x.txt'
      },
      '/repo'
    )
    expect(noIndex).toBe(true)
    expect(args).toContain('--no-index')
    expect(args).toContain('/dev/null')
    expect(args).toContain('/repo/x.txt')
  })

  it('from 与 to 相同走 diff-tree -p --root', () => {
    const { args, noIndex } = buildFileDiffArgs({ ...base, toHash: 'aaa' }, '/repo')
    expect(noIndex).toBe(false)
    expect(args).toContain('diff-tree')
    expect(args).toContain('--root')
    expect(args).toContain('-p')
  })

  it('to 为未提交（非 U）时与工作区比较，不加 --find-renames', () => {
    const { args } = buildFileDiffArgs({ ...base, toHash: '*' }, '/repo')
    expect(args).toContain('diff')
    expect(args).toContain('aaa')
    expect(args).not.toContain('*')
    expect(args).not.toContain('--find-renames')
  })

  it('两提交间比较带 --find-renames；重命名文件传旧新两个路径', () => {
    const { args } = buildFileDiffArgs(
      { ...base, oldFilePath: 'src/old.ts', newFilePath: 'src/new.ts', type: 'R' },
      '/repo'
    )
    expect(args).toContain('--find-renames')
    expect(args).toContain('src/old.ts')
    expect(args).toContain('src/new.ts')
  })

  it('两提交间路径未变时只传一个路径', () => {
    const { args } = buildFileDiffArgs(base, '/repo')
    expect(args.filter((arg) => arg === 'src/a.ts')).toHaveLength(1)
  })
})

describe('buildStatusArgs', () => {
  it('展示未跟踪文件时 --untracked-files=all，否则 no', () => {
    expect(buildStatusArgs(true)).toEqual([
      'status',
      '-s',
      '--untracked-files=all',
      '--porcelain',
      '-z'
    ])
    expect(buildStatusArgs(false)).toEqual([
      'status',
      '-s',
      '--untracked-files=no',
      '--porcelain',
      '-z'
    ])
  })
})

describe('assembleRepoConfig', () => {
  it('从 local 提取 branch.<name>.remote / .pushremote，分支名可含点号', () => {
    const config = assembleRepoConfig(
      {},
      {
        'branch.main.remote': 'origin',
        'branch.dev.remote': 'origin',
        'branch.dev.pushremote': 'fork',
        'branch.v1.0.x.remote': 'origin'
      },
      {},
      []
    )
    expect(config.branches).toEqual({
      main: { remote: 'origin', pushRemote: null },
      dev: { remote: 'origin', pushRemote: 'fork' },
      'v1.0.x': { remote: 'origin', pushRemote: null }
    })
  })

  it('remotes 的 url/pushUrl 取自 local 配置，缺失为 null', () => {
    const config = assembleRepoConfig({}, { 'remote.origin.url': 'git@github.com:a/b.git' }, {}, [
      'origin',
      'fork'
    ])
    expect(config.remotes).toEqual([
      { name: 'origin', url: 'git@github.com:a/b.git', pushUrl: null },
      { name: 'fork', url: null, pushUrl: null }
    ])
  })

  it('pushDefault 取合并视图，user 信息分别取 local 与 global', () => {
    const config = assembleRepoConfig(
      { 'remote.pushdefault': 'origin', 'user.name': '本地名', 'user.email': 'g@x.com' },
      { 'user.name': '本地名' },
      { 'user.name': '全局名', 'user.email': 'global@x.com' },
      []
    )
    expect(config.pushDefault).toBe('origin')
    expect(config.user).toEqual({
      name: { local: '本地名', global: '全局名' },
      email: { local: null, global: 'global@x.com' }
    })
  })

  it('空输入产出空配置骨架', () => {
    expect(assembleRepoConfig({}, {}, {}, [])).toEqual({
      branches: {},
      pushDefault: null,
      remotes: [],
      user: { name: { local: null, global: null }, email: { local: null, global: null } }
    })
  })
})
