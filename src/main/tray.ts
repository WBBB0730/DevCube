import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import { resolveReleaseEdition } from '../shared/release-edition'
import iconWin from '../../resources/icon-win.png?asset'

let tray: Tray | null = null

/** `ensureMain` 返回既有主窗口或新建（预览窗口不算主窗口，不能拿 getAllWindows 首个充数）。 */
function showMainWindow(ensureMain: () => BrowserWindow): void {
  const win = ensureMain()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** 仅 Windows：系统托盘。macOS / Linux 不创建。 */
export function installTray(ensureMain: () => BrowserWindow): void {
  if (process.platform !== 'win32' || tray) return

  const image = nativeImage.createFromPath(iconWin)
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  tray.setToolTip(resolveReleaseEdition(app.getVersion()).productName)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '打开主窗口',
        click: () => showMainWindow(ensureMain)
      },
      {
        label: '退出',
        click: () => app.quit()
      }
    ])
  )
  tray.on('click', () => showMainWindow(ensureMain))
  tray.on('double-click', () => showMainWindow(ensureMain))
}

export function disposeTray(): void {
  tray?.destroy()
  tray = null
}
