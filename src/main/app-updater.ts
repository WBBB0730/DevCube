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
  isReleaseOnlyPackaging,
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
/** 检查失败（如发版窗口期内 Atom 指向无资产 tag）后的静默重试间隔。 */
const CHECK_RETRY_MS = 15 * 60 * 1000
/** 进入关于自动检查的冷却（手动「检查更新」可 force 绕过）。 */
const CHECK_COOLDOWN_MS = 5 * 60 * 1000

let packaging: UpdatePackaging = 'dev'
let phase: AppUpdatePhase = 'upToDate'
let availableVersion: string | null = null
let lastError: string | null = null
let win: BrowserWindow | null = null
let started = false
/** 是否接线并跑检查（未包装开发与可更新包装形态为 true）。 */
let checksEnabled = false
let startupTimer: ReturnType<typeof setTimeout> | null = null
let intervalTimer: ReturnType<typeof setInterval> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
/** 进行中的检查；并发调用共用同一 Promise，避免早退 snapshot 竞态。 */
let checkPromise: Promise<void> | null = null
/** 最近一次真正开始检查的时间（含后台 jitter / 周期）。 */
let lastCheckStartedAt = 0

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
    checksEnabled,
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

function clearRetryTimer(): void {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
}

/** 已有「可安装 / 仅打开 Release」结果时，复检失败不降级。 */
function shouldPreserveUpdateOffer(): boolean {
  return phase === 'ready' || (phase === 'available' && isReleaseOnlyPackaging(packaging))
}

/** 检查失败：对外当无更新，不展示错误，稍后静默再查。已有可用更新时不降级。 */
function treatCheckFailureAsUpToDate(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  console.warn('[app-updater] check failed; treat as up to date, retry later:', message)
  lastError = null
  if (shouldPreserveUpdateOffer()) {
    emit()
    scheduleCheckRetry()
    return
  }
  availableVersion = null
  setPhase('upToDate')
  scheduleCheckRetry()
}

function scheduleCheckRetry(): void {
  if (!checksEnabled) return
  clearRetryTimer()
  retryTimer = setTimeout(() => {
    retryTimer = null
    void runCheck()
  }, CHECK_RETRY_MS)
}

async function runCheck(): Promise<void> {
  if (!checksEnabled) return
  // 下载中不打断。
  if (phase === 'downloading') return
  if (checkPromise) {
    await checkPromise
    return
  }

  checkPromise = (async () => {
    lastCheckStartedAt = Date.now()
    clearRetryTimer()
    lastError = null
    // 已有可用更新结果时仍可复检，但不把 UI 打回 checking。
    if (!shouldPreserveUpdateOffer()) setPhase('checking')
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      treatCheckFailureAsUpToDate(err)
    }
  })()

  try {
    await checkPromise
  } finally {
    checkPromise = null
  }
}

function wireUpdater(): void {
  autoUpdater.autoDownload = false
  // 退出安装由清理完成后的 installDownloadedUpdate 显式触发（与退出确认 / 清理编排配合）。
  autoUpdater.autoInstallOnAppQuit = false
  // mac 的 quitAndInstall 忽略 isForceRunAfter，只看此开关；Win/Linux 非静默安装也走它。
  autoUpdater.autoRunAppAfterInstall = true
  autoUpdater.allowPrerelease = edition().channel === 'beta'
  // 官方：未包装测更新 UI 需 forceDevUpdateConfig + 根目录 dev-app-update.yml。
  if (packaging === 'dev') {
    autoUpdater.forceDevUpdateConfig = true
  }

  autoUpdater.on('checking-for-update', () => {
    lastError = null
    if (!shouldPreserveUpdateOffer()) setPhase('checking')
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
    if (shouldPreserveUpdateOffer()) return
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
    // 下载失败仍标 error（关于页可提示）；检查失败静默当无更新。
    if (phase === 'downloading') {
      lastError = err instanceof Error ? err.message : String(err)
      setPhase('error')
      return
    }
    if (phase === 'ready') {
      emit()
      return
    }
    treatCheckFailureAsUpToDate(err)
  })
}

/**
 * 应用就绪后启动。
 * 未包装开发：官方 forceDevUpdateConfig，策略同便携（只检查 / 开 Release）。
 * Linux 等仍解析为 `dev` 但已包装：本轮不启用检查。
 */
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

  // 包装后的 `dev`（如 Linux）本轮不更新；未包装开发与便携/可自动更新形态启用检查。
  if (packaging === 'dev' && app.isPackaged) {
    checksEnabled = false
    phase = 'upToDate'
    emit()
    return
  }

  checksEnabled = true
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

/**
 * 供关于页调用。
 * - 默认受 5 分钟冷却（进入关于自动查）。
 * - `force: true` 绕过冷却（手动点「检查更新」）。
 * - 已有进行中的检查则等待汇合。
 */
export async function checkAppUpdates(opts?: { force?: boolean }): Promise<AppUpdateState> {
  if (!checksEnabled) return buildState()
  if (checkPromise) {
    await checkPromise
    return buildState()
  }
  const force = opts?.force === true
  if (
    !force &&
    lastCheckStartedAt > 0 &&
    Date.now() - lastCheckStartedAt < CHECK_COOLDOWN_MS
  ) {
    return buildState()
  }
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
  clearRetryTimer()
  startupTimer = null
  intervalTimer = null
}
