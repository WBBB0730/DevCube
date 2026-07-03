// 仓库设置面板的纯函数测试：Issue 链接配置校验（toolbar-widgets §4.5）、隐藏远程集合切换。
import { describe, expect, it } from 'vitest'
import { nextHideRemotes, validateIssueLinking } from './GitRepoSettings'

describe('validateIssueLinking', () => {
  it('合法的正则与 URL 返回 null', () => {
    expect(validateIssueLinking('#(\\d+)', 'https://github.com/o/r/issues/$1')).toBeNull()
  })

  it('空输入返回非空提示', () => {
    expect(validateIssueLinking('', '')).toBe('Issue 正则与 Issue URL 均不能为空。')
  })

  it('正则不含捕获组时报捕获组错误', () => {
    expect(validateIssueLinking('#\\d+', 'https://x/$1')).toBe('正则表达式不包含捕获组 ( )。')
  })

  it('非法正则（含括号但构造失败）返回其构造异常消息', () => {
    const err = validateIssueLinking('(+)', 'https://x/$1')
    expect(err).not.toBeNull()
    expect(err).not.toBe('正则表达式不包含捕获组 ( )。')
  })

  it('URL 不含 $1 等占位符时报占位符错误', () => {
    expect(validateIssueLinking('#(\\d+)', 'https://github.com/o/r/issues/')).toBe(
      'Issue URL 中不含用于代入 Issue 编号的占位符（$1、$2 等）。'
    )
  })

  it('占位符可以是 $2 等更大的序号', () => {
    expect(validateIssueLinking('([A-Z]+)-(\\d+)', 'https://jira/$1/browse/$2')).toBeNull()
  })
})

describe('nextHideRemotes', () => {
  it('勾选隐藏把 remote 加入集合', () => {
    expect(nextHideRemotes([], 'origin', true)).toEqual(['origin'])
  })

  it('取消勾选把 remote 移出集合', () => {
    expect(nextHideRemotes(['origin', 'upstream'], 'origin', false)).toEqual(['upstream'])
  })

  it('重复勾选不产生重复项（幂等）', () => {
    expect(nextHideRemotes(['origin'], 'origin', true)).toEqual(['origin'])
  })

  it('移除不存在的 remote 原集合内容不变', () => {
    expect(nextHideRemotes(['origin'], 'upstream', false)).toEqual(['origin'])
  })
})
