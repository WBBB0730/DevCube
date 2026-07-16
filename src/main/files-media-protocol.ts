import { protocol } from 'electron'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { FILES_MEDIA_SCHEME } from '../shared/files'
import { parseBytesRange } from '../shared/files-media-range'
import { normalizePath, resolveWithinProject } from '../shared/files-path'
import { getProjects } from './store'

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

/** 构建仅限本应用渲染层使用的媒体 URL（项目根、文件路径、MIME）。 */
export function buildFilesMediaUrl(projectPath: string, filePath: string, mime: string): string {
  const u = new URL(`${FILES_MEDIA_SCHEME}://local/`)
  u.searchParams.set('p', normalizePath(projectPath))
  u.searchParams.set('f', normalizePath(filePath))
  u.searchParams.set('m', mime)
  return u.toString()
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
 * 在 `app.ready` 之后注册一次。只放行已登记项目根内的路径。
 * 显式处理 HTTP Range（206），对齐 Electron 社区通用做法（Signal / Joplin 等）。
 */
export function handleFilesMediaProtocol(): void {
  protocol.handle(FILES_MEDIA_SCHEME, async (request) => {
    try {
      const u = new URL(request.url)
      const projectPath = u.searchParams.get('p')
      const filePath = u.searchParams.get('f')
      const mime = u.searchParams.get('m') || 'application/octet-stream'
      if (!projectPath || !filePath) {
        return new Response('bad request', { status: 400 })
      }
      const root = normalizePath(projectPath)
      if (!getProjects().some((p) => normalizePath(p.path) === root)) {
        return new Response('forbidden', { status: 403 })
      }
      const logical = resolveWithinProject(root, filePath)
      if (!logical) {
        return new Response('forbidden', { status: 403 })
      }
      const sysPath = toSys(logical)
      const st = await fs.stat(sysPath)
      if (!st.isFile()) {
        return new Response('not found', { status: 404 })
      }
      const size = st.size
      const baseHeaders: Record<string, string> = {
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
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
