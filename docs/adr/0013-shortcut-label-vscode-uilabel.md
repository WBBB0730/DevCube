# 快捷键 UI 文案对齐 VS Code UILabel；应用快捷键走主进程 before-input-event

需要在 title / 菜单里按平台展示快捷键，且修饰键顺序与符号不能各写各的。采用 VS Code `UILabelProvider` 规则：修饰键固定 Ctrl → Shift → Alt → Meta；macOS 用 ⌃⇧⌥⌘ 符号（不用 `+`），符号与主键之间加空格以便扫读；Windows / Linux 用 `Ctrl + Alt + …`（加号两侧空格；Linux 的 Meta 为 Super）。实现为共享纯函数 `formatShortcutLabel`，平台读 `process.platform`，避免在组件里硬编码 `⌘…`。

应用内导航类快捷键（切项目 / Tab / 筛选聚焦等）在主进程用 `webContents.before-input-event` 匹配并 `preventDefault`，再 IPC 到渲染端执行：这是 Electron 文档推荐的窗口内拦截方式，优先于页面 `keydown` / xterm / Chromium 默认（如 ⌥⌘← 前进后退）。明确不做 `globalShortcut`（后台抢键、易与其它 App 冲突）；系统级快捷键（如 Mission Control 的 ⌃←/→）仍无法从应用内抬优先级。

主修饰键按平台严格匹配：CmdOrCtrl 在 macOS 只认 ⌘、Windows / Linux 只认 Ctrl，另一个不得混入，由共享纯函数 `isPrimaryModifier` 判定；主进程匹配与渲染层自持的键盘处理（终端 / Git / 看图 / PDF / PPT 的查找、刷新、缩放）同用这一个判定。否则 macOS 的 ⌃T / ⌃W / ⌃F 这类 shell 与编辑器的 Emacs 式编辑键会被当成 ⌘ 抢走，Win / Super 键组合也会误触发。鼠标与触控板不在此列：⌘ 点选多选、Ctrl+滚轮缩放（触控板捏合本身就以带 ctrlKey 的滚轮派发）保持原样。

终端焦点让位：主进程拦截时不知道焦点在哪，由渲染端在焦点进出任一 xterm（Terminal 与运行会话）时经 IPC 上报，主进程按窗口记录、匹配时参考；聚焦元素被隐藏时 Chromium 同样派发 focusout，状态不会滞留。Windows / Linux 上焦点在终端时，只有 Ctrl+E（最近打开文件；shell 的行尾）让给 shell，Ctrl+W 仍关闭 Tab、Ctrl+T 仍新建终端——与 VS Code 默认不同（它把 Ctrl+W 交给 shell、把 Ctrl+E 留给 Quick Open），按本项目的使用习惯取舍。macOS 用 ⌘ 与 shell 无冲突，无需让位。让位判断仍在主进程一处完成，没有把这类键挪到渲染层按焦点处理：那样应用快捷键会分裂成两套注册路径。
