// 应用菜单与 macOS Dock 菜单：模板按平台与是否开发分流（见 ADR-0019）。
import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { is } from '@electron-toolkit/utils'
import {
  DOCK_MENU_TEMPLATE,
  resolveAppMenuTemplate,
  type AppMenuAction,
  type AppMenuItem
} from '../shared/app-menu'

/** 模板里各自定义动作的点击处理 */
export type AppMenuActions = Record<AppMenuAction, () => void>

function buildMenu(template: AppMenuItem[], actions: AppMenuActions): Menu {
  const toOptions = (items: AppMenuItem[]): MenuItemConstructorOptions[] =>
    items.map((item) => {
      if ('action' in item) return { label: item.label, click: () => actions[item.action]() }
      if ('submenu' in item) return { ...item, submenu: toOptions(item.submenu) }
      return item
    })
  return Menu.buildFromTemplate(toOptions(template))
}

/** 须在 app ready 之前调用，才能阻止 Electron 安装默认菜单。 */
export function installAppMenu(actions: AppMenuActions): void {
  const template = resolveAppMenuTemplate({
    isDev: is.dev,
    platform: process.platform,
    appName: app.getName()
  })
  Menu.setApplicationMenu(template ? buildMenu(template, actions) : null)
}

/** 仅 macOS（其余平台没有 app.dock）；须在 app ready 之后调用（官方文档）。 */
export function installDockMenu(actions: AppMenuActions): void {
  app.dock?.setMenu(buildMenu(DOCK_MENU_TEMPLATE, actions))
}
