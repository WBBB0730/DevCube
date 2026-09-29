// 服务器文件连接（Server 的 Files Tab，docs/prd/server-files.md）：每台服务器至多一条，由主进程管理，
// 独立于 SSH Terminal 与状态连接。经内置连接（ADR-0041）开两个 SFTP 通道：浏览（列目录、查信息、读写、
// 打开时的下载）与传输（上传 / 下载队列），互不堵塞；通道出错或被关后下次使用时重开。
// 点「连接」才建立；保留到手动断开、网络断开、服务器被编辑 / 移除或 DevCube 退出。
// 上传 / 下载按服务器排队、一次一个；同名时经渲染端询问。

import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Client } from 'ssh2'
import { detectAv } from '@file-type/av'
import { fileTypeFromBuffer } from 'file-type'
import {
  FILES_TEXT_MAX_BYTES,
  compareFilesDirEntries,
  filesEntryNameError,
  type FilesDirEntry
} from '../shared/files'
import {
  classifyFilesOpenKind,
  filesOpenKindFromMime,
  primaryMime,
  sniffTextBuffer,
  type FilesOpenKind
} from '../shared/files-kind'
import { joinLogicalPath, logicalParentPath, normalizePath } from '../shared/files-path'
import { isIdeIgnoredEntryName } from '../shared/files-tree-filter'
import {
  createConflictPolicy,
  sameServerFileVersion,
  serverOpenPlan,
  sftpOpenFailureMessage,
  type ServerFileStat,
  type ServerFileVersion,
  type ServerFilesReadProgress,
  type ServerFilesReadResult,
  type ServerFilesState,
  type ServerFilesStateEvent,
  type ServerFilesWriteResult,
  type ServerTransfer,
  type ServerTransferDirection,
  type ServerTransfersEvent,
  type TransferConflictRequest,
  type TransferConflictResponse
} from '../shared/server-files'
import { SFTP_STATUS, sftpEntryKind, type SftpAttrs } from '../shared/sftp'
import { readFileEntry } from './files'
import { newServerFileCopyPath, serverFilesCacheRoot } from './server-files-cache'
import { ServerFileCopies, type ServerFileCopy } from './server-files-copies'
import { findServer } from './servers'
import { SftpClient, SftpStatusError } from './sftp-client'
import { connectSsh, onSshClosed } from './ssh-connect'

/** 嗅探类型读的文件开头：够 file-type 认出 OOXML（PPT / Excel）这类 zip 容器。 */
const HEAD_BYTES = 64 * 1024
/** 进度推送的最短间隔。 */
const PROGRESS_INTERVAL_MS = 200
/** 预览类副本（磁盘）所有服务器合计的上限，与本机的瓦片缓存一致 */
const FILE_COPIES_MAX_BYTES = 2 * 1024 * 1024 * 1024
/** 文本副本（内存）所有服务器合计的上限 */
const TEXT_COPIES_MAX_BYTES = 50 * 1024 * 1024

interface TransferTask {
  info: ServerTransfer
  controller: AbortController
  run: (task: TransferTask, report: () => void) => Promise<void>
}

/** 两个 SFTP 通道：浏览（列目录、查信息、读写、打开时的下载）与传输（上传 / 下载队列）。 */
type ChannelKind = 'browse' | 'transfer'

interface FilesConnection {
  state: ServerFilesState
  /** 已连上的连接；未连接为 null */
  ssh: Client | null
  /** 正在建立的连接：断开、编辑、移除时中止（撤下还没回答的提问） */
  connecting: AbortController | null
  /** 各通道（打开中或已打开）；出错或被关的下次使用时重开 */
  channels: Map<ChannelKind, Promise<SftpClient>>
  /** 进行中的打开：同一时刻一个，新的打开取消旧的 */
  read: AbortController | null
  /** 上一次打开时判断出的类型（按版本）：同一版本再打开（如占位上点「仍然打开」）不必再读开头 */
  lastKind: { path: string; version: ServerFileVersion; kind: FilesOpenKind } | null
  /** 传输队列（含失败的）：一次跑一个 */
  transfers: TransferTask[]
  transfersTimer: NodeJS.Timeout | null
}

export interface ServerFilesSink {
  state: (event: ServerFilesStateEvent) => void
  transfers: (event: ServerTransfersEvent) => void
  readProgress: (event: ServerFilesReadProgress) => void
  /** 上传完成等：该服务器的文件树应重新读已展开的目录 */
  entriesChanged: (serverId: string) => void
  conflict: (request: TransferConflictRequest) => void
  conflictDismiss: (id: string) => void
}

const IDLE: ServerFilesState = { phase: 'idle' }
const connections = new Map<string, FilesConnection>()
/**
 * 打开过的文件的副本（所有服务器合计）：预览类下载在磁盘上（副本目录连同瓦片一起删），文本在内存里。
 * 服务器上的内容不在没人用时留在本机：手动断开、编辑或移除服务器时丢弃，退出与启动时整个清空。
 */
const fileCopies = new ServerFileCopies<{ dir: string; file: string }>(
  FILE_COPIES_MAX_BYTES,
  (copy) => void rm(copy.data.dir, { recursive: true, force: true })
)
const textCopies = new ServerFileCopies<Uint8Array>(TEXT_COPIES_MAX_BYTES, () => undefined)
const conflicts = new Map<string, (response: TransferConflictResponse) => void>()
let sink: ServerFilesSink | null = null

/** 状态、传输与提问推给谁：由 ipc 绑定到主窗口。 */
export function setServerFilesSink(next: ServerFilesSink): void {
  sink = next
}

function connectionOf(serverId: string): FilesConnection {
  let conn = connections.get(serverId)
  if (!conn) {
    conn = {
      state: IDLE,
      ssh: null,
      connecting: null,
      channels: new Map(),
      read: null,
      lastKind: null,
      transfers: [],
      transfersTimer: null
    }
    connections.set(serverId, conn)
  }
  return conn
}

function setState(serverId: string, conn: FilesConnection, state: ServerFilesState): void {
  conn.state = state
  sink?.state({ serverId, state })
}

export function getServerFilesState(serverId: string): ServerFilesState {
  return connections.get(serverId)?.state ?? IDLE
}

// —— 连接 ——

/** 在连接上开一个 SFTP 通道。 */
function openSftp(ssh: Client): Promise<SftpClient> {
  return new Promise((resolve, reject) =>
    ssh.sftp((error, sftp) =>
      error ? reject(new Error(sftpOpenFailureMessage(error))) : resolve(new SftpClient(sftp))
    )
  )
}

/** 点「连接」/「重新连接」：连上服务器、开浏览通道并取家目录；已在连接或已连上则不动。 */
export async function connectServerFiles(serverId: string): Promise<void> {
  const conn = connectionOf(serverId)
  if (conn.state.phase === 'connecting' || conn.state.phase === 'connected') return
  const server = findServer(serverId)
  if (!server) return
  setState(serverId, conn, { phase: 'connecting' })
  const controller = new AbortController()
  conn.connecting = controller

  let ssh: Client
  let browse: SftpClient
  try {
    ssh = (
      await connectSsh({
        target: server.target,
        direct: server.direct,
        serverId,
        password: undefined,
        testing: false,
        signal: controller.signal
      })
    ).client
    browse = await openSftp(ssh).catch((error: unknown) => {
      ssh.end()
      throw error
    })
  } catch (error) {
    if (conn.connecting !== controller) return
    conn.connecting = null
    const message = error instanceof Error ? error.message : String(error)
    setState(serverId, conn, { phase: 'disconnected', message })
    return
  }
  if (conn.connecting !== controller) {
    ssh.end()
    return
  }
  conn.connecting = null
  conn.ssh = ssh
  conn.channels = new Map([['browse', Promise.resolve(browse)]])
  onSshClosed(ssh, (reason) => {
    if (conn.ssh !== ssh) return
    detach(serverId, conn, '连接已断开')
    setState(serverId, conn, { phase: 'disconnected', message: reason ?? '连接已断开' })
  })

  let home: string
  try {
    home = await browse.realpath('.')
  } catch (error) {
    // 连上了却读不到家目录：断开，报出原因
    if (conn.ssh !== ssh) return
    detach(serverId, conn, '连接已断开')
    const message = error instanceof Error ? error.message : String(error)
    setState(serverId, conn, { phase: 'disconnected', message })
    return
  }
  if (conn.ssh !== ssh) return
  setState(serverId, conn, { phase: 'connected', home })
}

/**
 * 摘掉连接：结束 ssh、取消进行中的打开；排队与进行中的传输以 reason 失败。reason 为 null 即用户主动
 * 断开（或服务器被编辑 / 移除）：传输视作取消、直接移除，副本一并丢弃；意外断开时副本都留着
 * （面板里的预览还在用，连回来后打开照样先核对版本）。不推送状态。
 */
function detach(serverId: string, conn: FilesConnection, reason: string | null): void {
  const ssh = conn.ssh
  conn.connecting?.abort()
  conn.connecting = null
  conn.ssh = null
  conn.channels = new Map()
  conn.read?.abort()
  conn.read = null
  for (const task of conn.transfers) {
    if (task.info.status === 'failed') continue
    task.controller.abort()
    if (reason !== null) task.info = { ...task.info, status: 'failed', error: reason }
  }
  if (reason === null) {
    conn.transfers = conn.transfers.filter((t) => t.info.status === 'failed')
    fileCopies.drop(serverId)
    textCopies.drop(serverId)
  }
  emitTransfers(serverId, conn, true)
  ssh?.end()
}

/** 点「断开连接」：结束连接、中止传输，回到未连接。 */
export function disconnectServerFiles(serverId: string): void {
  const conn = connections.get(serverId)
  if (!conn) return
  detach(serverId, conn, null)
  setState(serverId, conn, IDLE)
}

/** 服务器被编辑：连接信息可能变了，断开并回到未连接。 */
export function resetServerFiles(serverId: string): void {
  disconnectServerFiles(serverId)
}

/** 服务器被移除：断开并忘掉它（含失败的传输）。 */
export function disposeServerFiles(serverId: string): void {
  const conn = connections.get(serverId)
  if (!conn) return
  detach(serverId, conn, null)
  conn.transfers = []
  emitTransfers(serverId, conn, true)
  connections.delete(serverId)
}

/** 退出时一并结束（缓存由调用方整个清空）。 */
export function disposeAllServerFiles(): void {
  for (const serverId of [...connections.keys()]) disposeServerFiles(serverId)
}

/** 取某个通道：还没开、或上一个已结束（出错、被关）时重开，同 WebStorm。 */
async function channelOf(conn: FilesConnection, kind: ChannelKind): Promise<SftpClient> {
  const current = conn.channels.get(kind)
  if (current !== undefined) {
    const client = await current.catch(() => null)
    if (client !== null && !client.closed) return client
    // 等的这会儿别处已经在重开：用它的
    if (conn.channels.get(kind) !== current) return channelOf(conn, kind)
  }
  if (conn.ssh === null) throw new Error('未连接到服务器')
  const opening = openSftp(conn.ssh)
  conn.channels.set(kind, opening)
  return opening
}

/** 已连上时取某个通道（缺省为浏览通道）；未连接时报错。 */
async function connected(
  serverId: string,
  kind: ChannelKind = 'browse'
): Promise<{ conn: FilesConnection; client: SftpClient }> {
  const conn = connections.get(serverId)
  if (!conn?.ssh || conn.state.phase !== 'connected') throw new Error('未连接到服务器')
  return { conn, client: await channelOf(conn, kind) }
}

// —— 浏览与读写 ——

const mtimeMsOf = (attrs: SftpAttrs): number => (attrs.mtime ?? 0) * 1000
const versionOf = (attrs: SftpAttrs): ServerFileVersion => ({
  mtimeMs: mtimeMsOf(attrs),
  size: attrs.size ?? 0
})

/** 自己改过服务器上的这些路径（含其下的一切）：对应的副本作废，不等下次打开时核对。 */
function forgetCopies(serverId: string, paths: string[]): void {
  fileCopies.forget(serverId, paths)
  textCopies.forget(serverId, paths)
}

/** 路径不存在为 null，其余错误照常抛出。 */
async function statOrNull(client: SftpClient, remotePath: string): Promise<SftpAttrs | null> {
  try {
    return await client.stat(remotePath)
  } catch (error) {
    if (error instanceof SftpStatusError && error.code === SFTP_STATUS.NO_SUCH_FILE) return null
    throw error
  }
}

async function existsRemote(client: SftpClient, remotePath: string): Promise<boolean> {
  try {
    await client.lstat(remotePath)
    return true
  } catch (error) {
    if (error instanceof SftpStatusError && error.code === SFTP_STATUS.NO_SUCH_FILE) return false
    throw error
  }
}

/** 列目录：隐藏规则同本地；符号链接按目标类型显示，指向目录的可以展开（断链按文件）。 */
export async function listServerDir(serverId: string, dir: string): Promise<FilesDirEntry[]> {
  const { client } = await connected(serverId)
  const names = await client.readdir(dir)
  const entries = await Promise.all(
    names
      .filter((n) => !isIdeIgnoredEntryName(n.filename))
      .map(async (n): Promise<FilesDirEntry> => {
        const entryPath = joinLogicalPath(dir, n.filename)
        const kind = sftpEntryKind(n.attrs)
        const isDirectory =
          kind === 'directory' ||
          (kind === 'symlink' &&
            (await client.stat(entryPath).then(
              (target) => sftpEntryKind(target) === 'directory',
              () => false
            )))
        return { name: n.filename, path: entryPath, isDirectory }
      })
  )
  return entries.sort(compareFilesDirEntries)
}

/** 条目信息（跟随符号链接）；不存在为 null。 */
export async function statServerPath(
  serverId: string,
  remotePath: string
): Promise<ServerFileStat | null> {
  const { client } = await connected(serverId)
  const attrs = await statOrNull(client, remotePath)
  if (!attrs) return null
  return {
    isDirectory: sftpEntryKind(attrs) === 'directory',
    size: attrs.size ?? 0,
    mtimeMs: mtimeMsOf(attrs)
  }
}

async function detectMime(head: Uint8Array): Promise<string | null> {
  try {
    const ft = await fileTypeFromBuffer(head, { customDetectors: [detectAv] })
    return ft ? primaryMime(ft.mime) : null
  } catch {
    return null
  }
}

/** 节流后的进度推送：首次与此后每 PROGRESS_INTERVAL_MS 至多一次。 */
function progressReporter(
  serverId: string,
  remotePath: string,
  totalBytes: number
): (doneBytes: number) => void {
  let last = 0
  return (doneBytes) => {
    const now = Date.now()
    if (now - last < PROGRESS_INTERVAL_MS && doneBytes < totalBytes) return
    last = now
    sink?.readProgress({ serverId, path: remotePath, doneBytes, totalBytes })
  }
}

/** 读到本机文件（按偏移落盘）；失败时删掉写了一半的文件。 */
async function downloadFile(
  client: SftpClient,
  remotePath: string,
  localPath: string,
  size: number,
  onProgress: (doneBytes: number) => void,
  signal: AbortSignal
): Promise<void> {
  const file = await open(localPath, 'w')
  try {
    await client.withHandle(remotePath, 'r', (handle) =>
      client.readInto(
        handle,
        size,
        async (offset, data) => {
          await file.write(data, 0, data.length, offset)
        },
        onProgress,
        signal
      )
    )
  } catch (error) {
    await file.close()
    await rm(localPath, { force: true })
    throw error
  }
  await file.close()
}

/** 先按扩展名分流，否则读文件开头嗅探类型（规则同本地）。 */
async function detectKind(
  client: SftpClient,
  remotePath: string,
  size: number
): Promise<FilesOpenKind> {
  const name = path.posix.basename(remotePath)
  const byName = classifyFilesOpenKind(name)
  if (byName === 'text') return byName
  // 空文件不必读：按空的开头走同一套规则（扩展名认不出的空文件即文本，同本地）
  const head =
    size === 0 ? new Uint8Array(0) : await client.readHead(remotePath, Math.min(size, HEAD_BYTES))
  const mime = await detectMime(head)
  const fromMime = mime === null ? null : filesOpenKindFromMime(mime, name)
  if (fromMime !== null) return fromMime
  if (mime === null && byName === 'other' && sniffTextBuffer(head)) return 'text'
  return byName
}

/** 下载完再查一次版本：没变，下到的才能留作副本（下载期间被改过的只用这一次）。 */
async function unchangedSince(
  client: SftpClient,
  remotePath: string,
  version: ServerFileVersion
): Promise<boolean> {
  const after = await statOrNull(client, remotePath).catch(() => null)
  return after !== null && sameServerFileVersion(versionOf(after), version)
}

/** 文本读进内存，并留作副本；开始即报 0%（渲染端据此盖上进度）。 */
async function downloadText(
  serverId: string,
  client: SftpClient,
  remotePath: string,
  version: ServerFileVersion,
  onProgress: (doneBytes: number) => void,
  signal: AbortSignal
): Promise<Uint8Array> {
  const epoch = textCopies.epoch(serverId)
  onProgress(0)
  const data = await client.readFile(remotePath, version.size, onProgress, signal)
  if (await unchangedSince(client, remotePath, version)) {
    textCopies.keep(
      { serverId, path: remotePath, version, kind: 'text', bytes: data.length, data },
      epoch
    )
  }
  return data
}

/** 预览类下载成一份新副本（一个新目录），并留作副本；开始即报 0%，失败时删掉下了一半的。 */
async function downloadCopy(
  serverId: string,
  client: SftpClient,
  remotePath: string,
  kind: FilesOpenKind,
  version: ServerFileVersion,
  onProgress: (doneBytes: number) => void,
  signal: AbortSignal
): Promise<ServerFileCopy<{ dir: string; file: string }>> {
  const epoch = fileCopies.epoch(serverId)
  onProgress(0)
  const data = newServerFileCopyPath(serverId, path.posix.basename(remotePath))
  try {
    await mkdir(path.dirname(data.file), { recursive: true })
    await downloadFile(client, remotePath, data.file, version.size, onProgress, signal)
  } catch (error) {
    await rm(data.dir, { recursive: true, force: true })
    throw error
  }
  const copy = { serverId, path: remotePath, version, kind, bytes: version.size, data }
  if (await unchangedSince(client, remotePath, version)) fileCopies.keep(copy, epoch)
  return copy
}

/**
 * 打开服务器上的文件：先查版本，有对得上的副本就直接用（不再嗅探类型、不再下载）；否则按扩展名分流、
 * 读开头嗅探类型（规则同本地；同一版本上一次判断过的不再读），再按类型与大小决定读文本、下载到本机缓存后
 * 预览、或只给占位（serverOpenPlan），读到的留作副本。force = 点了「仍然打开」。
 * 同一台服务器同一时刻只打开一个：新的打开会取消旧的，旧的以 canceled 收口。
 */
export async function readServerFile(
  serverId: string,
  remotePath: string,
  force: boolean
): Promise<ServerFilesReadResult> {
  const { conn, client } = await connected(serverId)
  conn.read?.abort()
  const controller = new AbortController()
  conn.read = controller
  const { signal } = controller
  try {
    const attrs = await client.stat(remotePath)
    if (sftpEntryKind(attrs) === 'directory') throw new Error('不能打开目录')
    const version = versionOf(attrs)
    const { size } = version
    const onProgress = progressReporter(serverId, remotePath, size)
    const text = textCopies.take(serverId, remotePath, version)
    const file = fileCopies.take(serverId, remotePath, version)
    const last = conn.lastKind
    const known =
      last !== null && last.path === remotePath && sameServerFileVersion(last.version, version)
        ? last.kind
        : null
    const kind =
      text !== null ? 'text' : (file?.kind ?? known ?? (await detectKind(client, remotePath, size)))
    conn.lastKind = { path: remotePath, version, kind }
    signal.throwIfAborted()
    const plan = serverOpenPlan(kind, size, force)
    // 正文区换成占位或文本：原先显示的预览副本不再占着（show null）
    if (plan.action === 'unsupported') {
      fileCopies.show(serverId, null)
      return { kind: 'other', path: remotePath, size, version }
    }
    if (plan.action === 'too-large') {
      fileCopies.show(serverId, null)
      return { kind: 'too-large', path: remotePath, size, canForce: plan.canForce, version }
    }
    if (plan.action === 'read-text') {
      const data =
        text?.data ??
        (await downloadText(serverId, client, remotePath, version, onProgress, signal))
      signal.throwIfAborted()
      fileCopies.show(serverId, null)
      return {
        kind: 'text',
        path: remotePath,
        content: Buffer.from(data).toString('utf8'),
        mtimeMs: version.mtimeMs,
        size: data.length
      }
    }
    const copy =
      file ?? (await downloadCopy(serverId, client, remotePath, kind, version, onProgress, signal))
    try {
      signal.throwIfAborted()
      const cacheRoot = normalizePath(serverFilesCacheRoot())
      const result = await readFileEntry(cacheRoot, normalizePath(copy.data.file))
      fileCopies.show(serverId, copy)
      return { kind: 'preview', path: remotePath, cacheRoot, result, version }
    } finally {
      // 没收下也没显示的（被取消、出错）这时丢弃
      fileCopies.settle(copy)
    }
  } catch (error) {
    if (signal.aborted) return { kind: 'canceled' }
    throw error
  } finally {
    if (conn.read === controller) conn.read = null
  }
}

/** 取消进行中的打开（正文区的「取消」）。 */
export function cancelServerFileRead(serverId: string): void {
  connections.get(serverId)?.read?.abort()
}

/**
 * 保存文本：写前比对服务器上的修改时间与大小（base 为载入时的），变了就不写，带回服务器上的当前内容；
 * 原地覆盖写入，保住文件的权限、属主与符号链接。
 */
export async function writeServerFile(
  serverId: string,
  remotePath: string,
  content: string,
  base: ServerFileVersion
): Promise<ServerFilesWriteResult> {
  const { client } = await connected(serverId)
  const current = await statOrNull(client, remotePath)
  if (current && !sameServerFileVersion(versionOf(current), base)) {
    const size = current.size ?? 0
    const disk =
      size <= FILES_TEXT_MAX_BYTES
        ? Buffer.from(await client.readFile(remotePath, size)).toString('utf8')
        : null
    return { conflict: { content: disk, mtimeMs: mtimeMsOf(current), size } }
  }
  const data = Buffer.from(content, 'utf8')
  try {
    await client.writeFile(remotePath, data)
  } finally {
    forgetCopies(serverId, [remotePath])
  }
  const after = await client.stat(remotePath)
  return { mtimeMs: mtimeMsOf(after), size: after.size ?? data.length }
}

function assertEntryName(name: string): void {
  const error = filesEntryNameError(name)
  if (error !== null) throw new Error(error)
}

/** 在 dir 下新建文件 / 文件夹；已存在同名条目即失败。 */
export async function createServerEntry(
  serverId: string,
  dir: string,
  name: string,
  kind: 'file' | 'directory'
): Promise<FilesDirEntry> {
  const { client } = await connected(serverId)
  assertEntryName(name)
  const target = joinLogicalPath(dir, name)
  if (await existsRemote(client, target)) throw new Error('已存在同名条目')
  try {
    if (kind === 'directory') await client.mkdir(target)
    else await client.createFile(target)
  } finally {
    forgetCopies(serverId, [target])
  }
  return { name, path: target, isDirectory: kind === 'directory' }
}

/** 就地重命名（不跨目录）；已存在同名条目即失败。 */
export async function renameServerEntry(
  serverId: string,
  entryPath: string,
  newName: string
): Promise<{ path: string }> {
  const { client } = await connected(serverId)
  if (entryPath === '/') throw new Error('不能重命名根文件夹')
  assertEntryName(newName)
  const target = joinLogicalPath(logicalParentPath(entryPath), newName)
  if (target === entryPath) return { path: entryPath }
  if (await existsRemote(client, target)) throw new Error('已存在同名条目')
  try {
    await client.rename(entryPath, target)
  } finally {
    forgetCopies(serverId, [entryPath, target])
  }
  return { path: target }
}

/** 删除（服务器上没有回收站，删了即不可恢复）：文件夹连同内容逐项删除，符号链接只删链接本身。 */
export async function deleteServerEntry(serverId: string, entryPath: string): Promise<void> {
  const { client } = await connected(serverId)
  if (entryPath === '/') throw new Error('不能删除根文件夹')
  const removeTree = async (target: string): Promise<void> => {
    const attrs = await client.lstat(target)
    if (sftpEntryKind(attrs) !== 'directory') return client.remove(target)
    const children = await client.readdir(target)
    await Promise.all(children.map((c) => removeTree(joinLogicalPath(target, c.filename))))
    await client.rmdir(target)
  }
  try {
    await removeTree(entryPath)
  } finally {
    forgetCopies(serverId, [entryPath])
  }
}

// —— 上传 / 下载 ——

function transferView(conn: FilesConnection): ServerTransfer[] {
  return conn.transfers.map((t) => t.info)
}

/** 推送传输列表：状态变化立即推，进度按 PROGRESS_INTERVAL_MS 节流。 */
function emitTransfers(serverId: string, conn: FilesConnection, immediate: boolean): void {
  if (immediate) {
    if (conn.transfersTimer !== null) clearTimeout(conn.transfersTimer)
    conn.transfersTimer = null
    sink?.transfers({ serverId, transfers: transferView(conn) })
    return
  }
  if (conn.transfersTimer !== null) return
  conn.transfersTimer = setTimeout(() => {
    conn.transfersTimer = null
    sink?.transfers({ serverId, transfers: transferView(conn) })
  }, PROGRESS_INTERVAL_MS)
}

export function getServerTransfers(serverId: string): ServerTransfer[] {
  const conn = connections.get(serverId)
  return conn ? transferView(conn) : []
}

/** 服务器上有未保存修改的文件数：编辑状态在渲染端，由它上报（退出确认用）。 */
let unsavedFileCount = 0

export function setUnsavedServerFileCount(count: number): void {
  unsavedFileCount = count
}

export function unsavedServerFileCount(): number {
  return unsavedFileCount
}

/** 各台服务器上排队或进行中的传输总数（退出确认用）。 */
export function activeServerTransferCount(): number {
  let n = 0
  for (const conn of connections.values()) {
    n += conn.transfers.filter((t) => t.info.status !== 'failed').length
  }
  return n
}

/** 队首没在跑就跑下一个；一次一个，成功即移除，失败的留下原因。 */
function pumpTransfers(serverId: string, conn: FilesConnection): void {
  if (conn.transfers.some((t) => t.info.status === 'running')) return
  const task = conn.transfers.find((t) => t.info.status === 'queued')
  if (!task) return
  task.info = { ...task.info, status: 'running' }
  emitTransfers(serverId, conn, true)
  void task
    .run(task, () => emitTransfers(serverId, conn, false))
    .then(
      () => {
        conn.transfers = conn.transfers.filter((t) => t !== task)
      },
      (error: unknown) => {
        if (task.controller.signal.aborted) {
          conn.transfers = conn.transfers.filter((t) => t !== task || t.info.status === 'failed')
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        task.info = { ...task.info, status: 'failed', error: message }
      }
    )
    .finally(() => {
      // 上传不论成败、取消，服务器上都可能多了东西
      if (task.info.direction === 'upload') sink?.entriesChanged(serverId)
      emitTransfers(serverId, conn, true)
      if (connections.get(serverId) === conn) pumpTransfers(serverId, conn)
    })
}

/**
 * 排进传输队列。选完文件时连接若已断开也照样排进来：跑时连不上即以失败收口，原因留在传输栏，
 * 与传输中途断开同一处显示。
 */
function enqueueTransfer(
  serverId: string,
  direction: ServerTransferDirection,
  name: string,
  run: TransferTask['run']
): void {
  const conn = connections.get(serverId)
  if (!conn) return
  conn.transfers.push({
    info: { id: randomUUID(), direction, name, status: 'queued', totalBytes: null, doneBytes: 0 },
    controller: new AbortController(),
    run
  })
  emitTransfers(serverId, conn, true)
  pumpTransfers(serverId, conn)
}

/** 取消一项传输：排队的直接移除，进行中的中止（中止后移除）。 */
export function cancelServerTransfer(serverId: string, id: string): void {
  const conn = connections.get(serverId)
  const task = conn?.transfers.find((t) => t.info.id === id)
  if (!conn || !task) return
  task.controller.abort()
  if (task.info.status === 'queued') {
    conn.transfers = conn.transfers.filter((t) => t !== task)
    emitTransfers(serverId, conn, true)
  }
}

/** 关掉一项失败的传输。 */
export function dismissServerTransfer(serverId: string, id: string): void {
  const conn = connections.get(serverId)
  if (!conn) return
  conn.transfers = conn.transfers.filter((t) => t.info.id !== id || t.info.status !== 'failed')
  emitTransfers(serverId, conn, true)
}

/** 同名询问：推给渲染端，等用户回答；传输被取消时撤回弹窗。 */
function askConflict(
  request: Omit<TransferConflictRequest, 'id'>,
  signal: AbortSignal
): Promise<TransferConflictResponse> {
  const id = randomUUID()
  return new Promise((resolve, reject) => {
    if (!sink) return resolve({ id, action: 'skip', applyToRest: false })
    const onAbort = (): void => {
      conflicts.delete(id)
      sink?.conflictDismiss(id)
      reject(signal.reason instanceof Error ? signal.reason : new Error('已取消'))
    }
    conflicts.set(id, (response) => {
      signal.removeEventListener('abort', onAbort)
      resolve(response)
    })
    signal.addEventListener('abort', onAbort, { once: true })
    sink.conflict({ id, ...request })
  })
}

export function respondTransferConflict(response: TransferConflictResponse): void {
  const resolve = conflicts.get(response.id)
  if (!resolve) return
  conflicts.delete(response.id)
  resolve(response)
}

/** 本机待上传的一项：目录先建，文件再传。 */
type LocalItem =
  | { kind: 'dir'; local: string; remote: string }
  | {
      kind: 'file'
      local: string
      remote: string
      size: number
    }

/** 清点本机要上传的内容；文件的符号链接照目标上传，目录的符号链接跳过（免得绕圈）。 */
async function collectLocal(local: string, remote: string, out: LocalItem[]): Promise<void> {
  const st = await lstat(local)
  const target = st.isSymbolicLink() ? await stat(local).catch(() => null) : st
  if (!target) return
  if (target.isFile()) {
    out.push({ kind: 'file', local, remote, size: target.size })
    return
  }
  if (!target.isDirectory() || st.isSymbolicLink()) return
  out.push({ kind: 'dir', local, remote })
  for (const name of await readdir(local)) {
    await collectLocal(path.join(local, name), joinLogicalPath(remote, name), out)
  }
}

/** 上传一批本机文件 / 文件夹到服务器上的 remoteDir（拖放或右键「上传…」）。 */
export function uploadToServer(serverId: string, localPaths: string[], remoteDir: string): void {
  if (localPaths.length === 0) return
  const server = findServer(serverId)
  const names = localPaths.map((p) => path.basename(p))
  const label = names.length === 1 ? names[0]! : `${names[0]} 等 ${names.length} 项`
  enqueueTransfer(serverId, 'upload', label, async (task, report) => {
    const { client } = await connected(serverId, 'transfer')
    const { signal } = task.controller
    const items: LocalItem[] = []
    for (const local of localPaths) {
      await collectLocal(local, joinLogicalPath(remoteDir, path.basename(local)), items)
    }
    const files = items.filter((i) => i.kind === 'file')
    const total = files.reduce((n, f) => n + f.size, 0)
    task.info = { ...task.info, totalBytes: total }
    report()
    const policy = createConflictPolicy()
    let done = 0
    for (const item of items) {
      signal.throwIfAborted()
      if (item.kind === 'dir') {
        const existing = await statOrNull(client, item.remote)
        if (existing === null) await client.mkdir(item.remote)
        else if (sftpEntryKind(existing) !== 'directory') {
          throw new Error(`服务器上已有同名文件：${path.posix.basename(item.remote)}`)
        }
        continue
      }
      if (await existsRemote(client, item.remote)) {
        const action = await policy.resolve(() =>
          askConflict(
            {
              serverName: server?.name ?? '',
              direction: 'upload',
              name: path.posix.basename(item.remote),
              batch: files.length > 1
            },
            signal
          )
        )
        if (action === 'skip') {
          done += item.size
          task.info = { ...task.info, doneBytes: done }
          report()
          continue
        }
      }
      const base = done
      try {
        await uploadFile(client, item.local, item.remote, item.size, signal, (n) => {
          task.info = { ...task.info, doneBytes: base + n }
          report()
        })
      } finally {
        forgetCopies(serverId, [item.remote])
      }
      done += item.size
    }
  })
}

/** 传一个本机文件（覆盖目标）；失败或取消时删掉传了一半的目标。 */
async function uploadFile(
  client: SftpClient,
  localPath: string,
  remotePath: string,
  size: number,
  signal: AbortSignal,
  onProgress: (doneBytes: number) => void
): Promise<void> {
  const file = await open(localPath, 'r')
  try {
    const handle = await client.open(remotePath, 'w')
    try {
      await client.writeFrom(
        handle,
        size,
        async (offset, length) => {
          const buf = Buffer.allocUnsafe(length)
          const { bytesRead } = await file.read(buf, 0, length, offset)
          return buf.subarray(0, bytesRead)
        },
        onProgress,
        signal
      )
    } catch (error) {
      await client.closeHandle(handle)
      await client.remove(remotePath).catch(() => undefined)
      throw error
    }
    await client.closeHandle(handle)
  } finally {
    await file.close()
  }
}

/**
 * 下载服务器上的文件或文件夹。文件：localTarget 是保存对话框选定的完整路径（同名已由系统问过）；
 * 文件夹：localTarget 是选定的目录，在其中建同名文件夹，里面的同名文件逐个询问。
 */
export function downloadFromServer(
  serverId: string,
  remotePath: string,
  isDirectory: boolean,
  localTarget: string
): void {
  const server = findServer(serverId)
  enqueueTransfer(serverId, 'download', path.posix.basename(remotePath), async (task, report) => {
    const { client } = await connected(serverId, 'transfer')
    const { signal } = task.controller
    const progress =
      (base: number) =>
      (n: number): void => {
        task.info = { ...task.info, doneBytes: base + n }
        report()
      }
    if (!isDirectory) {
      const attrs = await client.stat(remotePath)
      task.info = { ...task.info, totalBytes: attrs.size ?? 0 }
      report()
      await downloadFile(client, remotePath, localTarget, attrs.size ?? 0, progress(0), signal)
      return
    }
    // 清点服务器上的文件夹：目录的符号链接跳过（免得绕圈），文件的符号链接照目标下载
    const files: { remote: string; local: string; size: number }[] = []
    const dirs: string[] = []
    const walk = async (remote: string, local: string): Promise<void> => {
      signal.throwIfAborted()
      dirs.push(local)
      for (const n of await client.readdir(remote)) {
        const childRemote = joinLogicalPath(remote, n.filename)
        const childLocal = path.join(local, n.filename)
        const kind = sftpEntryKind(n.attrs)
        if (kind === 'directory') await walk(childRemote, childLocal)
        else if (kind === 'file')
          files.push({ remote: childRemote, local: childLocal, size: n.attrs.size ?? 0 })
        else if (kind === 'symlink') {
          const target = await client.stat(childRemote).catch(() => null)
          if (target && sftpEntryKind(target) === 'file') {
            files.push({ remote: childRemote, local: childLocal, size: target.size ?? 0 })
          }
        }
      }
    }
    await walk(remotePath, path.join(localTarget, path.posix.basename(remotePath)))
    task.info = { ...task.info, totalBytes: files.reduce((n, f) => n + f.size, 0) }
    report()
    for (const dir of dirs) await mkdir(dir, { recursive: true })
    const policy = createConflictPolicy()
    let done = 0
    for (const f of files) {
      signal.throwIfAborted()
      const exists = await stat(f.local).then(
        () => true,
        () => false
      )
      if (exists) {
        const action = await policy.resolve(() =>
          askConflict(
            {
              serverName: server?.name ?? '',
              direction: 'download',
              name: path.basename(f.local),
              batch: files.length > 1
            },
            signal
          )
        )
        if (action === 'skip') {
          done += f.size
          task.info = { ...task.info, doneBytes: done }
          report()
          continue
        }
      }
      await downloadFile(client, f.remote, f.local, f.size, progress(done), signal)
      done += f.size
    }
  })
}
