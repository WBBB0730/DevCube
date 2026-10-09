# 系统集成入口选型：快速操作而非 FinderSync，协议按 Edition 分线

把「在 DevCube 中打开」铺进系统与外部工具时（`docs/prd/system-integration.md`），入口选型如下，均以「简单、官方路径、可干净移除」优先：

- **deep link scheme 按 Release Edition 分线**（`devcube://` / `devcube-beta://`，Dev 不注册）：协议是系统级注册，不分线则双装互抢，与 ADR-0012 的隔离原则一致；scheme 即 edition `name`，与制品名同源。
- **macOS 右键入口用「快速操作」（`~/Library/Services` 下的 .workflow），不做 FinderSync 扩展**：Apple 明确 FinderSync 是为同步类应用设计的，「不是用来修改 Finder 界面的通用工具」（[DTS，2024-10](https://developer.apple.com/forums/thread/766680)）。它还有绕不过的硬限制：iCloud Drive（含开启同步的「桌面」与「文稿」）里不显示；同一个文件夹只有一个扩展生效，正式版和 Beta 并装时会互抢（ADR-0012）；用户要到系统设置里手动启用；还要引入沙盒 appex、App Group、Xcode 工程与单独的签名处理。快速操作是 Apple 有文档的机制，零原生代码、可整目录增删，多选时一次传入，代价只是入口在「快速操作」子菜单。「macOS 26 上大面积不加载」不作为理由：经 Apple 查明是设备管理配置禁用了扩展，不是系统缺陷（[DTS，2025-11](https://developer.apple.com/forums/thread/806607)）。
- **Codex 桌面端走用户级 `~/.codex/config.toml` 的 `desktop.custom_file_handlers`**（官方扩展点），只按表头增删自己的块、写前解析校验，绝不重写整个文件（保用户注释与格式）。**Claude 桌面端不做**：其 Open in 名单硬编码（VS Code / Cursor / Zed / Windsurf / Xcode），无注册机制，本机 bundle 实证。
- **Windows 右键菜单由应用设置开关经 `reg.exe` 管 HKCU，安装器不写**：单一写入方即同时覆盖 NSIS 与 portable、状态可实时探测；NSIS 仅在真卸载（`${isUpdated}` 为否）时兜底清理。不做 Win11 新版一级菜单：所需的稀疏包要签名，Windows 包签名前不做（见 ADR-0049）。需要多选时一次交付全部路径的入口（压缩）不能用命令动词，见 ADR-0049。
- **CLI 仅 macOS 安装**（脚本 `open -b <bundleId>` + `/usr/local/bin` 软链，必要时 @vscode/sudo-prompt 提权，VS Code 同款）：Windows 程序化改用户 PATH 有截断 / 损坏风险且无成熟库，放弃；Linux deb 由 electron-builder 自带 `/usr/bin` 符号链接。
