// 分支筛选下拉的纯函数测试：显示名、选中语义（toolbar-widgets §2.5）、触发行文案。
import { describe, expect, it } from 'vitest'
import {
  branchDisplayName,
  branchFilterLabel,
  invertBranches,
  isCurrentBranchFilter,
  toggleBranch
} from './GitBranchDropdown'

describe('branchDisplayName', () => {
  it('远程分支去掉 remotes/ 前缀', () => {
    expect(branchDisplayName('remotes/origin/main')).toBe('origin/main')
  })

  it('本地分支原样返回', () => {
    expect(branchDisplayName('feature/remotes-ui')).toBe('feature/remotes-ui')
  })
})

describe('isCurrentBranchFilter', () => {
  it('null（全部分支）不是当前分支模式', () => {
    expect(isCurrentBranchFilter(null)).toBe(false)
  })

  it("['HEAD'] 是当前分支模式", () => {
    expect(isCurrentBranchFilter(['HEAD'])).toBe(true)
  })

  it('具体分支筛选不是当前分支模式', () => {
    expect(isCurrentBranchFilter(['main'])).toBe(false)
  })
})

describe('toggleBranch', () => {
  it('全部分支（null）时单击具体项：只选中该项', () => {
    expect(toggleBranch(null, 'main')).toEqual(['main'])
  })

  it("当前分支模式（['HEAD']）时单击具体项：从头选中该项", () => {
    expect(toggleBranch(['HEAD'], 'main')).toEqual(['main'])
  })

  it('未选中的项被追加到选中集合', () => {
    expect(toggleBranch(['main'], 'dev')).toEqual(['main', 'dev'])
  })

  it('已选中的项被取消选中', () => {
    expect(toggleBranch(['main', 'dev'], 'main')).toEqual(['dev'])
  })

  it('取消最后一个选中项后回落到全部分支（null）', () => {
    expect(toggleBranch(['main'], 'main')).toBeNull()
  })
})

describe('invertBranches', () => {
  it('全部分支（null）时反选：所有具体项全部选中', () => {
    expect(invertBranches(null, ['main', 'dev'])).toEqual(['main', 'dev'])
  })

  it('当前分支模式视同无具体选中：反选后全量分支选中', () => {
    expect(invertBranches(['HEAD'], ['main', 'dev'])).toEqual(['main', 'dev'])
  })

  it('部分选中时反选：选中与未选中互换', () => {
    expect(invertBranches(['main'], ['main', 'dev', 'remotes/origin/main'])).toEqual([
      'dev',
      'remotes/origin/main'
    ])
  })

  it('全部选中时反选：回落到全部分支（null）', () => {
    expect(invertBranches(['main', 'dev'], ['main', 'dev'])).toBeNull()
  })

  it('空分支列表反选回落 null', () => {
    expect(invertBranches(null, [])).toBeNull()
  })
})

describe('branchFilterLabel', () => {
  it('null 显示「全部分支」', () => {
    expect(branchFilterLabel(null)).toBe('全部分支')
  })

  it("['HEAD'] 显示「当前分支」", () => {
    expect(branchFilterLabel(['HEAD'])).toBe('当前分支')
  })

  it('单个选中项直接显示其显示名', () => {
    expect(branchFilterLabel(['remotes/origin/main'])).toBe('origin/main')
  })

  it('两个选中项用「和」连接', () => {
    expect(branchFilterLabel(['main', 'dev'])).toBe('main 和 dev')
  })

  it('三个及以上用顿号加「和」连接', () => {
    expect(branchFilterLabel(['main', 'dev', 'remotes/origin/hotfix'])).toBe(
      'main、dev 和 origin/hotfix'
    )
  })
})
