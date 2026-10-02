// 服务器文件管理（Server 的 Files Tab，docs/prd/server-files.md）的共享类型与纯函数。
// 连接经内置实现的 SFTP 通道（ADR-0041）；服务器上的路径一律按 POSIX 处理。
import type { FilesOpenKind } from './files-kind'
import { FILES_TEXT_MAX_BYTES, FILES_XLSX_PREVIEW_MAX_BYTES, type FilesReadResult } from './files'
import { logicalParentPath } from './files-path'

/** 文件连接的状态：点「连接」才建立，连上后带回家目录（树首次打开时展开到这里）。 */
export type ServerFilesState =
  | { phase: 'idle' }
  | { phase: 'connecting' }
  | { phase: 'connected'; home: string }
  | { phase: 'disconnected'; message: string }

/** 主进程 → 渲染端：某台服务器的文件连接状态有变化。 */
export interface ServerFilesStateEvent {
  serverId: string
  state: ServerFilesState
}

/**
 * 除文本与 Excel 外的可预览类型（图片、PDF、PPT、音视频）先下载再预览；超过这个大小先停下来问，
 * 占位里可以「仍然打开」。上限固定、不做成设置：快慢取决于每台服务器的带宽，一个全局数字对哪台都不准。
 */
export const SERVER_FILES_PREVIEW_MAX_BYTES = 10 * 1024 * 1024

export type ServerOpenPlan =
  | { action: 'read-text' }
  | { action: 'download' }
  | { action: 'too-large'; canForce: boolean }
  | { action: 'unsupported' }

/**
 * 按类型与服务器上的大小决定怎么打开：文本直接读进编辑器（上限同本地）；Excel 的上限是表格预览本身的，
 * 没有「仍然打开」；其余可预览类型超过上限先占位，force（点了「仍然打开」）时照常下载；其余二进制不下载。
 */
export function serverOpenPlan(kind: FilesOpenKind, size: number, force: boolean): ServerOpenPlan {
  if (kind === 'other') return { action: 'unsupported' }
  if (kind === 'text') {
    return size > FILES_TEXT_MAX_BYTES
      ? { action: 'too-large', canForce: false }
      : { action: 'read-text' }
  }
  if (kind === 'xlsx') {
    return size > FILES_XLSX_PREVIEW_MAX_BYTES
      ? { action: 'too-large', canForce: false }
      : { action: 'download' }
  }
  if (size > SERVER_FILES_PREVIEW_MAX_BYTES && !force)
    return { action: 'too-large', canForce: true }
  return { action: 'download' }
}

/**
 * 服务器上文件的版本：修改时间（SFTP 只精确到秒）与大小。复用副本、保存前查冲突、刷新时判断有没有变，
 * 都按这两项；同一秒内改动且大小不变的认不出来（没有内容指纹可取）。
 */
export interface ServerFileVersion {
  mtimeMs: number
  size: number
}

export function sameServerFileVersion(a: ServerFileVersion, b: ServerFileVersion): boolean {
  return a.mtimeMs === b.mtimeMs && a.size === b.size
}

/**
 * 打开服务器上的文件的结果。preview 是下载到本机缓存后的预览：result 与本地打开同形，
 * 但其中的路径是缓存文件（cacheRoot 之内），path 才是服务器上的路径。
 */
export type ServerFilesReadResult =
  | Extract<FilesReadResult, { kind: 'text' }>
  | ((
      | Extract<FilesReadResult, { kind: 'other' }>
      | { kind: 'too-large'; path: string; size: number; canForce: boolean }
      | { kind: 'preview'; path: string; cacheRoot: string; result: FilesReadResult }
    ) & {
      /** 载入时服务器上的版本：刷新时比对，变了重新打开（文本自带修改时间与大小） */
      version: ServerFileVersion
    })
  /** 被新的打开或「取消」打断 */
  | { kind: 'canceled' }

/** 打开时的下载进度（文本与预览都有；开始下载即报 0%，用副本、只给占位的没有；主进程节流推送）。 */
export interface ServerFilesReadProgress {
  serverId: string
  path: string
  doneBytes: number
  totalBytes: number
}

export interface ServerFileStat {
  isDirectory: boolean
  size: number
  mtimeMs: number
}

/**
 * 保存：写前比对服务器上文件的修改时间与大小（base 为载入时的），变了不写、带回服务器上的当前内容
 * （超过文本上限时为 null）。
 */
export type ServerFilesWriteResult =
  | { mtimeMs: number; size: number }
  | { conflict: { content: string | null; mtimeMs: number; size: number } }

/**
 * 打开 SFTP 通道失败的原因：服务器没启用 sftp 子系统、或通道里混进了别的输出（ssh2 报 SFTP 协议错误，
 * 最常见的是登录脚本往里打印了内容）时换成明确的说法，其余原样。
 */
export function sftpOpenFailureMessage(error: { message: string; level?: string }): string {
  if (error.level === 'sftp-protocol') {
    return '服务器返回了无法识别的数据，可能是登录脚本往 SFTP 通道里输出了内容'
  }
  return /subsystem/i.test(error.message) ? '服务器没有启用 SFTP，无法管理文件' : error.message
}

// —— 上传 / 下载 ——

export type ServerTransferDirection = 'upload' | 'download'

/** 传输栏里的一项：完成即移除；失败的留下原因，直到用户关掉。 */
export interface ServerTransfer {
  id: string
  direction: ServerTransferDirection
  /** 被传的文件或文件夹名 */
  name: string
  status: 'queued' | 'running' | 'failed'
  /** 总字节数；文件夹还在清点时为 null */
  totalBytes: number | null
  doneBytes: number
  error?: string
}

export interface ServerTransfersEvent {
  serverId: string
  transfers: ServerTransfer[]
}

/** 同名询问：上传或文件夹下载时目标已有同名文件。 */
export interface TransferConflictRequest {
  id: string
  serverName: string
  direction: ServerTransferDirection
  /** 冲突的文件名 */
  name: string
  /** 这次传输不止一个文件：显示「对其余同名项同样处理」 */
  batch: boolean
}

export type TransferConflictAction = 'replace' | 'skip'

export interface TransferConflictResponse {
  id: string
  action: TransferConflictAction
  applyToRest: boolean
}

/**
 * 一次传输里的同名处理：勾了「对其余同名项同样处理」之后不再问，照那次的选择处理；
 * 没勾就每个都问（ask 返回用户的回答）。
 */
export function createConflictPolicy(): {
  resolve: (ask: () => Promise<TransferConflictResponse>) => Promise<TransferConflictAction>
} {
  let remembered: TransferConflictAction | null = null
  return {
    resolve: async (ask) => {
      if (remembered !== null) return remembered
      const response = await ask()
      if (response.applyToRest) remembered = response.action
      return response.action
    }
  }
}

// —— 服务器上的路径（POSIX） ——

/** 规范化服务器上的绝对路径：折叠 `.`、`..` 与重复的 `/`；只认 `/` 为分隔符（文件名可以含 `\`）。 */
export function normalizeRemotePath(p: string): string {
  const out: string[] = []
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return '/' + out.join('/')
}

/**
 * 「前往路径」的输入 → 服务器上的绝对路径：接受绝对路径与 `~` 开头的路径（`~` 即家目录）；
 * 空、相对路径、`~user` 这类写法为 null。
 */
export function resolveRemoteInput(input: string, home: string): string | null {
  const text = input.trim()
  if (text === '~') return normalizeRemotePath(home)
  if (text.startsWith('~/')) return normalizeRemotePath(`${home}/${text.slice(2)}`)
  if (text.startsWith('/')) return normalizeRemotePath(text)
  return null
}

/**
 * 选目录对话框里选中的目录 → 服务器上的配置的工作目录（同本机的配置：项目根写成空）：家目录写成空（即默认的登录后的
 * 目录），家目录之下写成 `~/…`，其余为绝对路径。
 */
export function remoteCwdFromPicked(home: string, picked: string): string {
  const base = normalizeRemotePath(home)
  const target = normalizeRemotePath(picked)
  if (target === base) return ''
  const under = base === '/' ? '/' : `${base}/`
  return target.startsWith(under) ? `~/${target.slice(under.length)}` : target
}

/** 上传的落点：拖到目录行即该目录，拖到文件行即它所在的目录。 */
export function uploadTargetDir(target: { path: string; isDirectory: boolean }): string {
  return target.isDirectory ? target.path : logicalParentPath(target.path)
}
