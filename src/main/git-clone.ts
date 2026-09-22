// 「从 Git 仓库克隆」的主进程执行层：单例语义——同一时刻至多一个克隆在跑。
// 启动 → 流式回推进度 → 结束收口；目标目录探测与失败 / 取消后的兜底清理也在这里。
// 本模块不依赖 electron（项目登记由 IPC 层在成功后走既有的按路径登记流程完成）。

import { promises as fs } from 'fs'
import {
  buildCloneArgs,
  cloneErrorFromStderr,
  parseCloneProgress,
  resolveClonePath,
  type GitCloneInput,
  type GitCloneProgress,
  type GitCloneTargetState
} from '../shared/git-clone'
import { execGitStreaming } from './git-exec'

/** 一次克隆的终局。 */
export type GitCloneOutcome =
  { status: 'ok'; path: string } | { status: 'canceled' } | { status: 'error'; message: string }

let current: { cancel: () => void; canceled: boolean } | null = null

/** 探测目标目录：不存在 = free，空目录 = empty；非空目录 / 同名文件 / 读不动 = occupied。 */
export async function checkCloneTarget(path: string): Promise<GitCloneTargetState> {
  try {
    return (await fs.readdir(path)).length === 0 ? 'empty' : 'occupied'
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'free' : 'occupied'
  }
}

/** 取消进行中的克隆（无则空操作）；实际终局由 runClone 的返回值给出。 */
export function cancelClone(): void {
  if (!current) return
  current.canceled = true
  current.cancel()
}

/**
 * 执行一次克隆：进度按帧回调，返回终局。永不 throw。
 * 失败 / 取消且目标目录是本次克隆新建的，一并删除，不留半成品
 * （git 自己的信号清理在 Windows 的 TerminateProcess 下不生效，故需要这层兜底）。
 */
export async function runClone(
  input: GitCloneInput,
  onProgress: (progress: GitCloneProgress) => void
): Promise<GitCloneOutcome> {
  if (current) return { status: 'error', message: '已有克隆正在进行' }
  // 先占位再做校验与 spawn：渲染端一点「克隆」就进了可取消的界面，
  // 而 git 发现 / 登录 shell 环境解析是异步的——这段窗口里的取消也得认。
  const mine: { cancel: () => void; canceled: boolean } = { cancel: () => {}, canceled: false }
  current = mine
  try {
    try {
      if (!(await fs.stat(input.parentDir)).isDirectory()) {
        return { status: 'error', message: '存放位置不是文件夹' }
      }
    } catch {
      return { status: 'error', message: '存放位置不存在' }
    }

    const target = resolveClonePath(input.parentDir, input.name)
    // 渲染端已按探测结果禁用确认，这里再验一次防「填好表单期间目录被占」的竞态
    const before = await checkCloneTarget(target)
    if (before === 'occupied') return { status: 'error', message: '目标目录已存在且非空' }
    if (mine.canceled) return { status: 'canceled' }

    const run = await execGitStreaming(
      input.parentDir,
      buildCloneArgs(input.url, target, input.recurseSubmodules),
      (chunk) => {
        const progress = parseCloneProgress(chunk)
        if (progress) onProgress(progress)
      }
    )
    mine.cancel = run.cancel
    if (mine.canceled) run.cancel() // 进程起来之前就点了取消

    const result = await run.done
    if (result.code === 0) return { status: 'ok', path: target }
    if (before === 'free') await fs.rm(target, { recursive: true, force: true })
    if (mine.canceled) return { status: 'canceled' }
    const message = cloneErrorFromStderr(result.stderr) || result.error?.message
    return { status: 'error', message: message || '克隆失败' }
  } finally {
    if (current === mine) current = null
  }
}
