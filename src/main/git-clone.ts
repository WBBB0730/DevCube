// 「从 Git 仓库克隆」的主进程执行层：克隆是一个 Task（docs/prd/task-progress.md）——启动 → 流式回报进度 →
// 结束收口；目标目录探测与失败 / 取消后的兜底清理也在这里。同一时刻至多一个克隆，由 IPC 层按任务登记处把关。
// 本模块不依赖 electron（项目登记由 IPC 层在成功后走既有的按路径登记流程完成）。

import { promises as fs } from 'fs'
import {
  buildCloneArgs,
  cloneErrorFromStderr,
  resolveClonePath,
  type GitCloneInput,
  type GitCloneTargetState
} from '../shared/git-clone'
import { createGitProgressTracker } from '../shared/git-task'
import { execGitStreaming, gitPathArg } from './git-exec'
import type { TaskHandle } from './tasks'

/** 一次克隆的终局。 */
export type GitCloneOutcome =
  { status: 'ok'; path: string } | { status: 'canceled' } | { status: 'error'; message: string }

/** 探测目标目录：不存在 = free，空目录 = empty；非空目录 / 同名文件 / 读不动 = occupied。 */
export async function checkCloneTarget(path: string): Promise<GitCloneTargetState> {
  try {
    return (await fs.readdir(path)).length === 0 ? 'empty' : 'occupied'
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'free' : 'occupied'
  }
}

/**
 * 执行一次克隆：进度回报给它的 Task，Task 被取消即结束 git 的整棵进程树（含子模块的克隆）。返回终局，永不 throw。
 * 失败 / 取消且目标目录是本次克隆新建的，一并删除，不留半成品
 * （git 自己的信号清理在 Windows 的结束进程下不生效，故需要这层兜底）。
 */
export async function runClone(
  input: GitCloneInput,
  task: Pick<TaskHandle, 'signal' | 'report'>
): Promise<GitCloneOutcome> {
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
  // 渲染端一点「克隆」就进了可取消的界面，而 git 发现 / 登录 shell 环境解析是异步的——这段窗口里的取消也得认
  if (task.signal.aborted) return { status: 'canceled' }

  const tracker = createGitProgressTracker()
  const stream = await execGitStreaming(
    input.parentDir,
    // 存放位置在 WSL 里时 git 在那个发行版里执行，目标目录换成它的 Linux 路径
    buildCloneArgs(input.url, gitPathArg(input.parentDir, target), input.recurseSubmodules),
    (chunk) => {
      const progress = tracker.feed(chunk)
      if (progress !== null) task.report(progress)
    }
  )
  const cancel = (): void => stream.cancel()
  task.signal.addEventListener('abort', cancel)
  if (task.signal.aborted) stream.cancel() // 进程起来之前就点了取消

  const result = await stream.done
  task.signal.removeEventListener('abort', cancel)
  if (result.code === 0) return { status: 'ok', path: target }
  if (before === 'free') await fs.rm(target, { recursive: true, force: true })
  if (task.signal.aborted) return { status: 'canceled' }
  const message = cloneErrorFromStderr(result.stderr) || result.error?.message
  return { status: 'error', message: message || '克隆失败' }
}
