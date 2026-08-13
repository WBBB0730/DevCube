import { describe, expect, it } from 'vitest'
import { gitGutterLineKinds } from './cm6-git-gutter'

describe('gitGutterLineKinds', () => {
  it('无差异 → 无标记', () => {
    expect(gitGutterLineKinds('a\nb\n', 'a\nb\n').size).toBe(0)
  })

  it('中间新增行 → added', () => {
    expect(gitGutterLineKinds('a\nb\n', 'a\nx\nb\n')).toEqual(new Map([[2, 'added']]))
  })

  it('文末追加行 → added（README 回归：基线空尾行不误标为 modified）', () => {
    expect(gitGutterLineKinds('a\nb\n', 'a\nb\n\n1')).toEqual(
      new Map([
        [3, 'added'],
        [4, 'added']
      ])
    )
  })

  it('修改行 → modified', () => {
    expect(gitGutterLineKinds('a\nb\nc\n', 'a\nB\nc\n')).toEqual(new Map([[2, 'modified']]))
  })

  it('连续多行修改块整段标记', () => {
    expect(gitGutterLineKinds('a\nb\nc\nd\n', 'a\nB\nC\nd\n')).toEqual(
      new Map([
        [2, 'modified'],
        [3, 'modified']
      ])
    )
  })

  it('空行填入内容 → modified（非 added）', () => {
    expect(gitGutterLineKinds('a\n\nb\n', 'a\nx\nb\n')).toEqual(new Map([[2, 'modified']]))
  })

  it('删除中间行 → 标记落在被删位置的下一行', () => {
    expect(gitGutterLineKinds('a\nb\nc\n', 'a\nc\n')).toEqual(new Map([[2, 'deleted']]))
  })

  it('删除末行（保留换行）→ 标记钳制到最后一行', () => {
    expect(gitGutterLineKinds('a\nb\n', 'a\n')).toEqual(new Map([[1, 'deleted']]))
  })

  it('多删少加的替换 → 净存的行标 modified', () => {
    expect(gitGutterLineKinds('a\nb\nc\nd\n', 'a\nX\nd\n')).toEqual(new Map([[2, 'modified']]))
  })

  it('给无尾换行的基线追加行时，git 口径把末行也算改动', () => {
    expect(gitGutterLineKinds('a', 'a\nx')).toEqual(
      new Map([
        [1, 'modified'],
        [2, 'modified']
      ])
    )
  })

  it('CRLF 基线经归一后与 LF 文档不误报（由 gitDiffGutter 归一，等价断言）', () => {
    const normalized = 'a\r\nb\r\n'.split(/\r\n?|\n/).join('\n')
    expect(gitGutterLineKinds(normalized, 'a\nb\n').size).toBe(0)
  })

  it('新文件（基线为空）整体标 added', () => {
    expect(gitGutterLineKinds('', 'a\nb')).toEqual(
      new Map([
        [1, 'added'],
        [2, 'added']
      ])
    )
  })
})
