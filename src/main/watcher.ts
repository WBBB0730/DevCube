import chokidar, { type FSWatcher } from 'chokidar'
import { basename, join } from 'path'
import { isAppQuitting } from './app-shutdown'
import { CONVENTION_WATCH_FILES, isDotnetProjectFile, LOCKFILE_NAMES } from './discovery'

// 只监听项目根的清单 / lockfile / 约定指纹 —— 不递归项目树，避免 node_modules 事件风暴。
const FIXED_WATCH_FILES = ['package.json', ...LOCKFILE_NAMES, ...CONVENTION_WATCH_FILES]

function isRelevantRootName(name: string): boolean {
  return FIXED_WATCH_FILES.includes(name) || isDotnetProjectFile(name)
}

const watchers = new Map<string, FSWatcher>()

/** 让监听集合与当前项目集合对齐：新增项目起监听，移除项目关监听。 */
export function syncWatchers(projectPaths: string[], onChange: () => void): void {
  if (isAppQuitting()) return
  for (const [path, watcher] of watchers) {
    if (!projectPaths.includes(path)) {
      void watcher.close()
      watchers.delete(path)
    }
  }
  for (const path of projectPaths) {
    if (watchers.has(path)) continue
    // 固定文件名 + 项目根（depth 0 仅用于捕获根目录新增的 *.csproj / *.sln）。
    // 不把「项目根目录自身」的事件当成变更——否则 addDir 等会误触发全量对账。
    const targets = [...FIXED_WATCH_FILES.map((f) => join(path, f)), path]
    const watcher = chokidar.watch(targets, { ignoreInitial: true, depth: 0 })
    watcher.on('all', (_event, changedPath) => {
      if (changedPath === path) return
      if (isRelevantRootName(basename(changedPath))) onChange()
    })
    watchers.set(path, watcher)
  }
}

/** 关闭全部 package/lockfile watcher；await 后再退出，避免 fsevents 在进程销毁时 abort。 */
export async function closeAllWatchers(): Promise<void> {
  const closing = [...watchers.values()].map((watcher) => watcher.close())
  watchers.clear()
  await Promise.all(closing)
}
