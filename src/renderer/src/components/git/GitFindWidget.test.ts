// 查找部件的纯函数测试：findMatches 的命中范围与开关语义（toolbar-widgets §3.3）、
// getFindError 的非法正则 / 零长度匹配防御。
import { describe, expect, it } from 'vitest'
import type { GitCommit } from '@shared/git'
import { findMatches, getFindError } from './GitFindWidget'

/** 构造测试提交：默认字段全空，按需覆盖。 */
function commit(partial: Partial<GitCommit> & { hash: string }): GitCommit {
  return {
    parents: [],
    author: '',
    email: '',
    date: 0,
    message: '',
    heads: [],
    tags: [],
    remotes: [],
    stash: null,
    ...partial
  }
}

const COMMITS: GitCommit[] = [
  commit({
    hash: 'aaaa111122223333444455556666777788889999',
    message: 'feat: 新增登录页',
    author: 'Alice',
    email: 'alice@example.com',
    heads: ['main'],
    remotes: [{ name: 'origin/main', remote: 'origin' }]
  }),
  commit({
    hash: 'bbbb111122223333444455556666777788889999',
    message: 'fix(scope): 修复越界',
    author: 'Bob',
    email: 'bob@example.com',
    tags: [{ name: 'v1.2.0', annotated: true }]
  }),
  commit({
    hash: 'cccc111122223333444455556666777788889999',
    message: 'WIP on main',
    author: 'Alice',
    email: 'alice@example.com',
    stash: {
      selector: 'refs/stash@{0}',
      baseHash: 'aaaa111122223333444455556666777788889999',
      untrackedFilesHash: null
    }
  })
]

const DEFAULT = { caseSensitive: false, regex: false }

describe('findMatches', () => {
  it('按提交消息命中，默认不区分大小写', () => {
    expect(findMatches(COMMITS, '登录', DEFAULT)).toEqual([COMMITS[0].hash])
    expect(findMatches(COMMITS, 'wip', DEFAULT)).toEqual([COMMITS[2].hash])
  })

  it('区分大小写开启后大小写不同不命中', () => {
    expect(findMatches(COMMITS, 'wip', { caseSensitive: true, regex: false })).toEqual([])
    expect(findMatches(COMMITS, 'WIP', { caseSensitive: true, regex: false })).toEqual([
      COMMITS[2].hash
    ])
  })

  it('完整 hash 前缀命中（超过 8 位也可）', () => {
    expect(findMatches(COMMITS, 'bbbb11112222', DEFAULT)).toEqual([COMMITS[1].hash])
  })

  it('作者名与邮箱命中', () => {
    expect(findMatches(COMMITS, 'bob@example', DEFAULT)).toEqual([COMMITS[1].hash])
    expect(findMatches(COMMITS, 'Alice', DEFAULT)).toEqual([COMMITS[0].hash, COMMITS[2].hash])
  })

  it('本地分支 / 远程分支 / tag 名命中', () => {
    expect(findMatches([COMMITS[0]], 'origin/main', DEFAULT)).toEqual([COMMITS[0].hash])
    expect(findMatches(COMMITS, 'v1.2.0', DEFAULT)).toEqual([COMMITS[1].hash])
  })

  it('stash selector（去掉 refs/ 前缀）命中', () => {
    expect(findMatches(COMMITS, 'stash@{0}', DEFAULT)).toEqual([COMMITS[2].hash])
  })

  it('未提交更改行（hash 为 *）不参与查找', () => {
    const withUncommitted = [commit({ hash: '*', message: '未提交的更改 (3)' }), ...COMMITS]
    expect(findMatches(withUncommitted, '未提交', DEFAULT)).toEqual([])
  })

  it('非正则模式下特殊字符按字面匹配', () => {
    expect(findMatches(COMMITS, 'fix(scope)', DEFAULT)).toEqual([COMMITS[1].hash])
  })

  it('正则模式按模式匹配', () => {
    expect(findMatches(COMMITS, '^fix\\(', { caseSensitive: false, regex: true })).toEqual([
      COMMITS[1].hash
    ])
  })

  it('非法正则返回空结果', () => {
    expect(findMatches(COMMITS, '([', { caseSensitive: false, regex: true })).toEqual([])
  })

  it('会产生零长度匹配的正则（如 a*）返回空结果', () => {
    expect(findMatches(COMMITS, 'a*', { caseSensitive: false, regex: true })).toEqual([])
  })

  it('空查询词返回空结果', () => {
    expect(findMatches(COMMITS, '', DEFAULT)).toEqual([])
  })
})

describe('getFindError', () => {
  it('非正则模式恒无错误', () => {
    expect(getFindError('([', DEFAULT)).toBeNull()
  })

  it('合法正则无错误', () => {
    expect(getFindError('#\\d+', { caseSensitive: false, regex: true })).toBeNull()
  })

  it('非法正则返回异常消息', () => {
    expect(getFindError('([', { caseSensitive: false, regex: true })).not.toBeNull()
  })

  it('零长度匹配的正则返回专用错误文案', () => {
    expect(getFindError('a*', { caseSensitive: false, regex: true })).toBe(
      '不能使用会产生零长度匹配的正则表达式'
    )
  })
})
