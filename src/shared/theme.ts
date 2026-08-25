/**
 * 应用主题：深色 / 浅色两档，不跟随系统。
 *
 * 主进程按偏好把 `nativeTheme.themeSource` 钉成对应值，渲染层的 CSS 只需响应
 * `prefers-color-scheme`——它跟随的是这个强制值而非系统外观，因此样式表在解析时
 * 就已定音，首帧不会闪；原生菜单 / 托盘 / 系统对话框也一并跟随（见 ADR-0026）。
 */
export type ThemeMode = 'dark' | 'light'

export const THEME_MODES: readonly ThemeMode[] = ['dark', 'light']

/**
 * 主进程绘制的窗口色：BrowserWindow 的 backgroundColor 与 Windows titleBarOverlay。
 *
 * ⚠ 与 main.css 的 `--bg-panel` / `--fg-icon` 同值双写——这两处是建窗选项，吃不了
 * CSS 变量，改动需两处同步。
 */
export const WINDOW_CHROME: Record<ThemeMode, { background: string; symbol: string }> = {
  dark: { background: '#2b2d30', symbol: '#ced0d6' },
  light: { background: '#f7f8fa', symbol: '#6c707e' }
}
