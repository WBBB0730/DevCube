import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { handleFilesMediaProtocol, registerFilesMediaScheme } from './files-media-protocol'
import { wireAppShortcuts } from './app-shortcuts'
import { initStore } from './store'
import { registerIpc } from './ipc'
import { killAllSessions } from './runner'
import { closeAllWatchers } from './watcher'
import { closeAllGitWatchers } from './git-watcher'
import { closeAllFilesWatchers } from './files-watcher'
import { resolveReleaseEdition } from '../shared/release-edition'

// 必须在 app.ready 之前注册特权 scheme，否则渲染层无法用自定义协议播媒体。
registerFilesMediaScheme()

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#2b2d30',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 应用快捷键：主进程 before-input-event 优先拦截（见 ADR-0013 / docs）。
  wireAppShortcuts(mainWindow)

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId(resolveReleaseEdition(app.getVersion()).appId)

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  await initStore()
  handleFilesMediaProtocol()
  registerIpc(createWindow())

  app.on('activate', function () {
    // On macOS re-create a window when the dock icon is clicked and none are open.
    if (BrowserWindow.getAllWindows().length === 0) registerIpc(createWindow())
  })
})

// 退出前杀掉所有活跃会话的进程树，避免 dev server 变孤儿。
app.on('before-quit', killAllSessions)

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  // macOS 关窗不退出：保留运行中的会话进程，重开窗口后仍能恢复运行状态。
  // 真正退出时由 before-quit 统一杀进程树；非 mac 下面的 app.quit() 会触发它。
  closeAllWatchers()
  closeAllGitWatchers()
  closeAllFilesWatchers()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
