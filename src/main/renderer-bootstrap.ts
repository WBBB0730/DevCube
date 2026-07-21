import { ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import type { RendererBootstrap } from '../shared/renderer-bootstrap'
import { getProjectSortPrefs, getWorkspaceUi } from './store'
import { getSessions, getTerminals } from './runner'
import { buildTree } from './tree'

export function getRendererBootstrap(): RendererBootstrap {
  return {
    tree: buildTree(),
    sessions: getSessions(),
    terminals: getTerminals(),
    projectSortPrefs: getProjectSortPrefs(),
    workspace: getWorkspaceUi()
  }
}

/** 必须在 loadURL 之前注册，preload 里 sendSync 才能拿到快照。 */
export function registerBootstrapIpc(): void {
  ipcMain.on(IPC.bootstrapSync, (event) => {
    event.returnValue = getRendererBootstrap()
  })
}
