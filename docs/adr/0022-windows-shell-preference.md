# Windows 默认 Git Bash，Terminal 与 Run 共用可配置 shell

Windows 上 Terminal / Run Session 都经登录式 shell 起 PTY。默认选 Git Bash（与常见前端/跨平台工作流一致），设置里可改 PowerShell 或 cmd。Git Bash 探测：常见安装根 → PATH 旁路 `git.exe` 反推安装根 → PATH 上非 WSL 的 `bash.exe`（跳过 `System32` / `WindowsApps` 占位）；拆 PATH 时不用 `:`，以免切开盘符。设置页对探测失败的选项置灰；若偏好仍为 Git Bash 则运行时回退 PowerShell。
