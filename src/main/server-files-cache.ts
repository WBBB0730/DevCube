// 服务器文件的本机缓存（docs/prd/server-files.md「打开」）：打开图片、PDF、PPT、Excel、音视频时先下载到这里，
// 再走本地的预览（dc-media 协议放行这个目录，ADR-0010 / ADR-0032）。每次下载是一份新副本、一个新目录，
// 由 server-files-copies 记账复用；超大图片切出的瓦片也放在副本目录里，随副本一起删。退出与启动时整个清空。

import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import path from 'node:path'

const CACHE_DIR_NAME = 'server-files'
/** 副本目录里放下载的文件的子目录（文件保留原名：预览按扩展名分流） */
const COPY_FILE_DIR = 'file'
/** 副本目录里放瓦片的子目录 */
const COPY_TILES_DIR = 'tiles'
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
/** 副本瓦片的键：`<服务器 id>.<副本 id>` */
const COPY_TILES_KEY = new RegExp(`^(${UUID})\\.(${UUID})$`)

export function serverFilesCacheRoot(): string {
  return path.join(app.getPath('userData'), CACHE_DIR_NAME)
}

/** 新副本的位置：dir 为副本目录（删副本即删它），file 为下载到的文件。 */
export function newServerFileCopyPath(
  serverId: string,
  name: string
): { dir: string; file: string } {
  const dir = path.join(serverFilesCacheRoot(), serverId, randomUUID())
  return { dir, file: path.join(dir, COPY_FILE_DIR, name) }
}

/** 协议按键找副本的瓦片目录；键形状不合法为 null。 */
export function serverFileCopyTilesDir(key: string): string | null {
  const m = COPY_TILES_KEY.exec(key)
  return m ? path.join(serverFilesCacheRoot(), m[1]!, m[2]!, COPY_TILES_DIR) : null
}

/** sys 是某份副本下载到的文件时，它的瓦片键与目录；否则为 null。 */
export function serverFileCopyTiles(sys: string): { key: string; dir: string } | null {
  const parts = path.relative(serverFilesCacheRoot(), sys).split(path.sep)
  if (parts.length !== 4 || parts[2] !== COPY_FILE_DIR) return null
  const key = `${parts[0]}.${parts[1]}`
  const dir = serverFileCopyTilesDir(key)
  return dir === null ? null : { key, dir }
}

/** 整个清空（退出时同步执行，免得进程先退出）。 */
export function clearAllServerFilesCache(): void {
  try {
    rmSync(serverFilesCacheRoot(), { recursive: true, force: true })
  } catch {
    /* 留到下次启动再清 */
  }
}
