import { basename, isAbsolute, join, relative, sep } from 'path'
import type { GitDirs } from './git-exec'
import { isIdeIgnoredEntryName } from '../shared/files-tree-filter'
import { CONVENTION_WATCH_FILES, isDotnetProjectFile, LOCKFILE_NAMES } from './discovery'

/** 项目根清单 / lockfile / 约定指纹（与原 discovery watcher 白名单一致）。 */
const ROOT_WATCH_NAMES = new Set<string>([
  'package.json',
  ...LOCKFILE_NAMES,
  ...CONVENTION_WATCH_FILES
])

/** 监听要知道的一个仓库（ProjectRepo 的子集，路径均为本平台写法）。 */
export interface WatchRepo {
  /** ProjectRepo.path：git:changed 的键 */
  path: string
  /** 仓库根 */
  root: string
  /** 两个 gitdir；解析失败为 null（按 `<根>/.git` 认） */
  gitDirs: GitDirs | null
  /** 子模块所属的上级仓库（WatchRepo.path）；其余为 null */
  superPath: string | null
}

export type WatchEventClass =
  | { kind: 'discovery' }
  | { kind: 'files' }
  | { kind: 'git-meta'; repo: string }
  | { kind: 'git-worktree'; repo: string; relPath: string }
  /** 仓库清单可能变了（某处 `.git` 增删、嵌套仓库所在目录被删或改名）：重新发现 */
  | { kind: 'git-probe' }

/** 监听根：项目在仓库里则盯项目自己所在仓库的根（覆盖 .git 与项目外的同仓库路径），否则盯项目路径。 */
export function resolveWatchRoot(projectPath: string, ownRoot: string | null): string {
  return ownRoot ?? projectPath
}

/**
 * `target` 相对 `parent` 的路径；在 `parent` 之外则 `null`；自身为 `''`。
 * `isPathInside` / 根条目判定共用，避免两套 `relative` 边界逻辑分叉。
 */
export function relativeInside(parent: string, target: string): string | null {
  const rel = relative(parent, target)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) return null
  return rel
}

export function isPathInside(parent: string, target: string): boolean {
  return relativeInside(parent, target) !== null
}

function isProjectRootEntry(projectPath: string, absPath: string): boolean {
  const rel = relativeInside(projectPath, absPath)
  return rel !== null && rel !== '' && !rel.includes(sep)
}

export function isDiscoveryRootName(name: string): boolean {
  return ROOT_WATCH_NAMES.has(name) || isDotnetProjectFile(name)
}

/**
 * 引用存储（gitdir 或 `worktrees/<名>` 内的相对路径，'/' 分隔）：files 后端的 HEAD / refs / packed-refs，
 * reftable 后端的 reftable/（该格式下 HEAD 文件是固定占位，切分支只改 reftable/）。任一变化即引用变化。
 */
function isRefStorage(rel: string): boolean {
  return (
    rel === 'HEAD' ||
    rel === 'packed-refs' ||
    rel === 'refs' ||
    rel.startsWith('refs/') ||
    rel === 'reftable' ||
    rel.startsWith('reftable/')
  )
}

/**
 * gitdir 内路径分类：白名单元数据 vs objects/logs 等噪声。
 * `ownGitDirRel` = 本项目工作树在该 gitdir 内的私有目录：盯自己的 `.git` 时为 null；
 * 链接工作树盯主仓库公共 gitdir 时为 `worktrees/<名>`（见 classifyCommonDirPath）。
 * - 顶层引用存储：null 时含自己的 HEAD，非 null 时含主工作树的 HEAD（分支占用标注要跟进）→ 均 meta
 * - 顶层 index：只有自己的才 meta（别的工作树的暂存区与本项目无关）
 * - `worktrees` / `worktrees/<名>`：工作树增删 → meta；`worktrees/<名>` 内的引用存储：任一工作树切分支 → meta；
 *   `worktrees/<名>/index`：仅自己的 → meta
 */
export function classifyGitDirRel(
  relFromGitDir: string,
  ownGitDirRel: string | null = null
): 'meta' | 'noise' {
  if (relFromGitDir.endsWith('.lock')) return 'noise'
  const norm = relFromGitDir.split(/[/\\]/).join('/')
  const ownNorm = ownGitDirRel === null ? null : ownGitDirRel.split(/[/\\]/).join('/')
  if (isRefStorage(norm) || norm === 'config') return 'meta'
  if (norm === 'index') return ownNorm === null ? 'meta' : 'noise'
  if (norm === 'worktrees') return 'meta'
  const linked = norm.match(/^worktrees\/([^/]+)(?:\/(.*))?$/)
  if (linked) {
    const inner = linked[2] ?? ''
    if (inner === '' || isRefStorage(inner)) return 'meta'
    if (inner === 'index' && ownNorm === `worktrees/${linked[1]}`) return 'meta'
  }
  return 'noise'
}

/**
 * 路径落在某仓库的 gitdir 里时的分类（不在则 null）：链接工作树与子模块的 gitdir 在别处（主仓库的公共 gitdir、
 * 上级仓库的 `.git/modules/…`），按公共 gitdir 内的相对路径与本工作树私有目录走 classifyGitDirRel。
 * gitdir 目录自身（`<根>/.git` 增删）为 probe。
 */
export function classifyRepoGitDirPath(
  repo: WatchRepo,
  absPath: string
): 'meta' | 'noise' | 'probe' | null {
  const own = repo.gitDirs?.gitDir ?? join(repo.root, '.git')
  const common = repo.gitDirs?.commonDir ?? own
  const rel = relativeInside(common, absPath)
  if (rel !== null) {
    if (rel === '') return own === common ? 'probe' : 'noise'
    const ownRel = relativeInside(common, own)
    return classifyGitDirRel(rel, ownRel === null || ownRel === '' ? null : ownRel)
  }
  const ownRel = relativeInside(own, absPath)
  if (ownRel === null) return null
  return ownRel === '' ? 'probe' : classifyGitDirRel(ownRel)
}

export function pathHasIdeIgnoredSegment(absPath: string): boolean {
  return absPath.split(/[/\\]/).some((seg) => seg !== '' && isIdeIgnoredEntryName(seg))
}

/**
 * 将一条绝对路径事件归到 discovery / files / git 通道（可多通道）。git 通道按仓库：gitdir 里的白名单元数据
 * 归那个仓库（一条路径可同时在几个仓库的 gitdir 里，如主仓库与它的链接工作树），工作区路径归离它最近的仓库
 * （嵌套仓库里的文件不归外层）。不硬编码语言生态目录；`.git` 白名单是仓库元数据边界，工作区噪声靠事后 check-ignore。
 */
export function classifyWatchPathAll(
  projectPath: string,
  repos: readonly WatchRepo[],
  absPath: string
): WatchEventClass[] {
  const out: WatchEventClass[] = []
  let probe = basename(absPath) === '.git' || touchesNestedRepoRoot(projectPath, repos, absPath)
  let inGitDir = false
  for (const repo of repos) {
    const cls = classifyRepoGitDirPath(repo, absPath)
    if (cls === null) continue
    inGitDir = true
    if (cls === 'meta') out.push({ kind: 'git-meta', repo: repo.path })
    else if (cls === 'probe') probe = true
  }
  if (probe) out.push({ kind: 'git-probe' })
  if (inGitDir) return out

  const owner = innermostWatchRepo(repos, absPath)
  if (owner !== null) {
    const relPath = relativeInside(owner.root, absPath)
    if (relPath !== null && relPath !== '') {
      out.push({ kind: 'git-worktree', repo: owner.path, relPath })
    }
  }
  if (!isPathInside(projectPath, absPath)) return out
  if (isProjectRootEntry(projectPath, absPath) && isDiscoveryRootName(basename(absPath))) {
    out.push({ kind: 'discovery' })
  }
  if (!pathHasIdeIgnoredSegment(absPath)) {
    out.push({ kind: 'files' })
  }
  return out
}

/** 工作区路径所在的最内层仓库。 */
function innermostWatchRepo(repos: readonly WatchRepo[], absPath: string): WatchRepo | null {
  let best: WatchRepo | null = null
  for (const repo of repos) {
    if (!isPathInside(repo.root, absPath)) continue
    if (best === null || isPathInside(best.root, repo.root)) best = repo
  }
  return best
}

/** 路径是项目里某个嵌套仓库的根或其上级目录（目录被删除、改名时仓库跟着没了）。 */
function touchesNestedRepoRoot(
  projectPath: string,
  repos: readonly WatchRepo[],
  absPath: string
): boolean {
  if (!isPathInside(projectPath, absPath) || relativeInside(projectPath, absPath) === '')
    return false
  return repos.some((repo) => repo.path !== projectPath && isPathInside(absPath, repo.root))
}
