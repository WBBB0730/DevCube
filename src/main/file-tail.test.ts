// 跟读文件：读出新追加的部分、文件晚建也接得上、停止时读完剩下的、多字节字符被劈开不乱码（真实文件与计时）。
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tailFile } from './file-tail'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'devcube-file-tail-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('tailFile', () => {
  it('文件晚建也接得上，按块读出新追加的部分', async () => {
    const path = join(dir, 'progress')
    const texts: string[] = []
    const tail = tailFile(path, (text) => texts.push(text), 10)
    await new Promise((resolve) => setTimeout(resolve, 30))
    writeFileSync(path, 'upload 1/2 1/1 a\n')
    await vi.waitFor(() => expect(texts.join('')).toBe('upload 1/2 1/1 a\n'))
    appendFileSync(path, 'upload 2/2 1/1 b\n')
    await vi.waitFor(() => expect(texts.join('')).toBe('upload 1/2 1/1 a\nupload 2/2 1/1 b\n'))
    await tail.stop()
  })

  it('停止时读完还没读的部分', async () => {
    const path = join(dir, 'progress')
    const texts: string[] = []
    const tail = tailFile(path, (text) => texts.push(text), 60_000)
    writeFileSync(path, 'download 1/1 5/5 a\n')
    await tail.stop()
    expect(texts.join('')).toBe('download 1/1 5/5 a\n')
  })

  it('多字节字符被两次读取劈开时不乱码', async () => {
    const path = join(dir, 'progress')
    const texts: string[] = []
    const tail = tailFile(path, (text) => texts.push(text), 10)
    const bytes = Buffer.from('upload 1/1 1/1 文件.bin\n')
    const cut = bytes.indexOf(Buffer.from('件')) + 1
    writeFileSync(path, bytes.subarray(0, cut))
    // 先读到半个「件」：只交出它之前的部分
    await vi.waitFor(() => expect(texts.join('')).toBe('upload 1/1 1/1 文'))
    appendFileSync(path, bytes.subarray(cut))
    await vi.waitFor(() => expect(texts.join('')).toBe('upload 1/1 1/1 文件.bin\n'))
    await tail.stop()
  })
})
