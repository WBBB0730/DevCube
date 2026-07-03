// Git 仓库监听：精确 watch .git 下与图谱视图相关的少数目标（HEAD/index/config/refs），
// 绝不递归整个 .git —— objects/、logs/ 的写入量大且无 UI 意义，会造成事件风暴。
// 风格与 watcher.ts 一致：Map 持有 + 幂等对齐；防抖 750ms 按项目分桶（各项目独立计时）。

import chokidar, { type FSWatcher } from 'chokidar'
import { join } from 'path'
import { isGitActionRunning } from './git-actions'

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
  watcher: FSWatcher
  /** 该项目的防抖计时器（尾沿），与其他项目互不干扰 */
  timer: ReturnType<typeof setTimeout> | null
}

const watchers = new Map<string, GitWatcherEntry>()

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

/** 重置该项目的防抖计时器；到期后回调一次「仓库有变化」。 */
function scheduleChange(projectPath: string, onChange: (projectPath: string) => void): void {
  const entry = watchers.get(projectPath)
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => {
    entry.timer = null
    onChange(projectPath)
  }, DEBOUNCE_MS)
}

/** 关掉一个项目的 watcher 并清掉未到期的防抖计时器。 */
function disposeEntry(projectPath: string, entry: GitWatcherEntry): void {
  if (entry.timer) clearTimeout(entry.timer)
  void entry.watcher.close()
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
      scheduleChange(projectPath, onChange)
    })
    watchers.set(projectPath, { repoRoot, watcher, timer: null })
  }
}

/** 关闭全部 git watcher（应用退出前兜底清理）。 */
export function closeAllGitWatchers(): void {
  for (const [projectPath, entry] of watchers) disposeEntry(projectPath, entry)
}
