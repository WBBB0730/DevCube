import { BrowserWindow, dialog } from 'electron'
import { quitConfirmation } from '../shared/quit-guard'
import { getQuitGuardSessions } from './runner'
import { activeServerTransferCount, unsavedServerFileCount } from './server-files'

/** 若有运行中的 Run Session、未完成的文件传输或服务器上未保存的文件，弹出确认；无则直接放行。返回是否允许退出。 */
export async function confirmQuitIfNeeded(parent?: BrowserWindow | null): Promise<boolean> {
  const confirmation = quitConfirmation(
    getQuitGuardSessions(),
    activeServerTransferCount(),
    unsavedServerFileCount()
  )
  if (confirmation === null) return true

  const options = {
    type: 'warning' as const,
    buttons: ['退出', '取消'],
    defaultId: 1,
    cancelId: 1,
    title: '确认退出',
    message: confirmation.message,
    detail: confirmation.detail
  }

  const { response } =
    parent && !parent.isDestroyed()
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options)

  return response === 0
}

/**
 * 关主窗口（不退出应用，如 macOS 点红灯）前：服务器上的文件手动保存，窗口一关编辑就没了，
 * 有未保存的先确认。返回是否允许关窗。
 */
export async function confirmCloseIfUnsaved(win: BrowserWindow): Promise<boolean> {
  const count = unsavedServerFileCount()
  if (count === 0) return true
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['关闭窗口', '取消'],
    defaultId: 1,
    cancelId: 1,
    title: '确认关闭',
    message: `还有 ${count} 个服务器上的文件未保存`,
    detail: '关闭窗口将丢失未保存的修改。确定关闭？'
  })
  return response === 0
}
