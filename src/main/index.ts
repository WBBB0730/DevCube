import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { handleFilesMediaProtocol, registerFilesMediaScheme } from './files-media-protocol'
import { installAppMenu } from './app-menu'
import { installWebContentsGuard } from './web-contents-guard'
import { wireAppShortcuts } from './app-shortcuts'
import { initStore } from './store'
import { bindMainWindow, registerIpcHandlers } from './ipc'
import { isAppQuitting, isQuitAllowed, markAppQuitting, markQuitAllowed } from './app-shutdown'
import { killAllSessions } from './runner'
import { disposeAllServerStatus } from './server-status'
import { disposeAllDataSourceSessions } from './data-source-sessions'
import { flushSchemaCaches } from './data-source-schema-cache'
import {
  disposeAllServerFiles,
  setUnsavedServerFileCount,
  unsavedServerFileCount
} from './server-files'
import { clearAllServerFilesCache } from './server-files-cache'
import { closeAllProjectWatchers } from './project-watchers'
import { resolveReleaseEdition } from '../shared/release-edition'
import { confirmCloseIfUnsaved, confirmQuitIfNeeded } from './quit-confirm'
import { canInstallUpdateOnQuit, installDownloadedUpdate } from './app-updater'
import { rememberWindowPlacement, resolveRememberedWindowPlacement } from './window-placement'
import { registerBootstrapIpc } from './renderer-bootstrap'
import { disposeTray, installTray } from './tray'
import { configureUserData } from './user-data'
import {
  argvTailStart,
  classifyExternalPath,
  dispatchExternalOpen,
  drainPendingExternalOpens,
  extractOpenTargets,
  parseDeepLink,
  setExternalOpenHandler,
  targetFromDeepLink,
  type ExternalOpenTarget
} from './external-open'
import { openProjectFromExternal } from './ipc'
import { addProjectByPath } from './projects'
import { getAppPrefs, getWorkspaceUi, setWorkspaceUi } from './store'
import { applyTheme } from './theme'
import { createAppWindow } from './app-window'
import { closeAllPreviewWatchers, openPreviewWindow } from './preview-window'
import { disposeAllCompressJobs, openCompressWindow, setCompressIdleHandler } from './compress'
import { devElectronAppPath, ensureDevOpenerApp } from './dev-opener-app'
import { syncSystemIntegration } from './system-integration'

// 必须早于 app.ready、Store 初始化和 Chromium Session 创建，隔离 Stable / Beta / Dev。
configureUserData(app)

// 单实例（锁随 userData 分线，Stable / Beta / Dev 互不拦）：第二实例把 argv
// 转发给主实例（second-instance 事件）后立即退出，承接外部唤起路径。
if (!app.requestSingleInstanceLock()) app.exit(0)

// External Open：deep link 按 Edition 分线（devcube / devcube-beta）；Dev 不注册，
// 避免抢注已安装版本（ADR-0025）。事件监听必须早于 ready，冷启动事件先排队。
const deepLinkScheme = resolveReleaseEdition(app.getVersion()).name
if (app.isPackaged) app.setAsDefaultProtocolClient(deepLinkScheme)

// Finder 快速操作「在 DevCube 中打开」/ 「打开方式」/ `open -b <bundleId> <路径>` 走 open-file：目录 → 项目，文件 → 预览窗口
app.on('open-file', (event, path) => {
  event.preventDefault()
  const target = classifyExternalPath(path)
  if (target) dispatchExternalOpen(target)
})
// deep link：打开（同上）与压缩（Finder 快速操作「用 DevCube 压缩」一次带上全部选中项）
app.on('open-url', (event, url) => {
  event.preventDefault()
  const link = parseDeepLink(url, deepLinkScheme)
  const target = link === null ? null : targetFromDeepLink(link)
  if (target) dispatchExternalOpen(target)
})
app.on('second-instance', (_event, argv, workingDirectory) => {
  const args = argv.slice(argvTailStart(app.isPackaged))
  const targets = extractOpenTargets(args, { scheme: deepLinkScheme, cwd: workingDirectory })
  // 只带文件或压缩请求时不动主窗口（双击文件只多开一个预览窗口，压缩只开压缩窗口）；
  // 带目录或空唤起才把主窗口带到前台
  if (targets.length > 0 && targets.every((t) => t.kind !== 'dir')) {
    for (const t of targets) dispatchExternalOpen(t)
    return
  }
  focusMainWindow()
  for (const t of targets) dispatchExternalOpen(t)
})

// 必须在 app.ready 之前注册特权 scheme，否则渲染层无法用自定义协议播媒体。
registerFilesMediaScheme()
// 必须在 app.ready 之前安装/清除应用菜单，否则 Electron 会挂上含 DevTools 的默认菜单。
installAppMenu()
// 渲染层主框架除重载外禁止导航、开窗一律改走系统浏览器：须早于建窗，只对之后创建的 webContents 生效。
installWebContentsGuard()

const WINDOW_DEFAULTS = {
  width: 1100,
  height: 720,
  minWidth: 720,
  minHeight: 480
} as const

let mainWindow: BrowserWindow | null = null
/** 本进程开过主窗口（冷启动只为压缩时据此判断压完是否退出） */
let mainWindowOpened = false
/** 冷启动只带压缩请求：最后一个压缩窗口关掉、期间也没开过主窗口时退出，像系统压缩一样用完即走 */
let launchedForCompress = false

function liveMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

function createWindow(): BrowserWindow {
  const placement = resolveRememberedWindowPlacement(WINDOW_DEFAULTS, 'main')
  const win = createAppWindow({ placement, defaults: WINDOW_DEFAULTS })

  // 关窗前写入进程内记忆（macOS 点 Dock 重开时恢复；重启进程则清空）。
  // Windows：点关闭隐藏到托盘，真正退出走托盘「退出」/ before-quit。
  // 其余平台关窗即销毁渲染端：服务器上还有未保存的文件时先确认（退出时已由退出确认问过）。
  let closeConfirmed = false
  win.on('close', (event) => {
    rememberWindowPlacement(win, 'main')
    if (isAppQuitting()) return
    if (process.platform === 'win32') {
      event.preventDefault()
      win.hide()
      return
    }
    if (closeConfirmed || unsavedServerFileCount() === 0) return
    event.preventDefault()
    void confirmCloseIfUnsaved(win).then((ok) => {
      if (!ok || win.isDestroyed()) return
      closeConfirmed = true
      win.close()
    })
  })
  // 渲染端没了，它登记的未保存文件也随之作废
  win.on('closed', () => setUnsavedServerFileCount(0))

  win.on('ready-to-show', () => {
    if (placement.isMaximized) win.maximize()
    if (placement.isFullScreen) win.setFullScreen(true)
    win.show()
  })

  // 应用快捷键：主进程 before-input-event 优先拦截（见 ADR-0013 / docs）。
  wireAppShortcuts(win)
  return win
}

function openMainWindow(): BrowserWindow {
  const existing = liveMainWindow()
  if (existing) return existing
  const win = createWindow()
  mainWindow = win
  mainWindowOpened = true
  bindMainWindow(win)
  return win
}

/** 外部唤起 / 第二实例 / 托盘：把主窗口带到前台（Windows 托盘隐藏态先 show），没有则重开。 */
function focusMainWindow(): void {
  const win = liveMainWindow()
  if (!win) {
    if (app.isReady() && !isAppQuitting()) openMainWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** 运行中的 External Open：目录 → 登记 / 聚焦项目（主窗口不在则建）；文件 → 预览窗口；压缩 → 压缩窗口。 */
function handleExternalOpen(target: ExternalOpenTarget): void {
  if (target.kind === 'compress') void openCompressWindow(target.paths)
  else if (target.kind === 'file') openPreviewWindow(target.path)
  else openProjectFromExternal(target.path)
}

app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId(resolveReleaseEdition(app.getVersion()).appId)

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // zoom: true —— 该钩子默认还会拦下 CmdOrCtrl+- 与 CmdOrCtrl+Shift+=（它以为是网页缩放键），
  // 页面连 keydown 都收不到；这两个键归 Files 预览用，菜单里也早无缩放角色（ADR-0019）。
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window, { zoom: true })
  })

  await initStore()
  // 必须在建窗之前：themeSource 决定页面加载时 prefers-color-scheme 的取值，样式表解析即定音，首帧不闪。
  applyTheme(getAppPrefs().theme)
  handleFilesMediaProtocol()
  // 上次异常退出留下的服务器文件缓存（正常退出时已清）
  clearAllServerFilesCache()
  // preload sendSync 依赖此通道；必须在 createWindow / loadURL 之前。
  registerBootstrapIpc()

  // IPC handler 只注册一次且早于任何窗口：冷启动可能只开预览窗口而没有主窗口。
  registerIpcHandlers(openMainWindow)

  // 冷启动 External Open（启动参数 / 就绪前已到的 open-file / open-url）：目录在开窗前登记并预置
  // 当前项目（渲染端从 bootstrap 快照直接带出选中，无需事后推送）；文件各开一个预览窗口；压缩各开一个压缩窗口。
  // 只带文件或压缩请求时不建主窗口——看一张图、压一个包不必拉起整个工作台。
  const argvTargets = extractOpenTargets(process.argv.slice(argvTailStart(app.isPackaged)), {
    scheme: deepLinkScheme,
    cwd: process.cwd()
  })
  const targets = [...argvTargets, ...drainPendingExternalOpens()]
  const dirs: string[] = []
  const files: string[] = []
  const compressions: string[][] = []
  for (const t of targets) {
    if (t.kind === 'compress') compressions.push(t.paths)
    else if (t.kind === 'dir') dirs.push(t.path)
    else files.push(t.path)
  }
  for (const path of dirs) {
    if (addProjectByPath(path) !== null) {
      setWorkspaceUi({ ...getWorkspaceUi(), currentEntryKey: path, selectedKey: null })
    }
  }

  if (targets.length === 0 || dirs.length > 0) openMainWindow()
  for (const path of files) openPreviewWindow(path)
  launchedForCompress = targets.length > 0 && targets.length === compressions.length
  setCompressIdleHandler(() => {
    if (launchedForCompress && !mainWindowOpened && BrowserWindow.getAllWindows().length === 0) {
      app.quit()
    }
  })
  for (const paths of compressions) void openCompressWindow(paths)
  installTray(openMainWindow)

  // Dev 身份的「文件打开方式」实体：启动即同步（打包身份靠 Info.plist 声明，安装即在「打开方式」里），
  // 指纹不变则跳过；失败只记日志，不影响启动。
  if (!app.isPackaged && process.platform === 'darwin') {
    ensureDevOpenerApp(devElectronAppPath()).catch((err) => {
      console.warn('[dev-opener-app] sync failed', err)
    })
  }

  // 已开启的系统入口与当前构建对齐（Windows 压缩右键扩展：DLL 换了版本或唤起命令变了就重新登记）；
  // 失败只记日志，不影响启动。
  syncSystemIntegration().catch((err) => {
    console.warn('[system-integration] sync failed', err)
  })

  // 运行中的 External Open（第二实例 / open-file / open-url）
  setExternalOpenHandler(handleExternalOpen)

  app.on('activate', function () {
    // On macOS re-create a window when the dock icon is clicked and none are open.
    if (isAppQuitting()) return
    if (BrowserWindow.getAllWindows().length === 0) openMainWindow()
  })
})

// Cmd+Q / app.quit() 会走 before-quit，但不会发 window-all-closed（Electron 官方说明）。
// 退出清理必须在这里完成：先 await 关掉原生文件监听，再 app.exit（官方对原生 addon 的要求是
// 退出前显式 destroy；用 app.exit 避免再入 before-quit）。清理期间禁止 sync* 重建监听。
type QuitPhase = 'running' | 'cleaning' | 'exiting'
let quitPhase: QuitPhase = 'running'

async function runQuitCleanup(): Promise<void> {
  markAppQuitting()
  disposeTray()
  killAllSessions()
  disposeAllServerStatus()
  disposeAllServerFiles()
  clearAllServerFilesCache()
  // 数据库连接与 SQLite 查询线程也在这里关掉（含数总行数、导出、连上后读主体结构等临时连接）；还在执行的语句先叫停，
  // 最多等 2 秒。表结构缓存把待写的写完。进行中的压缩结束线程、删掉写了一半的临时文件
  await Promise.all([
    closeAllProjectWatchers(),
    closeAllPreviewWatchers(),
    disposeAllDataSourceSessions(),
    flushSchemaCaches(),
    disposeAllCompressJobs()
  ])
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

// Quit when all windows are closed, except on macOS / Windows（托盘驻留）。
app.on('window-all-closed', () => {
  // macOS / Windows 关窗不退出：保留运行中的会话进程，重开后仍能恢复运行状态。
  // 真正退出清理在 before-quit；此处仅在「只关窗、不退出」时停掉无 UI 的文件监听。
  // Windows 正常点关闭是 hide 不会进这里；窗口被销毁时仍不 quit。
  if (process.platform === 'darwin' || process.platform === 'win32') {
    void closeAllProjectWatchers()
    return
  }
  app.quit()
})
