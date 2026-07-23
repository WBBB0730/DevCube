import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { handleFilesMediaProtocol, registerFilesMediaScheme } from './files-media-protocol'
import { installAppMenu } from './app-menu'
import { wireAppShortcuts } from './app-shortcuts'
import { initStore } from './store'
import { registerIpc } from './ipc'
import { isAppQuitting, isQuitAllowed, markAppQuitting, markQuitAllowed } from './app-shutdown'
import { killAllSessions } from './runner'
import { closeAllProjectWatchers } from './project-watchers'
import { resolveReleaseEdition } from '../shared/release-edition'
import { confirmQuitIfNeeded } from './quit-confirm'
import { canInstallUpdateOnQuit, installDownloadedUpdate } from './app-updater'
import { rememberWindowPlacement, resolveRememberedWindowPlacement } from './window-placement'
import { registerBootstrapIpc } from './renderer-bootstrap'

// 必须在 app.ready 之前注册特权 scheme，否则渲染层无法用自定义协议播媒体。
registerFilesMediaScheme()
// 必须在 app.ready 之前安装/清除应用菜单，否则 Electron 会挂上含 DevTools 的默认菜单。
installAppMenu()

const WINDOW_DEFAULTS = {
  width: 1100,
  height: 720,
  minWidth: 720,
  minHeight: 480
} as const

function createWindow(): BrowserWindow {
  const placement = resolveRememberedWindowPlacement(WINDOW_DEFAULTS)
  const mainWindow = new BrowserWindow({
    width: placement.width,
    height: placement.height,
    ...(placement.x !== undefined && placement.y !== undefined
      ? { x: placement.x, y: placement.y }
      : {}),
    minWidth: WINDOW_DEFAULTS.minWidth,
    minHeight: WINDOW_DEFAULTS.minHeight,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#2b2d30',
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 12 } } : {}),
    ...(process.platform !== 'darwin'
      ? {
          titleBarOverlay: {
            color: '#2b2d30',
            symbolColor: '#ced0d6',
            height: 40
          }
        }
      : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // 关窗前写入进程内记忆（macOS 点 Dock 重开时恢复；重启进程则清空）。
  mainWindow.on('close', () => {
    rememberWindowPlacement(mainWindow)
  })

  mainWindow.on('ready-to-show', () => {
    if (placement.isMaximized) mainWindow.maximize()
    if (placement.isFullScreen) mainWindow.setFullScreen(true)
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
  // preload sendSync 依赖此通道；必须在 createWindow / loadURL 之前。
  registerBootstrapIpc()
  registerIpc(createWindow())

  app.on('activate', function () {
    // On macOS re-create a window when the dock icon is clicked and none are open.
    if (isAppQuitting()) return
    if (BrowserWindow.getAllWindows().length === 0) registerIpc(createWindow())
  })
})

// Cmd+Q / app.quit() 会走 before-quit，但不会发 window-all-closed（Electron 官方说明）。
// 退出清理必须在这里完成：先 await 关掉原生文件监听，再 app.exit（官方对原生 addon 的要求是
// 退出前显式 destroy；用 app.exit 避免再入 before-quit）。清理期间禁止 sync* 重建监听。
type QuitPhase = 'running' | 'cleaning' | 'exiting'
let quitPhase: QuitPhase = 'running'

async function runQuitCleanup(): Promise<void> {
  markAppQuitting()
  killAllSessions()
  await closeAllProjectWatchers()
  // 给原生 watcher stop 一点时间收尾，再拆 Node Environment。
  await new Promise<void>((resolve) => setTimeout(resolve, 50))
}

app.on('before-quit', (event) => {
  if (quitPhase === 'exiting') return
  event.preventDefault()
  if (quitPhase === 'cleaning') return

  void (async () => {
    if (!isQuitAllowed()) {
      const ok = await confirmQuitIfNeeded(BrowserWindow.getFocusedWindow())
      if (!ok) return
      markQuitAllowed()
    }

    quitPhase = 'cleaning'
    try {
      await runQuitCleanup()
    } catch {
      // ignore
    }

    // 有待装更新：标 exiting 后跳出 before-quit 再 install（Squirrel.Mac 忌在带
    // preventDefault 的 before-quit 同步栈里 quitAndInstall，见 ADR-0016）。
    if (canInstallUpdateOnQuit()) {
      quitPhase = 'exiting'
      setImmediate(() => installDownloadedUpdate())
      return
    }

    quitPhase = 'exiting'
    app.exit(0)
  })()
})

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  // macOS 关窗不退出：保留运行中的会话进程，重开窗口后仍能恢复运行状态。
  // 真正退出清理在 before-quit；此处仅在「只关窗、不退出」时停掉无 UI 的文件监听。
  if (process.platform === 'darwin') {
    void closeAllProjectWatchers()
    return
  }
  app.quit()
})
