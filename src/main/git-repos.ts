// 项目里的 Git 仓库（docs/prd/git-nested-repos.md，ADR-0060）：项目自己所在的仓库，加上项目里的嵌套仓库与子模块。
// - 项目自己所在的仓库：rev-parse 往上找；项目是上层仓库的子目录、却被那个仓库忽略时不认它（同 JetBrains）。
// - 仓库里的嵌套仓库交给 git：`ls-files --others --exclude-standard` 里以 `/` 结尾的条目正是嵌套仓库（git 不进
//   嵌套仓库，被忽略的不列）；子模块读 `.gitmodules`。两种都再经 rev-parse 确认是仓库根（子模块要已检出），
//   与加载图谱时的判断同一口径。
// - 不在任何仓库里的目录逐层读目录找 `.git`，深度不限。
// 隐藏目录与 node_modules 一概不进（JetBrains 跳过隐藏目录，VS Code 跳过 node_modules）。
// 两档：监听只要项目自己的仓库（启动时每个项目一两个 git 进程，同原先）；渲染端第一次要清单时（选中项目、
// 打开它的 Git / 文件页）才完整发现，同主流工具「打开项目时才找」。结果按项目缓存，监听看到 `.git` 增删时
// 按已有的那一档重新发现（ipc 侧接线）。

import { isAbsolute, join, relative, sep } from 'node:path'
import { promises as fs } from 'original-fs'
import { lastPathSegment, normalizePath } from '../shared/files-path'
import type { GitRepo } from '../shared/git'
import {
  clearRepoRootCache,
  execGit,
  refreshRepoRoot,
  resolveGitDirs,
  type GitDirs
} from './git-exec'

/** 主进程里的仓库条目：比渲染端多出监听与写动作队列要的信息。 */
export interface ProjectRepo extends GitRepo {
  /** 两个 gitdir；解析失败为 null */
  gitDirs: GitDirs | null
  /** 子模块所属的上级仓库（ProjectRepo.path）：子模块里的变化也会改上级的工作区状态；其余为 null */
  superPath: string | null
}

/** 发现时不进的目录名：隐藏目录与 node_modules。 */
export function isSkippedScanDir(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules'
}

function hasSkippedSegment(rel: string): boolean {
  return rel.split(/[/\\]/).some((seg) => seg !== '' && isSkippedScanDir(seg))
}

/** `ls-files --others --exclude-standard -z` 里的嵌套仓库：以 `/` 结尾的条目，去掉尾斜杠（相对 cwd，`/` 分隔）。 */
export function parseNestedRepoEntries(stdout: string): string[] {
  return stdout
    .split('\0')
    .filter((entry) => entry.endsWith('/'))
    .map((entry) => entry.slice(0, -1))
}

/** `config -f .gitmodules -z --get-regexp` 的值：每条为「键\n值」并以 NUL 结尾。 */
export function parseSubmodulePaths(stdout: string): string[] {
  return stdout
    .split('\0')
    .map((entry) => {
      const newline = entry.indexOf('\n')
      return newline < 0 ? '' : entry.slice(newline + 1)
    })
    .filter((path) => path !== '')
}

/** 同时在跑的 git 进程与读目录上限：一个目录里有几十个仓库时不一口气起几十个进程。 */
const DISCOVERY_CONCURRENCY = 8
let running = 0
const waiting: Array<() => void> = []

async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (running < DISCOVERY_CONCURRENCY) running++
  // 排到时由结束的那个直接把名额交过来
  else await new Promise<void>((resolve) => waiting.push(resolve))
  try {
    return await task()
  } finally {
    const next = waiting.shift()
    if (next) next()
    else running--
  }
}

/** 目录本身是不是仓库根（rev-parse 查到的根就是它；与加载图谱时的判断同一口径，顺带刷新仓库根缓存）。 */
async function isRepoRoot(dir: string): Promise<boolean> {
  const root = await limited(() => refreshRepoRoot(dir))
  return root !== undefined && root !== null && normalizePath(root) === normalizePath(dir)
}

/** 项目自己所在的仓库根；不在仓库里、或被上层仓库忽略为 null；git 跑不起来为 undefined。 */
async function ownRepoRoot(projectPath: string): Promise<string | null | undefined> {
  const root = await limited(() => refreshRepoRoot(projectPath))
  if (root === undefined || root === null) return root
  if (normalizePath(root) === normalizePath(projectPath)) return root
  const ignored = await limited(() => execGit(projectPath, ['check-ignore', '-q', '.']))
  return ignored.code === 0 ? null : root
}

interface FoundRepo {
  /** 仓库目录（本平台分隔符），即 ProjectRepo.path */
  path: string
  superPath: string | null
}

/**
 * 在一个仓库里找嵌套仓库与子模块，并逐个再往里找。cwd 为跑 git 的目录：项目自己的仓库为项目路径
 * （项目可能是仓库的子目录，只列项目里面的），嵌套仓库为它自己的根。
 */
async function scanRepo(
  projectPath: string,
  repoPath: string,
  root: string,
  found: FoundRepo[]
): Promise<void> {
  const [others, modules] = await Promise.all([
    limited(() => execGit(repoPath, ['ls-files', '--others', '--exclude-standard', '-z'])),
    limited(() =>
      execGit(root, [
        'config',
        '--file',
        '.gitmodules',
        '-z',
        '--get-regexp',
        '^submodule\\..*\\.path$'
      ])
    )
  ])
  const children = new Map<string, string | null>()
  if (others.code === 0) {
    for (const rel of parseNestedRepoEntries(others.stdout.toString('utf8'))) {
      children.set(join(repoPath, rel), null)
    }
  }
  if (modules.code === 0) {
    for (const rel of parseSubmodulePaths(modules.stdout.toString('utf8'))) {
      // 只认项目里面的子模块（项目可能是仓库的子目录）
      const path = join(root, rel)
      const fromProject = relative(projectPath, path)
      if (fromProject !== '' && !fromProject.startsWith('..')) children.set(path, repoPath)
    }
  }
  const candidates = [...children].filter(
    ([path]) => !hasSkippedSegment(relative(projectPath, path))
  )
  await Promise.all(
    candidates.map(async ([path, superPath]) => {
      if (!(await isRepoRoot(path))) return
      found.push({ path, superPath })
      await scanRepo(projectPath, path, path, found)
    })
  )
}

/** 不在任何仓库里的目录：逐层读目录，有 `.git` 且确是仓库根的交给 scanRepo，其余接着往下找。 */
async function walkDir(projectPath: string, dir: string, found: FoundRepo[]): Promise<void> {
  const entries = await limited(() => fs.readdir(dir, { withFileTypes: true })).catch(() => [])
  if (
    dir !== projectPath &&
    entries.some((entry) => entry.name === '.git') &&
    (await isRepoRoot(dir))
  ) {
    found.push({ path: dir, superPath: null })
    await scanRepo(projectPath, dir, dir, found)
    return
  }
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !isSkippedScanDir(entry.name))
      .map((entry) => walkDir(projectPath, join(dir, entry.name), found))
  )
}

function toSlash(path: string): string {
  return path.split(sep).join('/')
}

/**
 * 发现一遍：项目自己的仓库排第一个，嵌套仓库按名字排；full 为 false 时只要项目自己的仓库。
 * git 跑不起来为 undefined（查不了，不等于没有仓库）。
 */
async function discover(projectPath: string, full: boolean): Promise<ProjectRepo[] | undefined> {
  const ownRoot = await ownRepoRoot(projectPath)
  if (ownRoot === undefined) return undefined
  const found: FoundRepo[] = []
  if (full && ownRoot !== null) await scanRepo(projectPath, projectPath, ownRoot, found)
  else if (full) await walkDir(projectPath, projectPath, found)
  const nested = found
    .map((f) => ({ ...f, name: toSlash(relative(projectPath, f.path)) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  const entries: Array<Omit<ProjectRepo, 'gitDirs'>> = [
    ...(ownRoot !== null
      ? [
          {
            path: projectPath,
            root: ownRoot,
            name: lastPathSegment(ownRoot),
            own: true,
            superPath: null
          }
        ]
      : []),
    ...nested.map((n) => ({
      path: n.path,
      root: toSlash(n.path),
      name: n.name,
      own: false,
      superPath: n.superPath
    }))
  ]
  return Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      gitDirs: await limited(() => resolveGitDirs(entry.own ? entry.root : entry.path))
    }))
  )
}

/** 每项目缓存的清单：full 为完整发现过，否则只有项目自己的仓库（监听用）。 */
interface CachedRepos {
  repos: ProjectRepo[]
  full: boolean
}

const cache = new Map<string, CachedRepos>()
/** 首次发现在途（同一项目同一档的并发读取共用一轮），键见 inflightKey */
const inflight = new Map<string, Promise<ProjectRepo[] | undefined>>()
/** 每项目最近一轮发现的序号：晚结束的旧一轮不覆盖新一轮的结果 */
const sequence = new Map<string, number>()

function inflightKey(projectPath: string, full: boolean): string {
  return `${full ? 'full' : 'own'}\0${projectPath}`
}

async function runDiscovery(
  projectPath: string,
  full: boolean
): Promise<ProjectRepo[] | undefined> {
  const seq = (sequence.get(projectPath) ?? 0) + 1
  sequence.set(projectPath, seq)
  const repos = await discover(projectPath, full)
  if (repos !== undefined && sequence.get(projectPath) === seq) {
    cache.set(projectPath, { repos, full })
  }
  return repos
}

/** 发现一遍并缓存，同一项目同一档的并发读取共用一轮（git 跑不起来时为空、不缓存）。 */
async function sharedDiscovery(projectPath: string, full: boolean): Promise<ProjectRepo[]> {
  const key = inflightKey(projectPath, full)
  let pending = inflight.get(key)
  if (pending === undefined) {
    pending = runDiscovery(projectPath, full).finally(() => inflight.delete(key))
    inflight.set(key, pending)
  }
  return (await pending) ?? []
}

/** 项目里的全部仓库（渲染端要清单时）：完整发现过直接给，否则完整发现一遍。 */
export async function getProjectRepos(projectPath: string): Promise<ProjectRepo[]> {
  const cached = cache.get(projectPath)
  if (cached?.full === true) return cached.repos
  return sharedDiscovery(projectPath, true)
}

/** 是否完整发现过（渲染端要过它的清单）。 */
export function isFullyDiscovered(projectPath: string): boolean {
  return cache.get(projectPath)?.full === true
}

/**
 * 监听用的仓库：有缓存直接给（哪一档都行），否则只查项目自己的仓库——启动时每个项目一两个 git 进程，
 * 不把每个项目都扫一遍。完整发现在途时等它，免得另起一轮只查项目根的、晚到时把完整的结果挤掉。
 */
export async function getWatchedRepos(projectPath: string): Promise<ProjectRepo[]> {
  const cached = cache.get(projectPath)
  if (cached !== undefined) return cached.repos
  return sharedDiscovery(projectPath, inflight.has(inflightKey(projectPath, true)))
}

function shapeOf(repos: readonly ProjectRepo[]): string {
  return JSON.stringify(
    repos.map((r) => [r.path, r.root, r.name, r.superPath, r.gitDirs?.gitDir, r.gitDirs?.commonDir])
  )
}

/**
 * 重新发现（绕过缓存），按已有的那一档：只查过项目根的仍只查项目根（没打开过的项目不因 `.git` 变化被整个扫一遍）；
 * 从未发现过、或完整发现在途时完整发现。changed 含此前从未发现过。git 跑不起来时维持原清单、不算变化。
 */
export async function revalidateProjectRepos(
  projectPath: string
): Promise<{ repos: ProjectRepo[]; changed: boolean }> {
  const before = cache.get(projectPath)
  const full = before?.full !== false || inflight.has(inflightKey(projectPath, true))
  const repos = await runDiscovery(projectPath, full)
  if (repos === undefined) return { repos: before?.repos ?? [], changed: false }
  const latest = cache.get(projectPath)?.repos ?? repos
  for (const repo of before?.repos ?? []) {
    if (!repo.own && !latest.some((r) => r.path === repo.path)) clearRepoRootCache(repo.path)
  }
  return {
    repos: latest,
    changed: before === undefined || shapeOf(before.repos) !== shapeOf(latest)
  }
}

/**
 * 只重查项目自己所在的仓库（便宜：一两个 git 进程），与缓存的不一样才重新发现一遍。Git Tab 到前台时的兜底
 * 用它——项目根 init / 删 .git 的跟进与从前一样，嵌套仓库的增删交给监听与手动刷新，免得每次切回都把整个项目扫一遍。
 */
export async function revalidateOwnRepo(
  projectPath: string
): Promise<{ repos: ProjectRepo[]; changed: boolean }> {
  const cached = cache.get(projectPath)
  if (cached === undefined) return revalidateProjectRepos(projectPath)
  const own = await ownRepoRoot(projectPath)
  if (own === undefined || own === (cached.repos.find((r) => r.own)?.root ?? null)) {
    return { repos: cached.repos, changed: false }
  }
  return revalidateProjectRepos(projectPath)
}

/** 项目移除：忘掉它的仓库清单与嵌套仓库的仓库根缓存。 */
export function forgetProjectRepos(projectPath: string): void {
  for (const repo of cache.get(projectPath)?.repos ?? []) {
    if (!repo.own) clearRepoRootCache(repo.path)
  }
  cache.delete(projectPath)
  inflight.delete(inflightKey(projectPath, true))
  inflight.delete(inflightKey(projectPath, false))
  sequence.delete(projectPath)
}

/** path 是否就是 dir 或在它里面（本平台路径）。 */
function isWithin(path: string, dir: string): boolean {
  const rel = relative(dir, path)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/**
 * 项目移除后没人再用的仓库键（GitRepo.path，每仓库设置的键）：在移除的项目目录里、又不在任何剩下的项目目录里
 * （剩下的项目可能就是它里面的嵌套仓库，或者它本身是剩下项目里的嵌套仓库）。按路径判断，不靠发现过的清单——
 * 没打开过的项目没完整发现过。
 */
export function orphanedRepoPaths(
  repoPaths: readonly string[],
  removedProject: string,
  remainingProjects: readonly string[]
): string[] {
  return repoPaths.filter(
    (path) =>
      isWithin(path, removedProject) &&
      !remainingProjects.some((project) => isWithin(path, project))
  )
}

/** 交给渲染端的形状：去掉主进程内部字段。 */
export function toGitRepo(repo: ProjectRepo): GitRepo {
  return { path: repo.path, root: repo.root, name: repo.name, own: repo.own }
}
