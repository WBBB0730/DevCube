import { ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import type { RendererBootstrap } from '../shared/renderer-bootstrap'
import { getAppPrefs, getProjectSortPrefs, getWorkspaceUi } from './store'
import { getSessions, getTerminals } from './runner'
import { listDataSourceNodes } from './data-sources'
import { listServerNodes } from './servers'
import { buildTree } from './tree'
import { getPanelSizes } from './layout-memory'

export function getRendererBootstrap(): RendererBootstrap {
  return {
    tree: buildTree(),
    servers: listServerNodes(),
    dataSources: listDataSourceNodes(),
    sessions: getSessions(),
    terminals: getTerminals(),
    projectSortPrefs: getProjectSortPrefs(),
    workspace: getWorkspaceUi(),
    appPrefs: getAppPrefs(),
    panelSizes: getPanelSizes()
  }
}

/** 必须在 loadURL 之前注册，preload 里 sendSync 才能拿到快照。 */
export function registerBootstrapIpc(): void {
  ipcMain.on(IPC.bootstrapSync, (event) => {
    event.returnValue = getRendererBootstrap()
  })
}
