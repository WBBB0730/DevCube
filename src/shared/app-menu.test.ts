import { describe, expect, it } from 'vitest'
import { resolveAppMenuTemplate, type AppMenuItem } from './app-menu'

const mac = (isDev: boolean): AppMenuItem[] | null =>
  resolveAppMenuTemplate({ isDev, platform: 'darwin', appName: 'DevCube' })
const win = (isDev: boolean): AppMenuItem[] | null =>
  resolveAppMenuTemplate({ isDev, platform: 'win32', appName: 'DevCube' })

const titles = (items: AppMenuItem[] | null): string[] =>
  (items ?? []).map((i) => ('label' in i ? i.label : ''))

/** 摊平某个顶层菜单（含子菜单）里的所有 role。 */
function rolesOf(items: AppMenuItem[] | null, title: string): string[] {
  const top = (items ?? []).find((i) => 'submenu' in i && i.label === title)
  const walk = (list: AppMenuItem[]): string[] =>
    list.flatMap((i) => ('submenu' in i ? walk(i.submenu) : 'role' in i ? [i.role] : []))
  return top && 'submenu' in top ? walk(top.submenu) : []
}

describe('resolveAppMenuTemplate', () => {
  it('Win/Linux 生产 → null（suppress 默认菜单）', () => {
    expect(resolveAppMenuTemplate({ isDev: false, platform: 'win32', appName: 'X' })).toBeNull()
    expect(resolveAppMenuTemplate({ isDev: false, platform: 'linux', appName: 'X' })).toBeNull()
  })

  it('macOS 生产 → 应用 / 编辑 / 窗口，无视图', () => {
    expect(titles(mac(false))).toEqual(['DevCube', '编辑', '窗口'])
  })

  it('macOS 开发 → 多一个视图', () => {
    expect(titles(mac(true))).toEqual(['DevCube', '编辑', '视图', '窗口'])
  })

  it('Win/Linux 开发 → 编辑 / 视图 / 窗口（无应用菜单）', () => {
    expect(titles(win(true))).toEqual(['编辑', '视图', '窗口'])
  })

  it('顶层与项全是中文文案，不跟随系统语言', () => {
    const items = mac(true)
    const editLabels = (() => {
      const edit = (items ?? []).find((i) => 'submenu' in i && i.label === '编辑')
      return edit && 'submenu' in edit
        ? edit.submenu.flatMap((i) => ('label' in i ? [i.label] : []))
        : []
    })()
    expect(editLabels).toContain('撤销')
    expect(editLabels).toContain('粘贴并匹配样式')
    expect(editLabels).toContain('语音')
  })

  it('应用名拼进关于 / 隐藏 / 退出', () => {
    const appTop = (mac(false) ?? [])[0]
    const labels = appTop && 'submenu' in appTop ? titles(appTop.submenu) : []
    expect(labels).toContain('关于 DevCube')
    expect(labels).toContain('隐藏 DevCube')
    expect(labels).toContain('退出 DevCube')
  })

  it('各 role 照 Electron 原块保留，行为与快捷键不变', () => {
    expect(rolesOf(mac(false), '编辑')).toEqual([
      'undo',
      'redo',
      'cut',
      'copy',
      'paste',
      'pasteAndMatchStyle',
      'delete',
      'selectAll',
      'startSpeaking',
      'stopSpeaking'
    ])
    expect(rolesOf(win(true), '编辑')).toEqual([
      'undo',
      'redo',
      'cut',
      'copy',
      'paste',
      'delete',
      'selectAll'
    ])
    expect(rolesOf(mac(false), '窗口')).toEqual(['minimize', 'zoom', 'front'])
    expect(rolesOf(win(true), '窗口')).toEqual(['minimize', 'zoom', 'close'])
  })

  it('编辑菜单不含「替换」：编辑器与终端里不生效，开关的勾也不显示', () => {
    const roles = rolesOf(mac(false), '编辑')
    expect(roles).not.toContain('showSubstitutions')
    expect(roles).not.toContain('toggleSmartQuotes')
    expect(roles).not.toContain('toggleSmartDashes')
    expect(roles).not.toContain('toggleTextReplacement')
  })

  it('窗口块本身带 window role：macOS 据此认作 Window 菜单，系统才往里加项', () => {
    const windowTop = (mac(false) ?? []).find((i) => 'submenu' in i && i.label === '窗口')
    expect(windowTop).toMatchObject({ role: 'window' })
  })

  it('视图菜单不含整页缩放项：那三个键留给 Files 预览', () => {
    const roles = rolesOf(mac(true), '视图')
    expect(roles).toEqual(['reload', 'forceReload', 'toggleDevTools', 'togglefullscreen'])
    expect(roles).not.toContain('resetZoom')
    expect(roles).not.toContain('zoomIn')
    expect(roles).not.toContain('zoomOut')
  })
})
