import { BrowserWindow } from 'electron'
import { basename } from 'node:path'
import { normalizePath } from '../shared/files-path'
import { IPC } from '../shared/ipc'
import { matchAppShortcut } from '../shared/app-shortcut'
import { buildPreviewQuery, resolvePreviewRoot } from '../shared/preview-window'
import { createAppWindow } from './app-window'
import { grantFilesRoot, revokeFilesRoot } from './files-roots'
import { isAppQuitting } from './app-shutdown'
import { getProjects } from './store'
import { rememberWindowPlacement, resolveRememberedWindowPlacement } from './window-placement'
import { watchPreviewRoot } from './preview-watch'

/**
 * Preview Window（预览窗口）：系统带着一个文件拉起 DevCube 时开的独立窗口（docs/prd/file-preview-window.md）；
 * 主窗口项目菜单「在新窗口中打开」则以项目根开窗、不带初始文件。一文件（或一根）一窗、可多开、
 * 不进项目列表、不落盘；同一目标复开即聚焦。
 */

const PREVIEW_DEFAULTS = { width: 1000, height: 680, minWidth: 640, minHeight: 420 } as const
/** 多开时相对上一窗的错位 */
const CASCADE_OFFSET = 24

interface PreviewEntry {
  win: BrowserWindow
  /** 当前根（规范化逻辑路径）；「上一级」时替换 */
  root: string
  watcher: { dispose: () => Promise<void> } | null
}

/** 开窗目标（规范化文件路径，或无文件时的根路径）→ 窗口 */
const byFile = new Map<string, PreviewEntry>()
/** 最近聚焦过的预览窗口：新窗继承它的实时几何（最大化 / 位置尺寸），而不是只认最近关掉的那份 */
let lastFocused: BrowserWindow | null = null

/** 逻辑路径（/）→ 系统路径（Windows 盘符路径还原反斜杠）。 */
function toSys(logical: string): string {
  return process.platform === 'win32' ? logical.replace(/\//g, '\\') : logical
}

function entryOf(win: BrowserWindow): PreviewEntry | undefined {
  for (const entry of byFile.values()) if (entry.win === win) return entry
  return undefined
}

function attachWatcher(entry: PreviewEntry): void {
  void entry.watcher?.dispose()
  const root = entry.root
  entry.watcher = watchPreviewRoot(toSys(root), () => {
    if (!entry.win.isDestroyed()) entry.win.webContents.send(IPC.filesChanged, root)
  })
}

/** 预览窗口只响应 Cmd/Ctrl+W（关窗）与筛选框聚焦；项目 / Tab 类快捷键在此无意义，放行给页面。 */
function wirePreviewShortcuts(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    const hit = matchAppShortcut({
      type: input.type,
      code: input.code,
      key: input.key,
      meta: input.meta,
      control: input.control,
      alt: input.alt,
      shift: input.shift
    })
    if (!hit) return
    if (hit.id === 'closeTab') {
      event.preventDefault()
      win.close()
    } else if (hit.id === 'focusFilesFilter') {
      event.preventDefault()
      win.webContents.send(IPC.appShortcut, hit)
    }
  })
}

/** 系统 / External Open 带来的文件：根按「最深登记项目根，否则所在文件夹」解析。 */
export function openPreviewWindow(fileSysPath: string): BrowserWindow {
  const file = normalizePath(fileSysPath)
  const root = resolvePreviewRoot(
    file,
    getProjects().map((p) => p.path)
  )
  return openPreview({ file, root }, fileSysPath)
}

/** 主窗口「在新窗口中打开」：以该目录为根、不带初始文件。 */
export function openPreviewWindowForRoot(rootSysPath: string): BrowserWindow {
  return openPreview({ file: null, root: normalizePath(rootSysPath) }, rootSysPath)
}

function openPreview(
  launch: { file: string | null; root: string },
  sysPath: string
): BrowserWindow {
  const { file, root } = launch
  const key = file ?? root
  const existing = byFile.get(key)
  if (existing && !existing.win.isDestroyed()) {
    if (existing.win.isMinimized()) existing.win.restore()
    existing.win.show()
    existing.win.focus()
    return existing.win
  }

  // 几何只在进程内记（退出即清，与主窗口同；两者各记一份）。还开着的预览窗口是最新事实：
  // 先把它此刻的状态写进记忆再取，新窗就跟它一样是否最大化、多大、在哪；没有活窗则用最近关掉的那份。
  const live = lastFocused && !lastFocused.isDestroyed() ? lastFocused : null
  if (live) rememberWindowPlacement(live, 'preview')
  const placement = resolveRememberedWindowPlacement(PREVIEW_DEFAULTS, 'preview')
  // 多开且不是最大化 / 全屏：从活窗错位级联，别叠在同一位置
  if (live && !placement.isMaximized && !placement.isFullScreen) {
    const b = live.getNormalBounds()
    placement.x = b.x + CASCADE_OFFSET
    placement.y = b.y + CASCADE_OFFSET
  }
  const win = createAppWindow({
    placement,
    defaults: PREVIEW_DEFAULTS,
    query: buildPreviewQuery({ file, root })
  })
  const entry: PreviewEntry = { win, root, watcher: null }
  byFile.set(key, entry)
  lastFocused = win
  grantFilesRoot(win.id, root)
  attachWatcher(entry)

  win.setTitle(basename(sysPath))
  if (process.platform === 'darwin') win.setRepresentedFilename(sysPath)
  wirePreviewShortcuts(win)

  win.on('focus', () => {
    lastFocused = win
  })
  win.on('ready-to-show', () => {
    if (placement.isMaximized) win.maximize()
    if (placement.isFullScreen) win.setFullScreen(true)
    win.show()
  })
  win.on('close', () => rememberWindowPlacement(win, 'preview'))
  win.on('closed', () => {
    revokeFilesRoot(win.id)
    void entry.watcher?.dispose()
    entry.watcher = null
    if (byFile.get(key) === entry) byFile.delete(key)
    if (lastFocused === win) lastFocused = null
  })
  return win
}

/** 「上一级」等根切换：换授权、换监听。非预览窗口调用则忽略。 */
export function setPreviewWindowRoot(win: BrowserWindow, root: string): boolean {
  const entry = entryOf(win)
  if (!entry || isAppQuitting()) return false
  entry.root = normalizePath(root)
  grantFilesRoot(win.id, entry.root)
  attachWatcher(entry)
  return true
}

export function isPreviewWindow(win: BrowserWindow): boolean {
  return entryOf(win) !== undefined
}

/** 退出前关掉全部预览根监听（原生 addon 要求退出前显式 unsubscribe）。 */
export async function closeAllPreviewWatchers(): Promise<void> {
  const closing = [...byFile.values()].map(async (entry) => {
    const w = entry.watcher
    entry.watcher = null
    if (w) await w.dispose()
  })
  await Promise.all(closing)
}

/** 是否还有活着的预览窗口（Dock 点击 / 退出判定用）。 */
export function hasPreviewWindows(): boolean {
  return [...byFile.values()].some((e) => !e.win.isDestroyed())
}
