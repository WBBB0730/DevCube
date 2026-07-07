// Git 仓库监听，每项目两个 watcher：
// 1) .git 白名单（HEAD/index/config/refs）—— 绝不递归整个 .git：objects/、logs/ 的写入量
//    大且无 UI 意义，会造成事件风暴；
// 2) 工作区递归（仅排除 .git）—— 未跟踪 / 修改文件的增删改不触碰 .git，须监听工作区才能让
//    未提交行统计与提交面板文件树及时刷新（macOS FSEvents 递归监听开销低）。忽略规则零硬编码：
//    事件路径在防抖到期后经 `git check-ignore` 批量过滤，.gitignore / info/exclude / 全局
//    excludesfile 全部由 git 自己裁决，不假设任何语言生态的目录布局。
// 风格与 watcher.ts 一致：Map 持有 + 幂等对齐；防抖 750ms 按项目分桶（两个 watcher 共用计时）。

import chokidar, { type FSWatcher } from 'chokidar'
import { join, relative } from 'path'
import { isGitActionRunning } from './git-actions'
import { execGit } from './git-exec'

/** 防抖窗口：一次 git 操作（如 pull）会连发大量文件事件，尾沿防抖收敛为一次回调。 */
const DEBOUNCE_MS = 750

/**
 * refs 目录的递归深度上限：覆盖 refs/remotes/<远程>/<含斜杠的分支名> 的常见嵌套；
 * 更深的极端嵌套错过事件时由手动刷新兜底（浅递归可接受，见 watch-refresh 规格 §1）。
 */
const REFS_DEPTH = 4

interface GitWatcherEntry {
  /** 建 watcher 时的仓库根 —— 对齐时用于探测 repoRoot 变化（如 .git 被删除后重建）以重建 watcher */
  repoRoot: string
  /** .git 白名单 watcher（HEAD/index/config/refs） */
  watcher: FSWatcher
  /** 工作区递归 watcher（仅排除 .git） */
  worktreeWatcher: FSWatcher
  /** 该项目的防抖计时器（尾沿），与其他项目互不干扰 */
  timer: ReturnType<typeof setTimeout> | null
  /** 防抖窗口内累计的工作区相对路径（待 check-ignore 判定）；null = 本轮已含必刷新事件 */
  pendingPaths: Set<string> | null
}

const watchers = new Map<string, GitWatcherEntry>()

/** 工作区监听仅排除 .git（git 自身结构，由白名单 watcher 专管）；其余交给 check-ignore。 */
const WORKTREE_IGNORED = /(^|[/\\])\.git([/\\]|$)/

/** 防抖窗口内待判定路径的收集上限：超过（事件风暴，如批量安装依赖）直接视为需刷新。 */
const PENDING_PATHS_MAX = 200

/** 监听目标清单：只列白名单文件/目录，忽略锁文件的过滤在 chokidar ignored 里做。 */
function watchTargets(repoRoot: string): string[] {
  const gitDir = join(repoRoot, '.git')
  return [
    join(gitDir, 'HEAD'), // checkout / 分支切换
    join(gitDir, 'index'), // 暂存区变化 → 未提交变更数变化
    join(gitDir, 'config'), // 远程增删改、分支 upstream 变化
    join(gitDir, 'refs') // 分支 / 标签 / stash 等引用变化（浅递归）
  ]
}

/**
 * 记录一次变更事件并重置防抖计时器：relPath 为工作区相对路径（进入待判定集），
 * null 表示 .git 白名单事件（必刷新，本轮跳过 ignore 判定）。到期后工作区路径先经
 * git check-ignore 批量过滤，存在未被忽略的路径才回调「仓库有变化」。
 */
function scheduleChange(
  projectPath: string,
  onChange: (projectPath: string) => void,
  relPath: string | null
): void {
  const entry = watchers.get(projectPath)
  if (!entry) return
  if (relPath === null || entry.pendingPaths === null) {
    entry.pendingPaths = null
  } else if (entry.pendingPaths.size >= PENDING_PATHS_MAX) {
    // 事件风暴：停止逐条判定，本轮直接视为需刷新（保守正确；软刷新数据未变时零重渲染）
    entry.pendingPaths = null
  } else {
    entry.pendingPaths.add(relPath)
  }
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => {
    entry.timer = null
    const paths = entry.pendingPaths
    entry.pendingPaths = new Set()
    if (paths === null) onChange(projectPath)
    else void notifyIfNotIgnored(projectPath, entry.repoRoot, [...paths], onChange)
  }, DEBOUNCE_MS)
}

/**
 * 工作区事件路径经 `git check-ignore` 批量过滤后决定是否通知刷新——忽略规则零硬编码，
 * .gitignore / .git/info/exclude / 全局 excludesfile 全部由 git 自己裁决。退出码 0 且
 * 全部被忽略才吞掉本轮；其余（1 = 全未被忽略、fatal 等）保守通知。已知边缘：check-ignore
 * 只看规则不看跟踪状态，「已跟踪但被规则匹配」的文件变更会被误吞——该配置本身即仓库异味，接受。
 */
async function notifyIfNotIgnored(
  projectPath: string,
  repoRoot: string,
  paths: string[],
  onChange: (projectPath: string) => void
): Promise<void> {
  const result = await execGit(repoRoot, ['check-ignore', '-z', '--', ...paths])
  if (result.code === 0) {
    const ignored = result.stdout
      .toString('utf8')
      .split('\0')
      .filter((p) => p !== '')
    if (ignored.length >= paths.length) return // 全部被忽略：不刷新
  }
  onChange(projectPath)
}

/** 关掉一个项目的 watcher 并清掉未到期的防抖计时器。 */
function disposeEntry(projectPath: string, entry: GitWatcherEntry): void {
  if (entry.timer) clearTimeout(entry.timer)
  void entry.watcher.close()
  void entry.worktreeWatcher.close()
  watchers.delete(projectPath)
}

/**
 * 让监听集合与当前项目集合对齐：新增项目起监听，移除项目关监听；
 * repoRoot 为 null（非 git 仓库）的项目跳过，repoRoot 变化的项目重建 watcher。
 */
export function syncGitWatchers(
  projects: { projectPath: string; repoRoot: string | null }[],
  onChange: (projectPath: string) => void
): void {
  // 期望集合：projectPath → repoRoot（剔除非 git 仓库）
  const wanted = new Map<string, string>()
  for (const project of projects) {
    if (project.repoRoot !== null) wanted.set(project.projectPath, project.repoRoot)
  }
  // 移除：项目已不在集合中，或 repoRoot 已变化 —— 后者关掉旧 watcher 让下面的新增分支重建
  for (const [projectPath, entry] of watchers) {
    if (wanted.get(projectPath) !== entry.repoRoot) disposeEntry(projectPath, entry)
  }
  // 新增（含 repoRoot 变化后的重建）
  for (const [projectPath, repoRoot] of wanted) {
    if (watchers.has(projectPath)) continue
    const watcher = chokidar.watch(watchTargets(repoRoot), {
      ignoreInitial: true,
      // git 写操作的锁文件（index.lock、refs/heads/x.lock 等）无 UI 意义，直接忽略
      ignored: (path: string) => path.endsWith('.lock'),
      depth: REFS_DEPTH
    })
    watcher.on('all', () => {
      // 动作执行期间（含结束后 1500ms 余震窗口，git-actions 内置）丢弃事件且不进防抖队列：
      // 动作成功后渲染端自会软刷新，静音只为避免「动作 → 文件事件 → 又一次刷新」的重复刷新
      if (isGitActionRunning()) return
      scheduleChange(projectPath, onChange, null)
    })
    const worktreeWatcher = chokidar.watch(repoRoot, {
      ignoreInitial: true,
      ignored: (path: string) => WORKTREE_IGNORED.test(path)
    })
    worktreeWatcher.on('all', (_event, eventPath: string) => {
      if (isGitActionRunning()) return
      const rel = relative(repoRoot, eventPath)
      if (rel === '') return // 仓库根自身的目录事件无实义
      scheduleChange(projectPath, onChange, rel)
    })
    watchers.set(projectPath, {
      repoRoot,
      watcher,
      worktreeWatcher,
      timer: null,
      pendingPaths: new Set()
    })
  }
}

/** 关闭全部 git watcher（应用退出前兜底清理）。 */
export function closeAllGitWatchers(): void {
  for (const [projectPath, entry] of watchers) disposeEntry(projectPath, entry)
}
