# 系统集成入口选型：快速操作而非 FinderSync，协议按 Edition 分线

把「在 DevCube 中打开」铺进系统与外部工具时（`docs/prd/system-integration.md`），入口选型如下，均以「简单、官方路径、可干净移除」优先：

- **deep link scheme 按 Release Edition 分线**（`devcube://` / `devcube-beta://`，Dev 不注册）：协议是系统级注册，不分线则双装互抢，与 ADR-0012 的隔离原则一致；scheme 即 edition `name`，与制品名同源。
- **macOS 右键入口用「快速操作」（`~/Library/Services` 下的 .workflow），不做 FinderSync 扩展**：FinderSync 虽能进一级右键菜单，但 Apple 已事实弃置——macOS 26 Tahoe 上 Apple Silicon 大面积不加载（Dropbox 等同受害），且需引入 Xcode 工具链、签名面与只能在打包产物上调试的原生壳。快速操作零原生代码、可整目录增删，代价只是入口在「快速操作」子菜单。
- **Codex 桌面端走用户级 `~/.codex/config.toml` 的 `desktop.custom_file_handlers`**（官方扩展点），只按表头增删自己的块、写前解析校验，绝不重写整个文件（保用户注释与格式）。**Claude 桌面端不做**：其 Open in 名单硬编码（VS Code / Cursor / Zed / Windsurf / Xcode），无注册机制，本机 bundle 实证。
- **Windows 右键菜单由应用设置开关经 `reg.exe` 管 HKCU，安装器不写**：单一写入方即同时覆盖 NSIS 与 portable、状态可实时探测；NSIS 仅在真卸载（`${isUpdated}` 为否）时兜底清理。不做 Win11 新版一级菜单（IExplorerCommand + 稀疏 MSIX，成本不成比例）。
- **CLI 仅 macOS 安装**（脚本 `open -b <bundleId>` + `/usr/local/bin` 软链，必要时 @vscode/sudo-prompt 提权，VS Code 同款）：Windows 程序化改用户 PATH 有截断 / 损坏风险且无成熟库，放弃；Linux deb 由 electron-builder 自带 `/usr/bin` 符号链接。
