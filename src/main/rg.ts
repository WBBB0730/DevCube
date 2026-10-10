// 在目录下跑 rg（文件名索引与内容搜索共用，ADR-0027）：WSL 项目在它的发行版里跑随包带的 Linux 版 rg
// （ADR-0055，Windows 版 rg 隔着文件共享扫太慢），其余用 @vscode/ripgrep 的本机 rg。两者的输出都是相对路径。
import { spawn } from 'node:child_process'
import { rgPath } from '@vscode/ripgrep'
import { wslToLinuxPath } from '../shared/wsl-path'
import { toSysPath } from './sys-path'
import { wslExec, wslRgPath } from './wsl'

// 打包后 rg 二进制在 asar 外（electron-builder asarUnpack），require.resolve
// 仍给出 asar 内虚拟路径，spawn 需要真实文件路径；开发环境无此段则原样。
export const rgBin = rgPath.replace('app.asar', 'app.asar.unpacked')

export interface RgRun {
  /** 结束 rg（封顶、被新搜索取代） */
  kill(): void
  /** 退出码：0 有结果、1 无结果、2 出错；被结束时为 null。起不来（含连不上发行版）时 error 写明原因 */
  done: Promise<{ code: number | null; error: Error | null }>
}

/** 在 root（规范化逻辑路径）下跑 rg，输出按块回调。 */
export function runRg(
  root: string,
  args: string[],
  onStdout: (chunk: Buffer) => void,
  onStderr: (chunk: Buffer) => void
): RgRun {
  const wsl = wslToLinuxPath(root)
  if (wsl !== null) return runWslRg(wsl.distro, wsl.path, args, onStdout, onStderr)
  const child = spawn(rgBin, args, {
    cwd: toSysPath(root),
    // stdin 必须关死：rg 对非 TTY stdin 有「从 stdin 搜」的语义（参数里已显式给路径，双保险）
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })
  child.stdout.on('data', onStdout)
  child.stderr.on('data', onStderr)
  const done = new Promise<{ code: number | null; error: Error | null }>((resolve) => {
    child.on('error', (error) => resolve({ code: null, error }))
    child.on('close', (code) => resolve({ code, error: null }))
  })
  return { kill: () => child.kill(), done }
}

function runWslRg(
  distro: string,
  cwd: string,
  args: string[],
  onStdout: (chunk: Buffer) => void,
  onStderr: (chunk: Buffer) => void
): RgRun {
  const controller = new AbortController()
  const done = wslRgPath(distro)
    .then((rg) =>
      wslExec(distro, rg, args, {
        cwd,
        signal: controller.signal,
        onData: (fd, chunk) => (fd === 'stdout' ? onStdout(chunk) : onStderr(chunk))
      })
    )
    .then((result) => ({
      // 被信号结束时小助手报 -1（同 Node 的 null）
      code: result.error === null && result.code >= 0 ? result.code : null,
      error: result.error
    }))
    .catch((error: Error) => ({ code: null, error }))
  return { kill: () => controller.abort(), done }
}
