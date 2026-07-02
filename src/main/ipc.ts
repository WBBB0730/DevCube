import { ipcMain, BrowserWindow, shell } from 'electron'
import { IPC } from '../shared/ipc'
import { configKey } from '../shared/runnable'
import type { CommandRunConfig, RunTarget } from '../shared/types'
import {
  createCommandConfig,
  deleteConfig,
  promoteScript,
  reconcileConfigs,
  reorderConfigs,
  updateCommandConfig
} from './configs'
import { addProjectByPath, pickAndAddProject, removeProject } from './projects'
import {
  closeSession,
  disposeSession,
  disposeTerminalsForProject,
  getSessionBuffer,
  getSessions,
  getTerminals,
  openTerminal,
  resize,
  run,
  setRunnerWindow,
  stop,
  writeStdin
} from './runner'
import { getConfigs, getProjects } from './store'
import { buildTree } from './tree'
import { syncWatchers } from './watcher'

let mainWindow: BrowserWindow | null = null
let registered = false

/** 主动向渲染端推送最新树（供文件监听 / 自动删除等 main 侧变更使用）。 */
export function emitTree(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.treeChanged, buildTree())
  }
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(fn, ms)
  }
}

// 文件事件可能连发，防抖后先对账（删除引用悬空的配置、销毁其会话）再重建树推送。
const onWatchEvent = debounce(() => {
  for (const removed of reconcileConfigs()) disposeSession(configKey(removed))
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
    // 先销毁该项目名下所有会话（杀进程树 + 清状态），再移除项目。
    for (const config of getConfigs().filter((c) => c.projectPath === path)) {
      disposeSession(configKey(config))
    }
    disposeTerminalsForProject(path) // 一并杀掉并清除它名下的全部 Terminal
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

  // —— 终端（Terminal，自由 shell）与 Tab 关闭 ——
  ipcMain.handle(IPC.terminalOpen, (_e, projectPath: string) => openTerminal(projectPath))
  // 用户关闭 Tab（Run Session / Terminal 通用）：温和停止 + 弃会话 + 通知渲染端移除 Tab。
  ipcMain.handle(IPC.sessionClose, (_e, key: string) => closeSession(key))
  ipcMain.handle(IPC.terminals, () => getTerminals())

  // 选中探测脚本即晋升为引用型配置（不必等运行；运行路径的晋升见 IPC.run）。
  ipcMain.handle(IPC.scriptPromote, (_e, projectPath: string, scriptName: string) => {
    promoteScript(projectPath, scriptName)
    return buildTree()
  })

  // —— 命令型配置 CRUD ——
  ipcMain.handle(IPC.configCreate, (_e, input: Omit<CommandRunConfig, 'id' | 'kind'>) => {
    createCommandConfig(input)
    return buildTree()
  })

  ipcMain.handle(IPC.configUpdate, (_e, config: CommandRunConfig) => {
    updateCommandConfig(config)
    return buildTree()
  })

  ipcMain.handle(IPC.configDelete, (_e, id: string) => {
    // 删除前销毁其会话（杀进程树 + 清状态）。
    const config = getConfigs().find((c) => c.id === id)
    if (config) disposeSession(configKey(config))
    deleteConfig(id)
    return buildTree()
  })

  ipcMain.handle(IPC.configReorder, (_e, projectPath: string, orderedIds: string[]) => {
    reorderConfigs(projectPath, orderedIds)
    return buildTree()
  })

  // —— 外链 ——
  // 终端里点击链接 → 系统默认浏览器；仅放行 http/https，杜绝 file:// 等其他协议。
  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
  })
}
