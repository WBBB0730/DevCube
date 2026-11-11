import { BrowserWindow } from 'electron'
import { basename } from 'node:path'
import { normalizePath } from '../shared/files-path'
import { IPC } from '../shared/ipc'
import { matchAppShortcut, type AppShortcut } from '../shared/app-shortcut'
import {
  buildPreviewQuery,
  deepestRootContaining,
  resolvePreviewRoot
} from '../shared/preview-window'
import { bringToFront, resetWindowGeometry } from './app-window'
import { grantFilesRoot, revokeFilesRoot } from './files-roots'
import { isAppQuitting } from './app-shutdown'
import { getProjects } from './store'
import { createRememberedWindow } from './layout-memory'
import { watchPreviewRoot } from './preview-watch'
import { toSysPath } from './sys-path'

/**
 * Preview Window（预览窗口）：系统带着一个文件拉起 DevCube 时开的独立窗口（docs/prd/file-preview-window.md）；
 * 主窗口项目菜单「在新窗口中打开」则以项目根开窗、不带初始文件。窗口按根认：文件落在某个窗口的树里就在那个窗口
 * 打开（多个包含它时取根最深的），否则新开一窗；同一个根再「在新窗口中打开」即聚焦。可多开、不进项目列表、不落盘。
 */

const PREVIEW_DEFAULTS = { width: 1000, height: 680, minWidth: 640, minHeight: 420 } as const
/** 多开时相对上一窗的错位 */
const CASCADE_OFFSET = 24

interface PreviewEntry {
  win: BrowserWindow
  /** 当前根（规范化逻辑路径）；「上一级」时替换 */
  root: string
  watcher: { dispose: () => Promise<void> } | null
  /** 页面已订阅打开文件的推送（previewReady）；页面重新加载时复位 */
  ready: boolean
  /** 页面就绪前落进本窗口的文件，就绪时一并交给页面 */
  queuedFiles: string[]
}

const entries = new Set<PreviewEntry>()

function entryOf(win: BrowserWindow): PreviewEntry | undefined {
  for (const entry of entries) if (entry.win === win) return entry
  return undefined
}

/** 树里能找到这个文件的窗口：根包含它，多个时取根最深的。 */
function entryShowing(file: string): PreviewEntry | undefined {
  const all = [...entries]
  const root = deepestRootContaining(
    file,
    all.map((e) => e.root)
  )
  return all.find((e) => e.root === root)
}

function attachWatcher(entry: PreviewEntry): void {
  void entry.watcher?.dispose()
  const root = entry.root
  entry.watcher = watchPreviewRoot(toSysPath(root), () => {
    if (!entry.win.isDestroyed()) entry.win.webContents.send(IPC.filesChanged, root)
  })
}

/**
 * 预览窗口只响应 Files 面板自己的键：筛选框聚焦、最近打开、Editor Tab 的关闭 / 切换 / 分屏，都交给页面——
 * Cmd/Ctrl+W 由页面先关 Editor Tab，关掉最后一个（或本来就没有）才关窗（docs/prd/files-editor-tabs.md「键位」）。
 * 项目 / Tab 类快捷键在此无意义，放行给页面。
 */
const PREVIEW_SHORTCUTS = new Set<AppShortcut['id']>([
  'focusFilesFilter',
  'recentFiles',
  'closeTab',
  'prevEditorTab',
  'nextEditorTab',
  'splitEditor'
])

function wirePreviewShortcuts(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    const hit = matchAppShortcut(
      {
        type: input.type,
        code: input.code,
        key: input.key,
        meta: input.meta,
        control: input.control,
        alt: input.alt,
        shift: input.shift
      },
      // 预览窗口没有终端
      { platform: process.platform, terminalFocused: false }
    )
    if (!hit || !PREVIEW_SHORTCUTS.has(hit.id)) return
    event.preventDefault()
    win.webContents.send(IPC.appShortcut, hit)
  })
}

/**
 * 系统 / External Open 带来的文件：落在某个窗口的树里就聚焦它并在里面打开；页面还没就绪先排着，也不提前聚焦——
 * 新开的窗口画好后自己显示并聚焦（见 createAppWindow），提前 show 会露出空窗口。
 * 否则新开一窗，根按「最深登记项目根，否则所在文件夹」解析。多选打开时系统逐个交来，同一文件夹的自然落进同一窗。
 */
export function openPreviewWindow(fileSysPath: string): void {
  const file = normalizePath(fileSysPath)
  const showing = entryShowing(file)
  if (showing === undefined) {
    const root = resolvePreviewRoot(
      file,
      getProjects().map((p) => p.path)
    )
    createPreview({ file, root }, fileSysPath)
    return
  }
  if (!showing.ready) {
    showing.queuedFiles.push(file)
    return
  }
  bringToFront(showing.win)
  showing.win.webContents.send(IPC.previewOpenFile, file)
}

/** 主窗口「在新窗口中打开」：以该目录为根、不带初始文件；已有同根的窗口即聚焦。 */
export function openPreviewWindowForRoot(rootSysPath: string): void {
  const root = normalizePath(rootSysPath)
  const same = [...entries].find((e) => e.root === root)
  if (same === undefined) createPreview({ file: null, root }, rootSysPath)
  else bringToFront(same.win)
}

/** 页面已订阅打开文件的推送：交出加载期间排着的文件，之后改为直接推送。非预览窗口为空。 */
export function takePreviewQueuedFiles(win: BrowserWindow): string[] {
  const entry = entryOf(win)
  if (entry === undefined) return []
  entry.ready = true
  return entry.queuedFiles.splice(0)
}

function createPreview(launch: { file: string | null; root: string }, sysPath: string): void {
  const { file, root } = launch
  // 几何与主窗口各记一份（ADR-0053），记忆跟着最近变化过或聚焦过的预览窗口实时更新：新窗跟它一样是否最大化、
  // 多大、在哪；它还开着且不是最大化 / 全屏时错位级联，别叠在同一位置（同一批连开的几个依次排开）
  const win = createRememberedWindow('preview', {
    defaults: PREVIEW_DEFAULTS,
    query: buildPreviewQuery({ file, root }),
    cascadeOffset: CASCADE_OFFSET
  })
  const entry: PreviewEntry = { win, root, watcher: null, ready: false, queuedFiles: [] }
  entries.add(entry)
  grantFilesRoot(win.id, root)
  attachWatcher(entry)
  // 页面重新加载期间推送会丢：先排着，等页面再次就绪
  win.webContents.on('did-start-loading', () => (entry.ready = false))

  win.setTitle(basename(sysPath))
  if (process.platform === 'darwin') win.setRepresentedFilename(sysPath)
  wirePreviewShortcuts(win)

  win.on('closed', () => {
    revokeFilesRoot(win.id)
    void entry.watcher?.dispose()
    entry.watcher = null
    entries.delete(entry)
  })
}

/** 恢复默认布局：开着的预览窗口都回到新开时的样子，依次错开（同多开）。 */
export function resetPreviewWindowsGeometry(): void {
  let offset = 0
  for (const { win } of entries) {
    if (win.isDestroyed()) continue
    resetWindowGeometry(win, offset)
    offset += CASCADE_OFFSET
  }
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
  const closing = [...entries].map(async (entry) => {
    const w = entry.watcher
    entry.watcher = null
    if (w) await w.dispose()
  })
  await Promise.all(closing)
}

/** 是否还有活着的预览窗口（Dock 点击 / 退出判定用）。 */
export function hasPreviewWindows(): boolean {
  return [...entries].some((e) => !e.win.isDestroyed())
}
