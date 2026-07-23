import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
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
    expect(
      classifyWatchPathAll(project, project, join(project, '.git', 'objects', 'aa'))
    ).toEqual([])
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
