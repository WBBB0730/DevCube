// 压缩线程（docs/prd/compress.md「写包」）：按主线程给的清单边读边写 zip，压大文件夹时主进程照常响应。
// 用 yazl 写包（ADR-0050）：文件名带 UTF-8 标记，外部属性写 Unix 权限位，符号链接存为链接条目，超出 4 GB 自动转 ZIP64。
// 取消即由主线程结束本线程，写了一半的临时文件由主线程删除。

// 用不带 asar 改装的原版 fs：用户文件里的 .asar 按普通文件读（ADR-0051）
import { createReadStream, createWriteStream } from 'original-fs'
import { parentPort, workerData } from 'node:worker_threads'
import { ZipFile } from 'yazl'

export interface CompressWorkerEntry {
  kind: 'dir' | 'file' | 'link'
  /** 系统路径 */
  path: string
  /** 包内路径 */
  name: string
  mode: number
  mtimeMs: number
  /** 符号链接的目标 */
  target?: string
}

export interface CompressWorkerData {
  entries: CompressWorkerEntry[]
  /** 写到哪个文件（临时文件，主线程完成后改名） */
  output: string
  /** 全部文件的字节数，算进度用 */
  totalBytes: number
}

export type CompressWorkerMessage =
  { type: 'progress'; percent: number } | { type: 'done' } | { type: 'error'; message: string }

/** 进度最多每 100 ms 报一次 */
const PROGRESS_INTERVAL = 100

const port = parentPort!
const post = (message: CompressWorkerMessage): void => port.postMessage(message)
const { entries, output, totalBytes } = workerData as CompressWorkerData

let failed = false
const fail = (message: string): void => {
  if (failed) return
  failed = true
  post({ type: 'error', message })
}

let doneBytes = 0
let lastPercent = -1
let lastReport = 0
const report = (): void => {
  if (totalBytes === 0) return
  const percent = Math.min(99, Math.floor((doneBytes / totalBytes) * 100))
  const now = Date.now()
  if (percent === lastPercent || now - lastReport < PROGRESS_INTERVAL) return
  lastPercent = percent
  lastReport = now
  post({ type: 'progress', percent })
}

const zip = new ZipFile()
const out = createWriteStream(output)
zip.on('error', (err: Error) => fail(err.message))
out.on('error', (err) => fail(`无法写入「${output}」：${err.message}`))
// close 在文件句柄关掉之后才发：主线程随后改名，Windows 上句柄未关会改名失败
out.on('close', () => {
  if (!failed) post({ type: 'done' })
})
zip.outputStream.pipe(out)

for (const entry of entries) {
  const options = { mtime: new Date(entry.mtimeMs), mode: entry.mode }
  if (entry.kind === 'dir') {
    zip.addEmptyDirectory(entry.name, options)
  } else if (entry.kind === 'link') {
    zip.addBuffer(Buffer.from(entry.target ?? '', 'utf8'), entry.name, {
      ...options,
      compress: false
    })
  } else {
    zip.addReadStreamLazy(entry.name, options, (cb) => {
      const stream = createReadStream(entry.path)
      stream.on('data', (chunk) => {
        doneBytes += chunk.length
        report()
      })
      stream.on('error', (err) => fail(`无法读取「${entry.path}」：${err.message}`))
      cb(null, stream)
    })
  }
}
zip.end()
