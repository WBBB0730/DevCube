/** 应用菜单模板决议（平台 × 开发态）；安装见 main `installAppMenu` / ADR-0019。 */

/** 用到的 Electron role 子集：行为、快捷键、平台适配都由 role 给，我们只覆盖 label。 */
export type AppMenuRole =
  | 'about'
  | 'services'
  | 'hide'
  | 'hideOthers'
  | 'unhide'
  | 'quit'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'pasteAndMatchStyle'
  | 'delete'
  | 'selectAll'
  | 'startSpeaking'
  | 'stopSpeaking'
  | 'reload'
  | 'forceReload'
  | 'toggleDevTools'
  | 'togglefullscreen'
  | 'minimize'
  | 'zoom'
  | 'front'
  | 'close'

export type AppMenuItem =
  | { role: AppMenuRole; label: string }
  | { type: 'separator' }
  /** 子菜单本身的 role 只用 `window`：macOS 据此把它登记为 Window 菜单，系统才往里加移到显示器、平铺与窗口列表。 */
  | { role?: 'window'; label: string; submenu: AppMenuItem[] }

export type AppMenuInstallInput = {
  isDev: boolean
  platform: NodeJS.Platform
  /** 拼进「关于 X」/「隐藏 X」/「退出 X」；main 传 `app.getName()`。 */
  appName: string
}

const SEP = { type: 'separator' } as const

/**
 * macOS 应用菜单。顶层标题由系统强制显示为应用名，这里的 label 只是占位。
 */
function appMenu(appName: string): AppMenuItem {
  return {
    label: appName,
    submenu: [
      { role: 'about', label: `关于 ${appName}` },
      SEP,
      { role: 'services', label: '服务' },
      SEP,
      { role: 'hide', label: `隐藏 ${appName}` },
      { role: 'hideOthers', label: '隐藏其他' },
      { role: 'unhide', label: '全部显示' },
      SEP,
      { role: 'quit', label: `退出 ${appName}` }
    ]
  }
}

/**
 * 编辑菜单。macOS 比 Win/Linux 多「粘贴并匹配样式」与「语音」，顺序也不同（对齐 Electron 的 editMenu）。
 * 刻意不放 Electron editMenu 里的「替换」（智能引号 / 智能破折号 / 文本替换）：编辑器与终端的输入区
 * 自带 autocorrect="off"、spellcheck="false"，开关在那里不生效；能生效的只剩提交说明、文件名这类输入，
 * 改成弯引号反而添乱；而 Electron 自管菜单状态（autoenablesItems = NO），开关的勾永远不显示。
 */
function editMenu(isMac: boolean): AppMenuItem {
  return {
    label: '编辑',
    submenu: [
      { role: 'undo', label: '撤销' },
      { role: 'redo', label: '重做' },
      SEP,
      { role: 'cut', label: '剪切' },
      { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' },
      ...(isMac
        ? ([
            { role: 'pasteAndMatchStyle', label: '粘贴并匹配样式' },
            { role: 'delete', label: '删除' },
            { role: 'selectAll', label: '全选' },
            SEP,
            {
              label: '语音',
              submenu: [
                { role: 'startSpeaking', label: '开始朗读' },
                { role: 'stopSpeaking', label: '停止朗读' }
              ]
            }
          ] satisfies AppMenuItem[])
        : ([
            { role: 'delete', label: '删除' },
            SEP,
            { role: 'selectAll', label: '全选' }
          ] satisfies AppMenuItem[]))
    ]
  }
}

/**
 * 开发态的视图菜单：刻意不照搬 Electron 的 `viewMenu`。
 * 那一块自带 resetZoom / zoomIn / zoomOut，会把 CmdOrCtrl+0 与 +/- 抢走，而这三个键在
 * Files 预览里另有用处（回适应窗口 / 放大 / 缩小），菜单加速键优先级更高，留着就压住预览。
 * 整页缩放对本应用本身也没意义——它不是网页浏览器。
 */
const VIEW_MENU: AppMenuItem = {
  label: '视图',
  submenu: [
    { role: 'reload', label: '重新加载' },
    { role: 'forceReload', label: '强制重新加载' },
    { role: 'toggleDevTools', label: '开发者工具' },
    SEP,
    { role: 'togglefullscreen', label: '切换全屏' }
  ]
}

/**
 * 窗口菜单。macOS 用「前置全部窗口」，Win/Linux 用「关闭」（对齐 Electron 的 windowMenu）。
 * 整块 `windowMenu` 自带 `window` role，拆开自列时须在这一层补上，否则系统加的项全丢。
 */
function windowMenu(isMac: boolean): AppMenuItem {
  return {
    role: 'window',
    label: '窗口',
    submenu: [
      { role: 'minimize', label: '最小化' },
      { role: 'zoom', label: '缩放' },
      ...(isMac
        ? ([SEP, { role: 'front', label: '前置全部窗口' }] satisfies AppMenuItem[])
        : ([{ role: 'close', label: '关闭' }] satisfies AppMenuItem[]))
    ]
  }
}

/**
 * 返回顶层菜单模板；`null` 表示 suppress 默认菜单（无应用菜单）。
 * 生产 Win/Linux → null；macOS 生产 → 应用 / 编辑 / 窗口；开发额外加视图。
 * 全部自列而不用 Electron 的 `appMenu` / `editMenu` / `windowMenu` 整块：那些块的文案跟随
 * 系统语言，与本应用一律中文的界面对不上；role 仍逐项保留，行为与快捷键不受影响。
 */
export function resolveAppMenuTemplate(input: AppMenuInstallInput): AppMenuItem[] | null {
  if (!input.isDev && input.platform !== 'darwin') return null

  const isMac = input.platform === 'darwin'
  const items: AppMenuItem[] = []
  if (isMac) items.push(appMenu(input.appName))
  items.push(editMenu(isMac))
  if (input.isDev) items.push(VIEW_MENU)
  items.push(windowMenu(isMac))
  return items
}
