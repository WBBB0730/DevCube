import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import iconWin from '../../resources/icon-win.png?asset'
import {
  centerInArea,
  type ResolvedWindowPlacement,
  type WindowPlacementDefaults
} from '../shared/window-placement'
import { WINDOW_CHROME } from '../shared/theme'
import { getAppPrefs } from './store'

/** 窗口的最大化 / 全屏状态（见 windowState） */
export type WindowState = Pick<ResolvedWindowPlacement, 'isMaximized' | 'isFullScreen'>

/** 窗口壳为每个窗口记的：最大化 / 全屏状态（随窗口事件更新）与建窗时的默认尺寸 */
type AppWindowRecord = { state: WindowState; defaults: WindowPlacementDefaults }

const records = new WeakMap<BrowserWindow, AppWindowRecord>()

function recordOf(win: BrowserWindow): AppWindowRecord {
  const record = records.get(win)
  if (record === undefined) throw new Error('不是 createAppWindow 建的窗口')
  return record
}

/**
 * 窗口的最大化 / 全屏状态：建窗时记下要套的，之后随窗口事件更新。不现读 isMaximized() / isFullScreen()：
 * macOS 的全屏切换是异步的，官方文档要求以 enter-full-screen / leave-full-screen 事件为准（多选文件一起打开会
 * 连开几个预览窗口，后开的要照前一个开，那时前一个的切换还没完成）。
 */
export function windowState(win: BrowserWindow): WindowState {
  return { ...recordOf(win).state }
}

function trackWindow(
  win: BrowserWindow,
  initial: WindowState,
  defaults: WindowPlacementDefaults
): void {
  const state: WindowState = {
    isMaximized: initial.isMaximized,
    isFullScreen: initial.isFullScreen
  }
  records.set(win, { state, defaults })
  win.on('maximize', () => (state.isMaximized = true))
  win.on('unmaximize', () => (state.isMaximized = false))
  win.on('enter-full-screen', () => (state.isFullScreen = true))
  win.on('leave-full-screen', () => (state.isFullScreen = false))
}

/**
 * 恢复默认布局：窗口回到新开时的样子——退出全屏与最大化，默认尺寸摆在所在显示器工作区的正中。
 * offset：多个同类窗口依次错开，不叠在一处。
 */
export function resetWindowGeometry(win: BrowserWindow, offset = 0): void {
  const { state, defaults } = recordOf(win)
  const place = (): void => {
    if (win.isDestroyed()) return
    if (state.isMaximized) win.unmaximize()
    const area = screen.getDisplayMatching(win.getBounds()).workArea
    win.setBounds(centerInArea(defaults, area, offset))
  }
  if (state.isFullScreen) {
    // macOS 的全屏切换是异步的（官方文档）：等退出完成再摆，否则会被恢复成进全屏前的样子；其余平台当场完成
    if (process.platform === 'darwin') {
      win.once('leave-full-screen', place)
      win.setFullScreen(false)
      return
    }
    win.setFullScreen(false)
  }
  place()
}

/**
 * 主窗口、Preview Window 与压缩窗口共用的窗口壳：无边框标题栏、平台图标、preload；
 * 加载同一渲染入口，`query` 决定渲染层挂工作台、预览窗口还是压缩窗口（见 shared/preview-window、shared/compress）。
 *
 * 几何在页面第一次排版之前就位：按 placement 的位置尺寸建窗，紧接着套上最大化 / 全屏，再加载页面。等页面画好
 * 再套的话，窗口变大后会先露出一帧按原尺寸画的旧画面。Electron 套这两种状态时会把隐藏的窗口直接显示出来
 * （官方文档：maximize 会顺带显示窗口），所以这类窗口建好即显示，页面加载期间由 backgroundColor 垫底；其余窗口
 * 等页面画好（ready-to-show）再显示，不露出空窗口。
 * fixedSize：不可调整大小、不可最大化 / 全屏（压缩窗口这类按内容定高的小窗）。
 * showNow：建好即显示、不等页面画好（压缩窗口要立即接管键盘，见 compress.ts）。
 */
export function createAppWindow(opts: {
  placement: ResolvedWindowPlacement
  defaults: WindowPlacementDefaults
  query?: Record<string, string>
  fixedSize?: boolean
  showNow?: boolean
}): BrowserWindow {
  const { placement, defaults } = opts
  const chrome = WINDOW_CHROME[getAppPrefs().theme]
  const win = new BrowserWindow({
    width: placement.width,
    height: placement.height,
    ...(placement.x !== undefined && placement.y !== undefined
      ? { x: placement.x, y: placement.y }
      : {}),
    minWidth: defaults.minWidth,
    minHeight: defaults.minHeight,
    show: false,
    ...(opts.fixedSize === true
      ? { resizable: false, maximizable: false, fullscreenable: false }
      : {}),
    autoHideMenuBar: true,
    backgroundColor: chrome.background,
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 12 } } : {}),
    ...(process.platform !== 'darwin'
      ? {
          titleBarOverlay: {
            color: chrome.background,
            symbolColor: chrome.symbol,
            height: 40
          }
        }
      : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    ...(process.platform === 'win32' ? { icon: iconWin } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  trackWindow(win, placement, defaults)
  if (placement.isMaximized) win.maximize()
  // maximize 只显示不聚焦，show 把它带到前台；全屏对着已显示的窗口切（同 VS Code：先显示，再切全屏）
  if (opts.showNow === true || placement.isMaximized || placement.isFullScreen) win.show()
  else win.once('ready-to-show', () => win.show())
  if (placement.isFullScreen) win.setFullScreen(true)

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  const query = opts.query ?? {}
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    void win.loadURL(url.toString())
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query })
  }
  return win
}

/** 推给全部窗口（主窗口与各 Preview Window）。 */
export function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}
