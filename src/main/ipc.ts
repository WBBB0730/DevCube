import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import { addProjectByPath, pickAndAddProject, removeProject } from './projects'
import { getProjects } from './store'
import { buildTree } from './tree'
import { syncWatchers } from './watcher'

let mainWindow: BrowserWindow | null = null
let registered = false

/** 主动向渲染端推送最新树（供文件监听 / 自动删除等 main 侧变更使用）。 */
export function emitTree(): void {
  mainWindow?.webContents.send(IPC.treeChanged, buildTree())
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(fn, ms)
  }
}

// 文件事件可能连发，防抖后再重建树推送。
const onWatchEvent = debounce(emitTree, 120)

function refreshWatchers(): void {
  syncWatchers(
    getProjects().map((p) => p.path),
    onWatchEvent
  )
}

export function registerIpc(win: BrowserWindow): void {
  mainWindow = win
  if (registered) {
    refreshWatchers()
    return
  }
  registered = true
  refreshWatchers()

  ipcMain.handle(IPC.treeGet, () => buildTree())

  ipcMain.handle(IPC.projectAdd, async () => {
    await pickAndAddProject()
    refreshWatchers()
    return buildTree()
  })

  ipcMain.handle(IPC.projectAddByPath, (_e, path: string) => {
    addProjectByPath(path)
    refreshWatchers()
    return buildTree()
  })

  ipcMain.handle(IPC.projectRemove, (_e, path: string) => {
    removeProject(path)
    refreshWatchers()
    return buildTree()
  })
}
