import { BrowserWindow, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
// 用不带 asar 改装的原版 fs：读写的是用户的文件（ADR-0051）
import { promises as originalFs } from 'original-fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import {
  ARCHIVE_EXT,
  COMPRESS_WINDOW_SIZE,
  buildCompressQuery,
  commonParentPath,
  compressSubject,
  defaultArchiveName,
  nextFreeArchiveName,
  type CompressOptions,
  type CompressResult,
  type CompressScanResponse,
  type CompressStartRequest
} from '../shared/compress'
import { IPC } from '../shared/ipc'
import { createAppWindow } from './app-window'
import {
  filterCompressEntries,
  isScanAborted,
  previewOf,
  scanCompressItems,
  type CompressListing
} from './compress-scan'
import type { CompressWorkerData, CompressWorkerMessage } from './compress-worker'
import workerPath from './compress-worker?modulePath'

/**
 * 压缩窗口（docs/prd/compress.md）：每次压缩一个独立的小窗口，可多开。主进程按窗口持有一次压缩的会话——
 * 所选条目、清单（按「排除被 Git 忽略的文件」两种取法各缓存一份，勾选 `.git` / Mac 专属文件只在内存里过滤）、
 * 进行中的压缩线程。窗口尺寸固定（COMPRESS_WINDOW_SIZE），首帧内容（标题、默认名称与位置）建窗前算好经查询串传入；
 * 建好即显示（Electron 推荐的两种显示方式之一：渲染较重时先显示、以主题底色铺底），统计等加载在窗口里面进行。
 */

interface CompressJob {
  /** 开始压缩时先重新列清单（磁盘可能已变），这一步也能取消 */
  scan: AbortController
  worker: Worker | null
  temp: string | null
}

interface CompressSession {
  items: string[]
  /** 共同上层文件夹（系统路径） */
  parent: string
  win: BrowserWindow
  listings: Map<boolean, Promise<CompressListing>>
  /** 窗口关闭即中止仍在跑的扫描 */
  abort: AbortController
  job: CompressJob | null
}

const sessions = new Map<number, CompressSession>()
let idleHandler: (() => void) | null = null

/** 最后一个压缩窗口关掉时回调（冷启动只为压缩时据此退出应用）。 */
export function setCompressIdleHandler(handler: () => void): void {
  idleHandler = handler
}

export function hasCompressWindows(): boolean {
  return sessions.size > 0
}

/** 逻辑路径（/）→ 系统路径（Windows 还原反斜杠）。 */
function toSys(logical: string): string {
  return process.platform === 'win32' ? logical.replace(/\//g, '\\') : logical
}

function sessionOf(sender: WebContents): CompressSession {
  const session = sessions.get(sender.id)
  if (!session) throw new Error('不是压缩窗口')
  return session
}

/**
 * 带一组路径开一个压缩窗口（路径已校验存在）。建好即显示并接管键盘：macOS 上应用随之到前台，按系统规则
 * 主窗口会跟着在后面出现（Apple：激活带出主窗口与当前窗口），压缩窗口在最前；Finder 快速操作投递时不先把应用
 * 切到前台（`open -g`），两个窗口同时出现，不是一前一后。
 */
export async function openCompressWindow(paths: readonly string[]): Promise<void> {
  const items = [...new Set(paths)]
  if (items.length === 0) return
  const logicalParent = commonParentPath(items)
  const parent = toSys(logicalParent)
  const subject = compressSubject(items)
  // 默认名称避开位置里已有的同名包；建窗前算好，首帧就是完整内容
  const taken = await originalFs.readdir(parent).catch(() => [])
  const name = nextFreeArchiveName(defaultArchiveName(items, logicalParent), taken)
  const { width, height } = COMPRESS_WINDOW_SIZE
  const win = createAppWindow({
    placement: { width, height, isMaximized: false, isFullScreen: false },
    defaults: { width, height, minWidth: width, minHeight: height },
    query: buildCompressQuery({ subject, dir: parent, name }),
    fixedSize: true
  })
  win.setTitle(`压缩「${subject}」`)
  const webContentsId = win.webContents.id
  const session: CompressSession = {
    items,
    parent,
    win,
    listings: new Map(),
    abort: new AbortController(),
    job: null
  }
  sessions.set(webContentsId, session)

  // 关窗即取消：中止扫描、结束压缩线程、删掉写了一半的临时文件
  win.on('closed', () => {
    session.abort.abort()
    void cancelJob(session)
    sessions.delete(webContentsId)
    if (sessions.size === 0) idleHandler?.()
  })
  win.show()
}

function listingOf(s: CompressSession, excludeIgnored: boolean): Promise<CompressListing> {
  const cached = s.listings.get(excludeIgnored)
  if (cached) return cached
  const listing = scanCompressItems(s.items, s.parent, excludeIgnored, s.abort.signal)
  // 失败的不缓存：下次勾选变化时重试
  listing.catch(() => s.listings.delete(excludeIgnored))
  s.listings.set(excludeIgnored, listing)
  return listing
}

function applyOptions(listing: CompressListing, options: CompressOptions): CompressListing {
  return { flags: listing.flags, entries: filterCompressEntries(listing.entries, options) }
}

/** 预览：按勾选给出内容特征（决定勾选框是否出现）与将装入的文件个数、字节数；读不了时带上原因。 */
export async function scanForCompress(
  sender: WebContents,
  options: CompressOptions
): Promise<CompressScanResponse> {
  const s = sessionOf(sender)
  try {
    const listing = await listingOf(s, options.excludeIgnored)
    return {
      ok: true,
      flags: listing.flags,
      preview: previewOf(applyOptions(listing, options).entries)
    }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

export async function compressTargetExists(dir: string, name: string): Promise<boolean> {
  return originalFs.access(join(dir, `${name.trim()}${ARCHIVE_EXT}`)).then(
    () => true,
    () => false
  )
}

async function cancelJob(s: CompressSession): Promise<void> {
  const job = s.job
  if (!job) return
  job.scan.abort()
  // terminate 之后线程的 exit 收口这次压缩（结果为取消）
  await job.worker?.terminate()
}

/** 删掉写了一半的临时文件：Windows 上线程刚结束时句柄可能还没放开，稍作重试。 */
async function removeTemp(temp: string): Promise<void> {
  await originalFs.rm(temp, { force: true, maxRetries: 5, retryDelay: 100 })
}

/**
 * 开始压缩：按当时的勾选重新列清单，交给压缩线程写到目标文件夹下的临时文件，完成后改名为最终名称
 * （需要替换时到这一步才替换旧包）。成功即关窗；取消或失败删掉临时文件，窗口留着。
 */
export async function startCompress(
  sender: WebContents,
  request: CompressStartRequest
): Promise<CompressResult> {
  const s = sessionOf(sender)
  if (s.job) return { status: 'error', message: '正在压缩' }
  const job: CompressJob = { scan: new AbortController(), worker: null, temp: null }
  s.job = job
  const name = request.name.trim()
  const target = join(request.dir, `${name}${ARCHIVE_EXT}`)

  try {
    const scan = AbortSignal.any([job.scan.signal, s.abort.signal])
    const listing = applyOptions(
      await scanCompressItems(s.items, s.parent, request.options.excludeIgnored, scan),
      request.options
    )
    const totalBytes = previewOf(listing.entries).bytes
    const temp = join(request.dir, `.${name}${ARCHIVE_EXT}.${randomUUID().slice(0, 8)}.tmp`)
    job.temp = temp
    const data: CompressWorkerData = {
      entries: listing.entries.map(({ kind, path, name, mode, mtimeMs, target }) => ({
        kind,
        path,
        name,
        mode,
        mtimeMs,
        ...(target === undefined ? {} : { target })
      })),
      output: temp,
      totalBytes
    }
    const worker = new Worker(workerPath, { workerData: data })
    job.worker = worker

    const outcome = await new Promise<CompressResult>((resolve) => {
      let settled = false
      const settle = (result: CompressResult): void => {
        if (settled) return
        settled = true
        resolve(result)
      }
      worker.on('message', (message: CompressWorkerMessage) => {
        if (message.type === 'progress') {
          if (!s.win.isDestroyed()) s.win.webContents.send(IPC.compressProgress, message.percent)
        } else if (message.type === 'done') {
          settle({ status: 'done' })
        } else {
          settle({ status: 'error', message: message.message })
          void worker.terminate()
        }
      })
      worker.on('error', (err) => settle({ status: 'error', message: err.message }))
      worker.on('exit', () => settle({ status: 'canceled' }))
    })

    if (outcome.status !== 'done') {
      await removeTemp(temp)
      return outcome
    }
    await worker.terminate()
    try {
      await originalFs.rename(temp, target)
    } catch (err) {
      await removeTemp(temp)
      return { status: 'error', message: `无法保存「${target}」：${(err as Error).message}` }
    }
    if (!s.win.isDestroyed()) s.win.close()
    return outcome
  } catch (err) {
    if (job.temp !== null) await removeTemp(job.temp)
    if (isScanAborted(err)) return { status: 'canceled' }
    return { status: 'error', message: (err as Error).message }
  } finally {
    if (s.job === job) s.job = null
  }
}

export async function cancelCompress(sender: WebContents): Promise<void> {
  await cancelJob(sessionOf(sender))
}

/** 退出前：中止全部压缩，删掉写了一半的临时文件。 */
export async function disposeAllCompressJobs(): Promise<void> {
  await Promise.all(
    [...sessions.values()].map(async (s) => {
      s.abort.abort()
      const temp = s.job?.temp ?? null
      await cancelJob(s)
      if (temp !== null) await removeTemp(temp)
    })
  )
}
