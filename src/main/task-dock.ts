// Task 的 Dock / 任务栏进度（docs/prd/task-progress.md）：只在 DevCube 不在前台时显示，
// 取进行中 Task 的平均总百分比（汇总规则见 shared/task 的 dockProgressOf）。macOS 画在 Dock 图标上，
// Windows 画在主窗口的任务栏按钮上。

import { app, BrowserWindow } from 'electron'
import { dockProgressOf } from '../shared/task'
import { tasks } from './tasks'

/** setProgressBar 的取值：小于 0 移除，大于 1 为不确定。 */
const REMOVE = -1
const INDETERMINATE = 2

export function startTaskDockProgress(mainWindow: () => BrowserWindow | null): void {
  let applied: { win: BrowserWindow; value: number } | null = null

  const apply = (): void => {
    const win = mainWindow()
    if (!win) return
    const progress = dockProgressOf(tasks.list(), BrowserWindow.getFocusedWindow() !== null)
    const value =
      progress.kind === 'none'
        ? REMOVE
        : progress.kind === 'indeterminate'
          ? INDETERMINATE
          : progress.value
    if (applied?.win === win && applied.value === value) return
    win.setProgressBar(value)
    applied = { win, value }
  }

  tasks.subscribe(apply)
  app.on('browser-window-focus', apply)
  // 在 DevCube 自己的窗口之间切换时，失焦与得焦之间有一瞬没有焦点窗口：下一轮再看
  app.on('browser-window-blur', () => setTimeout(apply, 0))
}
