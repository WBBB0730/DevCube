// shared/git 纯函数测试：图片扩展名 → MIME 判定（imageMimeOf）、工作树的分支占用与展示名。
import { describe, expect, it } from 'vitest'
import {
  branchesFreeForWorktree,
  defaultWorktreeDirectory,
  imageMimeOf,
  isWorktreeNameInvalid,
  lastPathSegment,
  listedWorktrees,
  resolveWorktreePath,
  worktreeAnchorPath,
  worktreeDisplayName,
  worktreeHoldingBranch,
  worktreeNameFromBranch,
  type GitWorktree
} from './git'

describe('imageMimeOf', () => {
  it('常见图片扩展名给出对应 MIME（大小写不敏感）', () => {
    expect(imageMimeOf('a/b/logo.png')).toBe('image/png')
    expect(imageMimeOf('photo.JPG')).toBe('image/jpeg')
    expect(imageMimeOf('anim.webp')).toBe('image/webp')
  })

  it('非图片与无扩展名返回 null', () => {
    expect(imageMimeOf('src/main.ts')).toBeNull()
    expect(imageMimeOf('Makefile')).toBeNull()
  })

  it('svg 走文本 diff，不作为图片预览', () => {
    expect(imageMimeOf('icon.svg')).toBeNull()
  })
})

function worktree(path: string, extra: Partial<GitWorktree> = {}): GitWorktree {
  return {
    path,
    head: '1111',
    branch: null,
    isMain: false,
    bare: false,
    prunable: false,
    isCurrent: false,
    ...extra
  }
}

describe('worktreeHoldingBranch', () => {
  const list = [
    worktree('/main', { isMain: true, branch: 'main', isCurrent: true }),
    worktree('/wt/feat', { branch: 'feat' }),
    worktree('/wt/spike'),
    worktree('/bare.git', { bare: true, branch: 'bare-branch' })
  ]

  it('返回检出该分支的其他工作树；本项目自身与裸仓库条目不算；未占用为 null', () => {
    expect(worktreeHoldingBranch(list, 'feat')?.path).toBe('/wt/feat')
    expect(worktreeHoldingBranch(list, 'main')).toBeNull()
    expect(worktreeHoldingBranch(list, 'bare-branch')).toBeNull()
    expect(worktreeHoldingBranch(list, 'nope')).toBeNull()
    expect(worktreeHoldingBranch([], 'feat')).toBeNull()
  })
})

describe('worktreeDisplayName', () => {
  it('主工作树固定「主工作树」，其余取目录名（两种分隔符）', () => {
    expect(worktreeDisplayName(worktree('/code/app', { isMain: true }))).toBe('主工作树')
    expect(worktreeDisplayName(worktree('/code/worktrees/app/feat-x'))).toBe('feat-x')
    expect(worktreeDisplayName(worktree('C:\\code\\wt\\spike'))).toBe('spike')
    expect(worktreeDisplayName(worktree('/code/wt/trailing/'))).toBe('trailing')
  })
})

describe('listedWorktrees', () => {
  it('剔除裸仓库条目，其余保持原序', () => {
    const list = [
      worktree('/bare.git', { bare: true }),
      worktree('/main', { isMain: true }),
      worktree('/wt/feat', { branch: 'feat' })
    ]
    expect(listedWorktrees(list).map((w) => w.path)).toEqual(['/main', '/wt/feat'])
    expect(listedWorktrees([])).toEqual([])
  })
})

describe('worktreeAnchorPath', () => {
  it('优先主工作树，其次本项目所在工作树，最后项目路径', () => {
    const main = worktree('/main', { isMain: true })
    const cur = worktree('/wt/cur', { isCurrent: true })
    expect(worktreeAnchorPath([cur, main], '/proj')).toBe('/main')
    expect(worktreeAnchorPath([cur, worktree('/bare.git', { bare: true })], '/proj')).toBe(
      '/wt/cur'
    )
    expect(worktreeAnchorPath([], '/proj')).toBe('/proj')
  })
})

describe('worktreeNameFromBranch / isWorktreeNameInvalid / lastPathSegment', () => {
  it('分支名斜杠换横线', () => {
    expect(worktreeNameFromBranch('feat/x')).toBe('feat-x')
    expect(worktreeNameFromBranch('a/b/c')).toBe('a-b-c')
    expect(worktreeNameFromBranch('main')).toBe('main')
  })
  it('目录名非法：空 / 仅空白、含分隔符、. 与 ..；合法名不算', () => {
    expect(isWorktreeNameInvalid('feat-x')).toBe(false)
    expect(isWorktreeNameInvalid('')).toBe(true)
    expect(isWorktreeNameInvalid('   ')).toBe(true)
    expect(isWorktreeNameInvalid('a/b')).toBe(true)
    expect(isWorktreeNameInvalid('a\\b')).toBe(true)
    expect(isWorktreeNameInvalid('.')).toBe(true)
    expect(isWorktreeNameInvalid('..')).toBe(true)
  })
  it('默认存放目录 = ../<锚点目录名>.worktrees', () => {
    expect(defaultWorktreeDirectory('/code/app')).toBe('../app.worktrees')
    expect(defaultWorktreeDirectory('C:\\code\\app')).toBe('../app.worktrees')
  })
  it('空闲分支：去掉远程分支与被任一工作树（含本项目）检出的', () => {
    const list = [
      worktree('/main', { isMain: true, branch: 'main', isCurrent: true }),
      worktree('/wt/feat', { branch: 'feat' }),
      worktree('/bare.git', { bare: true, branch: 'ignored' })
    ]
    expect(
      branchesFreeForWorktree(['main', 'feat', 'dev', 'ignored', 'remotes/origin/dev'], list)
    ).toEqual(['dev', 'ignored'])
  })
  it('路径末段兼容两种分隔符与末尾分隔符', () => {
    expect(lastPathSegment('/a/b/c')).toBe('c')
    expect(lastPathSegment('/a/b/c/')).toBe('c')
    expect(lastPathSegment('C:\\a\\b')).toBe('b')
  })
})

describe('resolveWorktreePath', () => {
  const anchor = '/Users/me/Projects/godot-demo'

  it('默认目录：仓库旁边的 <主项目名>.worktrees/<名字>', () => {
    expect(resolveWorktreePath(anchor, null, 'feat-x')).toBe(
      '/Users/me/Projects/godot-demo.worktrees/feat-x'
    )
    expect(resolveWorktreePath(anchor, '  ', 'feat-x')).toBe(
      '/Users/me/Projects/godot-demo.worktrees/feat-x'
    )
  })

  it('相对目录相对锚点解析并归一 . 与 ..；绝对目录直接用', () => {
    expect(resolveWorktreePath(anchor, '../worktrees/godot-demo', 'x')).toBe(
      '/Users/me/Projects/worktrees/godot-demo/x'
    )
    expect(resolveWorktreePath(anchor, './.worktrees', 'x')).toBe(
      '/Users/me/Projects/godot-demo/.worktrees/x'
    )
    expect(resolveWorktreePath(anchor, '/tmp/wt/', 'x')).toBe('/tmp/wt/x')
  })

  it('.. 不越过根', () => {
    expect(resolveWorktreePath('/a', '../../../wt', 'x')).toBe('/wt/x')
  })

  it('Windows 路径：分隔符跟随锚点，盘符为根', () => {
    expect(resolveWorktreePath('C:\\code\\app', null, 'x')).toBe('C:\\code\\app.worktrees\\x')
    expect(resolveWorktreePath('C:\\code\\app', 'D:\\wt', 'x')).toBe('D:\\wt\\x')
    expect(resolveWorktreePath('C:\\app', '..\\..\\wt', 'x')).toBe('C:\\wt\\x')
  })
})
