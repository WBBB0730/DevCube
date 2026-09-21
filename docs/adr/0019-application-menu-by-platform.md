# 应用菜单按平台与开发态分流，且自列中文文案

未自定义时 Electron 会装默认菜单（含 Reload / Toggle Developer Tools）。我们在 `app.ready` 之前安装菜单：生产环境 Win/Linux 用 `Menu.setApplicationMenu(null)` 去掉窗口菜单栏；macOS 保留应用 / 编辑 / 窗口三块（系统栏与复制粘贴 / 退出等），开发环境额外加视图。避免生产露出开发项，同时适配双平台对原生菜单的不同预期。

菜单**不用 `appMenu` / `editMenu` / `windowMenu` / `viewMenu` 这些整块 role**，而是逐项自列并写死中文 label：整块 role 的文案跟随系统语言，与本应用一律中文的界面对不上。role 本身逐项保留，行为、快捷键与平台差异（macOS 多「粘贴并匹配样式」「语音」「前置全部窗口」，Win/Linux 用「关闭」）都照 Electron 原块摆，只覆盖显示文字。

视图块另有一处刻意偏离：不放 `resetZoom` / `zoomIn` / `zoomOut`。那三项占住 CmdOrCtrl+0 与 +/-，而这几个键在 Files 预览里另有用处（回适应窗口 / 放大 / 缩小），菜单加速键优先级更高，留着就压住预览；整页缩放对本应用本身也没意义——它不是网页浏览器。

同一件事还有第二道闸：`@electron-toolkit/utils` 的 `optimizer.watchWindowShortcuts` 默认（`zoom: false`）在 `before-input-event` 里把 CmdOrCtrl+- 与 CmdOrCtrl+Shift+= 直接 `preventDefault`，意图同样是关掉网页缩放，结果是这两个键连页面的 keydown 都收不到（CmdOrCtrl+= 不带 Shift 反而放过，症状就是"能放大不能缩小"）。菜单里既然已无缩放角色，这道闸只剩副作用，故传 `{ zoom: true }` 放行；它对 Cmd+R / 开发者工具的生产态拦截照旧。

代价：菜单文案不再随系统语言切换（英文系统下也是中文），且 Electron 未来给这些块加项时我们不会自动跟进。单测锁住了各块的 role 顺序与中文文案。
