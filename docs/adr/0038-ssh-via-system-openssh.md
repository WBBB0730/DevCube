# SSH 一律经系统 OpenSSH，不内置协议实现

> 已被 ADR-0041 取代：配置仍由系统 OpenSSH 解析（`ssh -G`），连接改由内置的 ssh2 完成，askpass 小助手已删除。

要支持连服务器（**SSH Terminal**，以后还有远程文件管理）时，可以像 FinalShell / Termius 那样内置一套 SSH 客户端（Node 生态里是 `ssh2`），也可以直接调用系统自带的 `ssh`。我们决定一律经系统 OpenSSH：**SSH Terminal** 就是在 PTY 里跑 `ssh`；密码和其他提问经 `SSH_ASKPASS` + `SSH_ASKPASS_REQUIRE=force` 交给 DevCube 回答；记住的密码用 Electron `safeStorage` 加密存放，由 askpass 递给 `ssh`，不经命令行参数或环境变量传递。这样，用户 `~/.ssh/config` 里的 `Include`、`Match`、`ProxyJump`、`ProxyCommand`，ssh-agent、known_hosts 以及 `UseKeychain` 这类平台专有选项全部原样生效，DevCube 不必重做一遍配置解析和认证。

## Considered Options

- **系统 OpenSSH（选中）**：行为与用户在终端里敲 `ssh` 完全一致。代价是依赖系统里有 `ssh`（Windows 待实测），提问要经 askpass 小程序中转，而且只能拿到 `ssh` 给出的提问文字。
- **内置 `ssh2` 库**：能完全掌控认证交互和界面。但要自己解析 `~/.ssh/config`（`Include` / `Match` / `ProxyJump` / `ProxyCommand`）、对接 agent、校验 known_hosts，任何一处与 OpenSSH 不一致，都会出现「终端里连得上、DevCube 里连不上」；`UseKeychain` 这类 OpenSSH 专有选项也无从生效。
- **盯着终端输出，看到 `password:` 就把记住的密码敲进去**：提示文字因服务器和语言而异，一旦误判，就会把密码敲到错误的地方，属于 hack。

## Consequences

- 远程文件管理也必须经系统 `ssh` 建立连接（例如走 `ssh` 的 sftp 子系统），不另起一套 SSH 客户端。
- 打开「绕开代理直连」时，DevCube 会在 `ssh` 参数上追加绑定本机地址等选项（ADR-0039），这时的行为与在终端里敲 `ssh` 不再完全一致。
- 首次连接的指纹确认、钥匙文件口令、验证码都在 DevCube 弹窗里回答，不在终端里输入。
- Linux 上 `safeStorage` 没有可用的系统钥匙串时，不提供「记住密码」。
- askpass 必须是一个能被 `ssh` 直接执行的程序：以 `ELECTRON_RUN_AS_NODE` 借应用自带的 Electron 跑小助手（参照 VS Code git 扩展），小助手打包在 asar 外、不能引入 electron 或其他主进程模块；应用若关掉 RunAsNode 这个 Electron fuse，这条路就会断。
