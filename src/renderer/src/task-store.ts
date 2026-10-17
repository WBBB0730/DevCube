// 渲染端的 Task 快照（docs/prd/task-progress.md）：主进程任务登记处推来的全量列表，主窗口挂载时接上。
// 「找回」也在这里：Git 动作的切到所属项目的 Git Tab，克隆的打开克隆对话框——进度弹窗与失败界面随之出现。
import { create } from 'zustand'
import { gitTabKey } from '@shared/runnable'
import type { TaskInfo } from '@shared/task'
import { useApp } from '@renderer/store'

export type GitTask = Extract<TaskInfo, { kind: 'git' }>
export type CloneTask = Extract<TaskInfo, { kind: 'clone' }>

export const useTasks = create<{ tasks: TaskInfo[] }>(() => ({ tasks: [] }))

/** 接上任务登记处：订阅推送，再取一次快照（渲染端重载后接上已有的）；返回退订。 */
export function connectTasks(): () => void {
  let pushed = false
  const off = window.api.onTasksChanged((tasks) => {
    pushed = true
    useTasks.setState({ tasks })
  })
  void window.api.getTasks().then((tasks) => {
    if (!pushed) useTasks.setState({ tasks })
  })
  return off
}

/** 被隐藏的 Task（顶栏任务清单里列的就是它们）。 */
export function useHiddenTasks(): TaskInfo[] {
  const tasks = useTasks((s) => s.tasks)
  return tasks.filter((t) => t.hidden)
}

/** 克隆的 Task（同一时刻至多一个）。 */
export function cloneTaskOf(tasks: TaskInfo[]): CloneTask | undefined {
  return tasks.find((t): t is CloneTask => t.kind === 'clone')
}

/** 某项目在前台的 Git Task：没被隐藏的按发起先后一次显示一个。 */
export function foregroundGitTaskOf(tasks: TaskInfo[], projectPath: string): GitTask | undefined {
  return tasks.find(
    (t): t is GitTask => t.kind === 'git' && t.projectPath === projectPath && !t.hidden
  )
}

/** 打开克隆对话框：有被隐藏的克隆就找回它（对话框显示它的进度或失败界面）。 */
export function openCloneDialog(): void {
  const clone = cloneTaskOf(useTasks.getState().tasks)
  if (clone?.hidden === true) void window.api.revealTask(clone.id)
  useApp.getState().setCloneDialogOpen(true)
}

/** 找回一个被隐藏的 Task：放回眼前，和没隐藏过一样。 */
export function revealTask(task: TaskInfo): void {
  if (task.kind === 'clone') {
    openCloneDialog()
    return
  }
  void window.api.revealTask(task.id)
  useApp.getState().activateTab(task.projectPath, gitTabKey(task.projectPath))
}
