// Files Tab 项目树监听：递归盯项目根，尾沿防抖后通知渲染端重拉已缓存目录 / 同步打开文件。
// 风格对齐 git-watcher（Map + 幂等 sync + 防抖）；忽略规则对齐 VS Code watcherExclude 常见项
// （.git / node_modules）+ IDE 忽略名路径段——降低事件风暴；树展示仍可手动展开 node_modules。

import chokidar, { type FSWatcher } from 'chokidar'
import { basename } from 'node:path'
import { isIdeIgnoredEntryName } from '../shared/files-tree-filter'

const DEBOUNCE_MS = 750

/** 路径段级忽略：.git、node_modules、以及 IDE 默认忽略名（如 .DS_Store、__pycache__）。 */
const IGNORED_SEGMENT =
  /(^|[/\\])(\.git|node_modules|\.DS_Store|\.hg|\.svn|CVS|__pycache__|_svn)([/\\]|$)/i

interface FilesWatcherEntry {
  watcher: FSWatcher
  timer: ReturnType<typeof setTimeout> | null
}

const watchers = new Map<string, FilesWatcherEntry>()

function shouldIgnoreWatchPath(fullPath: string): boolean {
  if (IGNORED_SEGMENT.test(fullPath)) return true
  return isIdeIgnoredEntryName(basename(fullPath))
}

function disposeEntry(projectPath: string, entry: FilesWatcherEntry): void {
  if (entry.timer) clearTimeout(entry.timer)
  void entry.watcher.close()
  watchers.delete(projectPath)
}

function scheduleChange(projectPath: string, onChange: (projectPath: string) => void): void {
  const entry = watchers.get(projectPath)
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => {
    entry.timer = null
    onChange(projectPath)
  }, DEBOUNCE_MS)
}

/** 让监听集合与当前项目集合对齐：新增起听，移除关闭。 */
export function syncFilesWatchers(
  projectPaths: string[],
  onChange: (projectPath: string) => void
): void {
  const wanted = new Set(projectPaths)
  for (const [projectPath, entry] of watchers) {
    if (!wanted.has(projectPath)) disposeEntry(projectPath, entry)
  }
  for (const projectPath of wanted) {
    if (watchers.has(projectPath)) continue
    const watcher = chokidar.watch(projectPath, {
      ignoreInitial: true,
      ignored: (p: string) => shouldIgnoreWatchPath(p)
    })
    watcher.on('all', () => scheduleChange(projectPath, onChange))
    watchers.set(projectPath, { watcher, timer: null })
  }
}

export function closeAllFilesWatchers(): void {
  for (const [projectPath, entry] of watchers) disposeEntry(projectPath, entry)
}
