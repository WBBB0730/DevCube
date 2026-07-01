import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import type { RunTarget } from '../shared/types'
import { promoteScript, reconcileConfigs } from './configs'
import { addProjectByPath, pickAndAddProject, removeProject } from './projects'
import {
  getSessionBuffer,
  getSessions,
  resize,
  run,
  setRunnerWindow,
  stop,
  writeStdin
} from './runner'
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

// 文件事件可能连发，防抖后先对账（删除引用悬空的配置）再重建树推送。
const onWatchEvent = debounce(() => {
  reconcileConfigs()
  emitTree()
}, 120)

function refreshWatchers(): void {
  syncWatchers(
    getProjects().map((p) => p.path),
    onWatchEvent
  )
}

export function registerIpc(win: BrowserWindow): void {
  mainWindow = win
  setRunnerWindow(win)
  if (registered) {
    refreshWatchers()
    return
  }
  registered = true
  reconcileConfigs() // 启动对账：清掉关闭期间 script 已消失的引用型配置
  refreshWatchers()

  // —— 项目 / 树 ——
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

  // —— 运行时 ——
  ipcMain.handle(IPC.run, (_e, target: RunTarget) => {
    // 运行探测脚本即晋升为引用型配置：它随即从候补区移到「我的配置」。
    if (target.type === 'script') {
      promoteScript(target.projectPath, target.name)
      emitTree()
    }
    run(target)
  })
  ipcMain.handle(IPC.stop, (_e, key: string) => stop(key))
  ipcMain.on(IPC.stdin, (_e, key: string, data: string) => writeStdin(key, data))
  ipcMain.on(IPC.resize, (_e, key: string, cols: number, rows: number) => resize(key, cols, rows))
  ipcMain.handle(IPC.sessionBuffer, (_e, key: string) => getSessionBuffer(key))
  ipcMain.handle(IPC.sessions, () => getSessions())
}
