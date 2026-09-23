import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  classifyCommonDirPath,
  classifyGitDirRel,
  classifyWatchPathAll,
  isDiscoveryRootName,
  isPathInside,
  relativeInside,
  resolveWatchRoot
} from './project-watch-classify'

const project = join('/repo', 'app')
const monoRoot = join('/mono')
const nested = join('/mono', 'packages', 'app')

describe('resolveWatchRoot', () => {
  it('有仓库时用仓库根', () => {
    expect(resolveWatchRoot(nested, monoRoot)).toBe(monoRoot)
  })
  it('非仓库时用项目路径', () => {
    expect(resolveWatchRoot(project, null)).toBe(project)
  })
})

describe('relativeInside / isPathInside', () => {
  it('识别子孙、自身与域外', () => {
    expect(relativeInside(project, join(project, 'src', 'a.ts'))).toBe(join('src', 'a.ts'))
    expect(relativeInside(project, project)).toBe('')
    expect(relativeInside(project, join('/other', 'x'))).toBeNull()
    expect(isPathInside(project, join(project, 'src', 'a.ts'))).toBe(true)
    expect(isPathInside(project, project)).toBe(true)
    expect(isPathInside(project, join('/other', 'x'))).toBe(false)
  })
})

describe('classifyGitDirRel', () => {
  it('白名单与锁文件 / 噪声', () => {
    expect(classifyGitDirRel('HEAD')).toBe('meta')
    expect(classifyGitDirRel('index')).toBe('meta')
    expect(classifyGitDirRel(join('refs', 'heads', 'main'))).toBe('meta')
    expect(classifyGitDirRel('index.lock')).toBe('noise')
    expect(classifyGitDirRel(join('objects', 'aa', 'bb'))).toBe('noise')
  })

  it('引用存储整类：packed-refs（fetch --prune / 删打包引用只改它）与 reftable 后端', () => {
    expect(classifyGitDirRel('packed-refs')).toBe('meta')
    expect(classifyGitDirRel('packed-refs.lock')).toBe('noise')
    expect(classifyGitDirRel('reftable')).toBe('meta')
    expect(classifyGitDirRel(join('reftable', 'tables.list'))).toBe('meta')
    expect(classifyGitDirRel(join('reftable', 'tables.list.lock'))).toBe('noise')
  })
})

describe('isDiscoveryRootName', () => {
  it('识别清单与约定指纹', () => {
    expect(isDiscoveryRootName('package.json')).toBe(true)
    expect(isDiscoveryRootName('pnpm-lock.yaml')).toBe(true)
    expect(isDiscoveryRootName('go.mod')).toBe(true)
    expect(isDiscoveryRootName('Foo.csproj')).toBe(true)
    expect(isDiscoveryRootName('src')).toBe(false)
  })
})

describe('classifyWatchPathAll', () => {
  it('非仓库：.git 出现 → probe；根 package.json → discovery+files', () => {
    expect(classifyWatchPathAll(project, null, join(project, '.git'))).toEqual([
      { kind: 'git-probe' }
    ])
    expect(classifyWatchPathAll(project, null, join(project, 'package.json'))).toEqual([
      { kind: 'discovery' },
      { kind: 'files' }
    ])
  })

  it('非仓库：IDE 忽略名不进 files', () => {
    expect(classifyWatchPathAll(project, null, join(project, '.DS_Store'))).toEqual([])
  })

  it('仓库：工作区源码 → git-worktree+files；node_modules 仍进 git-worktree（交 check-ignore）', () => {
    const src = join(project, 'src', 'a.ts')
    expect(classifyWatchPathAll(project, project, src)).toEqual([
      { kind: 'git-worktree', relPath: join('src', 'a.ts') },
      { kind: 'files' }
    ])
    const nm = join(project, 'node_modules', 'x', 'index.js')
    expect(classifyWatchPathAll(project, project, nm)).toEqual([
      { kind: 'git-worktree', relPath: join('node_modules', 'x', 'index.js') },
      { kind: 'files' }
    ])
  })

  it('仓库：.git/objects 忽略；HEAD 为 meta', () => {
    expect(classifyWatchPathAll(project, project, join(project, '.git', 'objects', 'aa'))).toEqual(
      []
    )
    expect(classifyWatchPathAll(project, project, join(project, '.git', 'HEAD'))).toEqual([
      { kind: 'git-meta' }
    ])
  })

  it('嵌套项目：仓库根下项目外路径只驱动 git-worktree', () => {
    const sibling = join(monoRoot, 'packages', 'other', 'a.ts')
    expect(classifyWatchPathAll(nested, monoRoot, sibling)).toEqual([
      { kind: 'git-worktree', relPath: join('packages', 'other', 'a.ts') }
    ])
  })
})

describe('classifyGitDirRel：工作树白名单', () => {
  it('worktrees 目录本身、各工作树目录的增删、任一工作树的 HEAD 为 meta；其余为噪声', () => {
    expect(classifyGitDirRel('worktrees')).toBe('meta')
    expect(classifyGitDirRel(join('worktrees', 'feat'))).toBe('meta')
    expect(classifyGitDirRel(join('worktrees', 'feat', 'HEAD'))).toBe('meta')
    expect(classifyGitDirRel(join('worktrees', 'feat', 'index'))).toBe('noise')
    expect(classifyGitDirRel(join('worktrees', 'feat', 'logs', 'HEAD'))).toBe('noise')
    expect(classifyGitDirRel(join('worktrees', 'feat', 'index.lock'))).toBe('noise')
  })

  it('reftable 后端：工作树切分支只改其 reftable/，任一工作树均为 meta', () => {
    const own = join('worktrees', 'feat')
    expect(classifyGitDirRel(join('worktrees', 'other', 'reftable', 'tables.list'), own)).toBe(
      'meta'
    )
    expect(classifyGitDirRel(join('reftable', 'tables.list'), own)).toBe('meta')
  })

  it('链接工作树盯公共 gitdir：只有自己的 index 为 meta，主工作树的顶层 index 为噪声，顶层 HEAD 与 refs 仍为 meta', () => {
    const own = join('worktrees', 'feat')
    expect(classifyGitDirRel(join('worktrees', 'feat', 'index'), own)).toBe('meta')
    expect(classifyGitDirRel(join('worktrees', 'other', 'index'), own)).toBe('noise')
    expect(classifyGitDirRel(join('worktrees', 'other', 'HEAD'), own)).toBe('meta')
    expect(classifyGitDirRel('index', own)).toBe('noise')
    expect(classifyGitDirRel('HEAD', own)).toBe('meta')
    expect(classifyGitDirRel(join('refs', 'heads', 'main'), own)).toBe('meta')
  })
})

describe('classifyCommonDirPath', () => {
  const commonDir = join('/main', '.git')
  const ownGitDir = join('/main', '.git', 'worktrees', 'feat')

  it('公共 gitdir 内的白名单事件 → git-meta；噪声、目录自身与域外 → 空', () => {
    const meta = [{ kind: 'git-meta' }]
    expect(
      classifyCommonDirPath(commonDir, ownGitDir, join(commonDir, 'refs', 'heads', 'x'))
    ).toEqual(meta)
    expect(
      classifyCommonDirPath(commonDir, ownGitDir, join(commonDir, 'worktrees', 'feat'))
    ).toEqual(meta)
    expect(classifyCommonDirPath(commonDir, ownGitDir, join(ownGitDir, 'index'))).toEqual(meta)
    expect(classifyCommonDirPath(commonDir, ownGitDir, join(commonDir, 'index'))).toEqual([])
    expect(classifyCommonDirPath(commonDir, ownGitDir, join(commonDir, 'objects', 'aa'))).toEqual(
      []
    )
    expect(classifyCommonDirPath(commonDir, ownGitDir, commonDir)).toEqual([])
    expect(classifyCommonDirPath(commonDir, ownGitDir, join('/elsewhere', 'x'))).toEqual([])
  })
})
