import { execFile } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { BrowserWindow, clipboard } from 'electron'
import { normalizePath } from '../shared/files-path'
import { samePathSet } from '../shared/files-tree-ops'
import { IPC } from '../shared/ipc'
import { toSysPath } from './sys-path'

/**
 * 文件本身进出系统剪贴板：「复制」「复制文件」粘到访达 / 资源管理器即为拷贝，访达里复制的也能粘进文件树
 * （docs/prd/files-tree-move-copy.md「剪贴板」）。各平台走官方通道：
 * - macOS：多个文件是多个粘贴板项，Electron 的 clipboard 只写得了一项，交给系统自带 osascript 的
 *   JavaScript 桥调 NSPasteboard 的 writeObjects / readObjectsForClasses（官方的多文件读写接口）；
 * - Windows：CF_HDROP 是预定义格式、writeBuffer 注册不了，交给系统自带的 PowerShell 5.1
 *   `Set-Clipboard -LiteralPath` / `Get-Clipboard -Format FileDropList`（pwsh 7 已去掉这两个用法，所以点名 powershell.exe）；
 * - Linux：freedesktop 的 `text/uri-list`，一行一个 file URL。
 * 经脚本进出的路径一律 URI 编码，避开命令行参数与输出的字符编码问题。
 */

const execFileAsync = promisify(execFile)

export type FileClipboardPlan =
  { kind: 'buffer'; format: string; data: string } | { kind: 'exec'; file: string; args: string[] }

export type FileClipboardReadPlan =
  { kind: 'buffer'; format: string } | { kind: 'exec'; file: string; args: string[] }

const URI_LIST = 'text/uri-list'

const MAC_WRITE_SCRIPT = `ObjC.import('AppKit')
function run(argv) {
  const urls = argv.map((p) => $.NSURL.fileURLWithPath(decodeURIComponent(p)))
  const pasteboard = $.NSPasteboard.generalPasteboard
  pasteboard.clearContents
  pasteboard.writeObjects($(urls))
}`

const MAC_READ_SCRIPT = `ObjC.import('AppKit')
function run() {
  const urls = $.NSPasteboard.generalPasteboard.readObjectsForClassesOptions(
    $([$.NSURL]),
    $({ NSPasteboardURLReadingFileURLsOnlyKey: true })
  )
  const paths = []
  if (!urls.isNil()) {
    for (let i = 0; i < urls.count; i++) paths.push(encodeURIComponent(urls.objectAtIndex(i).path.js))
  }
  return paths.join('\\n')
}`

const WIN_READ_COMMAND =
  'Get-Clipboard -Format FileDropList | ForEach-Object { [Uri]::EscapeDataString($_.FullName) }'

function powershell(command: string): { kind: 'exec'; file: string; args: string[] } {
  return {
    kind: 'exec',
    file: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command', command]
  }
}

/** 只有 darwin / linux 用：路径必是 POSIX 形态，锁死 posix 语义（默认跟宿主走，Windows CI 上会补出盘符） */
function posixFileUrl(sysPath: string): string {
  return pathToFileURL(sysPath, { windows: false }).href
}

export function planCopyFilesToClipboard(
  platform: NodeJS.Platform,
  sysPaths: readonly string[]
): FileClipboardPlan {
  if (platform === 'win32') {
    const quoted = sysPaths.map((p) => `'${p.replace(/'/g, "''")}'`).join(',')
    return powershell(`Set-Clipboard -LiteralPath ${quoted}`)
  }
  if (platform === 'darwin') {
    return {
      kind: 'exec',
      file: 'osascript',
      args: ['-l', 'JavaScript', '-e', MAC_WRITE_SCRIPT, ...sysPaths.map(encodeURIComponent)]
    }
  }
  return {
    kind: 'buffer',
    format: URI_LIST,
    data: sysPaths.map((p) => `${posixFileUrl(p)}\r\n`).join('')
  }
}

export function planReadClipboardFiles(platform: NodeJS.Platform): FileClipboardReadPlan {
  if (platform === 'win32') return powershell(WIN_READ_COMMAND)
  if (platform === 'darwin') {
    return { kind: 'exec', file: 'osascript', args: ['-l', 'JavaScript', '-e', MAC_READ_SCRIPT] }
  }
  return { kind: 'buffer', format: URI_LIST }
}

/** 脚本的输出：一行一个 URI 编码的路径 */
export function parseEncodedPathLines(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map(decodeURIComponent)
}

/** `text/uri-list`：一行一个 URI，`#` 开头是注释；只认 file URL */
export function parseUriList(data: string): string[] {
  return data
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('file://'))
    .map((line) => fileURLToPath(line, { windows: false }))
}

async function writeClipboardFiles(sysPaths: readonly string[]): Promise<void> {
  const plan = planCopyFilesToClipboard(process.platform, sysPaths)
  if (plan.kind === 'exec') {
    await execFileAsync(plan.file, plan.args, { windowsHide: true })
    return
  }
  clipboard.writeBuffer(plan.format, Buffer.from(plan.data, 'utf8'))
}

/** 系统剪贴板里的文件（系统路径）；没有文件即空 */
async function readClipboardFiles(): Promise<string[]> {
  const plan = planReadClipboardFiles(process.platform)
  if (plan.kind === 'buffer')
    return parseUriList(clipboard.readBuffer(plan.format).toString('utf8'))
  const { stdout } = await execFileAsync(plan.file, plan.args, { windowsHide: true })
  return parseEncodedPathLines(stdout)
}

/**
 * 剪切的那一批（逻辑路径，docs/prd/files-tree-move-copy.md「剪贴板」）：主进程统一记，主窗口剪切、预览窗口粘贴也认；
 * 变了推给所有窗口（被剪切的行淡显）
 */
let cutPaths: string[] = []

function setCutPaths(paths: string[]): void {
  if (paths.length === 0 && cutPaths.length === 0) return
  cutPaths = paths
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.filesCutChanged, paths)
  }
}

/** 系统剪贴板里的文件（逻辑路径），及是不是剪切的那一批 */
async function clipboardFiles(): Promise<{ paths: string[]; cut: boolean }> {
  const paths = (await readClipboardFiles()).map((p) => normalizePath(p))
  return { paths, cut: cutPaths.length > 0 && samePathSet(paths, cutPaths) }
}

/** 「复制」「剪切」「复制文件」：把条目本身放进系统剪贴板，剪切另记下这一批（粘贴即移动） */
export async function putFilesOnClipboard(paths: string[], cut: boolean): Promise<void> {
  if (paths.length === 0) return
  await writeClipboardFiles(paths.map(toSysPath))
  setCutPaths(cut ? paths : [])
}

/** 粘贴：剪贴板里的文件与是不是剪切的那一批；读过即撤掉剪切（这一批就要移走，之后再粘贴就是复制） */
export async function takeClipboardFiles(): Promise<{ paths: string[]; cut: boolean }> {
  const result = await clipboardFiles()
  setCutPaths([])
  return result
}

/** 剪切还在等粘贴的那一批；剪贴板已被别处换掉即撤掉 */
export async function pendingCutPaths(): Promise<string[]> {
  if (cutPaths.length > 0 && !(await clipboardFiles()).cut) setCutPaths([])
  return cutPaths
}
