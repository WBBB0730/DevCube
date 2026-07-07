import { describe, expect, it } from 'vitest'
import {
  assembleCommits,
  countPorcelainStatus,
  generateFileChanges,
  GIT_LOG_SEPARATOR,
  parseBranches,
  parseConfigListZ,
  parseDetails,
  parseLog,
  parseNameStatusZ,
  parseNumStatZ,
  parseRefs,
  parseStashes,
  parseStatusFilesZ,
  parseTagDetails,
  parseFileDiff,
  countLinesInBuffer
} from './git-parse'
import type { GitCommitRecord, GitRefData, GitStash } from './git-parse'
import { UNCOMMITTED } from '../shared/git'

const SEP = GIT_LOG_SEPARATOR

/** 组一条 6 段的 git log 行（GIT_FORMAT_LOG 字段序）。 */
function logLine(hash: string, parents: string, date: number, message: string): string {
  return [hash, parents, '张三', 'zs@example.com', String(date), message].join(SEP)
}

/** 组一条 GitCommitRecord（assembleCommits 输入）。 */
function record(hash: string, parents: string[], date: number): GitCommitRecord {
  return { hash, parents, author: '张三', email: 'zs@example.com', date, message: `提交 ${hash}` }
}

/** 组一条挂在 baseHash 上的 stash。 */
function stashOn(hash: string, baseHash: string, date: number): GitStash {
  return {
    hash,
    baseHash,
    untrackedFilesHash: null,
    selector: `refs/stash@{${hash}}`,
    author: '张三',
    email: 'zs@example.com',
    date,
    message: `WIP ${hash}`
  }
}

const emptyRefs: GitRefData = { head: null, heads: [], tags: [], remotes: [] }

describe('parseBranches', () => {
  it('当前分支排在第 0 位，其余按输出顺序', () => {
    const stdout = '  develop\n* main\n  remotes/origin/main\n'
    expect(parseBranches(stdout, [], true)).toEqual({
      branches: ['main', 'develop', 'remotes/origin/main'],
      head: 'main'
    })
  })

  it('detached HEAD 伪条目被过滤，head 为 null', () => {
    const stdout = '* (HEAD detached at 1a2b3c4)\n  main\n'
    expect(parseBranches(stdout, [], true)).toEqual({ branches: ['main'], head: null })
  })

  it('remote HEAD 行取箭头前的名字，showRemoteHeads=false 时被过滤', () => {
    const stdout = '* main\n  remotes/origin/HEAD -> origin/main\n  remotes/origin/main\n'
    expect(parseBranches(stdout, [], false).branches).toEqual(['main', 'remotes/origin/main'])
    expect(parseBranches(stdout, [], true).branches).toContain('remotes/origin/HEAD')
  })

  it('隐藏 remote 名下的分支被过滤', () => {
    const stdout = '* main\n  remotes/upstream/dev\n'
    expect(parseBranches(stdout, ['upstream'], true).branches).toEqual(['main'])
  })
})

describe('parseStashes', () => {
  const fields = [
    'aaa111',
    'bbb222 ccc333',
    'refs/stash@{0}',
    '张三',
    'zs@example.com',
    '1700000000',
    'WIP on main: 初始'
  ]

  it('两个父提交的 stash untrackedFilesHash 为 null', () => {
    const stashes = parseStashes(fields.join(SEP) + '\n')
    expect(stashes).toEqual([
      {
        hash: 'aaa111',
        baseHash: 'bbb222',
        untrackedFilesHash: null,
        selector: 'refs/stash@{0}',
        author: '张三',
        email: 'zs@example.com',
        date: 1700000000,
        message: 'WIP on main: 初始'
      }
    ])
  })

  it('三个父提交的 stash 取第三父为 untrackedFilesHash', () => {
    const line = [...fields]
    line[1] = 'bbb222 ccc333 ddd444'
    expect(parseStashes(line.join(SEP) + '\n')[0].untrackedFilesHash).toBe('ddd444')
  })

  it('空输出与段数不符的行得到空数组（「仓库从没有 stash」的报错由调用方吞掉，解析器只管格式）', () => {
    expect(parseStashes('')).toEqual([])
    expect(parseStashes('坏掉的行\n')).toEqual([])
  })
})

describe('parseRefs', () => {
  const stdout =
    [
      'eee555 HEAD',
      'aaa111 refs/heads/main',
      'bbb222 refs/tags/v1.0',
      'ccc333 refs/tags/v1.0^{}',
      'ddd444 refs/remotes/origin/main',
      'fff666 refs/remotes/origin/HEAD',
      'abc789 refs/remotes/upstream/dev'
    ].join('\n') + '\n'

  it('annotated tag 的对象行与 ^{} 解引用行都保留并剥掉后缀', () => {
    expect(parseRefs(stdout, [], true).tags).toEqual([
      { hash: 'bbb222', name: 'v1.0', annotated: false },
      { hash: 'ccc333', name: 'v1.0', annotated: true }
    ])
  })

  it('HEAD / heads / remotes 按前缀归类且前缀被剥掉', () => {
    const refs = parseRefs(stdout, [], true)
    expect(refs.head).toBe('eee555')
    expect(refs.heads).toEqual([{ hash: 'aaa111', name: 'main' }])
    expect(refs.remotes.map((r) => r.name)).toEqual(['origin/main', 'origin/HEAD', 'upstream/dev'])
  })

  it('showRemoteHeads=false 过滤 /HEAD 结尾的 remote ref，隐藏 remote 的 ref 被丢弃', () => {
    const refs = parseRefs(stdout, ['upstream'], false)
    expect(refs.remotes.map((r) => r.name)).toEqual(['origin/main'])
  })
})

describe('parseLog', () => {
  it('六段行解析出完整记录，根提交空 parents 得到空数组', () => {
    const stdout =
      logLine('aaa111', 'bbb222 ccc333', 1700000100, '合并分支') +
      '\n' +
      logLine('bbb222', '', 1700000000, '根提交') +
      '\n'
    expect(parseLog(stdout)).toEqual([
      {
        hash: 'aaa111',
        parents: ['bbb222', 'ccc333'],
        author: '张三',
        email: 'zs@example.com',
        date: 1700000100,
        message: '合并分支'
      },
      {
        hash: 'bbb222',
        parents: [],
        author: '张三',
        email: 'zs@example.com',
        date: 1700000000,
        message: '根提交'
      }
    ])
  })

  it('段数不符的行直接停止解析（容忍尾部残缺）', () => {
    const stdout =
      logLine('aaa111', '', 1700000000, '正常') +
      '\n残缺行\n' +
      logLine('ccc333', '', 1700000000, '不会被解析') +
      '\n'
    expect(parseLog(stdout).map((r) => r.hash)).toEqual(['aaa111'])
  })
})

describe('countPorcelainStatus', () => {
  it('输出以换行结尾，行数减一即变更条数', () => {
    expect(countPorcelainStatus(' M a.ts\n?? b.ts\n')).toBe(2)
  })

  it('空输出计 0', () => {
    expect(countPorcelainStatus('')).toBe(0)
  })
})

describe('parseStatusFilesZ', () => {
  it('D 与 ? 状态分别归入 deleted / untracked', () => {
    const stdout = ' D gone.ts\0?? new.ts\0 M other.ts\0'
    expect(parseStatusFilesZ(stdout)).toEqual({ deleted: ['gone.ts'], untracked: ['new.ts'] })
  })

  it('R 记录的原路径是独立 NUL 段，被跳过不误读', () => {
    const stdout = 'R  renamed.ts\0orig.ts\0 D gone.ts\0'
    expect(parseStatusFilesZ(stdout)).toEqual({ deleted: ['gone.ts'], untracked: [] })
  })
})

describe('parseNameStatusZ', () => {
  it('A/M/D 记录两段，R100 记录带旧 / 新路径共三段', () => {
    const stdout = 'M\0src/a.ts\0R100\0old.ts\0new.ts\0A\0b.ts\0'
    expect(parseNameStatusZ(stdout, false)).toEqual([
      { type: 'M', oldFilePath: 'src/a.ts', newFilePath: 'src/a.ts' },
      { type: 'R', oldFilePath: 'old.ts', newFilePath: 'new.ts' },
      { type: 'A', oldFilePath: 'b.ts', newFilePath: 'b.ts' }
    ])
  })

  it('diff-tree 先回显提交 hash，diffTree=true 时丢掉第一段', () => {
    const stdout = 'abc123\0M\0a.ts\0'
    expect(parseNameStatusZ(stdout, true)).toEqual([
      { type: 'M', oldFilePath: 'a.ts', newFilePath: 'a.ts' }
    ])
  })
})

describe('parseNumStatZ', () => {
  it('二进制文件的 "-" 计数解析为 null 而非 NaN', () => {
    expect(parseNumStatZ('-\t-\timg.png\0', false)).toEqual([
      { filePath: 'img.png', additions: null, deletions: null }
    ])
  })

  it('rename 记录 path 为空，从后两个独立段取新路径', () => {
    expect(parseNumStatZ('3\t1\t\0old.ts\0new.ts\0', false)).toEqual([
      { filePath: 'new.ts', additions: 3, deletions: 1 }
    ])
  })
})

describe('generateFileChanges', () => {
  it('numstat 按新路径回填增删行数，rename 项也按新路径命中', () => {
    const changes = generateFileChanges(
      [
        { type: 'M', oldFilePath: 'a.ts', newFilePath: 'a.ts' },
        { type: 'R', oldFilePath: 'old.ts', newFilePath: 'new.ts' }
      ],
      [
        { filePath: 'a.ts', additions: 1, deletions: 2 },
        { filePath: 'new.ts', additions: 3, deletions: 0 }
      ],
      null
    )
    expect(changes).toEqual([
      { oldFilePath: 'a.ts', newFilePath: 'a.ts', type: 'M', additions: 1, deletions: 2 },
      { oldFilePath: 'old.ts', newFilePath: 'new.ts', type: 'R', additions: 3, deletions: 0 }
    ])
  })

  it('status 的 deleted 命中已有项改标 D、未命中追加 D 项，untracked 一律追加 U 项', () => {
    const changes = generateFileChanges(
      [{ type: 'M', oldFilePath: 'a.ts', newFilePath: 'a.ts' }],
      [],
      { deleted: ['a.ts', 'b.ts'], untracked: ['c.ts'] }
    )
    expect(changes.map((c) => [c.newFilePath, c.type])).toEqual([
      ['a.ts', 'D'],
      ['b.ts', 'D'],
      ['c.ts', 'U']
    ])
    // 合成的 D/U 项没有 numstat 数据，计数保持 null
    expect(changes[1].additions).toBeNull()
    expect(changes[2].additions).toBeNull()
  })

  it('untracked 目录条目（尾斜杠）去斜杠归一并标 isDir，普通文件不带 isDir', () => {
    const changes = generateFileChanges([], [], { deleted: [], untracked: ['c.ts', 'sub/'] })
    expect(changes).toEqual([
      { oldFilePath: 'c.ts', newFilePath: 'c.ts', type: 'U', additions: null, deletions: null },
      {
        oldFilePath: 'sub',
        newFilePath: 'sub',
        type: 'U',
        additions: null,
        deletions: null,
        isDir: true
      }
    ])
  })
})

describe('assembleCommits', () => {
  const opts = { maxCommits: 5, showTags: true, uncommittedChanges: 0 }

  it('拿满 maxCommits+1 条时弹掉哨兵条并标记还有更多', () => {
    const records = [record('a', ['b'], 3), record('b', ['c'], 2), record('c', [], 1)]
    const result = assembleCommits(records, emptyRefs, [], [], { ...opts, maxCommits: 2 })
    expect(result.moreCommitsAvailable).toBe(true)
    expect(result.commits.map((c) => c.hash)).toEqual(['a', 'b'])
  })

  it('未拿满时不弹条目，moreCommitsAvailable 为 false', () => {
    const result = assembleCommits([record('a', [], 1)], emptyRefs, [], [], opts)
    expect(result.moreCommitsAvailable).toBe(false)
    expect(result.commits).toHaveLength(1)
  })

  it('有未提交变更且 HEAD 在列表中时合成虚拟行到最前，指向 HEAD', () => {
    const refs: GitRefData = { ...emptyRefs, head: 'a' }
    const result = assembleCommits([record('a', [], 1)], refs, [], [], {
      ...opts,
      uncommittedChanges: 3
    })
    expect(result.commits[0].hash).toBe(UNCOMMITTED)
    expect(result.commits[0].parents).toEqual(['a'])
    expect(result.commits[0].message).toBe('未提交的更改 (3)')
  })

  it('HEAD 不在列表中时不合成未提交行', () => {
    const refs: GitRefData = { ...emptyRefs, head: 'zzz' }
    const result = assembleCommits([record('a', [], 1)], refs, [], [], {
      ...opts,
      uncommittedChanges: 3
    })
    expect(result.commits.map((c) => c.hash)).toEqual(['a'])
  })

  it('stash 按 baseHash 插到其 base 之前，同一 base 的多个 stash 新的在上', () => {
    const records = [record('a', ['b'], 4), record('b', [], 1)]
    const stashes = [stashOn('s1', 'b', 2), stashOn('s2', 'b', 3)]
    const result = assembleCommits(records, emptyRefs, stashes, [], opts)
    expect(result.commits.map((c) => c.hash)).toEqual(['a', 's2', 's1', 'b'])
    expect(result.commits[1].stash?.baseHash).toBe('b')
    expect(result.commits[1].parents).toEqual(['b'])
  })

  it('stash 提交本身已在列表中（--reflog 场景）时原地标注不重复插入', () => {
    const records = [record('s1', ['b'], 2), record('b', [], 1)]
    const result = assembleCommits(records, emptyRefs, [stashOn('s1', 'b', 2)], [], opts)
    expect(result.commits.map((c) => c.hash)).toEqual(['s1', 'b'])
    expect(result.commits[0].stash?.selector).toBe('refs/stash@{s1}')
  })

  it('heads/tags/remotes 标注命中提交，annotated tag 只有 ^{} 行命中，tags 名去重返回', () => {
    const refs: GitRefData = {
      head: 'a',
      heads: [{ hash: 'a', name: 'main' }],
      tags: [
        { hash: 'tagobj', name: 'v1.0', annotated: false },
        { hash: 'a', name: 'v1.0', annotated: true }
      ],
      remotes: [
        { hash: 'a', name: 'origin/main' },
        { hash: 'a', name: 'gone/main' }
      ]
    }
    const result = assembleCommits([record('a', [], 1)], refs, [], ['origin'], opts)
    expect(result.commits[0].heads).toEqual(['main'])
    expect(result.commits[0].tags).toEqual([{ name: 'v1.0', annotated: true }])
    expect(result.commits[0].remotes).toEqual([
      { name: 'origin/main', remote: 'origin' },
      { name: 'gone/main', remote: null }
    ])
    expect(result.tags).toEqual(['v1.0'])
  })

  it('showTags=false 时不往提交上挂 tag，但 tags 列表仍返回（供重名校验）', () => {
    const refs: GitRefData = {
      ...emptyRefs,
      tags: [{ hash: 'a', name: 'v1.0', annotated: true }]
    }
    const result = assembleCommits([record('a', [], 1)], refs, [], [], {
      ...opts,
      showTags: false
    })
    expect(result.commits[0].tags).toEqual([])
    expect(result.tags).toEqual(['v1.0'])
  })
})

describe('parseDetails', () => {
  it('十二字段解析，%B 含分隔符也能还原且尾部空行被去除', () => {
    const body = `主题\n\n正文里混入 ${SEP} 分隔符\n\n`
    const stdout = [
      'aaa111',
      'bbb222 ccc333',
      '张三',
      'zs@example.com',
      '1700000000',
      '李四',
      'ls@example.com',
      '1700000100',
      '',
      '',
      '',
      body
    ].join(SEP)
    const details = parseDetails(stdout)
    expect(details.hash).toBe('aaa111')
    expect(details.parents).toEqual(['bbb222', 'ccc333'])
    expect(details.author).toBe('张三')
    expect(details.authorEmail).toBe('zs@example.com')
    expect(details.authorDate).toBe(1700000000)
    expect(details.committer).toBe('李四')
    expect(details.committerDate).toBe(1700000100)
    expect(details.body).toBe(`主题\n\n正文里混入 ${SEP} 分隔符`)
  })

  it('根提交空 parents 得到空数组，段数不足的损坏输入返回空详情而非抛错', () => {
    const stdout = [
      'aaa111',
      '',
      '张三',
      'zs@example.com',
      '1700000000',
      '张三',
      'zs@example.com',
      '1700000000',
      '',
      '',
      '',
      '根提交\n'
    ].join(SEP)
    expect(parseDetails(stdout).parents).toEqual([])
    expect(parseDetails(stdout).body).toBe('根提交')
    expect(parseDetails('坏输入').hash).toBe('')
  })
})

describe('parseFileDiff', () => {
  it('普通 diff：原始文本原样透传、binary 为 false', () => {
    const stdout = [
      'diff --git a/a.ts b/a.ts',
      'index 1111111..2222222 100644',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1,2 @@ function foo()',
      '-旧行',
      '+新行一',
      '+新行二',
      ''
    ].join('\n')
    const diff = parseFileDiff(stdout, { oldFilePath: 'a.ts', newFilePath: 'a.ts', type: 'M' })
    expect(diff.binary).toBe(false)
    expect(diff.raw).toBe(stdout)
  })

  it('Binary files 差异标记 binary 且 raw 置空', () => {
    const stdout =
      'diff --git a/img.png b/img.png\n' +
      'index 1111111..2222222 100644\n' +
      'Binary files a/img.png and b/img.png differ\n'
    const diff = parseFileDiff(stdout, {
      oldFilePath: 'img.png',
      newFilePath: 'img.png',
      type: 'M'
    })
    expect(diff.binary).toBe(true)
    expect(diff.raw).toBe('')
  })
})

describe('countLinesInBuffer', () => {
  it('空内容为 0 行', () => {
    expect(countLinesInBuffer(new Uint8Array(0))).toBe(0)
  })

  it('末行有换行符按换行数计', () => {
    expect(countLinesInBuffer(new TextEncoder().encode('a\nb\n'))).toBe(2)
  })

  it('末行无换行符也算一行（numstat 口径）', () => {
    expect(countLinesInBuffer(new TextEncoder().encode('a\nb'))).toBe(2)
  })

  it('前 8000 字节含 NUL 判为二进制返回 null', () => {
    expect(countLinesInBuffer(new Uint8Array([104, 0, 105]))).toBeNull()
  })

  it('UTF-16 风格内容（隔字节 NUL）判为二进制', () => {
    expect(countLinesInBuffer(new Uint8Array([104, 0, 101, 0, 108, 0]))).toBeNull()
  })
})

describe('parseConfigListZ', () => {
  it('key 与 value 以第一个换行分隔，value 内换行原样保留', () => {
    const stdout = 'user.name\n张三\0alias.lg\nlog --graph\n--oneline\0'
    expect(parseConfigListZ(stdout)).toEqual({
      'user.name': '张三',
      'alias.lg': 'log --graph\n--oneline'
    })
  })

  it('空输出得到空对象，无值配置记为空串', () => {
    expect(parseConfigListZ('')).toEqual({})
    expect(parseConfigListZ('some.flag\0')).toEqual({ 'some.flag': '' })
  })
})

describe('parseTagDetails', () => {
  it('签名块从消息中被抠掉，signed 为 true，邮箱去掉包裹的尖括号', () => {
    const signature = '-----BEGIN PGP SIGNATURE-----\nabcdef\n-----END PGP SIGNATURE-----\n'
    const contents = `v1.0 发布\n\n说明正文\n${signature}`
    const stdout =
      ['tag111', '张三', '<zs@example.com>', '1700000000', signature, contents].join(SEP) + '\n'
    const details = parseTagDetails(stdout)
    expect(details).toEqual({
      hash: 'tag111',
      taggerName: '张三',
      taggerEmail: 'zs@example.com',
      taggerDate: 1700000000,
      message: 'v1.0 发布\n\n说明正文',
      signed: true
    })
  })

  it('无签名 tag signed 为 false，消息去掉尾部空行', () => {
    const stdout =
      ['tag111', '张三', '<zs@example.com>', '1700000000', '', 'v1.0 发布\n'].join(SEP) + '\n'
    const details = parseTagDetails(stdout)
    expect(details?.signed).toBe(false)
    expect(details?.message).toBe('v1.0 发布')
  })

  it('tag 不存在时 for-each-ref 输出为空，返回 null', () => {
    expect(parseTagDetails('')).toBeNull()
  })
})
