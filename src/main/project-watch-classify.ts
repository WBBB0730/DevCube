import { basename, isAbsolute, relative, sep } from 'path'
import { isIdeIgnoredEntryName } from '../shared/files-tree-filter'
import {
  CONVENTION_WATCH_FILES,
  isDotnetProjectFile,
  LOCKFILE_NAMES
} from './discovery'

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

/** `.git` 目录内：白名单元数据 vs objects/logs 等噪声。 */
export function classifyGitDirRel(relFromGitDir: string): 'meta' | 'noise' {
  if (relFromGitDir.endsWith('.lock')) return 'noise'
  const norm = relFromGitDir.split(/[/\\]/).join('/')
  if (norm === 'HEAD' || norm === 'index' || norm === 'config') return 'meta'
  if (norm === 'refs' || norm.startsWith('refs/')) return 'meta'
  return 'noise'
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
