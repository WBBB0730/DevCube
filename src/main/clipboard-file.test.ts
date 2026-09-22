import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ clipboard: { writeBuffer: vi.fn() } }))

import { planCopyFileToClipboard } from './clipboard-file'

describe('planCopyFileToClipboard', () => {
  it('macOS 写 public.file-url 的 file URL', () => {
    expect(planCopyFileToClipboard('darwin', '/Users/me/a b.png')).toEqual({
      kind: 'buffer',
      format: 'public.file-url',
      data: 'file:///Users/me/a%20b.png'
    })
  })

  it('Linux 写 text/uri-list，行尾 CRLF', () => {
    expect(planCopyFileToClipboard('linux', '/home/me/x.pdf')).toEqual({
      kind: 'buffer',
      format: 'text/uri-list',
      data: 'file:///home/me/x.pdf\r\n'
    })
  })

  it('Windows 走 powershell.exe Set-Clipboard -LiteralPath，单引号按 PowerShell 规则转义', () => {
    expect(planCopyFileToClipboard('win32', "C:\\Users\\me\\it's.png")).toEqual({
      kind: 'powershell',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Set-Clipboard -LiteralPath 'C:\\Users\\me\\it''s.png'"
      ]
    })
  })
})
