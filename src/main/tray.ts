import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import { resolveReleaseEdition } from '../shared/release-edition'
import iconWin from '../../resources/icon-win.png?asset'

let tray: Tray | null = null

function showMainWindow(createIfMissing: () => BrowserWindow): void {
  const existing = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!existing) {
    createIfMissing()
    return
  }
  if (existing.isMinimized()) existing.restore()
  existing.show()
  existing.focus()
}

/** 仅 Windows：系统托盘。macOS / Linux 不创建。 */
export function installTray(createIfMissing: () => BrowserWindow): void {
  if (process.platform !== 'win32' || tray) return

  const image = nativeImage.createFromPath(iconWin)
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  tray.setToolTip(resolveReleaseEdition(app.getVersion()).productName)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '打开主窗口',
        click: () => showMainWindow(createIfMissing)
      },
      {
        label: '退出',
        click: () => app.quit()
      }
    ])
  )
  tray.on('click', () => showMainWindow(createIfMissing))
  tray.on('double-click', () => showMainWindow(createIfMissing))
}

export function disposeTray(): void {
  tray?.destroy()
  tray = null
}
