// git-exec 纯函数测试：链接工作树 → 主工作树目录的推导（IO 部分不测）。
import { describe, expect, it } from 'vitest'
import { mainWorktreePathOf } from './git-exec'

describe('mainWorktreePathOf', () => {
  it('链接工作树：公共 gitdir 名为 .git 时取其父目录', () => {
    expect(
      mainWorktreePathOf({
        gitDir: '/code/app/.git/worktrees/feat',
        commonDir: '/code/app/.git'
      })
    ).toBe('/code/app')
  })

  it('主工作树（两目录相同）为 null', () => {
    expect(mainWorktreePathOf({ gitDir: '/code/app/.git', commonDir: '/code/app/.git' })).toBeNull()
  })

  it('裸仓库的链接工作树（公共 gitdir 不叫 .git）为 null', () => {
    expect(
      mainWorktreePathOf({ gitDir: '/srv/repo.git/worktrees/wt', commonDir: '/srv/repo.git' })
    ).toBeNull()
  })
})
