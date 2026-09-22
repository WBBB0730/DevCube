import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import iconWin from '../../resources/icon-win.png?asset'
import type { ResolvedWindowPlacement, WindowPlacementDefaults } from '../shared/window-placement'
import { WINDOW_CHROME } from '../shared/theme'
import { getAppPrefs } from './store'

/**
 * 主窗口与 Preview Window 共用的窗口壳：无边框标题栏、平台图标、preload；
 * 加载同一渲染入口，`query` 决定渲染层挂工作台还是预览窗口（见 shared/preview-window）。
 */
export function createAppWindow(opts: {
  placement: ResolvedWindowPlacement
  defaults: WindowPlacementDefaults
  query?: Record<string, string>
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
