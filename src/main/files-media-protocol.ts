import { protocol } from 'electron'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { FILES_ASSET_PDFJS, FILES_MEDIA_SCHEME, isFilesTileKey } from '../shared/files'
import { parseBytesRange } from '../shared/files-media-range'
import { normalizePath, resolveWithinProject } from '../shared/files-path'
import { imageTilesCacheRoot } from './files-image-pyramid'
import { isPdfjsAssetPath, pdfjsAssetMime, pdfjsAssetRoot } from './pdfjs-assets'
import { isGrantedFilesRoot } from './files-roots'

/** 逻辑路径（/）→ 系统路径。 */
function toSys(logical: string): string {
  return path.normalize(logical.split('/').join(path.sep))
}

/**
 * 必须在 `app.ready` 之前调用。
 * `stream: true` 以便 `<video>` / `<audio>` Range 寻址。
 */
export function registerFilesMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: FILES_MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true
      }
    }
  ])
}

function fileStreamResponse(
  sysPath: string,
  status: number,
  headers: Record<string, string>,
  start?: number,
  end?: number
): Response {
  const stream =
    start !== undefined && end !== undefined
      ? createReadStream(sysPath, { start, end })
      : createReadStream(sysPath)
  return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers })
}

/**
 * 三种来源：`p` + `f` = 授权根（已登记项目根 / 预览窗口根）内的文件；`t` + `f` = 瓦片金字塔缓存目录内的文件
 * （预览图 / 瓦片，键形状须合法）；`a` + `f` = 应用自带静态资源（PDF.js 字体映射表等，MIME 按扩展名）。
 * 都限制在各自根内，越界 403。
 */
function resolveMediaSysPath(u: URL): { sys: string; mime?: string } | { status: 400 | 403 } {
  const rel = u.searchParams.get('f')
  if (!rel) return { status: 400 }
  const asset = u.searchParams.get('a')
  if (asset !== null) {
    if (asset !== FILES_ASSET_PDFJS || !isPdfjsAssetPath(rel)) return { status: 403 }
    const logical = resolveWithinProject(normalizePath(pdfjsAssetRoot()), rel)
    return logical ? { sys: toSys(logical), mime: pdfjsAssetMime(rel) } : { status: 403 }
  }
  const tileKey = u.searchParams.get('t')
  if (tileKey !== null) {
    if (!isFilesTileKey(tileKey)) return { status: 403 }
    const root = normalizePath(path.join(imageTilesCacheRoot(), tileKey))
    const logical = resolveWithinProject(root, rel)
    return logical ? { sys: toSys(logical) } : { status: 403 }
  }
  const projectPath = u.searchParams.get('p')
  if (!projectPath) return { status: 400 }
  const root = normalizePath(projectPath)
  if (!isGrantedFilesRoot(root)) return { status: 403 }
  const logical = resolveWithinProject(root, rel)
  return logical ? { sys: toSys(logical) } : { status: 403 }
}

/**
 * 在 `app.ready` 之后注册一次。只放行授权根内的路径与本应用的瓦片缓存。
 * 显式处理 HTTP Range（206），对齐 Electron 社区通用做法（Signal / Joplin 等）。
 * 带 CORS 头：OpenSeadragon 的 WebGL 绘制器要把瓦片 `<img crossorigin>` 传进 WebGL。
 */
export function handleFilesMediaProtocol(): void {
  protocol.handle(FILES_MEDIA_SCHEME, async (request) => {
    try {
      const u = new URL(request.url)
      const resolved = resolveMediaSysPath(u)
      if ('status' in resolved) {
        return new Response(resolved.status === 400 ? 'bad request' : 'forbidden', {
          status: resolved.status
        })
      }
      const mime = resolved.mime ?? (u.searchParams.get('m') || 'application/octet-stream')
      const sysPath = resolved.sys
      const st = await fs.stat(sysPath)
      if (!st.isFile()) {
        return new Response('not found', { status: 404 })
      }
      const size = st.size
      const baseHeaders: Record<string, string> = {
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      }

      const range = parseBytesRange(request.headers.get('Range'), size)
      if (range === null) {
        return new Response(null, {
          status: 416,
          headers: {
            ...baseHeaders,
            'Content-Range': `bytes */${size}`
          }
        })
      }
      if (range === 'all') {
        return fileStreamResponse(sysPath, 200, {
          ...baseHeaders,
          'Content-Length': String(size)
        })
      }

      const { start, end } = range
      const contentLength = end - start + 1
      return fileStreamResponse(
        sysPath,
        206,
        {
          ...baseHeaders,
          'Content-Length': String(contentLength),
          'Content-Range': `bytes ${start}-${end}/${size}`
        },
        start,
        end
      )
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}
