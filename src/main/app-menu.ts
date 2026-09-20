// 应用菜单：按平台与是否开发分流（见 ADR-0019）。
// 须在 app ready 之前调用，才能阻止 Electron 安装默认菜单。
import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { is } from '@electron-toolkit/utils'
import { resolveAppMenuTemplate } from '../shared/app-menu'

export function installAppMenu(): void {
  const template = resolveAppMenuTemplate({
    isDev: is.dev,
    platform: process.platform,
    appName: app.getName()
  })
  Menu.setApplicationMenu(
    template ? Menu.buildFromTemplate(template as MenuItemConstructorOptions[]) : null
  )
}
