import chokidar, { type FSWatcher } from 'chokidar'
import { join } from 'path'
import { LOCKFILE_NAMES } from './discovery'

// 只监听每个项目根的 package.json 与 lockfile —— 不递归项目树，避免 node_modules 事件风暴。
const WATCH_FILES = ['package.json', ...LOCKFILE_NAMES]

const watchers = new Map<string, FSWatcher>()

/** 让监听集合与当前项目集合对齐：新增项目起监听，移除项目关监听。 */
export function syncWatchers(projectPaths: string[], onChange: () => void): void {
  for (const [path, watcher] of watchers) {
    if (!projectPaths.includes(path)) {
      void watcher.close()
      watchers.delete(path)
    }
  }
  for (const path of projectPaths) {
    if (watchers.has(path)) continue
    const targets = WATCH_FILES.map((f) => join(path, f))
    const watcher = chokidar.watch(targets, { ignoreInitial: true })
    watcher.on('all', onChange)
    watchers.set(path, watcher)
  }
}

export function closeAllWatchers(): void {
  for (const watcher of watchers.values()) void watcher.close()
  watchers.clear()
}
