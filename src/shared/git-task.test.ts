import { describe, expect, it } from 'vitest'
import type { GitAction } from './git'
import {
  createGitProgressTracker,
  gitTaskTitle,
  parseGitProgressLine,
  parseLfsProgressLine,
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
  it('带百分比与「完成 / 总数」的行', () => {
    expect(parseGitProgressLine('Resolving deltas: 100% (300/300), done.')).toEqual({
      name: 'Resolving deltas',
      percent: 100,
      items: { done: 300, total: 300 },
      bytes: null
    })
  })

  it('收发阶段带上已传字节（git 的二进制单位）', () => {
    expect(
      parseGitProgressLine('Receiving objects:  45% (556/1234), 12.50 MiB | 2.00 MiB/s')
    ).toEqual({
      name: 'Receiving objects',
      percent: (556 * 100) / 1234,
      items: { done: 556, total: 1234 },
      bytes: 12.5 * 1024 * 1024
    })
    expect(
      parseGitProgressLine('Writing objects: 100% (3/3), 300 bytes | 300.00 KiB/s, done.')?.bytes
    ).toBe(300)
    expect(
      parseGitProgressLine('Unpacking objects: 100% (1/1), 1 byte | 1 byte/s, done.')?.bytes
    ).toBe(1)
    expect(
      parseGitProgressLine('Receiving objects:  10% (1/10), 2.00 GiB | 9.00 MiB/s')?.bytes
    ).toBe(2 * 1024 ** 3)
  })

  it('不报百分比的阶段、remote: 前缀', () => {
    expect(parseGitProgressLine('remote: Enumerating objects: 1234, done.')).toEqual({
      name: 'Enumerating objects',
      percent: null,
      items: null,
      bytes: null
    })
    expect(parseGitProgressLine('remote: Compressing objects:  80% (400/500)')).toEqual({
      name: 'Compressing objects',
      percent: 80,
      items: { done: 400, total: 500 },
      bytes: null
    })
  })

  it('git-lfs 自己的进度行：十进制单位不当作已传字节', () => {
    expect(
      parseGitProgressLine('Uploading LFS objects:  45% (6246/13884), 470 MB | 120 KB/s    ')
    ).toEqual({
      name: 'Uploading LFS objects',
      percent: (6246 * 100) / 13884,
      items: { done: 6246, total: 13884 },
      bytes: null
    })
  })

  it('百分比按个数算，不用打出来的取整值：没传完不到 100%', () => {
    expect(
      parseGitProgressLine('Uploading LFS objects: 100% (400/402), 2.5 MB | 70 KB/s')?.percent
    ).toBe((400 * 100) / 402)
    expect(parseGitProgressLine('Resolving deltas: 100% (0/0), done.')?.percent).toBe(100)
  })

  it('不是进度的行', () => {
    expect(parseGitProgressLine("Cloning into 'repo'...")).toBeNull()
    expect(parseGitProgressLine('fatal: repository not found')).toBeNull()
    expect(parseGitProgressLine('remote: Total 3 (delta 0), reused 0 (delta 0)')).toBeNull()
    expect(parseGitProgressLine('Receiving objects:  4')).toBeNull()
    expect(parseGitProgressLine('')).toBeNull()
  })
})

describe('parseLfsProgressLine', () => {
  it('上传、下载的行：这个文件的已传字节与大小，文件名可含空格', () => {
    expect(parseLfsProgressLine('upload 1063/13884 191/191 Research/a b/Flower13.txt')).toEqual({
      direction: 'upload',
      doneBytes: 191,
      size: 191,
      name: 'Research/a b/Flower13.txt'
    })
    expect(parseLfsProgressLine('download 1/1 1500/3000000 f 1.bin')).toEqual({
      direction: 'download',
      doneBytes: 1500,
      size: 3000000,
      name: 'f 1.bin'
    })
  })

  it('不传数据的行（合并时本机算哈希）与不相干的行不算', () => {
    expect(parseLfsProgressLine('clean 1/1 20000/20000 f180.bin')).toBeNull()
    expect(parseLfsProgressLine('upload 1/x 1/2 a')).toBeNull()
    expect(parseLfsProgressLine('')).toBeNull()
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

  it('git-lfs 自己的进度行一并剔掉', () => {
    expect(
      stripGitProgress(
        'Uploading LFS objects:   5% (20/400), 0 B | 0 B/s   \r' +
          'Uploading LFS objects: 100% (400/400), 0 B | 0 B/s, done.\n'
      )
    ).toBe('')
  })

  it('全是进度时为空串', () => {
    expect(stripGitProgress('remote: Counting objects: 100% (4/4), done.\n')).toBe('')
  })
})

describe('createGitProgressTracker', () => {
  it('进度条只给传输：收发对象按自己的个数从 0 走到 100，清点、压缩、处理增量为加载态、个数照报', () => {
    const tracker = createGitProgressTracker()
    expect(tracker.feed('stderr', 'remote: Enumerating objects: 10, done.\n')).toEqual({
      phase: '枚举对象',
      percent: null,
      items: null,
      doneBytes: null,
      totalBytes: null
    })
    expect(tracker.feed('stderr', 'remote: Counting objects: 100% (10/10), done.\n')).toEqual({
      phase: '清点对象',
      percent: null,
      items: { done: 10, total: 10 },
      doneBytes: null,
      totalBytes: null
    })
    expect(tracker.feed('stderr', 'remote: Compressing objects:  50% (5/10)\r')?.percent).toBeNull()
    expect(tracker.feed('stderr', 'Receiving objects:  50% (5/10)\r')).toEqual({
      phase: '接收对象',
      percent: 50,
      items: { done: 5, total: 10 },
      doneBytes: 0,
      totalBytes: null
    })
    expect(tracker.feed('stderr', 'Resolving deltas:  50% (1/2)\r')).toEqual({
      phase: '处理增量',
      percent: null,
      items: { done: 1, total: 2 },
      doneBytes: null,
      totalBytes: null
    })
  })

  it('一进收发阶段即从 0 字节记起（git 约半秒后才报字节，速度从这里起算）', () => {
    const tracker = createGitProgressTracker()
    expect(
      tracker.feed('stderr', 'remote: Compressing objects: 100% (3/3), done.\n')?.doneBytes
    ).toBeNull()
    expect(tracker.feed('stderr', 'Writing objects:   0% (0/131)\r')?.doneBytes).toBe(0)
    expect(
      tracker.feed('stderr', 'Writing objects:   8% (11/131), 20.02 MiB | 37.05 MiB/s\r')?.doneBytes
    ).toBe(Math.round(20.02 * 1024 * 1024))
  })

  it('已传字节只在传数据的阶段有：传完转入处理增量即没有（不再显示速度）', () => {
    const tracker = createGitProgressTracker()
    tracker.feed('stderr', 'Receiving objects: 100% (10/10), 1.00 MiB | 2.00 MiB/s, done.\n')
    expect(tracker.feed('stderr', 'Resolving deltas:  50% (1/2)\r')?.doneBytes).toBeNull()
  })

  it('前面阶段的行出现在后面阶段之后不再计入', () => {
    const tracker = createGitProgressTracker()
    tracker.feed('stderr', 'Receiving objects:  50% (5/10)\r')
    expect(tracker.feed('stderr', 'remote: Compressing objects: 100% (3/3), done.\n')).toBeNull()
    expect(tracker.feed('stderr', 'Receiving objects:  60% (6/10)\r')?.percent).toBe(60)
  })

  it('没收尾的半行留到下一块，一帧不丢；两路输出各留各的', () => {
    const tracker = createGitProgressTracker()
    expect(tracker.feed('stderr', 'Receiving objects:  1')).toBeNull()
    expect(tracker.feed('stdout', 'Fast-')).toBeNull()
    expect(tracker.feed('stderr', '0% (1/10)\r')?.percent).toBe(10)
  })

  it('一块里含多帧时取最后一帧', () => {
    const tracker = createGitProgressTracker()
    const chunk =
      'Receiving objects:  10% (124/1234)\rReceiving objects:  60% (741/1234)\r' +
      'Receiving objects: 100% (1234/1234), done.\n'
    expect(tracker.feed('stderr', chunk)?.percent).toBe(100)
  })

  it('还没到任何加权阶段时为不确定，个数照报', () => {
    const tracker = createGitProgressTracker()
    expect(tracker.feed('stderr', 'Indexing revisions:  30% (3/10)\r')).toEqual({
      phase: 'Indexing revisions',
      percent: null,
      items: { done: 3, total: 10 },
      doneBytes: null,
      totalBytes: null
    })
  })

  it('收尾阶段（检出文件）为不确定，不显示百分比与个数', () => {
    const tracker = createGitProgressTracker()
    tracker.feed('stderr', 'Resolving deltas: 100% (2/2), done.\n')
    expect(tracker.feed('stderr', 'Updating files:  40% (4/10)\r')).toEqual({
      phase: '检出文件',
      percent: null,
      items: null,
      doneBytes: null,
      totalBytes: null
    })
  })

  it('子模块的克隆整体算一个收尾阶段，其中的进度行与 LFS 进度不再计入', () => {
    const tracker = createGitProgressTracker()
    tracker.feed('stderr', 'Resolving deltas: 100% (2/2), done.\n')
    expect(
      tracker.feed('stderr', "Submodule 'lib' (https://host/lib.git) registered for path 'lib'\n")
        ?.phase
    ).toBe('克隆子模块')
    expect(tracker.feed('stderr', 'Receiving objects:  50% (5/10)\r')).toBeNull()
    expect(tracker.feed('stderr', 'Updating files: 100% (3/3), done.\n')).toBeNull()
    expect(tracker.feed('stderr', 'Filtering content:  50% (1/2)\r')).toBeNull()
    expect(tracker.feed('lfs-progress', 'download 1/1 10/10 lib/a.bin\n')).toBeNull()
  })

  it('没有可识别的进度时为 null', () => {
    const tracker = createGitProgressTracker()
    expect(tracker.feed('stderr', "Cloning into 'repo'...\n")).toBeNull()
  })

  describe('LFS 文件', () => {
    it('推送：先上传 LFS 文件，个数看 git-lfs 自己的进度行，已传字节看进度文件', () => {
      const tracker = createGitProgressTracker()
      tracker.feed('stdout', 'Uploading LFS objects:   0% (0/400), 0 B | 0 B/s    \r')
      tracker.feed('lfs-progress', 'upload 1/400 100/200 a.bin\nupload 2/400 50/50 b.bin\n')
      tracker.feed('lfs-progress', 'upload 1/400 200/200 a.bin\n')
      // 进度行里的体积把跳过的文件也算作已传，不用；个数含跳过的
      expect(
        tracker.feed('stdout', 'Uploading LFS objects:  55% (220/400), 2.0 MB | 1 KB/s   \r')
      ).toEqual({
        phase: '上传 LFS 文件',
        percent: 55,
        items: { done: 220, total: 400 },
        doneBytes: 250,
        totalBytes: null
      })
      expect(tracker.feed('lfs-progress', 'upload 3/400 10/10 c.bin\n')?.doneBytes).toBe(260)
    })

    it('推送：git-lfs 数完要传的文件之前当作还在准备（总数与上一帧相同才算数完，第一帧必是 0 / 1）', () => {
      const tracker = createGitProgressTracker()
      expect(
        tracker.feed('stdout', 'Uploading LFS objects:   0% (0/1), 0 B | 0 B/s    \r')
      ).toBeNull()
      expect(
        tracker.feed('stdout', 'Uploading LFS objects:   6% (138/2191), 0 B | 0 B/s    \r')
      ).toBeNull()
      // 数的同时已开始传：先不报，数完后连同体积一起报
      expect(tracker.feed('lfs-progress', 'upload 1/2191 5000/5000 a.bin\n')).toBeNull()
      expect(
        tracker.feed('stdout', 'Uploading LFS objects:  10% (443/4625), 0 B | 0 B/s    \r')
      ).toBeNull()
      expect(
        tracker.feed('stdout', 'Uploading LFS objects:  15% (693/4625), 0 B | 0 B/s    \r')
      ).toEqual({
        phase: '上传 LFS 文件',
        percent: (693 * 100) / 4625,
        items: { done: 693, total: 4625 },
        doneBytes: 5000,
        totalBytes: null
      })
    })

    it('推送：LFS 文件传完轮到提交，发送对象从 0 走，已传字节从头记', () => {
      const tracker = createGitProgressTracker()
      tracker.feed('lfs-progress', 'upload 1/1 5000/5000 a.bin\n')
      tracker.feed('stdout', 'Uploading LFS objects: 100% (1/1), 5.0 KB | 0 B/s, done.\n')
      expect(tracker.feed('stderr', 'Enumerating objects: 3, done.\n')).toEqual({
        phase: '枚举对象',
        percent: null,
        items: null,
        doneBytes: null,
        totalBytes: null
      })
      expect(tracker.feed('stderr', 'Writing objects:  50% (1/2)\r')).toEqual({
        phase: '发送对象',
        percent: 50,
        items: { done: 1, total: 2 },
        doneBytes: 0,
        totalBytes: null
      })
    })

    it('克隆：提交传完后，检出时下载 LFS 文件另起一段（git 报的「Filtering content」带总数与字节）', () => {
      const tracker = createGitProgressTracker()
      tracker.feed('stderr', 'Receiving objects: 100% (203/203), 30.00 KiB | 1.00 MiB/s, done.\n')
      tracker.feed('stderr', 'Updating files: 100% (203/203), done.\n')
      expect(
        tracker.feed('stderr', 'Filtering content:  45% (90/200), 4.50 MiB | 2.00 MiB/s\r')
      ).toEqual({
        phase: '下载 LFS 文件',
        percent: 45,
        items: { done: 90, total: 200 },
        doneBytes: 4.5 * 1024 * 1024,
        totalBytes: null
      })
    })

    it('git 报了下载进度（带总数与字节）时以它为准，进度文件的行不再计入', () => {
      const tracker = createGitProgressTracker()
      tracker.feed('stderr', 'Filtering content:  10% (30/300), 600.00 KiB | 1.00 MiB/s\r')
      expect(tracker.feed('lfs-progress', 'download 1/1 20000/20000 f1.bin\n')).toBeNull()
      expect(
        tracker.feed('stderr', 'Filtering content:  11% (33/300), 660.00 KiB | 1.00 MiB/s\r')
      ).toMatchObject({
        percent: 11,
        items: { done: 33, total: 300 },
        doneBytes: 660 * 1024
      })
    })

    it('拉取：检出时逐个文件下载，只有进度文件，总数不可知、进度条不确定', () => {
      const tracker = createGitProgressTracker()
      expect(
        tracker.feed(
          'lfs-progress',
          'clean 1/1 20000/20000 f1.bin\ndownload 1/1 20000/20000 f2.bin\ndownload 1/1 5000/20000 f3.bin\n'
        )
      ).toEqual({
        phase: '下载 LFS 文件',
        percent: null,
        items: { done: 1, total: null },
        doneBytes: 25000,
        totalBytes: null
      })
      expect(tracker.feed('lfs-progress', 'download 1/1 20000/20000 f3.bin\n')).toMatchObject({
        items: { done: 2, total: null },
        doneBytes: 40000
      })
    })

    it('进度文件没收尾的半行留到下一块', () => {
      const tracker = createGitProgressTracker()
      expect(tracker.feed('lfs-progress', 'download 1/1 10/1')).toBeNull()
      expect(tracker.feed('lfs-progress', '0 a.bin\n')?.doneBytes).toBe(10)
    })
  })
})

describe('spreadProgress', () => {
  const base = { phase: '发送对象', percent: 50, items: null, doneBytes: null, totalBytes: null }

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
