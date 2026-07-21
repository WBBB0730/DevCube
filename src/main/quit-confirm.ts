import { BrowserWindow, dialog } from 'electron'
import { countRunningRunSessions, needsQuitConfirmation } from '../shared/quit-guard'
import { getQuitGuardSessions } from './runner'

/** 若有运行中的 Run Session，弹出确认；无则直接放行。返回是否允许退出。 */
export async function confirmQuitIfNeeded(parent?: BrowserWindow | null): Promise<boolean> {
  const sessions = getQuitGuardSessions()
  if (!needsQuitConfirmation(sessions)) return true

  const n = countRunningRunSessions(sessions)
  const options = {
    type: 'warning' as const,
    buttons: ['退出', '取消'],
    defaultId: 1,
    cancelId: 1,
    title: '确认退出',
    message: `还有 ${n} 个运行会话在运行`,
    detail: '退出应用将结束这些会话。确定退出？'
  }

  const { response } =
    parent && !parent.isDestroyed()
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options)

  return response === 0
}
