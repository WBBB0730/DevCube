# 应用菜单按平台与开发态分流

未自定义时 Electron 会装默认菜单（含 Reload / Toggle Developer Tools）。我们在 `app.ready` 之前安装菜单：生产环境 Win/Linux 用 `Menu.setApplicationMenu(null)` 去掉窗口菜单栏；macOS 只保留 `appMenu` / `editMenu` / `windowMenu`（系统栏与复制粘贴 / 退出等 role）；开发环境额外加 `viewMenu`。避免生产露出开发项，同时适配双平台对原生菜单的不同预期。
