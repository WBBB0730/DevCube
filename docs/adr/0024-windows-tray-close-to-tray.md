# Windows 托盘驻留，关窗不退出

Windows 上用户习惯关闭窗口后应用仍在托盘；macOS 已有 Dock 关窗不退。决定仅在 `win32` 安装系统托盘：点窗口关闭为 hide（真正退出走托盘「退出」→ `before-quit`），左键/双击与菜单「打开主窗口」恢复窗口；`window-all-closed` 与 mac 一样不 `app.quit`。托盘菜单保持原生 `setContextMenu`（主流做法），靠 `nativeTheme.themeSource = 'dark'` 强制深色以匹配仅深色产品。macOS / Linux 行为不变。
