---
status: accepted
---

# SSH 连接改为内置 ssh2，配置仍由系统 OpenSSH 解析

ADR-0038 让所有 SSH 连接都经系统 `ssh`：**SSH Terminal** 在 PTY 里跑 `ssh`，**Status Tab** 与 **Files Tab** 各起一条 `ssh`，提问经 askpass 小程序中转，SFTP 客户端自己写（ADR-0040）。用下来的代价是：askpass 只拿到提问原文，靠文字猜是密码还是指纹确认；一条 `ssh` 里没法再开独立通道（`ssh` 的连接复用 Windows 版不支持），浏览被传输堵住、取消下载后要等排队；Windows 上以管道启动系统 `ssh` 一直没实测。

我们决定照 JetBrains IDE 的做法改为混合实现（`docs/prd/ssh-connection.md`）：**配置仍交给系统 OpenSSH 解析**——每次连接前跑 `ssh -G <目标>` 取生效配置，用户的 `Include`、`Match`、`Host *` 由 OpenSSH 自己算；**连接改由内置的 `ssh2` 完成**——各功能仍各用各的连接（同今天），**Files Tab** 在自己的连接上分浏览与传输两个通道；认证顺序、known_hosts 核对、`ProxyJump` / `ProxyCommand`、ssh-agent、保活由 DevCube 按 OpenSSH 的语义实现。实测 WebStorm 2026.1：连接用内置的 sshj；「配置文件解析器」默认为 OpenSSH，即 `ssh -G`（另有它自己写的旧版解析器可选）；known_hosts、代理命令、跳板机、agent（含 Windows 命名管道）、多步认证都自己实现；一条会话默认最多同时开 8 个通道。

## Considered Options

- **内置 ssh2 + `ssh -G` 解析配置（选中）**：读到的配置与终端里敲 `ssh` 一致，连接可控、提问确切、一条连接上可开多个通道。代价是连接、认证、指纹核对要自己做对，缺的能力（见下）要明说。
- **维持系统 `ssh`（ADR-0038）**：行为与终端完全一致，但上面那些代价都留着。
- **系统 `ssh` + 连接复用（ControlMaster）**：一条连接上开多个通道也能做到，但 Windows 自带的 OpenSSH 不支持，只能做一半平台。
- **全内置、自己解析 `~/.ssh/config`**（WebStorm 的旧版解析器）：不依赖系统 `ssh`，但 `Match`、`Include`、令牌展开处处要与 OpenSSH 对齐，最容易出现「终端连得上、DevCube 连不上」。
- **同一台 Server 共用一条连接**（WebStorm 的连接池、VS Code）：只登录一次，但慢线路上传输拖慢同一连接上的终端，网络一抖所有 Tab 一起断，通道数还受服务器 `MaxSessions` 限制；终端软件（Termius、Xshell、PuTTY 默认）与 OpenSSH 默认都是一个终端一条连接。不采用。
- **VS Code / Zed 的做法（系统 `ssh` + 在服务器上装自己的服务端）**：适合编辑器，但要往每台服务器上装程序，文件也不走 SFTP；DevCube 只做连接与管理，不装服务端。

## Consequences

- 依赖 `ssh2`（纯 JavaScript，可选的原生加速模块不是必需）。它的可选依赖 `cpu-features` 只用来按 CPU 调整 ssh2 默认加密算法的先后，而我们总按 `ssh -G` 的顺序整表替换、用不上；它又是要为 Electron 重编译的原生模块，缺构建脚本时会让安装失败，所以用 pnpm 的覆盖规则不安装它。系统 `ssh` 仍是必需的：用来跑 `ssh -G`，同目录的 `ssh-keygen` 用来查找与删除 known_hosts 记录；找不到时与今天一样报「未找到 ssh，请安装 OpenSSH 客户端或将其加入 PATH」，不另设不读配置的退路。
- ssh2 不支持、因而不再生效的：硬件密钥（`sk-` 类型）、证书登录（`CertificateFile`、主机证书与 known_hosts 的 `@cert-authority`）、GSSAPI / Kerberos、macOS 的 `UseKeychain`（私钥口令改由 DevCube 问一次并可记住）、`ControlMaster`、端口转发、`ForwardAgent`、X11、`LocalCommand`；抗量子密钥交换（`sntrup761`、`mlkem768`）协商不上时退到 curve25519。
- known_hosts 与终端里的 `ssh` 共用同一份：查找与删除交给同目录的 `ssh-keygen`（`-F` / `-R`；Node 没有成熟的 known_hosts 库，Ansible 也是这么做的），哈希条目、通配与取反、`@revoked` 由它按 OpenSSH 的规则认；DevCube 只比对密钥、追加新记录，`StrictHostKeyChecking` 各档照 OpenSSH 处理；只有默认的询问档遇到主机密钥变了，照 WebStorm 醒目警告、可选择更新后继续（OpenSSH 直接拒绝）。
- 提问改为原生弹窗，确切知道是指纹确认、密码、私钥口令还是服务器的交互式提问；askpass 小程序与启动脚本随之删除。
- ADR-0040 的自写 SFTP 客户端改用 ssh2 的 SFTP；ADR-0039 的直连改为连接时绑定本机地址（`localAddress`），不再给 `ssh` 追加 `BindAddress` / `HostName` / `HostKeyAlias`。ADR-0038、ADR-0040 被本 ADR 取代。
