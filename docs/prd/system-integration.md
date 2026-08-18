## Problem Statement

DevCube 目前只能从自己的面板里添加 / 打开 **Project**（选择器、新建、拖拽）。日常工作流是反过来的：我正在 Finder / 资源管理器里看着一个文件夹、正在终端里 cd 在一个仓库里、正在 Codex 桌面端里开着一个会话——想把它丢进 DevCube 时，只能先切到 DevCube 再手动添加。DevCube 自己能「打开于」Claude / Codex / Cursor（ADR-0018），但别人打不开它。

## Solution

让 DevCube 可以被系统与外部工具「带着一个目录路径唤起」（**External Open（外部唤起）**），并把入口铺到常用位置：

1. **外部唤起层**：单实例 + `devcube://` deep link（Beta 分线 `devcube-beta://`）+ macOS `open-file`/`open-url` + 启动参数路径。所有入口统一落到「添加项目」语义：未登记则登记，已登记则聚焦选中。
2. **macOS Finder**：设置里一键安装「快速操作」——右键文件夹 → 快速操作 → 「在 DevCube 中打开」。
3. **Windows 资源管理器**：设置里一键添加右键菜单（文件夹与目录空白处）——「在 DevCube 中打开」。
4. **Linux**：desktop entry 声明 `inode/directory`，出现在文件管理器「用其他应用打开」。
5. **Codex 桌面端（ChatGPT）Open In**：设置里一键注册到用户级 `~/.codex/config.toml` 的 `desktop.custom_file_handlers`，Codex 的 Open in 菜单出现 DevCube。
6. **命令行（macOS）**：设置里一键安装 `devcube` 命令到 `/usr/local/bin`，终端里 `devcube <路径>` 直接打开。

## User Stories

1. 作为用户，我想在 Finder 里右键一个文件夹经快速操作打开 DevCube，以便不用切换应用手动添加项目。
2. 作为用户，我想在 Windows 资源管理器里右键文件夹（或目录空白处）打开 DevCube，以便与 macOS 同样顺手。
3. 作为用户，我想在 Linux 文件管理器「用其他应用打开」里看到 DevCube，以便主流发行版也有入口。
4. 作为用户，我想在 Codex 桌面端的 Open in 菜单里看到 DevCube，以便从 AI 会话一键跳回项目面板。
5. 作为用户，我想在 macOS 终端里敲 `devcube .` 打开当前目录，以便在 Claude Code / Codex CLI 会话里快速把项目丢进 DevCube。
6. 作为用户，我想任何外部入口打开一个已登记的项目时只是聚焦选中它，以便不产生重复登记。
7. 作为用户，我想外部打开一个未登记的目录时它被登记并选中（同手动添加的选中与滚动行为），以便入口之间行为一致。
8. 作为用户，我想 DevCube 未运行时从外部入口打开也能启动并直达该项目，以便入口不依赖应用常驻。
9. 作为用户，我想 DevCube 已运行（含 Windows 托盘隐藏）时外部打开会把窗口带到前台，以便不用自己找窗口。
10. 作为用户，我想脚本或其他工具能用 `devcube://open?path=…` 唤起 DevCube，以便自动化集成。
11. 作为用户，我想 Stable 与 Beta 各自有独立的协议与入口名（DevCube / DevCube Beta），以便双装互不抢注（对齐 Release Edition 隔离）。
12. 作为用户，我想这些系统入口都在设置「系统集成」里显式开关，以便自主决定装什么、随时移除。
13. 作为用户，我想未检测到 Codex 桌面端时注册按钮置灰并说明原因，以便与「打开于」的置灰惯例一致。
14. 作为用户，我想注册 Codex 时只增删 DevCube 自己的 handler 条目，以便我 config.toml 里的其他内容与注释原样保留。
15. 作为用户，我想 config.toml 本身有语法错误时 DevCube 拒绝修改并提示，以便不被工具改坏配置。
16. 作为用户，我想卸载 DevCube（Windows 卸载器）时右键菜单一并清理，以便不留垃圾注册表项。
17. 作为用户，我想传入的路径不是目录（或不存在）时被静默忽略，以便入口对脏输入稳健。

## Implementation Decisions

- **外部唤起层**（一切入口的汇聚点）：
  - 单实例锁：第二实例把 argv 转发给主实例后立即退出；主实例恢复 / 聚焦窗口（Windows 托盘隐藏态先 show）。
  - deep link：scheme 按 Release Edition 分线（`devcube` / `devcube-beta`），格式仅认 `<scheme>://open?path=<绝对路径>`；macOS 由 Info.plist（electron-builder `protocols`）声明，Windows 运行时 `setAsDefaultProtocolClient`，仅打包后注册（Dev 不注册，避免抢注已安装版本）。
  - macOS `open-file` 事件承接 Finder 快速操作与 `open -b <bundleId> <dir>`；目录同文件一样走该事件。
  - 启动参数：跳过 flag，取存在的目录参数（相对路径按第二实例工作目录解析）。
  - 冷启动时项目在渲染层加载前登记，并把 workspace 当前项目预置为该路径（bootstrap 快照直接带出）；运行中则推送 IPC 事件，渲染端复用「添加项目后的统一收尾」（选中 + 滚入视口）。
- **macOS 快速操作**：生成 `.workflow` bundle（Info.plist `NSServices` 收 `public.folder` + Automator「运行 Shell 脚本」执行 `open -b <bundleId> "$@"`）写入 `~/Library/Services`；移除即删目录。不用 FinderSync（见 ADR-0025）。
- **Windows 右键菜单**：`HKCU\Software\Classes\Directory\shell\<ProductName>` 与 `Directory\Background\shell\<ProductName>`（command 指当前 exe + `"%V"`），由设置开关经 `reg.exe` 增删——单一机制同时覆盖 NSIS 与 portable，安装器不重复写；NSIS 真卸载（非更新）时兜底清理。
- **Codex Open In**：外科手术式编辑 `~/.codex/config.toml`——只按表头定位增删 `[desktop.custom_file_handlers.<name>]` 自己的块，其余字节不动；写盘前用 TOML 解析器（smol-toml）校验结果，原文件已损坏或编辑后不合法则拒绝写入。macOS 的 command 用 `/usr/bin/open -b <bundleId>`（无需 CLI 前置），Windows 用当前 exe 绝对路径。
- **macOS CLI**：`~/Library/Application Support/<edition>/bin/<name>` 生成一行式脚本（`exec /usr/bin/open -b <bundleId> "$@"`，与应用安装位置解耦），软链到 `/usr/local/bin/<name>`；目录不可写时经 @vscode/sudo-prompt 提权执行（VS Code 同款做法）。
- **Linux**：electron-builder `linux.mimeTypes` 声明 `inode/directory`；deb 自带 `/usr/bin` 符号链接即 CLI，无需额外实现。
- **设置「系统集成」**：SettingsDialog 新增栏目；各行 = 名称 + 说明 + 安装/移除按钮；状态全部实时探测（文件 / 注册表 / TOML），不落盘持久化。
- **Dev 身份**：未打包时各入口以「DevCube Dev」（name `devcube-dev`）独立分线注册，与正式 / Beta 并行不抢注——macOS 经 `open -a <electron App 路径>` 唤起（正在运行的 dev 实例收 open-file；未运行则仅拉起空 Electron），Windows 以 electron.exe + 项目入口启动。deep link 协议仍仅打包注册。
- 所有涉及元数据集中于 Release Edition（appId / productName / name），入口文案统一「在 <ProductName> 中打开」；后续要加第二个系统菜单动作时，扩展各投影生成器即可（当前不预建动作清单框架）。

## Testing Decisions

只测外部行为可见的纯函数层，IO 经依赖注入隔离（先例：`open-in-app.test.ts` 的 deps mock）：deep link 与启动参数解析（脏输入 / 相对路径 / flag 混杂）；Codex TOML 块的增删（保注释与无关内容、重复注册幂等、原文件损坏拒改、Windows 路径转义）；各投影生成器产物包含关键要素（bundle id / exe 路径 / 菜单文案）。不为 Electron 事件挂接与真实注册表 / 文件系统写 e2e。

## Out of Scope

- Claude 桌面端的 Open In 菜单（硬编码名单，无注册机制，已实证）。
- macOS FinderSync 一级右键菜单（平台已塌，见 ADR-0025）。
- Windows 11 新版一级右键菜单（需 IExplorerCommand COM + 稀疏 MSIX，成本远超收益）。
- Windows / Linux 的 CLI 安装（Windows 改用户 PATH 风险大且无成熟库；Linux deb 已自带，AppImage / snap 用户自理）。
- 全局「复制路径」类与产品无关的系统工具。
- 打开文件（非目录）语义：所有入口只收目录。

## Further Notes

Codex 桌面端（随 ChatGPT 分发）的 `desktop.custom_file_handlers` 见官方 Advanced Configuration 文档；改动 config.toml 后需重启 ChatGPT 生效，设置行内注明。两处文档没写的实测行为：`icon` 实为必填（缺失时整个键被 settings-store 丢弃，日志 `Dropping invalid desktop setting`）；未设 `supports_ssh` 的 handler 只出现在本地会话的 Open in 菜单，云端任务会被过滤（DevCube 只开本地目录，语义正确）。
