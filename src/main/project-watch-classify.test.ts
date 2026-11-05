import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  classifyGitDirRel,
  classifyRepoGitDirPath,
  classifyWatchPathAll,
  isDiscoveryRootName,
  isPathInside,
  relativeInside,
  resolveWatchRoot,
  type WatchRepo
} from './project-watch-classify'

const project = join('/repo', 'app')
const monoRoot = join('/mono')
const nested = join('/mono', 'packages', 'app')

/** 主工作树形态的仓库：gitdir 即 `<根>/.git`。 */
function repo(path: string, root = path, superPath: string | null = null): WatchRepo {
  const gitDir = join(root, '.git')
  return { path, root, gitDirs: { gitDir, commonDir: gitDir }, superPath }
}

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
    expect(classifyWatchPathAll(project, [], join(project, '.git'))).toEqual([
      { kind: 'git-probe' }
    ])
    expect(classifyWatchPathAll(project, [], join(project, 'package.json'))).toEqual([
      { kind: 'discovery' },
      { kind: 'files' }
    ])
  })

  it('非仓库：IDE 忽略名不进 files', () => {
    expect(classifyWatchPathAll(project, [], join(project, '.DS_Store'))).toEqual([])
  })

  it('仓库：工作区源码 → git-worktree+files；node_modules 仍进 git-worktree（交 check-ignore）', () => {
    const repos = [repo(project)]
    const src = join(project, 'src', 'a.ts')
    expect(classifyWatchPathAll(project, repos, src)).toEqual([
      { kind: 'git-worktree', repo: project, relPath: join('src', 'a.ts') },
      { kind: 'files' }
    ])
    const nm = join(project, 'node_modules', 'x', 'index.js')
    expect(classifyWatchPathAll(project, repos, nm)).toEqual([
      { kind: 'git-worktree', repo: project, relPath: join('node_modules', 'x', 'index.js') },
      { kind: 'files' }
    ])
  })

  it('仓库：.git/objects 忽略；HEAD 为 meta；.git 自身增删为 probe', () => {
    const repos = [repo(project)]
    expect(classifyWatchPathAll(project, repos, join(project, '.git', 'objects', 'aa'))).toEqual([])
    expect(classifyWatchPathAll(project, repos, join(project, '.git', 'HEAD'))).toEqual([
      { kind: 'git-meta', repo: project }
    ])
    expect(classifyWatchPathAll(project, repos, join(project, '.git'))).toEqual([
      { kind: 'git-probe' }
    ])
  })

  it('项目是仓库子目录：仓库根下项目外路径只驱动 git-worktree', () => {
    const sibling = join(monoRoot, 'packages', 'other', 'a.ts')
    expect(classifyWatchPathAll(nested, [repo(nested, monoRoot)], sibling)).toEqual([
      { kind: 'git-worktree', repo: nested, relPath: join('packages', 'other', 'a.ts') }
    ])
  })

  it('嵌套仓库：文件归离它最近的仓库，gitdir 元数据只归它自己', () => {
    const inner = join(project, 'libs', 'inner')
    const repos = [repo(project), repo(inner)]
    expect(classifyWatchPathAll(project, repos, join(inner, 'src', 'b.ts'))).toEqual([
      { kind: 'git-worktree', repo: inner, relPath: join('src', 'b.ts') },
      { kind: 'files' }
    ])
    expect(classifyWatchPathAll(project, repos, join(inner, '.git', 'HEAD'))).toEqual([
      { kind: 'git-meta', repo: inner }
    ])
  })

  it('嵌套仓库所在目录被删或改名、某处新出现 .git → probe', () => {
    const inner = join(project, 'libs', 'inner')
    const repos = [repo(project), repo(inner)]
    expect(classifyWatchPathAll(project, repos, join(project, 'libs'))).toEqual([
      { kind: 'git-probe' },
      { kind: 'git-worktree', repo: project, relPath: 'libs' },
      { kind: 'files' }
    ])
    expect(classifyWatchPathAll(project, repos, inner)).toEqual([
      { kind: 'git-probe' },
      { kind: 'files' }
    ])
    expect(classifyWatchPathAll(project, repos, join(project, 'new', '.git'))).toEqual([
      { kind: 'git-probe' },
      { kind: 'git-worktree', repo: project, relPath: join('new', '.git') }
    ])
  })

  it('子模块：gitdir 在上级的 .git/modules 里，元数据归子模块，不归上级', () => {
    const lib = join(project, 'lib')
    const libGitDir = join(project, '.git', 'modules', 'lib')
    const repos: WatchRepo[] = [
      repo(project),
      {
        path: lib,
        root: lib,
        gitDirs: { gitDir: libGitDir, commonDir: libGitDir },
        superPath: project
      }
    ]
    expect(classifyWatchPathAll(project, repos, join(libGitDir, 'HEAD'))).toEqual([
      { kind: 'git-meta', repo: lib }
    ])
    expect(classifyWatchPathAll(project, repos, join(libGitDir, 'objects', 'aa'))).toEqual([])
  })

  it('主仓库与它的链接工作树都在项目里：任一工作树切分支两边都是 meta', () => {
    const main = join(project, 'main')
    const wt = join(project, 'wt')
    const common = join(main, '.git')
    const repos: WatchRepo[] = [
      repo(main),
      {
        path: wt,
        root: wt,
        gitDirs: { gitDir: join(common, 'worktrees', 'wt'), commonDir: common },
        superPath: null
      }
    ]
    expect(classifyWatchPathAll(project, repos, join(common, 'worktrees', 'wt', 'HEAD'))).toEqual([
      { kind: 'git-meta', repo: main },
      { kind: 'git-meta', repo: wt }
    ])
    // 链接工作树自己的 index 只归它
    expect(classifyWatchPathAll(project, repos, join(common, 'worktrees', 'wt', 'index'))).toEqual([
      { kind: 'git-meta', repo: wt }
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

describe('classifyRepoGitDirPath', () => {
  const commonDir = join('/main', '.git')
  const ownGitDir = join('/main', '.git', 'worktrees', 'feat')
  const linked: WatchRepo = {
    path: join('/feat'),
    root: join('/feat'),
    gitDirs: { gitDir: ownGitDir, commonDir },
    superPath: null
  }

  it('链接工作树：公共 gitdir 内的白名单事件 → meta；噪声、目录自身 → noise；域外 → null', () => {
    expect(classifyRepoGitDirPath(linked, join(commonDir, 'refs', 'heads', 'x'))).toBe('meta')
    expect(classifyRepoGitDirPath(linked, join(commonDir, 'worktrees', 'feat'))).toBe('meta')
    expect(classifyRepoGitDirPath(linked, join(ownGitDir, 'index'))).toBe('meta')
    expect(classifyRepoGitDirPath(linked, join(commonDir, 'index'))).toBe('noise')
    expect(classifyRepoGitDirPath(linked, join(commonDir, 'objects', 'aa'))).toBe('noise')
    expect(classifyRepoGitDirPath(linked, commonDir)).toBe('noise')
    expect(classifyRepoGitDirPath(linked, join('/elsewhere', 'x'))).toBeNull()
  })

  it('gitdir 没解析出来时按 <根>/.git 认', () => {
    const plain: WatchRepo = { path: project, root: project, gitDirs: null, superPath: null }
    expect(classifyRepoGitDirPath(plain, join(project, '.git', 'HEAD'))).toBe('meta')
    expect(classifyRepoGitDirPath(plain, join(project, '.git'))).toBe('probe')
  })
})
