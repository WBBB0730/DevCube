import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import { addProjectByPath, pickAndAddProject, removeProject } from './projects'
import { buildTree } from './tree'

let mainWindow: BrowserWindow | null = null
let registered = false

/** 主动向渲染端推送最新树（供文件监听 / 自动删除等 main 侧变更使用）。 */
export function emitTree(): void {
  mainWindow?.webContents.send(IPC.treeChanged, buildTree())
}

export function registerIpc(win: BrowserWindow): void {
  mainWindow = win
  if (registered) return
  registered = true

  ipcMain.handle(IPC.treeGet, () => buildTree())

  ipcMain.handle(IPC.projectAdd, async () => {
    await pickAndAddProject()
    return buildTree()
  })

  ipcMain.handle(IPC.projectAddByPath, (_e, path: string) => {
    addProjectByPath(path)
    return buildTree()
  })

  ipcMain.handle(IPC.projectRemove, (_e, path: string) => {
    removeProject(path)
    return buildTree()
  })
}
