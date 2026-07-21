/** 退出整个应用前的确认条件（仅运行中的 Run Session；Terminal 不计）。 */

import type { SessionStatus } from './types'

export type QuitGuardSession = {
  kind: 'run' | 'terminal'
  status: SessionStatus
}

/** 是否存在仍在运行的 Run Session（会挡住退出整个应用）。 */
export function needsQuitConfirmation(sessions: ReadonlyArray<QuitGuardSession>): boolean {
  return sessions.some((s) => s.kind === 'run' && s.status === 'running')
}

/** 运行中的 Run Session 数量（确认文案用）。 */
export function countRunningRunSessions(sessions: ReadonlyArray<QuitGuardSession>): number {
  return sessions.filter((s) => s.kind === 'run' && s.status === 'running').length
}
