/**
 * 应用内更新编排：检查节奏、身份过滤、下载/便携降级、状态推送。
 * 策略纯函数见 shared/app-update；产品范围见 docs/prd/in-app-update.md。
 */

import { app, autoUpdater as nativeAutoUpdater, BrowserWindow, shell } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import {
  canAutoDownload,
  GITHUB_REPO_URL,
  githubReleaseUrl,
  isUpdateAllowedForEdition,
  resolveUpdatePackaging,
  shouldShowUpdateButton,
  updateButtonAction,
  type AppUpdatePhase,
  type UpdatePackaging
} from '../shared/app-update'
import type { AppUpdateState } from '../shared/app-update-state'
import { IPC } from '../shared/ipc'
import { resolveReleaseEdition } from '../shared/release-edition'

const STARTUP_JITTER_MAX_MS = 30_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

let packaging: UpdatePackaging = 'dev'
let phase: AppUpdatePhase = 'idle'
let availableVersion: string | null = null
let lastError: string | null = null
let win: BrowserWindow | null = null
let started = false
let startupTimer: ReturnType<typeof setTimeout> | null = null
let intervalTimer: ReturnType<typeof setInterval> | null = null
let checking = false

function edition(): ReturnType<typeof resolveReleaseEdition> {
  return resolveReleaseEdition(app.getVersion())
}

function buildState(): AppUpdateState {
  const ed = edition()
  const showButton = shouldShowUpdateButton(packaging, phase)
  const buttonAction = updateButtonAction(packaging)
  return {
    phase,
    packaging,
    currentVersion: app.getVersion(),
    productName: ed.productName,
    channel: ed.channel,
    availableVersion,
    showButton,
    buttonAction,
    lastError,
    repoUrl: GITHUB_REPO_URL,
    releaseUrl: availableVersion
      ? githubReleaseUrl(availableVersion)
      : `${GITHUB_REPO_URL}/releases`
  }
}

function emit(): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.appUpdateState, buildState())
  }
}

function setPhase(next: AppUpdatePhase): void {
  phase = next
  emit()
}

function candidateFromInfo(info: UpdateInfo): { version: string; prerelease: boolean } | null {
  try {
    const ed = resolveReleaseEdition(info.version)
    return { version: info.version, prerelease: ed.prerelease }
  } catch {
    return null
  }
}

async function runCheck(): Promise<void> {
  if (packaging === 'dev' || checking) return
  checking = true
  lastError = null
  setPhase('checking')
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    availableVersion = null
    setPhase('error')
  } finally {
    checking = false
  }
}

function wireUpdater(): void {
  autoUpdater.autoDownload = false
  // 退出安装由清理完成后的 installDownloadedUpdate 显式触发（与退出确认 / 清理编排配合）。
  autoUpdater.autoInstallOnAppQuit = false
  // mac 的 quitAndInstall 忽略 isForceRunAfter，只看此开关；Win/Linux 非静默安装也走它。
  autoUpdater.autoRunAppAfterInstall = true
  autoUpdater.allowPrerelease = edition().channel === 'beta'

  autoUpdater.on('checking-for-update', () => {
    lastError = null
    if (phase !== 'ready') setPhase('checking')
  })

  autoUpdater.on('update-available', (info) => {
    const candidate = candidateFromInfo(info)
    if (!candidate || !isUpdateAllowedForEdition(edition(), candidate)) {
      availableVersion = null
      // 跨线 / 非法候选：当作没有适用更新，避免误下正式包到 Beta。
      setPhase('upToDate')
      return
    }
    availableVersion = candidate.version
    lastError = null
    if (!canAutoDownload(packaging)) {
      setPhase('available')
      return
    }
    setPhase('downloading')
    void autoUpdater.downloadUpdate().catch((err: unknown) => {
      lastError = err instanceof Error ? err.message : String(err)
      setPhase('error')
    })
  })

  autoUpdater.on('update-not-available', () => {
    if (phase === 'ready') return
    availableVersion = null
    lastError = null
    setPhase('upToDate')
  })

  autoUpdater.on('update-downloaded', (info) => {
    const candidate = candidateFromInfo(info)
    if (!candidate || !isUpdateAllowedForEdition(edition(), candidate)) {
      availableVersion = null
      setPhase('upToDate')
      return
    }
    availableVersion = candidate.version
    lastError = null
    setPhase('ready')
  })

  autoUpdater.on('error', (err) => {
    lastError = err instanceof Error ? err.message : String(err)
    if (phase !== 'ready') setPhase('error')
    else emit()
  })
}

/** 应用就绪后启动：开发形态直接推 idle 状态，不查网。 */
export function startAppUpdater(mainWindow: BrowserWindow): void {
  win = mainWindow
  packaging = resolveUpdatePackaging({
    isPackaged: app.isPackaged,
    platform: process.platform,
    portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR
  })

  if (started) {
    emit()
    return
  }
  started = true

  if (packaging === 'dev') {
    phase = 'idle'
    emit()
    return
  }

  wireUpdater()
  emit()

  const jitter = Math.floor(Math.random() * STARTUP_JITTER_MAX_MS)
  startupTimer = setTimeout(() => {
    startupTimer = null
    void runCheck()
  }, jitter)

  intervalTimer = setInterval(() => {
    void runCheck()
  }, CHECK_INTERVAL_MS)
}

export function getAppUpdateState(): AppUpdateState {
  return buildState()
}

export async function checkAppUpdates(): Promise<AppUpdateState> {
  if (packaging === 'dev') return buildState()
  await runCheck()
  return buildState()
}

/**
 * 顶栏 / 关于：按形态打开 Release，或走 `app.quit()` 让 before-quit 清理后安装。
 * 不可在此处直接 `quitAndInstall`：会被 before-quit 的 preventDefault 吞掉（表现为按钮无反应）。
 */
export function performUpdateButtonAction(): { startedInstall: boolean } {
  const state = buildState()
  if (!state.showButton) return { startedInstall: false }

  if (state.buttonAction === 'openRelease') {
    void shell.openExternal(state.releaseUrl)
    return { startedInstall: false }
  }

  if (phase !== 'ready') return { startedInstall: false }
  app.quit()
  return { startedInstall: true }
}

export function openAppReleasePage(): void {
  const state = buildState()
  void shell.openExternal(state.releaseUrl)
}

/** 正常退出时是否应安装已下载更新（由 before-quit 在清理完成后调用 install）。 */
export function canInstallUpdateOnQuit(): boolean {
  return phase === 'ready' && canAutoDownload(packaging)
}

/**
 * 安装已下载更新。调用前须已完成退出清理。
 *
 * macOS（Squirrel.Mac）：会拦截退出的 before-quit / window-all-closed / close 监听
 * 必须先卸掉，并在 before-quit-for-update 里 app.exit，否则常出现装完不重开
 *（electron-builder#8997 主流做法）。勿在带 preventDefault 的 before-quit 同步栈里调用。
 */
export function installDownloadedUpdate(): void {
  autoUpdater.autoRunAppAfterInstall = true

  if (process.platform === 'darwin') {
    app.removeAllListeners('before-quit')
    app.removeAllListeners('window-all-closed')
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue
      w.removeAllListeners('close')
    }
    nativeAutoUpdater.once('before-quit-for-update', () => {
      app.exit(0)
    })
  }

  autoUpdater.quitAndInstall(false, true)
}

export function disposeAppUpdater(): void {
  if (startupTimer) clearTimeout(startupTimer)
  if (intervalTimer) clearInterval(intervalTimer)
  startupTimer = null
  intervalTimer = null
}
