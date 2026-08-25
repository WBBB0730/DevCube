import { BrowserWindow, nativeTheme } from 'electron'
import { WINDOW_CHROME, type ThemeMode } from '../shared/theme'

/**
 * 把主题落到原生侧。
 *
 * `themeSource` 是强制值而非「跟随系统」：它同时决定原生菜单 / 托盘菜单 / 系统对话框的明暗，
 * 以及渲染层 `prefers-color-scheme` 的取值（渲染层全部样式由此驱动，见 ADR-0026）。
 * 窗口底色与 Windows 顶栏叠层是建窗选项、不受 themeSource 影响，需在此手动同步。
 */
export function applyTheme(theme: ThemeMode): void {
  nativeTheme.themeSource = theme
  const chrome = WINDOW_CHROME[theme]
  for (const win of BrowserWindow.getAllWindows()) {
    win.setBackgroundColor(chrome.background)
    // titleBarOverlay 仅在非 darwin 分支建窗时启用；未启用的窗口调用会抛错。
    if (process.platform !== 'darwin') {
      win.setTitleBarOverlay({ color: chrome.background, symbolColor: chrome.symbol })
    }
  }
}
