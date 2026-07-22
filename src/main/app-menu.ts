// 应用菜单：按平台与是否开发分流（见 ADR-0019）。
// 须在 app ready 之前调用，才能阻止 Electron 安装默认菜单。
import { Menu } from 'electron'
import { is } from '@electron-toolkit/utils'
import { resolveAppMenuRoles } from '../shared/app-menu'

export function installAppMenu(): void {
  const roles = resolveAppMenuRoles({
    isDev: is.dev,
    platform: process.platform
  })
  Menu.setApplicationMenu(roles ? Menu.buildFromTemplate(roles.map((role) => ({ role }))) : null)
}
