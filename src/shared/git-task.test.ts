import { describe, expect, it } from 'vitest'
import type { GitAction } from './git'
import {
  createGitProgressTracker,
  gitTaskTitle,
  parseGitProgressLine,
  spreadProgress,
  stripGitProgress,
  withProgressFlag
} from './git-task'

describe('gitTaskTitle', () => {
  it('会联网收发提交的动作是 Task，标题为动作 + 对象', () => {
    expect(
      gitTaskTitle({
        kind: 'pull-branch',
        remote: 'origin',
        branch: 'main',
        mode: 'merge',
        noFastForward: false
      })
    ).toEqual({ action: '拉取', target: 'origin/main' })
    expect(
      gitTaskTitle({
        kind: 'push-branch',
        remote: 'origin',
        localBranch: 'feat',
        targetBranch: 'feat',
        setUpstream: true,
        pushTags: false,
        mode: 'normal'
      })
    ).toEqual({ action: '推送', target: 'feat → origin/feat' })
    expect(
      gitTaskTitle({
        kind: 'fetch-into-local',
        remote: 'origin',
        remoteBranch: 'dev',
        localBranch: 'dev',
        force: false
      })
    ).toEqual({ action: '获取', target: 'origin/dev → dev' })
    expect(
      gitTaskTitle({
        kind: 'push-tag',
        name: 'v1.0',
        remotes: ['origin'],
        commitHash: 'abc',
        skipRemoteCheck: false
      })
    ).toEqual({ action: '推送标签', target: 'v1.0' })
  })

  it('新建标签、初始化只在要联网时才是 Task', () => {
    const tag: GitAction = {
      kind: 'add-tag',
      hash: 'abc',
      name: 'v1.0',
      type: 'lightweight',
      message: '',
      force: false,
      pushToRemote: null,
      skipRemoteCheck: false
    }
    expect(gitTaskTitle(tag)).toBeNull()
    expect(gitTaskTitle({ ...tag, pushToRemote: 'origin' })).toEqual({
      action: '推送标签',
      target: 'v1.0'
    })
    expect(gitTaskTitle({ kind: 'init', branchName: null, remoteUrl: null })).toBeNull()
    expect(
      gitTaskTitle({ kind: 'init', branchName: null, remoteUrl: 'git@host:me/app.git' })
    ).toEqual({ action: '初始化仓库', target: 'git@host:me/app.git' })
  })

  it('刷新与只删远程的动作不是 Task', () => {
    expect(gitTaskTitle({ kind: 'fetch', remote: null, prune: false, pruneTags: false })).toBeNull()
    expect(
      gitTaskTitle({ kind: 'delete-remote-branch', branch: 'feat', remote: 'origin' })
    ).toBeNull()
    expect(
      gitTaskTitle({
        kind: 'merge',
        obj: 'dev',
        on: 'branch',
        noFastForward: false,
        squash: false,
        noCommit: false
      })
    ).toBeNull()
  })
})

describe('withProgressFlag', () => {
  it('紧跟子命令加 --progress', () => {
    expect(withProgressFlag(['push', 'origin', 'main'])).toEqual([
      'push',
      '--progress',
      'origin',
      'main'
    ])
  })
})

describe('parseGitProgressLine', () => {
  it('带百分比的行', () => {
    expect(parseGitProgressLine('Resolving deltas: 100% (300/300), done.')).toEqual({
      name: 'Resolving deltas',
      percent: 100,
      bytes: null
    })
  })

  it('收发阶段带上已传字节（git 的二进制单位）', () => {
    expect(
      parseGitProgressLine('Receiving objects:  45% (556/1234), 12.50 MiB | 2.00 MiB/s')
    ).toEqual({ name: 'Receiving objects', percent: 45, bytes: 12.5 * 1024 * 1024 })
    expect(
      parseGitProgressLine('Writing objects: 100% (3/3), 300 bytes | 300.00 KiB/s, done.')
    ).toEqual({ name: 'Writing objects', percent: 100, bytes: 300 })
    expect(parseGitProgressLine('Unpacking objects: 100% (1/1), 1 byte | 1 byte/s, done.')).toEqual(
      { name: 'Unpacking objects', percent: 100, bytes: 1 }
    )
    expect(parseGitProgressLine('Receiving objects:  10% (1/10), 2.00 GiB | 9.00 MiB/s')).toEqual({
      name: 'Receiving objects',
      percent: 10,
      bytes: 2 * 1024 ** 3
    })
  })

  it('不报百分比的阶段、remote: 前缀', () => {
    expect(parseGitProgressLine('remote: Enumerating objects: 1234, done.')).toEqual({
      name: 'Enumerating objects',
      percent: null,
      bytes: null
    })
    expect(parseGitProgressLine('remote: Compressing objects:  80% (400/500)')).toEqual({
      name: 'Compressing objects',
      percent: 80,
      bytes: null
    })
  })

  it('不是进度的行', () => {
    expect(parseGitProgressLine("Cloning into 'repo'...")).toBeNull()
    expect(parseGitProgressLine('fatal: repository not found')).toBeNull()
    expect(parseGitProgressLine('remote: Total 3 (delta 0), reused 0 (delta 0)')).toBeNull()
    expect(parseGitProgressLine('Receiving objects:  4')).toBeNull()
    expect(parseGitProgressLine('')).toBeNull()
  })
})

describe('stripGitProgress', () => {
  it('剔掉进度帧与只在报进度时才打的统计行，保留报错并以换行收尾', () => {
    const stderr =
      'Enumerating objects: 5, done.\n' +
      'Counting objects:  50% (2/4)\rCounting objects: 100% (4/4), done.\n' +
      'Delta compression using up to 8 threads\n' +
      'Writing objects: 100% (3/3), 300 bytes | 300.00 KiB/s, done.\n' +
      'Total 3 (delta 1), reused 0 (delta 0), pack-reused 0 (from 0)\n' +
      'To github.com:me/app.git\n' +
      ' ! [rejected]        main -> main (fetch first)\n' +
      "error: failed to push some refs to 'github.com:me/app.git'\n"
    expect(stripGitProgress(stderr)).toBe(
      'To github.com:me/app.git\n' +
        ' ! [rejected]        main -> main (fetch first)\n' +
        "error: failed to push some refs to 'github.com:me/app.git'\n"
    )
  })

  it('全是进度时为空串', () => {
    expect(stripGitProgress('remote: Counting objects: 100% (4/4), done.\n')).toBe('')
  })
})

describe('createGitProgressTracker', () => {
  it('各阶段按权重合成总百分比：清点 5、压缩 10、收发 80、处理增量 5', () => {
    const tracker = createGitProgressTracker()
    expect(tracker.feed('remote: Counting objects: 100% (10/10), done.\n')?.percent).toBe(5)
    expect(tracker.feed('remote: Compressing objects:  50% (5/10)\r')?.percent).toBe(10)
    expect(tracker.feed('Receiving objects:  50% (5/10)\r')).toEqual({
      phase: '接收对象',
      percent: 55,
      doneBytes: 0,
      totalBytes: null
    })
    expect(tracker.feed('Resolving deltas: 100% (2/2), done.\n')?.percent).toBe(100)
  })

  it('一进收发阶段即从 0 字节记起（git 约半秒后才报字节，速度从这里起算）', () => {
    const tracker = createGitProgressTracker()
    expect(tracker.feed('remote: Compressing objects: 100% (3/3), done.\n')?.doneBytes).toBeNull()
    expect(tracker.feed('Writing objects:   0% (0/131)\r')?.doneBytes).toBe(0)
    expect(
      tracker.feed('Writing objects:   8% (11/131), 20.02 MiB | 37.05 MiB/s\r')?.doneBytes
    ).toBe(Math.round(20.02 * 1024 * 1024))
  })

  it('只增不减：前面阶段的行出现在后面阶段之后不再计入', () => {
    const tracker = createGitProgressTracker()
    tracker.feed('Receiving objects:  50% (5/10)\r')
    expect(tracker.feed('remote: Compressing objects: 100% (3/3), done.\n')).toBeNull()
    expect(tracker.feed('Receiving objects:  60% (6/10)\r')?.percent).toBe(63)
  })

  it('收发阶段带出已传字节', () => {
    const tracker = createGitProgressTracker()
    expect(
      tracker.feed('Receiving objects:  45% (556/1234), 1.00 MiB | 2.00 MiB/s\r')?.doneBytes
    ).toBe(1024 * 1024)
  })

  it('没收尾的半行留到下一块，一帧不丢', () => {
    const tracker = createGitProgressTracker()
    expect(tracker.feed('Receiving objects:  1')).toBeNull()
    expect(tracker.feed('0% (1/10)\r')?.percent).toBe(23)
  })

  it('一块里含多帧时取最后一帧', () => {
    const tracker = createGitProgressTracker()
    const chunk =
      'Receiving objects:  10% (124/1234)\rReceiving objects:  60% (741/1234)\r' +
      'Receiving objects: 100% (1234/1234), done.\n'
    expect(tracker.feed(chunk)?.percent).toBe(95)
  })

  it('还没到任何加权阶段时为不确定', () => {
    const tracker = createGitProgressTracker()
    expect(tracker.feed('Indexing revisions:  30% (3/10)\r')).toEqual({
      phase: 'Indexing revisions',
      percent: null,
      doneBytes: null,
      totalBytes: null
    })
  })

  it('收尾阶段（检出文件）为不确定，不显示百分比', () => {
    const tracker = createGitProgressTracker()
    tracker.feed('Resolving deltas: 100% (2/2), done.\n')
    expect(tracker.feed('Updating files:  40% (4/10)\r')).toEqual({
      phase: '检出文件',
      percent: null,
      doneBytes: null,
      totalBytes: null
    })
  })

  it('子模块的克隆整体算一个收尾阶段，其中的进度行不再计入', () => {
    const tracker = createGitProgressTracker()
    tracker.feed('Resolving deltas: 100% (2/2), done.\n')
    expect(
      tracker.feed("Submodule 'lib' (https://host/lib.git) registered for path 'lib'\n")?.phase
    ).toBe('克隆子模块')
    expect(tracker.feed('Receiving objects:  50% (5/10)\r')).toBeNull()
    expect(tracker.feed('Updating files: 100% (3/3), done.\n')).toBeNull()
  })

  it('没有可识别的进度时为 null', () => {
    const tracker = createGitProgressTracker()
    expect(tracker.feed("Cloning into 'repo'...\n")).toBeNull()
  })
})

describe('spreadProgress', () => {
  const base = { phase: '发送对象', percent: 50, doneBytes: null, totalBytes: null }

  it('多条命令按条数平分', () => {
    expect(spreadProgress(base, { index: 1, count: 2 }).percent).toBe(75)
    expect(spreadProgress(base, { index: 0, count: 4 }).percent).toBe(12.5)
  })

  it('单条命令与不确定的原样', () => {
    expect(spreadProgress(base, { index: 0, count: 1 })).toBe(base)
    const unknown = { ...base, percent: null }
    expect(spreadProgress(unknown, { index: 1, count: 2 })).toBe(unknown)
  })
})
