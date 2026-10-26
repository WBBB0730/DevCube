// 跟读一个正在被别的进程追加写入的文件（git-lfs 的进度文件，docs/prd/task-progress.md）：定时读出新写入的部分，
// 按块回调。文件要等写入方第一次写时才建，读不到（还没建、已被删）就下一轮再看——进度只是显示，读不到不影响写入方。

import { promises as fs } from 'fs'
import { StringDecoder } from 'string_decoder'

/** 多久看一次有没有新内容（同任务登记处的推送节流）。 */
const POLL_INTERVAL_MS = 200

export interface FileTail {
  /** 停止跟读：先把还没读的读完再停 */
  stop: () => Promise<void>
}

export function tailFile(
  path: string,
  onText: (text: string) => void,
  intervalMs = POLL_INTERVAL_MS
): FileTail {
  // 流式解码：多字节字符可能被两次读取劈开，StringDecoder 缓存半个字符到下一次
  const decoder = new StringDecoder('utf8')
  let offset = 0
  /** 读取串行进行，停止时等最后一次读完 */
  let reading = Promise.resolve()

  const readNew = async (): Promise<void> => {
    let handle: fs.FileHandle
    try {
      handle = await fs.open(path, 'r')
    } catch {
      return
    }
    try {
      const { size } = await handle.stat()
      if (size <= offset) return
      const buffer = Buffer.alloc(size - offset)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
      offset += bytesRead
      const text = decoder.write(buffer.subarray(0, bytesRead))
      if (text !== '') onText(text)
    } catch {
      // 读到一半出错：下一轮从同一位置再读
    } finally {
      await handle.close().catch(() => {})
    }
  }

  const tick = (): void => {
    reading = reading.then(readNew)
  }
  const timer = setInterval(tick, intervalMs)

  return {
    stop: async () => {
      clearInterval(timer)
      tick()
      await reading
      const rest = decoder.end()
      if (rest !== '') onText(rest)
    }
  }
}
