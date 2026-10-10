// 目录的递归监听：项目监听与 Preview Window 共用。WSL 发行版里的目录交给发行版里的小助手监听
// （Windows 侧的 ReadDirectoryChangesW 对 `\\wsl.localhost\…` 不生效，见 ADR-0055），其余用 @parcel/watcher（ADR-0021）。
// 两者的事件同形：绝对路径（WSL 的换回 Windows 路径）与 create / update / delete。
import parcelWatcher, { type Event } from '@parcel/watcher'
import { linuxToWslPath, wslToLinuxPath } from '../shared/wsl-path'
import { wslWatch } from './wsl'

export type DirWatchEvent = Event

export interface DirSubscription {
  unsubscribe(): Promise<void>
}

/** 订阅 root 的递归变化。WSL 里的目录需该发行版已连上（调用方按连接状态对齐，未连上时 throw）。 */
export async function subscribeDir(
  root: string,
  callback: (err: Error | null, events: DirWatchEvent[]) => void
): Promise<DirSubscription> {
  const wsl = wslToLinuxPath(root)
  if (wsl === null) return parcelWatcher.subscribe(root, callback)
  const unwatch = await wslWatch(wsl.distro, wsl.path, (err, events) =>
    callback(
      err,
      events.map((event) => ({ type: event.type, path: linuxToWslPath(wsl.distro, event.path) }))
    )
  )
  return { unsubscribe: unwatch }
}
