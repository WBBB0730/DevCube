import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { clipboard } from 'electron'

/**
 * 「复制文件」：把文件 / 文件夹本身放进系统剪贴板，粘贴到访达 / 资源管理器 / 文件管理器即为拷贝。
 * 各平台走官方通道：macOS 写 `public.file-url` 粘贴板类型；Linux 写 freedesktop 的 `text/uri-list`；
 * Windows 的 CF_HDROP 是预定义格式、Electron 的 writeBuffer 注册不了，交给系统自带的
 * PowerShell 5.1 `Set-Clipboard -LiteralPath`（pwsh 7 已去掉该参数，所以点名 powershell.exe）。
 */

const execFileAsync = promisify(execFile)

export type FileClipboardPlan =
  { kind: 'buffer'; format: string; data: string } | { kind: 'powershell'; args: string[] }

export function planCopyFileToClipboard(
  platform: NodeJS.Platform,
  sysPath: string
): FileClipboardPlan {
  if (platform === 'win32') {
    const quoted = `'${sysPath.replace(/'/g, "''")}'`
    return {
      kind: 'powershell',
      args: ['-NoProfile', '-NonInteractive', '-Command', `Set-Clipboard -LiteralPath ${quoted}`]
    }
  }
  // 只有 darwin / linux 走到这里，路径必是 POSIX 形态；锁死 posix 语义（默认跟宿主走，
  // Windows CI 上会把 '/Users/me' 补成带盘符的 'file:///D:/Users/me'），同 cli-shim 的 posix.join
  const url = pathToFileURL(sysPath, { windows: false }).href
  if (platform === 'darwin') return { kind: 'buffer', format: 'public.file-url', data: url }
  return { kind: 'buffer', format: 'text/uri-list', data: `${url}\r\n` }
}

export async function copyFileToClipboard(sysPath: string): Promise<void> {
  const plan = planCopyFileToClipboard(process.platform, sysPath)
  if (plan.kind === 'powershell') {
    await execFileAsync('powershell.exe', plan.args, { windowsHide: true })
    return
  }
  clipboard.writeBuffer(plan.format, Buffer.from(plan.data, 'utf8'))
}
