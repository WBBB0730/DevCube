import { describe, expect, it } from 'vitest'
import {
  buildCloneArgs,
  cloneErrorFromStderr,
  isCloneDirNameInvalid,
  isLikelyRepoUrl,
  normalizeRepoUrl,
  parseCloneProgress,
  repoDirNameFromUrl,
  resolveClonePath
} from './git-clone'

// 期望值逐条对照真实 git（2.50）的 "Cloning into '<名>'..." 实测结果
describe('repoDirNameFromUrl', () => {
  it('取 https 地址的最后一段并剥 .git', () => {
    expect(repoDirNameFromUrl('https://github.com/owner/repo.git')).toBe('repo')
    expect(repoDirNameFromUrl('https://github.com/owner/repo')).toBe('repo')
  })

  it('剥尾部斜杠与空白', () => {
    expect(repoDirNameFromUrl('https://github.com/owner/repo.git/')).toBe('repo')
    expect(repoDirNameFromUrl('  https://github.com/owner/repo/  ')).toBe('repo')
  })

  it('认账 scp 形式（冒号也是分隔符）', () => {
    expect(repoDirNameFromUrl('git@github.com:owner/repo.git')).toBe('repo')
    expect(repoDirNameFromUrl('git@github.com:repo.git')).toBe('repo')
    expect(repoDirNameFromUrl('git@github.com:repo')).toBe('repo')
  })

  it('跳过认证信息', () => {
    expect(repoDirNameFromUrl('https://user:pw@github.com/owner/repo.git')).toBe('repo')
  })

  it('只有主机名时剥端口，有路径时不剥', () => {
    expect(repoDirNameFromUrl('ssh://git@github.com:2222')).toBe('github.com')
    expect(repoDirNameFromUrl('ssh://git@github.com:2222/owner/repo.git')).toBe('repo')
    expect(repoDirNameFromUrl('/srv/foo/bar:2222.git')).toBe('2222')
  })

  it('认账本地路径与 file 地址，含 <repo>/.git 形式', () => {
    expect(repoDirNameFromUrl('file:///srv/git/repo.git')).toBe('repo')
    expect(repoDirNameFromUrl('/srv/git/myrepo')).toBe('myrepo')
    expect(repoDirNameFromUrl('/srv/git/myrepo/.git')).toBe('myrepo')
  })

  it('不剥 .bundle 后缀', () => {
    expect(repoDirNameFromUrl('https://github.com/owner/repo.bundle')).toBe('repo.bundle')
  })

  it('网页链接也能派生（浏览器地址栏直接粘贴）', () => {
    expect(repoDirNameFromUrl('https://github.com/owner/repo/tree/main')).toBe('repo')
    expect(repoDirNameFromUrl('https://github.com/owner/repo?tab=readme-ov-file')).toBe('repo')
  })

  it('退化输入派生为空串', () => {
    expect(repoDirNameFromUrl('')).toBe('')
    expect(repoDirNameFromUrl('   ')).toBe('')
    expect(repoDirNameFromUrl('///')).toBe('')
  })
})

describe('normalizeRepoUrl', () => {
  it('剥掉网页路由段，还原成仓库地址', () => {
    expect(normalizeRepoUrl('https://github.com/owner/repo/tree/main')).toBe(
      'https://github.com/owner/repo'
    )
    expect(normalizeRepoUrl('https://github.com/owner/repo/blob/main/src/a.ts')).toBe(
      'https://github.com/owner/repo'
    )
    expect(normalizeRepoUrl('https://github.com/owner/repo/pull/52')).toBe(
      'https://github.com/owner/repo'
    )
    expect(normalizeRepoUrl('https://github.com/owner/repo/issues')).toBe(
      'https://github.com/owner/repo'
    )
  })

  it('剥掉查询串、锚点与尾斜杠', () => {
    expect(normalizeRepoUrl('https://github.com/owner/repo?tab=readme-ov-file#install')).toBe(
      'https://github.com/owner/repo'
    )
    expect(normalizeRepoUrl('https://github.com/owner/repo/')).toBe('https://github.com/owner/repo')
  })

  it('GitLab 子组路径保留，到 - 分隔符才截断', () => {
    expect(normalizeRepoUrl('https://gitlab.com/group/sub/repo')).toBe(
      'https://gitlab.com/group/sub/repo'
    )
    expect(normalizeRepoUrl('https://gitlab.com/group/sub/repo/-/tree/main')).toBe(
      'https://gitlab.com/group/sub/repo'
    )
  })

  it('已是可克隆地址的原样不动', () => {
    expect(normalizeRepoUrl('https://github.com/owner/repo.git')).toBe(
      'https://github.com/owner/repo.git'
    )
    expect(normalizeRepoUrl('git@github.com:owner/repo.git')).toBe('git@github.com:owner/repo.git')
    expect(normalizeRepoUrl('ssh://git@host:2222/owner/repo.git')).toBe(
      'ssh://git@host:2222/owner/repo.git'
    )
    expect(normalizeRepoUrl('/srv/git/myrepo')).toBe('/srv/git/myrepo')
  })
})

describe('isLikelyRepoUrl', () => {
  it('认账各协议与 scp 形式', () => {
    expect(isLikelyRepoUrl('https://github.com/owner/repo.git')).toBe(true)
    expect(isLikelyRepoUrl('http://host/repo')).toBe(true)
    expect(isLikelyRepoUrl('ssh://git@host:2222/owner/repo.git')).toBe(true)
    expect(isLikelyRepoUrl('git://host/repo.git')).toBe(true)
    expect(isLikelyRepoUrl('file:///srv/git/repo.git')).toBe(true)
    expect(isLikelyRepoUrl('git@github.com:owner/repo.git')).toBe(true)
    expect(isLikelyRepoUrl('  https://github.com/owner/repo  ')).toBe(true)
  })

  it('不认账普通文本与含空白的内容', () => {
    expect(isLikelyRepoUrl('')).toBe(false)
    expect(isLikelyRepoUrl('repo')).toBe(false)
    expect(isLikelyRepoUrl('克隆一下这个仓库')).toBe(false)
    expect(isLikelyRepoUrl('git clone https://github.com/owner/repo.git')).toBe(false)
    expect(isLikelyRepoUrl('/srv/git/repo.git')).toBe(false) // 本地路径不预填，避免误判
  })
})

describe('isCloneDirNameInvalid', () => {
  it('空 / . / .. / 含路径分隔符为非法', () => {
    expect(isCloneDirNameInvalid('')).toBe(true)
    expect(isCloneDirNameInvalid('   ')).toBe(true)
    expect(isCloneDirNameInvalid('.')).toBe(true)
    expect(isCloneDirNameInvalid('..')).toBe(true)
    expect(isCloneDirNameInvalid('a/b')).toBe(true)
    expect(isCloneDirNameInvalid('a\\b')).toBe(true)
  })

  it('普通目录名合法', () => {
    expect(isCloneDirNameInvalid('repo')).toBe(false)
    expect(isCloneDirNameInvalid('my.repo-2')).toBe(false)
  })
})

describe('parseCloneProgress', () => {
  it('解析带百分比的进度行并译出阶段名', () => {
    expect(parseCloneProgress('Receiving objects:  45% (556/1234), 1.20 MiB | 2.00 MiB/s')).toEqual(
      {
        phase: '接收对象',
        percent: 45
      }
    )
    expect(parseCloneProgress('Resolving deltas: 100% (300/300), done.')).toEqual({
      phase: '处理增量',
      percent: 100
    })
  })

  it('无百分比的阶段行只给阶段名', () => {
    expect(parseCloneProgress('remote: Enumerating objects: 1234, done.')).toEqual({
      phase: '枚举对象',
      percent: null
    })
  })

  it('剥 remote: 前缀', () => {
    expect(parseCloneProgress('remote: Compressing objects:  80% (400/500)')).toEqual({
      phase: '压缩对象',
      percent: 80
    })
  })

  it('一块里含多帧时取最后一帧', () => {
    const chunk =
      'Receiving objects:  10% (124/1234)\rReceiving objects:  60% (741/1234)\r' +
      'Receiving objects: 100% (1234/1234), done.\n'
    expect(parseCloneProgress(chunk)).toEqual({ phase: '接收对象', percent: 100 })
  })

  it('块边界劈断的半行不产生错帧', () => {
    expect(parseCloneProgress('Receiving objects:  10% (124/1234)\rReceiving objects:  4')).toEqual(
      {
        phase: '接收对象',
        percent: 10
      }
    )
  })

  it('未知阶段原样保留英文', () => {
    expect(parseCloneProgress('Indexing revisions:  30% (3/10)')).toEqual({
      phase: 'Indexing revisions',
      percent: 30
    })
  })

  it('无进度可识别时返回 null', () => {
    expect(parseCloneProgress("Cloning into 'repo'...")).toBeNull()
    expect(parseCloneProgress('fatal: repository not found')).toBeNull()
    expect(parseCloneProgress('')).toBeNull()
  })
})

describe('resolveClonePath', () => {
  it('拼接存放位置与目录名，容忍尾部分隔符', () => {
    expect(resolveClonePath('/Users/me/code', 'repo')).toBe('/Users/me/code/repo')
    expect(resolveClonePath('/Users/me/code/', '  repo  ')).toBe('/Users/me/code/repo')
  })

  it('Windows 路径用反斜杠', () => {
    expect(resolveClonePath('C:\\Users\\me\\code', 'repo')).toBe('C:\\Users\\me\\code\\repo')
  })
})

describe('cloneErrorFromStderr', () => {
  it('剔掉进度帧与例行提示，只留报错', () => {
    const stderr =
      "Cloning into 'repo'...\n" +
      'remote: Enumerating objects: 12, done.\n' +
      'Receiving objects:  50% (6/12)\rReceiving objects: 100% (12/12), done.\n' +
      'fatal: could not read Username for https://github.com: terminal prompts disabled\n'
    expect(cloneErrorFromStderr(stderr)).toBe(
      'fatal: could not read Username for https://github.com: terminal prompts disabled'
    )
  })

  it('多行报错全部保留', () => {
    const stderr = 'remote: Repository not found.\nfatal: repository not found\n'
    expect(cloneErrorFromStderr(stderr)).toBe(
      'remote: Repository not found.\nfatal: repository not found'
    )
  })

  it('全是进度时返回空串', () => {
    expect(
      cloneErrorFromStderr("Cloning into 'repo'...\nResolving deltas: 100% (3/3), done.\n")
    ).toBe('')
  })
})

describe('buildCloneArgs', () => {
  it('默认不带子模块，操作数在 -- 之后', () => {
    expect(buildCloneArgs('https://github.com/owner/repo.git', '/projects/repo', false)).toEqual([
      'clone',
      '--progress',
      '--',
      'https://github.com/owner/repo.git',
      '/projects/repo'
    ])
  })

  it('勾选子模块时带 --recurse-submodules', () => {
    expect(buildCloneArgs('https://host/repo.git', '/p/repo', true)).toEqual([
      'clone',
      '--progress',
      '--recurse-submodules',
      '--',
      'https://host/repo.git',
      '/p/repo'
    ])
  })

  it('以 - 开头的地址不会被当成选项', () => {
    expect(buildCloneArgs('  --upload-pack=evil  ', '/p/repo', false)).toEqual([
      'clone',
      '--progress',
      '--',
      '--upload-pack=evil',
      '/p/repo'
    ])
  })
})
