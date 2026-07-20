# 快捷键 UI 文案对齐 VS Code UILabel；应用快捷键走主进程 before-input-event

需要在 title / 菜单里按平台展示快捷键，且修饰键顺序与符号不能各写各的。采用 VS Code `UILabelProvider` 规则：修饰键固定 Ctrl → Shift → Alt → Meta；macOS 用 ⌃⇧⌥⌘ 且无分隔符；Windows / Linux 用 `Ctrl+Alt+…`（Linux 的 Meta 为 Super）。实现为共享纯函数 `formatShortcutLabel`，平台读 `process.platform`，避免在组件里硬编码 `⌘…`。

应用内导航类快捷键（切项目 / Tab / 筛选聚焦等）在主进程用 `webContents.before-input-event` 匹配并 `preventDefault`，再 IPC 到渲染端执行：这是 Electron 文档推荐的窗口内拦截方式，优先于页面 `keydown` / xterm / Chromium 默认（如 ⌥⌘← 前进后退）。明确不做 `globalShortcut`（后台抢键、易与其它 App 冲突）；系统级快捷键（如 Mission Control 的 ⌃←/→）仍无法从应用内抬优先级。
