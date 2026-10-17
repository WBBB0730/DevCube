/**
 * 退出整个应用前的确认条件：运行中的 Run Session、进行中的文件传输、服务器上未保存的文件、
 * 未完成的 Task（Terminal 与 SSH Terminal 不计）。
 */

import type { SessionStatus } from './types'

export type QuitGuardSession = {
  kind: 'run' | 'terminal' | 'ssh'
  status: SessionStatus
}

/** 运行中的 Run Session 数量。 */
export function countRunningRunSessions(sessions: ReadonlyArray<QuitGuardSession>): number {
  return sessions.filter((s) => s.kind === 'run' && s.status === 'running').length
}

/**
 * 退出确认的文案；没有要挡的为 null。transfers 为各台服务器上排队或进行中的上传 / 下载总数，
 * unsaved 为服务器上有未保存修改的文件数（服务器上的文件手动保存，退出即丢失），
 * tasks 为排队或进行中的 Task 数（失败的不算）。
 */
export function quitConfirmation(
  sessions: ReadonlyArray<QuitGuardSession>,
  counts: { transfers: number; unsaved: number; tasks: number }
): { message: string; detail: string } | null {
  const runCount = countRunningRunSessions(sessions)
  const items = [
    runCount > 0 && { what: `${runCount} 个运行会话在运行`, then: '结束这些会话' },
    counts.transfers > 0 && { what: `${counts.transfers} 个文件传输未完成`, then: '中止这些传输' },
    counts.unsaved > 0 && {
      what: `${counts.unsaved} 个服务器上的文件未保存`,
      then: '丢失未保存的修改'
    },
    counts.tasks > 0 && { what: `${counts.tasks} 个任务未完成`, then: '中止这些任务' }
  ].filter((item) => item !== false)
  if (items.length === 0) return null
  return {
    message: `还有 ${items.map((i) => i.what).join('、')}`,
    detail: `退出应用将${items.map((i) => i.then).join('、')}。确定退出？`
  }
}
