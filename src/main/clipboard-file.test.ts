import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  clipboard: { writeBuffer: vi.fn(), readBuffer: vi.fn() }
}))

import {
  parseEncodedPathLines,
  parseUriList,
  planCopyFilesToClipboard,
  planReadClipboardFiles
} from './clipboard-file'

describe('planCopyFilesToClipboard', () => {
  it('macOS 交给 osascript 的 JavaScript 桥，路径 URI 编码后作参数', () => {
    const plan = planCopyFilesToClipboard('darwin', ['/Users/me/a b.png', '/Users/me/图.jpg'])
    expect(plan.kind).toBe('exec')
    if (plan.kind !== 'exec') return
    expect(plan.file).toBe('osascript')
    expect(plan.args.slice(0, 3)).toEqual(['-l', 'JavaScript', '-e'])
    expect(plan.args.slice(4)).toEqual([
      '%2FUsers%2Fme%2Fa%20b.png',
      '%2FUsers%2Fme%2F%E5%9B%BE.jpg'
    ])
  })

  it('Linux 写 text/uri-list，一行一个，行尾 CRLF', () => {
    expect(planCopyFilesToClipboard('linux', ['/home/me/x.pdf', '/home/me/a b'])).toEqual({
      kind: 'buffer',
      format: 'text/uri-list',
      data: 'file:///home/me/x.pdf\r\nfile:///home/me/a%20b\r\n'
    })
  })

  it('Windows 走 powershell.exe Set-Clipboard -LiteralPath，多个路径逗号分隔，单引号按 PowerShell 规则转义', () => {
    expect(planCopyFilesToClipboard('win32', ["C:\\Users\\me\\it's.png", 'D:\\b'])).toEqual({
      kind: 'exec',
      file: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Set-Clipboard -LiteralPath 'C:\\Users\\me\\it''s.png','D:\\b'"
      ]
    })
  })
})

describe('planReadClipboardFiles', () => {
  it('各平台的读法', () => {
    expect(planReadClipboardFiles('linux')).toEqual({ kind: 'buffer', format: 'text/uri-list' })
    const mac = planReadClipboardFiles('darwin')
    expect(mac.kind === 'exec' && mac.file).toBe('osascript')
    const win = planReadClipboardFiles('win32')
    expect(win.kind === 'exec' && win.args.at(-1)).toContain('Get-Clipboard -Format FileDropList')
  })
})

describe('parseEncodedPathLines', () => {
  it('一行一个，解码，跳过空行与 CRLF', () => {
    expect(parseEncodedPathLines('%2Fa%20b\r\nC%3A%5Cx%5C%E5%9B%BE\r\n\r\n')).toEqual([
      '/a b',
      'C:\\x\\图'
    ])
  })
})

describe('parseUriList', () => {
  it('只认 file URL，跳过注释与空行', () => {
    expect(
      parseUriList('# comment\r\nfile:///home/me/a%20b\r\nhttps://x.y\r\n\r\nfile:///t')
    ).toEqual(['/home/me/a b', '/t'])
  })
})
