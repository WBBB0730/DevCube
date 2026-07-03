// 仓库设置面板的纯函数测试：隐藏远程集合切换。
import { describe, expect, it } from 'vitest'
import { nextHideRemotes } from './GitRepoSettings'

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
