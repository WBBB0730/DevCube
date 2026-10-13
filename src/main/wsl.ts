// WSL 项目（docs/prd/wsl-project.md、ADR-0055）的对外入口：每个发行版一条连接（wsl-connection），
// 「在用」来源与闲置断开（wsl-idle），以及当前条目带来的在用。其余模块经这里在发行版里执行命令。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, posix } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import type { WslConnectionState } from '../shared/wsl'
import { wslDistroOf } from '../shared/wsl-path'
import { getAppPrefs, getProjects } from './store'
import {
  WslConnections,
  type WslExecOptions,
  type WslExecResult,
  type WslHelperInfo,
  type WslHelperProcess,
  type WslWatchListener
} from './wsl-connection'
import { WslIdleTracker } from './wsl-idle'
import { isStoreWsl, readWslDistros, wslPreflightReason } from './wsl-preflight'

const HELPER_NAME = 'devcube-wsl'
/** 含 WSL 冷启动（社区实测可到 8–10 秒）与取登录环境（小助手里最多等 10 秒） */
const CONNECT_TIMEOUT_MS = 60_000
/** 当前条目带来的在用来源 */
const CURRENT_HOLDER = 'current'

export function wslExePath(): string {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wsl.exe')
}

/** 小助手所在目录（scripts/build-wsl-helper.ts 产物）：打包在 resources/wsl 下，Dev 在仓库 build/wsl/out 下 */
function helperDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'wsl')
    : join(app.getAppPath(), 'build', 'wsl', 'out')
}

async function preflight(distro: string): Promise<string | null> {
  const [storeWsl, distros] = await Promise.all([isStoreWsl(wslExePath()), readWslDistros()])
  return wslPreflightReason(distro, {
    storeWsl,
    distros,
    helperPresent: existsSync(join(helperDir(), HELPER_NAME))
  })
}

/**
 * `wsl.exe -d <发行版> --cd <小助手目录> --exec ./devcube-wsl`：由 WSL 把 Windows 目录换成发行版里的挂载路径
 * （自定义了挂载根也对）。WSL_UTF8 让 wsl.exe 自己的报错用 UTF-8（默认 UTF-16），连不上时原因才读得出来。
 */
function spawnHelper(distro: string): WslHelperProcess {
  const child = spawn(
    wslExePath(),
    ['-d', distro, '--cd', helperDir(), '--exec', `./${HELPER_NAME}`],
    {
      windowsHide: true,
      env: { ...process.env, WSL_UTF8: '1' }
    }
  )
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    // 先关小助手的输入：它读到输入结束才收尾退出并结束它起的进程。只结束 wsl.exe，发行版里的小助手收不到（Windows 实测）
    kill: () => {
      child.stdin.end()
      child.kill()
    },
    exited: new Promise((resolve) => {
      child.once('exit', () => resolve(null))
      child.once('error', (e) => resolve(e.message))
    })
  }
}

const connections = new WslConnections({ preflight, spawnHelper, timeoutMs: CONNECT_TIMEOUT_MS })

const idle = new WslIdleTracker({
  idleMs: () => {
    const minutes = getAppPrefs().wslIdleMinutes
    return minutes === null ? null : minutes * 60_000
  },
  onIdle: (distro) => connections.disconnect(distro),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>)
})

let closing = false

connections.onState((distro, state) => {
  // 不经「在用」就连上的（后台的 git 等）也要闲置断开
  if (state.status === 'connected') idle.connected(distro)
  // 意外断开（wsl --shutdown、小助手退出）后仍在用：立即重连（连上不久就断的已标为失败，不在此列）
  if (state.status === 'disconnected' && !closing && idle.isInUse(distro)) {
    void connections.connect(distro).catch(() => undefined)
  }
})

/** 某个来源开始用这个发行版：取消闲置计时，没连上就连（「点开即连」）。 */
export function holdWsl(distro: string, holder: string): void {
  idle.hold(distro, holder)
  void connections.connect(distro).catch(() => undefined)
}

/** 某个来源放下这个发行版：最后一个放下时开始闲置计时；发行版已没有 WSL 项目则立即断开。 */
export function releaseWsl(distro: string, holder: string): void {
  idle.release(distro, holder)
  disconnectWslWithoutProject(distro)
}

/**
 * 发行版的 WSL 项目已全部移除且没有来源在用：立即断开，不等闲置。移除项目时调用；项目下的终端、运行会话
 * 要等进程退出才放下，届时经 releaseWsl 再判断一次。
 */
export function disconnectWslWithoutProject(distro: string): void {
  if (idle.isInUse(distro)) return
  if (getProjects().some((p) => wslDistroOf(p.path)?.toLowerCase() === distro.toLowerCase())) return
  connections.disconnect(distro)
}

/** 在发行版里执行一条命令（不经 shell），必要时先连上；结果与本机 git 子进程同形，永不 throw。 */
export function wslExec(
  distro: string,
  file: string,
  args: readonly string[],
  options: WslExecOptions
): Promise<WslExecResult> {
  return connections.exec(distro, file, args, options)
}

/** 连上并取小助手信息（已连上则直接返回）。 */
export function connectWsl(distro: string): Promise<WslHelperInfo> {
  return connections.connect(distro)
}

/** 递归监听发行版里的目录（需已连上，见 WslConnections.watch）。 */
export function wslWatch(
  distro: string,
  root: string,
  listener: WslWatchListener
): Promise<() => Promise<void>> {
  return connections.watch(distro, root, listener)
}

/** 列出发行版里的目录（需已连上）。 */
export function wslReadDir(
  distro: string,
  path: string
): Promise<{ names: string[]; notFound: boolean }> {
  return connections.readDir(distro, path)
}

/** 读发行版里的小文件（需已连上）；不存在为 null。 */
export function wslReadFile(distro: string, path: string): Promise<Buffer | null> {
  return connections.readFile(distro, path)
}

/** 发行版里的 Linux 版 rg：随安装包带、与小助手同目录（scripts/build-wsl-helper.ts）。连不上时 throw。 */
export async function wslRgPath(distro: string): Promise<string> {
  const info = await connections.connect(distro)
  return posix.join(posix.dirname(info.executable), 'rg')
}

/** 给运行会话的整个进程组发信号；没连上或会话还没登记时返回 false。 */
export function wslKillRun(distro: string, id: string, signal: NodeJS.Signals): Promise<boolean> {
  return connections.killRun(distro, id, signal)
}

/** 运行会话结束：删掉它的进程组登记。 */
export function wslForgetRun(distro: string, id: string): void {
  connections.forgetRun(distro, id)
}

/** 「重新连接」：清掉失败状态后重连。 */
export function reconnectWsl(distro: string): Promise<WslHelperInfo> {
  return connections.reconnect(distro)
}

export function getWslState(distro: string): WslConnectionState {
  return connections.state(distro)
}

export function onWslState(
  listener: (distro: string, state: WslConnectionState) => void
): () => void {
  return connections.onState(listener)
}

/** 「闲置后断开 WSL」的时长改了：正在计时的按新时长从头计。 */
export function restartWslIdleTimers(): void {
  idle.restartTimers()
}

/** 退出时断开全部（小助手随之结束它起的进程）。 */
export function closeAllWsl(): void {
  closing = true
  connections.disconnectAll()
}

// —— 当前条目：主窗口显示着、且当前条目是 WSL 项目时，它所在的发行版在用（窗口关到托盘不算） ——

let currentEntryKey: string | null = null
let mainWindowVisible = false
let currentDistro: string | null = null

function syncCurrentEntry(): void {
  const distro = mainWindowVisible && currentEntryKey !== null ? wslDistroOf(currentEntryKey) : null
  if (distro?.toLowerCase() === currentDistro?.toLowerCase()) return
  if (currentDistro !== null) releaseWsl(currentDistro, CURRENT_HOLDER)
  currentDistro = distro
  if (distro !== null) holdWsl(distro, CURRENT_HOLDER)
}

/** 工作台的当前条目变了（条目键：项目为项目路径）。 */
export function setWslCurrentEntry(entryKey: string | null): void {
  currentEntryKey = entryKey
  syncCurrentEntry()
}

/** 跟着主窗口的显示 / 隐藏（Windows 关窗即隐藏到托盘）。 */
export function watchWslMainWindow(win: BrowserWindow): void {
  const update = (visible: boolean): void => {
    mainWindowVisible = visible
    syncCurrentEntry()
  }
  update(win.isVisible())
  win.on('show', () => update(true))
  win.on('hide', () => update(false))
  win.on('closed', () => update(false))
}
