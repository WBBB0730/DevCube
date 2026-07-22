/** 应用菜单模板决议（平台 × 开发态）；安装见 main `installAppMenu` / ADR-0019。 */

export type AppMenuRole = 'appMenu' | 'editMenu' | 'viewMenu' | 'windowMenu'

export type AppMenuInstallInput = {
  isDev: boolean
  platform: NodeJS.Platform
}

/**
 * 返回顶层 role 列表；`null` 表示 suppress 默认菜单（无应用菜单）。
 * 生产 Win/Linux → null；macOS 生产 → app/edit/window；开发额外加 view。
 */
export function resolveAppMenuRoles(input: AppMenuInstallInput): AppMenuRole[] | null {
  if (!input.isDev && input.platform !== 'darwin') return null

  const roles: AppMenuRole[] = []
  if (input.platform === 'darwin') roles.push('appMenu')
  roles.push('editMenu')
  if (input.isDev) roles.push('viewMenu')
  roles.push('windowMenu')
  return roles
}
