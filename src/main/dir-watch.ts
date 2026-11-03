// 目录的递归监听：项目监听与 Preview Window 共用。WSL 发行版里的目录交给发行版里的小助手监听
// （Windows 侧的 ReadDirectoryChangesW 对 `\\wsl.localhost\…` 不生效，见 ADR-0055），其余用 @parcel/watcher（ADR-0021）。
// 两者的事件同形：绝对路径（WSL 的换回 Windows 路径）与 create / update / delete。
import { sep } from 'node:path'
import parcelWatcher, { type BackendType, type Event } from '@parcel/watcher'
import { promises as fs } from 'original-fs'
import { linuxToWslPath, wslToLinuxPath } from '../shared/wsl-path'
import { wslWatch } from './wsl'

/**
 * 指定各平台的原生后端：缺省在 Windows / Linux 上先找 watchman，用户装没装它行为就不同；
 * Windows 上找不到时还会把 cmd 的「不是内部或外部命令」打到控制台。
 */
const NATIVE_BACKEND: Partial<Record<NodeJS.Platform, BackendType>> = {
  darwin: 'fs-events',
  win32: 'windows',
  linux: 'inotify'
}

export type DirWatchEvent = Event

export interface DirSubscription {
  unsubscribe(): Promise<void>
}

/**
 * 订阅 root 的递归变化，事件路径与 root 同一写法。WSL 里的目录需该发行版已连上（调用方按连接状态对齐，未连上时 throw）。
 */
export async function subscribeDir(
  root: string,
  callback: (err: Error | null, events: DirWatchEvent[]) => void
): Promise<DirSubscription> {
  const wsl = wslToLinuxPath(root)
  if (wsl === null) {
    // macOS 的 FSEvents 报回真实路径（ADR-0059）：root 经过符号链接（如 /tmp → /private/tmp）或大小写与磁盘上不同时，
    // 把事件路径换回 root 的写法，下游才对得上登记的路径。其余平台事件本就是 root 的写法，换算不会命中
    const real = await fs.realpath(root).catch(() => root)
    const toRoot = (path: string): string =>
      path === real ? root : path.startsWith(real + sep) ? root + path.slice(real.length) : path
    return parcelWatcher.subscribe(
      root,
      real === root
        ? callback
        : (err, events) =>
            callback(
              err,
              events.map((event) => ({ ...event, path: toRoot(event.path) }))
            ),
      { backend: NATIVE_BACKEND[process.platform] }
    )
  }
  const unwatch = await wslWatch(wsl.distro, wsl.path, (err, events) =>
    callback(
      err,
      events.map((event) => ({ type: event.type, path: linuxToWslPath(wsl.distro, event.path) }))
    )
  )
  return { unsubscribe: unwatch }
}
