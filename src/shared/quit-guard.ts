/**
 * 退出整个应用前的确认条件：运行中的 Run Session、进行中的文件传输、服务器上未保存的文件
 * （Terminal 与 SSH Terminal 不计）。
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
 * 退出确认的文案；没有要挡的为 null。transferCount 为各台服务器上排队或进行中的上传 / 下载总数，
 * unsavedCount 为服务器上有未保存修改的文件数（服务器上的文件手动保存，退出即丢失）。
 */
export function quitConfirmation(
  sessions: ReadonlyArray<QuitGuardSession>,
  transferCount: number,
  unsavedCount: number
): { message: string; detail: string } | null {
  const runCount = countRunningRunSessions(sessions)
  const items = [
    runCount > 0 && { what: `${runCount} 个运行会话在运行`, then: '结束这些会话' },
    transferCount > 0 && { what: `${transferCount} 个文件传输未完成`, then: '中止这些传输' },
    unsavedCount > 0 && { what: `${unsavedCount} 个服务器上的文件未保存`, then: '丢失未保存的修改' }
  ].filter((item) => item !== false)
  if (items.length === 0) return null
  return {
    message: `还有 ${items.map((i) => i.what).join('、')}`,
    detail: `退出应用将${items.map((i) => i.then).join('、')}。确定退出？`
  }
}
