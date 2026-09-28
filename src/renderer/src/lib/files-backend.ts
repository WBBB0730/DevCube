// Files 面板的数据来源（docs/prd/server-files.md「面板宿主」）：本机（项目 / 预览窗口）走 files:* IPC，
// 服务器走 server-files:*（SFTP，ADR-0040）。面板只认这一组操作，宿主差异不渗进读写流程。
import {
  DEFAULT_FILES_UI,
  type FilesDirEntry,
  type FilesReadResult,
  type FilesUiState
} from '@shared/files'
import type { ServerFileVersion, ServerFilesWriteResult } from '@shared/server-files'

type ImageRead = Extract<FilesReadResult, { kind: 'image' }>

/** 面板打开一个条目的结果。 */
export type FilesOpenResult =
  | ((
      | Exclude<FilesReadResult, { kind: 'image' }>
      | (ImageRead & {
          /** 经主进程出图（超大位图 / 浏览器解不了）用的本机文件：本机即其自身，服务器上的即下载的缓存 */
          decode: { root: string; path: string }
        })
      /** 服务器上的文件较大：先占位，canForce 时可「仍然打开」 */
      | { kind: 'too-large'; path: string; size: number; canForce: boolean }
    ) & {
      /** 服务器上的非文本文件载入时的版本：刷新时比对，变了重新打开（文本自带修改时间与大小） */
      version?: ServerFileVersion
    })
  /** 被新的打开或「取消」打断 */
  | { kind: 'canceled' }

/** 保存结果：本机直接写；服务器上的写前比对修改时间与大小，变了带回冲突（见 ServerFilesWriteResult）。 */
export type FilesWriteResult = ServerFilesWriteResult

export interface FilesBackend {
  listDir(dir: string): Promise<FilesDirEntry[]>
  /** force：服务器上的文件超过预览上限时「仍然打开」 */
  read(path: string, force?: boolean): Promise<FilesOpenResult>
  /** base：载入时的修改时间与大小 */
  write(
    path: string,
    content: string,
    base: { mtimeMs: number; size: number }
  ): Promise<FilesWriteResult>
  create(dir: string, name: string, kind: 'file' | 'directory'): Promise<FilesDirEntry>
  rename(path: string, newName: string): Promise<{ path: string }>
  /** 本机移到回收站；服务器上删除（不可恢复） */
  remove(path: string): Promise<void>
  getUi(): Promise<FilesUiState>
  setUi(patch: Partial<FilesUiState>): void
}

/** 本机：rootPath 为授权根；persist = false（预览窗口）时 UI 态不落盘。 */
export function localFilesBackend(rootPath: string, persist: boolean): FilesBackend {
  return {
    listDir: (dir) => window.api.filesListDir(rootPath, dir),
    read: async (path) => {
      const result = await window.api.filesRead(rootPath, path)
      return result.kind === 'image'
        ? { ...result, decode: { root: rootPath, path: result.path } }
        : result
    },
    write: (path, content) => window.api.filesWrite(rootPath, path, content),
    create: (dir, name, kind) => window.api.filesCreate(rootPath, dir, name, kind),
    rename: (path, newName) => window.api.filesRename(rootPath, path, newName),
    remove: (path) => window.api.filesTrash(rootPath, path),
    getUi: () => (persist ? window.api.filesGetUi(rootPath) : Promise.resolve(DEFAULT_FILES_UI)),
    setUi: (patch) => {
      if (persist) void window.api.filesSetUi(rootPath, patch)
    }
  }
}

/** 服务器：下载到本机缓存的预览换回服务器上的路径，图片另记缓存文件供主进程出图。 */
export function serverFilesBackend(serverId: string): FilesBackend {
  return {
    listDir: (dir) => window.api.serverFilesListDir(serverId, dir),
    read: async (path, force = false) => {
      const result = await window.api.serverFilesRead(serverId, path, force)
      if (result.kind !== 'preview') return result
      const { result: preview, version } = result
      return preview.kind === 'image'
        ? {
            ...preview,
            path: result.path,
            version,
            decode: { root: result.cacheRoot, path: preview.path }
          }
        : { ...preview, path: result.path, version }
    },
    write: (path, content, base) => window.api.serverFilesWrite(serverId, path, content, base),
    create: (dir, name, kind) => window.api.serverFilesCreate(serverId, dir, name, kind),
    rename: (path, newName) => window.api.serverFilesRename(serverId, path, newName),
    remove: (path) => window.api.serverFilesDelete(serverId, path),
    getUi: () => window.api.serverFilesGetUi(serverId),
    setUi: (patch) => void window.api.serverFilesSetUi(serverId, patch)
  }
}
