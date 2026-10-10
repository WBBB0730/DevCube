---
status: accepted
---

# WSL 项目经发行版内的常驻小助手执行

要让文件夹在 WSL 发行版里的 **Project**（**WSL Project**，`docs/prd/wsl-project.md`）像 Windows 盘上的项目一样好用，单靠 Windows 这一侧做不到：Windows 的文件监听（ReadDirectoryChangesW，`@parcel/watcher` 用的就是它）对 `\\wsl.localhost\…` 不生效，微软至今未支持（microsoft/WSL#7674）；Windows 版 git 隔着文件共享读仓库，慢，还报属主可疑、误报可执行位变化；每次临时起一个 `wsl.exe` 执行命令要多花约 0.1～0.2 秒，**Git Tab** 刷新一次要跑好几条 git。VS Code（WSL 扩展的 server）、JetBrains（IJent，早先是 fsnotifier-wsl）、Zed（remote server）都在发行版里放一个常驻进程来做这些事。

我们决定：**每个发行版一个常驻小助手**，同一发行版的 WSL 项目共用。

- **小助手**：一个用 Go 编写、静态链接的 Linux 程序，只打进 Windows 安装包（目前 x64，对应 Linux x86_64），与 Linux 版 ripgrep 放在一起。连接时用 `wsl.exe -d <发行版> --cd <它所在的 Windows 目录> --exec ./<小助手>` 直接从安装目录启动（JetBrains 跑它的 WSL 小工具也是这样），不往发行版里拷贝、不联网，始终与应用同版本。主进程经标准输入输出与它通信。
- **它做的**：在发行版的登录环境里执行命令（git、rg）并取回输出；递归监听目录（inotify）；结束 **Run Session** 的进程组；读取探测用的清单与指纹。
- **它不做的**：文件的浏览、读写与预览仍由 Windows 直接访问 `\\wsl.localhost\…`，单个文件的读写走文件共享已经够用；**Terminal** 与 **Run Session** 的 PTY 仍在 Windows 侧，进程经 `wsl.exe` 进发行版（同 Windows Terminal 的 WSL 配置文件、Zed 的终端），只有运行会话的进程组交给小助手登记与结束。
- **生命周期**：发行版的某个 WSL 项目被用到时连上；该发行版不再在用、满偏好时长（默认 15 分钟，可选「从不」）后断开，让 WSL 能自己休眠；未连上时不访问该发行版的任何路径，因为从 Windows 访问 `\\wsl.localhost\…` 本身就会唤醒它。

## Considered Options

- **发行版内常驻小助手（选中）**：变化跟进可靠，git 与搜索接近本机速度，与三家主流做法一致；代价见下。
- **不放常驻进程，每次临时起 `wsl.exe`**：最省事，但文件变化无从跟进（只能窗口回到前台时刷新，同服务器的 **Files Tab**），Git Tab 每次刷新都要多等几条命令的启动开销。
- **不分流，Windows 侧直接操作 UNC 路径**：git 慢且报属主可疑，监听不生效，运行时用的是 Windows 的工具链，等于没支持。
- **像 VS Code / Zed 那样在发行版里跑完整后端**（Linux 版 Node 加上 DevCube 主进程的大部分逻辑，或另写一个全功能服务端）：文件读写也不走文件共享，最快；但要随包带或在线下载几十 MB 的运行时、维护一整套远程协议，每个新功能都要单独适配（Zed 的 Git Graph 曾因此在 WSL 里用不了）。DevCube 的文件操作以单个文件为主，走文件共享已经够用，不值得。
- **小助手用 Node 写**：可以复用 TypeScript，但发行版里不一定装了 Node，也不该替用户装。
- **小助手用 Rust 写**（Zed、JetBrains IJent 的选择）：同样可行；Go 不开 cgo 即得到静态程序，从任何平台交叉编译都不用额外的链接器，构建更省事。
- **拷进发行版（如 `~/.devcube`）再启动**（VS Code、Zed）：关掉 automount 也能用（Zed 另有经标准输入流式写入的退路），但要处理版本残留与清理。直接从安装目录跑始终与应用同版本，也不在用户的发行版里留东西。
- **结束运行会话时直接结束 Windows 侧的 `wsl.exe`**：WSL 已知这样不一定结束发行版里的进程（microsoft/WSL#3766、#12159），dev server 会残留、占着端口，所以改由小助手在发行版里结束整个进程组。

## Consequences

- 仓库多了一个 Go 子项目，Windows 构建要装 Go 工具链、交叉编译小助手，并另取 Linux 版 rg；Mac 与 Linux 构建不受影响。以后出 Windows ARM 安装包时，要再配 Linux arm64 版。
- 需要 Microsoft Store 版 WSL 与 WSL 2：`--cd` 只在新版 `wsl.exe` 上可靠，WSL 1 不支持；不满足时给出明确原因。用户关掉 automount 时小助手启动不了（VS Code 也有同样的限制），按连不上处理并给出原因。
- WSL 项目里删除即永久删除：Windows 回收站不覆盖 WSL，强行调用会报错；确认文案照服务器的 **Files Tab**。
- DevCube 开着且某个发行版在用时，WSL 不会自己休眠；闲置断开把这段时间限制在偏好时长内。
- git、rg、监听、探测今后都要按目录分流：新增「在本机执行」的功能时，要同时考虑 WSL 项目走哪条路，否则会出现 Zed 那样「某个功能在 WSL 里不能用」的情况。
- 共享路径层改为支持 UNC 根，网络共享上的项目随之能正确浏览，它们仍按 Windows 盘上的项目处理。
