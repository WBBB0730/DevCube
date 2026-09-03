import { basename, isAbsolute, relative, sep } from 'path'
import { isIdeIgnoredEntryName } from '../shared/files-tree-filter'
import { CONVENTION_WATCH_FILES, isDotnetProjectFile, LOCKFILE_NAMES } from './discovery'

/** 项目根清单 / lockfile / 约定指纹（与原 discovery watcher 白名单一致）。 */
const ROOT_WATCH_NAMES = new Set<string>([
  'package.json',
  ...LOCKFILE_NAMES,
  ...CONVENTION_WATCH_FILES
])

export type WatchEventClass =
  | { kind: 'discovery' }
  | { kind: 'files' }
  | { kind: 'git-meta' }
  | { kind: 'git-worktree'; relPath: string }
  | { kind: 'git-probe' }

/** 监听根：有仓库则盯仓库根（覆盖 .git 与嵌套项目），否则盯项目路径。 */
export function resolveWatchRoot(projectPath: string, repoRoot: string | null): string {
  return repoRoot ?? projectPath
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
 * gitdir 内路径分类：白名单元数据 vs objects/logs 等噪声。
 * `ownGitDirRel` = 本项目工作树在该 gitdir 内的私有目录：盯自己的 `.git` 时为 null；
 * 链接工作树盯主仓库公共 gitdir 时为 `worktrees/<名>`（见 classifyCommonDirPath）。
 * - 顶层 HEAD：null 时是自己的 HEAD，非 null 时是主工作树的 HEAD（分支占用标注要跟进）→ 均 meta
 * - 顶层 index：只有自己的才 meta（别的工作树的暂存区与本项目无关）
 * - `worktrees` / `worktrees/<名>`：工作树增删 → meta；`worktrees/<名>/HEAD`：任一工作树切分支 → meta；
 *   `worktrees/<名>/index`：仅自己的 → meta
 */
export function classifyGitDirRel(
  relFromGitDir: string,
  ownGitDirRel: string | null = null
): 'meta' | 'noise' {
  if (relFromGitDir.endsWith('.lock')) return 'noise'
  const norm = relFromGitDir.split(/[/\\]/).join('/')
  const ownNorm = ownGitDirRel === null ? null : ownGitDirRel.split(/[/\\]/).join('/')
  if (norm === 'HEAD' || norm === 'config') return 'meta'
  if (norm === 'index') return ownNorm === null ? 'meta' : 'noise'
  if (norm === 'refs' || norm.startsWith('refs/')) return 'meta'
  if (norm === 'worktrees') return 'meta'
  const linked = norm.match(/^worktrees\/([^/]+)(?:\/(.*))?$/)
  if (linked) {
    const inner = linked[2] ?? ''
    if (inner === '' || inner === 'HEAD') return 'meta'
    if (inner === 'index' && ownNorm === `worktrees/${linked[1]}`) return 'meta'
  }
  return 'noise'
}

/**
 * 链接工作树额外盯主仓库公共 gitdir 的事件分类：只驱动 git 通道（工作区文件与
 * discovery 仍由项目目录那条订阅负责）。`ownGitDir` 为本工作树私有 gitdir（在 commonDir 下）。
 */
export function classifyCommonDirPath(
  commonDir: string,
  ownGitDir: string,
  absPath: string
): WatchEventClass[] {
  const rel = relativeInside(commonDir, absPath)
  if (rel === null || rel === '') return []
  const ownRel = relativeInside(commonDir, ownGitDir)
  const ownGitDirRel = ownRel === null || ownRel === '' ? null : ownRel
  return classifyGitDirRel(rel, ownGitDirRel) === 'meta' ? [{ kind: 'git-meta' }] : []
}

function pathHasIdeIgnoredSegment(absPath: string): boolean {
  return absPath.split(/[/\\]/).some((seg) => seg !== '' && isIdeIgnoredEntryName(seg))
}

/**
 * 将一条绝对路径事件归到 discovery / files / git 通道（可多通道）。
 * 不硬编码语言生态目录；`.git` 白名单是仓库元数据边界，工作区噪声靠事后 check-ignore。
 */
export function classifyWatchPathAll(
  projectPath: string,
  repoRoot: string | null,
  absPath: string
): WatchEventClass[] {
  if (repoRoot === null) {
    const gitAtProject = `${projectPath}${sep}.git`
    if (absPath === gitAtProject || isPathInside(gitAtProject, absPath)) {
      return [{ kind: 'git-probe' }]
    }
    const out: WatchEventClass[] = []
    if (isProjectRootEntry(projectPath, absPath) && isDiscoveryRootName(basename(absPath))) {
      out.push({ kind: 'discovery' })
    }
    if (isPathInside(projectPath, absPath) && !pathHasIdeIgnoredSegment(absPath)) {
      out.push({ kind: 'files' })
    }
    return out
  }

  const gitDir = `${repoRoot}${sep}.git`
  if (absPath === gitDir || isPathInside(gitDir, absPath)) {
    const rel = absPath === gitDir ? '' : relative(gitDir, absPath)
    if (rel === '') return [{ kind: 'git-probe' }]
    return classifyGitDirRel(rel) === 'meta' ? [{ kind: 'git-meta' }] : []
  }

  const relPath = relativeInside(repoRoot, absPath)
  if (relPath === null || relPath === '') return []

  const out: WatchEventClass[] = [{ kind: 'git-worktree', relPath }]
  if (!isPathInside(projectPath, absPath)) return out

  if (isProjectRootEntry(projectPath, absPath) && isDiscoveryRootName(basename(absPath))) {
    out.push({ kind: 'discovery' })
  }
  if (!pathHasIdeIgnoredSegment(absPath)) {
    out.push({ kind: 'files' })
  }
  return out
}
