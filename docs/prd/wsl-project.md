# wsl-project

**WSL 项目**

## Problem Statement

Windows 上不少开发者把代码放在 WSL 的 Linux 发行版里，node、git 等工具也装在里面——在里面跑更快，也更接近服务器环境。DevCube 在 Windows 上只用 Windows 这一侧的东西，把 `\\wsl.localhost\Ubuntu\home\me\web` 这样的文件夹登记成 **Project** 后：

- 路径本身就认不对：共享路径层把 `\\…` 开头的路径当成相对路径，**Files Tab**、**Content Search**、预览与压缩都会出错（网络共享 `\\服务器\共享\…` 上的项目同样如此）。
- **Terminal** 开出来的是 Git Bash / PowerShell / cmd，运行配置用的是 Windows 的 node（往往根本没装）。
- **Git Tab** 用 Windows 的 git 隔着文件共享读仓库，慢，还常报仓库属主可疑、误报文件权限变化。
- 文件变化收不到通知：Windows 这一侧的文件监听对 WSL 文件系统不生效，Git Tab、Files Tab、「检测到的配置」都不跟进。
- 删除进不了回收站。

## Solution

文件夹位于 WSL 发行版里的 **Project** 即 **WSL Project（WSL 项目）**：DevCube 按路径自动认出，不需要任何设置，也不是新的条目类型。WSL 项目的 **Terminal**、**Run Session**、**Git Tab**、**Content Search**、**Discovered Script** 探测与变化跟进都在它所在的发行版里进行；文件的浏览、编辑与预览仍由 Windows 直接访问该文件夹。

发行版里的工作交给 DevCube 随 Windows 安装包带的一个小助手（ADR-0055）：同一发行版的 WSL 项目共用一个，**点开其中任一项目时自动连上**，没有「连接」按钮；切到别的项目不断开；这个发行版的项目都不在用、满设定时长（默认 15 分钟）后自动断开，让 WSL 能自己休眠。连不上时才出现「重新连接」。

Windows 盘上的项目、macOS 与 Linux 上的 DevCube 都不受影响。

## User Stories

1. 作为 Windows 用户，我想用「添加现有项目」选中 WSL 里的文件夹（资源管理器「Linux」节点下），它就作为 WSL 项目登记，以便不用做任何额外设置。
2. 作为 Windows 用户，我想拖入、资源管理器右键「在 DevCube 中打开」、新建空项目、从 Git 仓库克隆到 WSL 里的目录，同样得到 WSL 项目，以便各个入口行为一致。
3. 作为用户，我想 `\\wsl$\Ubuntu\…` 与 `\\wsl.localhost\Ubuntu\…` 指向同一个文件夹时只登记一次，以便不出现重复项目。
4. 作为用户，我想在左树里一眼认出 WSL 项目：文件夹图标换成 Linux 企鹅，悬停说明它在哪个发行版里，以便与 Windows 盘上的项目区分。
5. 作为用户，我想点开 WSL 项目就自动连上，不用点「连接」，以便它用起来跟 Windows 盘上的项目一样。
6. 作为用户，我想连接期间 **Git Tab** 与 **Files Tab** 显示加载中，连上后一次性出现内容，以便知道它在准备。
7. 作为用户，我想没点开过的 WSL 项目不唤醒 WSL：左树里照常显示名字与已保存的配置，「检测到的配置」等连上后再出现，以便不白白占用资源。
8. 作为用户，我想上次退出时停在 WSL 项目上，下次启动 DevCube 就直接连上，以便接着干活。
9. 作为用户，我想连不上时（没装 WSL、发行版已删除、WSL 版本太旧、发行版是 WSL 1、发行版启动失败），Git Tab 与 Files Tab 显示原因和「重新连接」，以便知道怎么修。
10. 作为用户，我想在 WSL 项目里新建 **Terminal**，得到发行版里我自己的默认 shell，在项目目录（或 Files Tab 里选中的目录）起，nvm 等照常生效，以便跟在 Windows Terminal 里开 WSL 一样。
11. 作为用户，我想 WSL 项目的运行配置在发行版里执行：清单脚本用发行版里的包管理器，命令型配置的工作目录与环境变量照常生效，以便跑出来的结果与我在 WSL 终端里敲的一致。
12. 作为用户，我想停止运行配置时连同它起的子进程一起结束，以便 dev server 不在发行版里残留、端口不被占着。
13. 作为用户，我想 Git Tab 用发行版里的 git，速度接近本机，不报属主可疑、不误报权限变化，以便正常查看与操作仓库。
14. 作为用户，我想发行版里没装 git 时得到「Ubuntu 中未找到 git」这类明确提示，以便知道去哪儿装。
15. 作为用户，我想在终端里提交、切分支，或用别的编辑器改了文件后，Git Tab、Files Tab 与「检测到的配置」自动跟进，以便不用手动刷新。
16. 作为用户，我想 **Content Search** 与文件树筛选在发行版里搜，速度接近本机，以便大仓库也能用。
17. 作为用户，我想在 WSL 项目的 Git Tab 里新建、删除、前往工作树都能用，新建出来的工作树也作为 WSL 项目登记，以便工作树流程不变。
18. 作为用户，我想在 WSL 项目里删除文件时先确认、确认后永久删除（WSL 里没有回收站），以便不误删；提示与服务器的 Files Tab 一致。
19. 作为用户，我想在 WSL 项目里「复制路径」得到 Linux 路径（`/home/me/web/…`），以便直接粘到终端或命令里；「复制相对路径」不变。
20. 作为用户，我想「打开文件夹」「在资源管理器中显示」「打开于」对 WSL 项目照常可用，以便在 Windows 应用里打开它。
21. 作为用户，我想切到别的项目时不断开，切回来不用等，以便来回切换顺畅。
22. 作为用户，我想某个发行版的项目都不在用满一段时间后自动断开，让 WSL 能自己休眠、把内存还给 Windows；再点开时自动重连并刷新，以便 DevCube 常驻托盘也不一直占着资源。
23. 作为用户，我想在设置「偏好」里选闲置多久后断开：5 / 10 / 15 / 30 分钟或「从不」，默认 15 分钟，以便按自己的习惯取舍；这一项只在 Windows 上出现。
24. 作为用户，我想压缩 WSL 项目里的文件时，「排除被 Git 忽略的文件」按发行版里的 git 判断，以便结果与 git 一致。
25. 作为用户，我想以系统「打开方式」打开 WSL 里的文件时 **Preview Window** 照常可用，内容随磁盘变化跟进，以便与 Windows 盘上的文件一样。
26. 作为用户，我想 Windows 盘上的项目完全不受影响，「默认终端」偏好只管它们，以便已有的用法不变。
27. 作为用户，我想网络共享（`\\服务器\共享\…`）上的项目也能正确浏览文件，以便它们不再出错（它们仍按 Windows 盘上的项目处理）。

## Implementation Decisions

**识别与路径**

- WSL 路径：`\\wsl.localhost\<发行版>\…` 与 `\\wsl$\<发行版>\…`，前缀不区分大小写，发行版名取第一段（WSL 规定发行版名只含字母、数字与 `._-`）。登记时统一成 `\\wsl.localhost\<发行版>\…`，按统一后的形式去重与匹配（External Open、登记、各处按路径找项目）。映射成盘符的网络驱动器（如 `Z:\`）不识别为 WSL。
- `Project` 记录不加字段：是否为 WSL 项目、在哪个发行版，都由路径派生。
- 共享路径层支持 UNC 根：`//主机/共享` 作为不可越过的根参与规范化、上翻、限定在项目内与子路径前缀判断，修掉把 UNC 路径变成相对路径的问题；主进程里各处「逻辑路径 → 系统路径」的副本合并成一处，渲染端判断绝对路径的地方一并改。
- Windows 路径与 Linux 路径互转是纯函数：前缀映射（`\\wsl.localhost\<发行版>\home\me` ↔ `/home/me`），再加上 NTFS 不允许的字符与 WSL 在 Windows 侧显示用的私有区字符（U+F000 起）之间的互换，与 WSL 自己的转换规则一致。发行版里输出的路径（git 等）先转回 Windows 形式，再参与比较与登记；传进发行版的路径参数转成 Linux 形式。

**连接（每个发行版一条）**

- 小助手是一个静态链接的 Linux 程序（ADR-0055），只打进 Windows 安装包；Windows 安装包目前只出 x64，对应带 Linux x86_64 版。同放的还有 Linux 版 ripgrep（与 `@vscode/ripgrep` 同来源、同版本的 x86_64 musl 静态构建）。Mac、Linux 安装包不带。
- 连接即启动小助手：`wsl.exe -d <发行版> --cd <小助手所在的 Windows 目录> --exec ./<小助手>`，由 WSL 把 Windows 目录换成发行版里的挂载路径；不往发行版里拷贝任何东西，不联网，始终与应用同版本。主进程与小助手经标准输入输出通信。
- 小助手提供：在指定目录以发行版的登录环境执行命令并取回输出（可流式、可写标准输入、可取消）；递归监听目录；结束进程组；按探测规则读取清单与指纹。登录环境在连接时由用户默认 shell 以交互登录方式取一次（同 VS Code / Zed），之后 git、rg 等都在这份环境下执行——与 macOS 上 git 子进程带登录 shell 环境同理。
- **何时连**：以下任一发生即连（已连则复用）——WSL 项目成为当前条目；在它下面运行配置或开 **Terminal**；**Preview Window** 或压缩窗口的路径在该发行版里；克隆的目标目录在该发行版里。启动时恢复的当前条目若是 WSL 项目，即在启动时连。
- **未连上时不碰发行版**：不读它的文件、不跑 git、不检查路径是否存在——从 Windows 访问 `\\wsl.localhost\…` 本身就会唤醒发行版（JetBrains 2025.2 修过同类问题）。左树、启动时的仓库解析与监听对齐都跳过未连上的 WSL 项目。
- **在用**：该发行版的某个 WSL 项目是当前条目（窗口关到托盘时不算），或它下面有开着的 **Terminal**、运行中的 **Run Session**，或有根在该发行版里的 **Preview Window** / 压缩窗口。
- **闲置断开**：该发行版不再在用时开始计时，满偏好时长即断开；计时期间重新在用则取消计时。「从不」即一直保持。另外 DevCube 退出、该发行版的 WSL 项目全部移除时也断开。断开不提示；之后再在用时自动重连，Git Tab、Files Tab 与探测结果刷新一次。
- **意外断开**（`wsl --shutdown`、小助手退出）：标为未连接；仍在用则立即重连，否则等下次在用。
- **Git / Files 面板**：两者对每个项目常驻挂载，挂载即读文件、跑 git，所以 WSL 项目第一次连上之前不挂载，显示连接占位页（连接中「正在连接…」）；连上过一次后一直显示，之后闲置断开、重连都不卸载（展开状态与编辑都在），用到时自会重新连上。
- **连不上**：Git Tab 与 Files Tab 显示原因与「重新连接」；**Terminal** 与 **Run Session** 在输出里给出原因。原因分：未安装 WSL；WSL 不是 Microsoft Store 版（提示运行 `wsl --update`）；发行版不存在；发行版是 WSL 1（提示转换为 WSL 2，WSL 1 不支持）；启动失败（附 WSL 的报错）。WSL 版本按注册表 `HKCU\…\Lxss` 下发行版的 `Flags` 判断。

**Terminal 与运行**

- **Terminal**：PTY 里起 `wsl.exe -d <发行版> --cd <目录>`，不带命令即用户默认 shell 的交互登录 shell（同 Windows Terminal 的 WSL 配置文件）。它仍是 **Terminal**，不是 **SSH Terminal**；关掉 Tab 即结束。
- **Run Session**：PTY 里经 `wsl.exe` 在目录下由小助手的启动子命令起进程：先自成进程组并报给常驻的小助手，再设好配置的环境变量，以用户默认 shell 的 `-l -i -c` 执行命令（与 macOS / Linux 上的本机运行一致）。停止由常驻的小助手结束整个进程组（先 SIGTERM、再 SIGKILL，同本机的停止规则），不靠结束 Windows 侧的 `wsl.exe`——WSL 已知结束 `wsl.exe` 不一定结束发行版里的进程。
- 运行头由发行版里的 shell 打印（ADR-0023 的 sh 写法），目录显示 Linux 路径。
- 命令型配置的工作目录：相对路径按项目根解析；用目录选择器选出的 Windows 绝对路径交给 `wsl.exe --cd` 由 WSL 换算（同一发行版的 `\\wsl.localhost\…` 与盘符路径都可）；以 `/` 或 `~` 开头的按 Linux 路径原样使用。
- Windows「默认终端」偏好不作用于 WSL 项目。

**Git**

- git 进程的唯一入口按目录分流：在 WSL 项目里经该发行版的连接执行发行版里的 git；git 可执行文件与版本按发行版分别发现与缓存，版本门槛按该发行版的 git 判断。未找到时报「<发行版> 中未找到 git，请在其中安装」。
- git 输出的绝对路径（仓库根、公共 gitdir、`worktree list`、`--git-path`）转回 Windows 形式；传给 git 的路径参数（`worktree add/remove`、克隆目标、未跟踪文件对比的 `--no-index` 路径）转成 Linux 形式；`check-ignore --stdin` 的相对路径一律用 `/`。仓库键用转换后的 Windows 形式，写动作按仓库排队的规则不变。
- 克隆目标在发行版里时，经该发行版的 git 克隆；取消与失败的清理在发行版里删除目标目录。

**变化跟进与探测**

- WSL 项目的文件监听由小助手在发行版里递归监听（inotify），不再用 Windows 侧的 `@parcel/watcher`；监听根、`.git` 白名单、`check-ignore` 过滤、防抖与三通道分发与 ADR-0021 一致，只是事件来源不同。**Preview Window** 同理。监听数量超出系统上限时按监听报错处理：各通道强制刷新一次，Files Tab 退为窗口回到前台时刷新（同服务器的 Files Tab）。
- **Discovered Script**：WSL 项目的清单与指纹经连接读取并缓存，建树只读缓存（建树本身不访问发行版）。从未连上过的项目没有「检测到的配置」；断开后保留上次的结果。引用型配置只在读到结果后对账，读不到时不删。

**搜索**

- **Content Search** 与文件树筛选的索引在发行版里跑 Linux 版 rg，参数与输出解析与现状相同（输出本就是相对路径）。

**文件**

- 浏览、读写、预览与媒体流仍由 Windows 直接访问 `\\wsl.localhost\…`（Node 的 fs 支持 UNC），不经小助手。
- 删除：WSL 项目的 Files Tab 删除确认文案为「将从 <发行版> 中删除它（及其中的全部内容），删除后无法恢复。」，确认后直接删除；不调用回收站（Windows 回收站不覆盖 WSL，强行调用会报错）。
- 「复制路径」（Files 树）与「复制文件绝对路径」（Git）在 WSL 项目里给 Linux 路径；「复制相对路径」、「打开文件夹」、「在资源管理器中显示」、「打开于」不变（后几项交给 Windows 应用，用 Windows 路径）。

**左树与设置**

- WSL 项目的文件夹图标换成自绘的线条风格 Linux 企鹅（15px 网格，线宽与圆头对齐左树的 lucide 图标，直接内置图形，同 GitHub 标志的做法；尺寸、颜色与左树其他图标一致），悬停为「<发行版> 中的项目」与 Linux 路径。WSL 里的链接工作树项目同样用企鹅图标，悬停再加一行它是哪个主工作树的工作树。
- 设置「偏好」在「默认终端」之后加「闲置后断开 WSL」下拉：5 分钟 / 10 分钟 / 15 分钟 / 30 分钟 / 从不，默认 15 分钟；仅 Windows 出现，选中即生效（正在计时的按新时长重算）。存于应用偏好。

## Testing Decisions

只测外部可见行为的纯函数与状态机，进程与 WSL 经依赖注入隔离，不写端到端测试：

- WSL 路径识别与统一（两种前缀、大小写、末尾分隔符、去重）；Windows ↔ Linux 路径互转（含私有区字符互换、`/` 与 `~` 开头、跨发行版拒绝）。
- 共享路径层对 UNC 根的规范化、上翻、限定在项目内与子路径前缀（不越过共享根）。
- **Terminal** 与 **Run Session** 的 `wsl.exe` 调用构造（引号、环境变量、各种工作目录形式）与运行头。
- 「在用 / 计时 / 断开 / 重连」状态机：各种在用来源的进出、托盘隐藏、偏好改时长、「从不」、意外断开。
- 探测缓存与引用型配置对账：未连上或读不到时不删。
- 小助手自身（Go）对执行、监听、进程组结束与通信协议做单元测试。

另按用户要求进行 Windows 实机验证，并在固定分支 `codex/wsl-windows-validation` 持续记录、提交和推送。手工验证的命令、临时脚本与原始输出作为本 PRD 的附件保存，不加入 CI 的端到端测试套件。验证只记录问题，尚未授权修改产品实现。

## Out of Scope

- Windows 盘上的项目在 WSL 里跑（「+」菜单里开 WSL 终端），以后再议。
- WSL 1：识别出来后按连不上处理，提示转换为 WSL 2。
- Windows ARM 安装包：目前不出；出了再配 Linux arm64 版小助手与 rg。
- 映射成盘符的 WSL 网络驱动器；发行版里 `/mnt/c/…` 形式的路径反向登记为 Windows 项目。
- 发行版的非默认用户（统一以发行版的默认用户连接）。
- Docker、Dev Container 等其他 Linux 环境。
- WSL 里的 SQLite 文件作为 **Data Source** 的专门处理（仍经 Windows 路径打开）。
- 「打开于」的其他应用如何对待 WSL 路径（由对方应用决定）。

## Further Notes

- 开发机是 macOS，以下需在 Windows 11 / Windows 10 + WSL 2 上实测：文件夹选择器、拖入与右键返回的路径形式；Windows 10 系统自带的 `wsl.exe` 是否支持 `--cd`（不支持则归入「不是 Microsoft Store 版」）；关闭 automount 时的报错；首次连接与 WSL 冷启动的等待时长；ConPTY 里 `wsl.exe` 终端的尺寸、中文与颜色；命令与环境变量的值（含引号、空格、`$`、反斜杠）经 Windows 命令行传给 `wsl.exe` 后原样到达；停止运行配置后发行版里无残留进程；大仓库的 Git Tab、搜索与监听开销及 inotify 上限；闲置断开后 WSL 能自行休眠；Windows 浏览器经 `localhost` 打开 WSL 里的 dev server（WSL 2 默认转发，Vite 等只绑 `::1` 时需绑 `127.0.0.1`）；Git Tab 不再出现属主可疑与权限误报。
- 参考：VS Code 的 WSL 扩展（发行版里跑 server，打开窗口即连，关窗 5 分钟后 server 退出）；JetBrains（IJent 按发行版共享、直到 IDE 退出；旧版用 WSL 里的 git 与 fsnotifier-wsl；2025.2 起最近项目列表不再唤醒 WSL）；Zed（WSL 当作远程连接，在发行版里跑 remote server，列表不唤醒 WSL，恢复会话即连）。三家都不提供「连接」按钮。

### Windows 实机验证记录

2026 年 10 月 13 日，时区为 Asia/Shanghai。最初实测基线为 `c06e41513f00bb972423b4ca1b6ed60bc2618707`。后续检查固定以 `79f19ecebf399ab971fe92baebe433a888556040` 建立独立工作树，避免影响用户正在体验的 Windows 开发版和 Ubuntu 中的源码副本。两者之间新增了 Files Tab 的刷新兜底与 Markdown 预览改动；WSL 连接、小助手和运行会话相关实现未变化。

截至首次记录，已确认两个产品缺陷，另有一个用户报告的严重 Terminal 显示问题待复现。基础功能通过不等于 WSL 支持已完整验收，尤其不能把应用状态变为 `disconnected` 当成发行版里的小助手已经退出。

#### 环境与路径

| 项目                | 实际值                                                                |
| ------------------- | --------------------------------------------------------------------- |
| Windows             | Windows 10，10.0.19045.6456                                           |
| CPU                 | AMD Ryzen 7 8845H，8 核、16 个逻辑处理器，固件虚拟化开启              |
| 物理内存            | 约 32 GB                                                              |
| 分页文件            | 系统自动管理，`C:\pagefile.sys`，分配 24 GB                           |
| WSL                 | Microsoft Store 版 2.6.3.0，内核 6.6.87.2-1                           |
| 初始发行版          | 仅 `docker-desktop`，停止，WSL 2                                      |
| 新装发行版          | `Ubuntu-24.04`，WSL 2                                                 |
| Ubuntu 默认测试用户 | `devcube`，UID/GID 1000，默认 shell `/bin/bash`                       |
| 最终工具版本        | Node.js 24.21.0 LTS、npm 11.19.0、pnpm 10.30.3、Git 2.43.0、Go 1.26.9 |
| Linux ripgrep       | `@vscode/ripgrep-linux-x64` 包 1.18.0，二进制报告 ripgrep 15.0.0      |
| Windows 源码        | `E:\Projects\Webstorm\DevCube`                                        |
| Ubuntu 体验副本     | `/home/devcube/DevCube`                                               |
| 体验副本 UNC        | `\\wsl.localhost\Ubuntu-24.04\home\devcube\DevCube`                   |
| 原始验证产物        | Windows 源码的 `out/wsl-verification`                                 |
| 小助手构建产物      | Windows 源码的 `build/wsl/out/devcube-wsl` 与 `rg`                    |
| Windows 开发版数据  | `%APPDATA%\DevCube Dev`，与安装版 `%APPDATA%\DevCube` 分开            |

Ubuntu 默认仓库先装出的 Node.js 是 18.19.1、npm 是 9.2.0。随后安装了经 SHA256 校验的官方 Linux Node.js 24.21.0 归档，并将 `/usr/local/bin/node`、`npm`、`npx` 链接到 `/opt/node-v24.21.0-linux-x64/bin`，pnpm 固定为 Windows 侧正在使用的 10.30.3。原始基础测试先在 Node 18 上完成；最后重新验证了 Node 24 下的工具发现、ConPTY 命令和环境变量传递。

Windows Go 工具链放在源码的 `out/wsl-verification/tools/go`，只在构建命令的进程环境中加入 PATH，没有修改 Windows 全局 PATH。Linux Go 位于 `/usr/local/go`，`/usr/local/bin/go` 是其链接。未设置 Git 全局提交身份；手工测试仓库使用仓库级 `DevCube Verification <verification@example.invalid>` 身份。

#### WSL 001 命令型运行配置停止后后台子进程仍存活

**状态：已在真实生产 Runner 入口复现，尚未修复。**

复现命令为：

```sh
sleep 120 & echo $! > marker.pid; wait
```

1. 在 WSL Project 下建立 **命令型 Run Configuration**，工作目录为发行版内项目目录，命令使用上面的内容。
2. 运行后读取 `marker.pid`，并在发行版里用 `ps -p <pid> -o pid,ppid,pgid,sid,stat,args` 检查后台 `sleep`。
3. 调用实际 `runner.stop(key)`：先 SIGTERM，2 秒未退出再 SIGKILL。
4. 等待 3.5 秒。Run Session 显示「进程已结束，退出代码为 9」，但后台 `sleep 120` 仍在运行。

实际生产入口的一次记录：

```text
停止前：PID 501，PPID 482，PGID 501，SID 482，STAT S，sleep 120
停止后：PID 501，PPID 481，PGID 501，SID 482，STAT S，sleep 120
会话输出：进程已结束，退出代码为 9
```

小助手的直接 ConPTY 诊断还记录到：Bash PID/PGID 761，后台 `sleep` PID/PGID 781。SIGTERM 请求返回成功时两者仍在；SIGKILL 请求返回成功后 Bash 不在，`sleep` 仍在。交互式 Bash 的后台作业进入了独立进程组，仅对登记的 Bash 进程组发信号无法覆盖它。`killRun` 返回成功只表示发信号成功，不表示整个运行会话的子进程树已退出。

相关实现：`src/main/runner.ts` 的 `runWsl`、`wslRunProcess`、`stop`；`src/main/command.ts` 的 `buildWslRunInvocation`；`build/wsl/launch.go` 的 `Setpgid` 与 `syscall.Exec`；`build/wsl/runs.go` 的 `syscall.Kill(-pgid, signal)`。

边界与对照：实际生产入口中 `npm run verify_stop` 的后台 `sleep` 与 npm/脚本 shell 留在同一进程组，停止后没有残留；普通 Terminal 关闭也通过了同类检查。因此当前证据明确覆盖命令型配置直接启动交互式 shell 后台作业的情况，不能笼统声称所有脚本停止都会失败。仍需覆盖前台长期进程、显式 `setsid` / `nohup`、孙进程和其他用户默认 shell。

影响：Run Session 已显示结束，实际任务仍运行；若该子进程持有端口或资源，下一次运行可能失败。不能仅靠 Windows 侧 `wsl.exe` 退出或界面会话状态判断清理完成。

建议的修复目标：停止应覆盖属于该运行会话的所有进程组，并保留用户登录环境和交互 shell 的工具可用性。不能为了让一次 Bash 测试通过而破坏 zsh、fish 或 nvm 等登录环境。此处只记录目标，尚未选择或实施修法。

证据：[生产 Runner 诊断](wsl-project-validation/initial/runner-diagnostic.json)、[直接进程组诊断](wsl-project-validation/initial/stop-diagnostic.json)、[生产 Runner 原始输出](wsl-project-validation/initial/electron-runner.stdout.txt)、[诊断脚本](wsl-project-validation/initial/electron-runner.ts.txt)。测试残留的进程已按其实际 PID/PGID 清理，没有结束用户正在体验的 Terminal。

#### WSL 002 断开连接后小助手未完成清理

**状态：真实 Windows 到 WSL 小助手连接中稳定复现，尚未修复。**

生产 `spawnHelper` 的 `kill` 实现只调用 `child.kill()`。主进程连接状态随后变为 `disconnected`，但在该 Windows Node 进程仍存活、标准输入流仍持有的情况下，发行版里的小助手没有收到输入结束，其运行会话登记目录两秒后仍存在。

对照实验只改变临时验证连接的结束方式，没有修改产品源码：

| 结束方式                          | 应用状态       | 两秒后小助手登记目录已删除 |
| --------------------------------- | -------------- | -------------------------- |
| `child.kill()`                    | `disconnected` | 否                         |
| `child.stdin.end(); child.kill()` | `disconnected` | 是                         |
| `child.stdin.end()`               | `disconnected` | 是                         |

相关实现：`src/main/wsl.ts` 的 `spawnHelper`；`src/main/wsl-connection.ts` 的 `disconnect`；`build/wsl/server.go` 的标准输入输出服务与断开清理；`build/wsl/runs.go` 的 `killAll`。协议设计本身以标准输入关闭作为小助手退出条件，当前 Windows 桥接进程的结束方式没有明确触发该条件。

影响：逻辑上已经闲置断开，实际小助手仍可能继续持有监听与运行会话资源，削弱让 WSL 休眠的目的。此前真实 5 分钟计时测试只证明状态切换、缓存保留和再次使用重连成功，没有证明实际 VM 已休眠。

建议的修复目标：明确关闭输入通信通道，使小助手按协议收尾；若有异常退出超时，再结束桥接进程，并验证发行版里没有该小助手和运行会话残留。先关闭标准输入的对照实验已通过，但尚未修改产品实现。

证据：[结束方式对照](wsl-project-validation/initial/close-diagnostic.json)、[诊断脚本](wsl-project-validation/initial/diagnose-close.ts.txt)、[基础实测结果](wsl-project-validation/initial/results.json)。

#### WSL 003 用户报告新建 Terminal 后持续刷空行

**状态：已复现并通过重复单变量对照确认布局反馈根因，正式与开发模式均可触发。尚未修复。**

用户描述：新建 Terminal 时，整个终端区域快速持续向下刷很久，滚动很多以后才停止，最终出现大量像连续按回车产生的空行。严重程度由用户明确描述为「非常严重」。目前没有精确持续时间、空行数量或原始终端输出，不能将它当作 WSL 001 或 WSL 002 的已知结果直接解释。

待区分的路径：发行版登录启动脚本产生输出；ConPTY 的 ANSI 清屏、游标移动和尺寸协商；主进程 headless xterm 序列化；前端快照与实时输出去重；xterm 的终端应答被写回 PTY 后形成交互循环；布局变化导致重复 resize 和 shell 重画。下一轮记录原始输出与输入、resize 次数、快照内容和前端实际显示，分别定位输出来源。

相关检查入口：`src/main/runner.ts` 的 `openTerminal`、`emitOutput`、`createScreen`、`resize`、`getSessionBuffer`；`src/renderer/src/components/Console.tsx` 的 TerminalPane 初始化、FitAddon、实时输出消费、快照回放及可见性变化。

**第二轮 正式构建真实界面验证：连续新建三次，没有复现持续滚动。** 在独立用户档案的临时 Electron 应用中加载 `79f19ec` 的实际 main、preload 和 renderer，使用 Playwright 操作实际「新建终端」菜单。每次观察 12 秒，记录主进程收到的 stdin/resize、前端收到的原始 session output、实际主进程快照和 xterm viewport。

三次结果一致：每个终端 369 个 UTF-16 代码单元、3 个输出块，原始输出包含 28 次 LF；这些 LF 位于 ConPTY 的逐行 `ESC[K` 清理序列中，结尾为 `ESC[H` 回到左上角，而不是 shell 连续执行空命令。最终快照只有 94 个代码单元、0 次 LF。前端 viewport 的 `scrollTop=0`，`scrollHeight=clientHeight=638`，没有产生滚动历史。实际尺寸为 108 列、29 行，每个终端前端发送了 3 次相同尺寸的 resize，主进程已有相同尺寸早退逻辑。三次合计 9 次 resize、1107 个输出代码单元、9 块输出、84 次 LF，stdin 输入次数为 0，因而本组中没有终端自动应答循环。

测试用户 `.bashrc`、`.profile` 与 `/etc/skel` 对应默认模板 `cmp` 均为 0，未发现自定义 shell 启动脚本差异。JetBrains Mono 字体实际已加载。本组是在新建临时档案和正式 React 构建下测试，尚不能覆盖用户现有档案、开发模式和全部窗口尺寸，也不能据此否定用户观察。

代码另有一个需要继续验证的配置差异：前端 xterm 和主进程 headless xterm 均未提供 `windowsPty`。当前本机 ConPTY 使用 Windows 10 build 19045，小于 xterm 区分旧版 ConPTY 重排行为的 21376 门槛。安装包 typings 与 [xterm 源码](https://github.com/xtermjs/xterm.js/blob/master/src/common/buffer/Buffer.ts)说明该配置影响 resize 时的历史行与行重排。当前只是潜在关联，未证明它是用户大量空行的根因，不能直接以设置该选项作为已验证修复。

操作限制与诊断差异：本轮没有启动 dev 服务，没有向用户的终端注入输入，也没有终止发行版。临时 app 自己拥有独立 `appData`，仅记录两类 IPC，不改变产品事件处理。第一次尝试隐藏窗口使 Chromium 暂停渲染帧，Playwright 等待按钮稳定性超时；这属于诊断方式限制，随后改用实际可见的临时窗口完成测试，并在结束后关闭。独立工作树通过 node_modules junction 复用现有依赖，跨盘 CSS 引用有 Inter/PDF 资源解析警告；终端使用的本地 JetBrains Mono 已验证加载，其他页面的视觉结果不在这一组的结论范围内。Playwright 注入的调试参数使诊断 app 目录额外显示为一个 Project；它只属于临时档案，不影响用户的 Project 列表。

证据：[界面采样和原始输出](wsl-project-validation/terminal-production/result.json)、[完整诊断脚本](wsl-project-validation/terminal-production/diagnostic.cjs.txt)、[主进程观察入口](wsl-project-validation/terminal-production/bootstrap.cjs.txt)、[第一次新建画面](wsl-project-validation/terminal-production/round-1.png)、[第二次](wsl-project-validation/terminal-production/round-2.png)、[第三次](wsl-project-validation/terminal-production/round-3.png)。后续将针对开发模式、窗口尺寸、已有终端恢复与重复快照继续检查。

**第三轮 已复现 resize 导致的持续刷屏。** 在相同源码 `79f19ec` 上单独构建包含 React development 与 StrictMode 的 renderer，依然用本地构建文件启动，没有启动 dev 服务。临时窗口设为用户实际保存的 1102×722；第二个终端另外切换过 720×480 和 1102×722 共 8 次，随后停止人工调整。第一次新建就已经出现循环，因此那 8 次调整不是最初问题出现的前提。

三次新建每次观察约 12 秒，累计原始输出/采样如下：

| 第几次新建 | 累计输出代码单元 | 累计输出块 | 累计 LF | 最新会话快照 LF |
| ---------- | ---------------- | ---------- | ------- | --------------- |
| 1          | 196068           | 788        | 21587   | 128             |
| 2          | 406281           | 1632       | 44588   | 140             |
| 3          | 606507           | 2436       | 66647   | 126             |

主进程共收到 9608 次 resize、0 次 stdin。尺寸的主要分布为 `110×29` 4795 次、`108×28` 3307 次、`109×28` 1487 次，其余只有少量窗口调整对应值。首个终端在第一次发送 `109×28` 后，很快进入 `109×28 → 110×29 → 109×28 → 110×29`，相邻变化通常只隔几毫秒。在没有任何键盘/终端输入的情况下仍持续产生输出，排除了「不断按回车」或自动终端应答是本组直接原因。

链路已经得到证据支持：容器/测量尺寸反复变化 → 前端 ResizeObserver/FitAddon 反复发不同尺寸 → 主进程相同尺寸早退无法拦截交替值 → ConPTY 不断调整并重画屏幕 → 输出携带大量清行与换行 → headless buffer 的快照也累积额外行。该快照不是单纯前端显示的重复回放。三张截图均出现大面积空白和滚动条，与用户描述的终端区域持续刷空行一致。

仍需区分：本次同时改变了 React 模式和窗口的 2 像素差异，不能仅凭这一轮把根因归为 StrictMode。下一步保持正式 React 构建也设为 1102×722，并记录 ResizeObserver contentRect、计算样式、父容器 padding、全局滚动条和 Canvas 几何；用单变量对照确定布局反馈的来源。普通终端自动应答和 shell 启动脚本已在本组排除，`windowsPty` 是否加剧历史行污染仍是另一个问题，不应替代尺寸循环的根因调查。

本轮报告在最后刷新页面后，renderer 端临时采集对象被重置，汇总打印遇到 `undefined.bytes`，属于诊断脚本收尾错误。此前三次的持续采样、9608 条主进程 resize 记录和截图均已保存；原始全部输出块没有在刷新前归档，不能声称这个 JSON 保存了 606507 个代码单元的完整原始输出。下一轮先保存采集对象再刷新。诊断应用在 finally 中关闭，未改动产品源码或用户档案。

证据：[开发模式采样与全部 resize](wsl-project-validation/terminal-development/result.json)、[诊断脚本](wsl-project-validation/terminal-development/diagnostic.cjs.txt)、[构建配置](wsl-project-validation/terminal-development/development.config.ts.txt)、[第一次刷空白画面](wsl-project-validation/terminal-development/round-1.png)、[第二次](wsl-project-validation/terminal-development/round-2.png)、[第三次](wsl-project-validation/terminal-development/round-3.png)。

**第四轮 正式构建与单变量对照确认根因。** 正式 React 构建也设为 1102×722 后立即复现，因此不是 React StrictMode 专有问题。又加载用户原 Windows 源码已有的正式 renderer 产物（避免独立工作树 node_modules junction 和 CSS 资源解析警告成为混杂因素），相同窗口尺寸仍复现。该 renderer 是最初构建的 `c06e415`；其 TerminalPane 实现与 `79f19ec` 相同。

直接根因是 **FitAddon 的测量父容器包含未扣除的 padding，溢出后触发外层 Panel 的自动滚动条反馈**：

1. TerminalPane 当前 JSX 是外层 `relative h-full w-full`，内层带 `ref={containerRef}` 的 `h-full w-full p-2`。ResizeObserver 观察内层，xterm 也挂在内层，padding 为四边 8 px，box-sizing 为 border-box。
2. 当前 `@xterm/addon-fit` 的 `proposeDimensions()` 读取 xterm 父元素的计算 width/height，却只扣除 xterm 元素自身的 padding，再扣固定滚动条宽度，没有扣除父元素 `p-2` 的 16 px。它因此按比真实内容区更大的空间计算行列。
3. 真实采样中，带 padding 的父容器宽 814.25 px、高 635.333 px，内容区至少再扣左右/上下共 16 px；xterm screen 却宽 807 px、高 638 px。容器出现 `scrollWidth=815 > clientWidth=814`、`scrollHeight=646 > clientHeight=635` 的溢出。
4. 祖先中有 react-resizable-panels 的 Panel DOM，计算样式 `overflow-x:auto; overflow-y:auto`。滚动条出现后可用区域减少约 8 px，改变被观察容器的尺寸；FitAddon 再次 fit 后滚动条条件反转。宽高在约 `814.25×635.333` 与 `822.25×643.333` 间交替，带来不同的行列数。body 实测 overflow 为 hidden，因此不是 body 的 overflow 设置丢失。
5. 每次不同尺寸都会穿过主进程的相同尺寸早退，调用 ConPTY resize。ConPTY 连续清行/重画产生大量 LF，并污染缓冲区历史。前端未发送任何 stdin，空行不是实际 shell 连续执行空命令。

仅在独立诊断窗口的 DOM 上把测量父容器 padding 从原样变为 `0px`，没有改文件或产品实现。移除 padding 后容器内容区可容纳 screen，滚动条反馈立即停止；恢复原 CSS 后循环再次出现；再次移除又停止。两个独立正式 renderer 环境都完成了这一组可逆对照。

| 环境               | 阶段           | 3 秒内 resize 增量 | LF 增量 | 输出代码单元增量 |
| ------------------ | -------------- | ------------------ | ------- | ---------------- |
| 独立工作树正式构建 | 原始 p-2       | 714                | 5335    | 48374            |
| 独立工作树正式构建 | padding 0      | 0                  | 28      | 252              |
| 独立工作树正式构建 | 恢复 p-2       | 718                | 5396    | 48913            |
| 独立工作树正式构建 | 再次 padding 0 | 0                  | 28      | 252              |

padding 0 阶段的少量输出来自变化前已排队的最后一次 ConPTY 重画；后续不再持续增长。历史里已经产生的空行不因改变 padding 自动消失，不能把停止增长等同于修复旧缓冲区内容。原 Windows renderer 的完整对照数值、内容区域和祖先滚动容器记录在 [original renderer](wsl-project-validation/terminal-layout/original-renderer.json)；独立构建完整原始输出、主进程 resize、ResizeObserver 几何记录在 [isolated build](wsl-project-validation/terminal-layout/isolated-build.json)。本组在刷新前就保存了全部采集对象，没有上一轮的收尾丢失问题。

修复方向应消除错误测量和布局反馈：将留白放在不被 FitAddon 测量的外层，给真正的终端挂载/观察元素无 padding 的内容区域，并核对终端面板的溢出约束。不能只给 resize 加延迟/限速，也不能把差一列一行的变化全部忽略，那会掩盖测量错误并影响正常调整窗口。前端 xterm 与主进程 headless xterm 的 Windows ConPTY 兼容选项可另行评估；它们不是本轮尺寸循环的根因。

下一步验收应覆盖正式/开发模式、150% 显示缩放下的分数像素、相邻窗口尺寸、最小窗口、切 Tab、拖面板、已有终端恢复、长提示符和输出历史。期望正常新建收敛到稳定尺寸，闲置时不反复发送 resize，停止的界面与主进程快照均没有持续空行污染。当前记录分支只保存诊断结果，不修改 JSX、库或产品配置。

证据：[单变量诊断脚本](wsl-project-validation/terminal-layout/diagnostic.cjs.txt)、[原始 p-2 的空白画面](wsl-project-validation/terminal-layout/original.png)、[移除 padding 后](wsl-project-validation/terminal-layout/no-padding.png)、[恢复 p-2 再现](wsl-project-validation/terminal-layout/restored-padding.png)、[再次移除](wsl-project-validation/terminal-layout/no-padding-again.png)。

#### WSL 004 同一目录的其他路径形式导致重复 Project

**状态：第五轮通过实际项目登记入口复现，尚未修复。**

在独立 Electron 用户档案中使用真实 `addProjectByPath` 和 store，每个案例先清空该诊断档案的 Projects，再登记同一个基准目录和一种等价路径。Linux 临时目录为 `/home/devcube/devcube-wsl-verification/path-cases-1791859154710/real`，没有修改用户的 Project 列表。

| 第二次登记的路径形式                      | 实际 Project 数量 | 结论     |
| ----------------------------------------- | ----------------- | -------- |
| 完全相同                                  | 1                 | 通过     |
| `wsl.localhost` 改为 `wsl$`               | 1                 | 通过     |
| 主机名变为 `WSL.LOCALHOST`                | 1                 | 通过     |
| 发行版 `Ubuntu-24.04` 改为 `ubuntu-24.04` | 2                 | 重复登记 |
| UNC 的反斜杠全部改为正斜杠                | 2                 | 重复登记 |
| 末尾增加反斜杠                            | 2                 | 重复登记 |
| 末尾增加 `\.`                             | 2                 | 重复登记 |

所有失败案例的两次登记均通过真实目录存在检查，不是不存在的路径被错误添加。当前 `canonicalWslPath` 只统一 UNC 主机前缀，并刻意保留原分隔符；`addProjectByPath` 直接用 `p.path === dir` 比较。发行版大小写、分隔符、末尾分隔符和点段因此没有成为同一 Project 的统一键。影响是同一目录在左树出现多个条目，其 Run Configuration、常驻 Tab 和其他按项目路径索引的状态也可能分开。

必须保留的对照：Linux 的 `Case` 与 `case` 是两个实际目录，当前登记数量为 2，符合 Linux 路径大小写语义。修复不能简单把整条 UNC 路径全部转为小写；只能将主机/发行版身份按 Windows/WSL 语义匹配，并规范化分隔符、目录边界和点段，保留 Linux 路径部分的大小写。

相关实现：`src/shared/wsl-path.ts` 的 `canonicalWslPath`；`src/main/projects.ts` 的 `addProjectByPath`；`src/shared/files-path.ts` 已有的逻辑路径规范化。证据：[完整登记结果](wsl-project-validation/path-cases/result.json)、[生产入口脚本](wsl-project-validation/path-cases/diagnostic.ts.txt)、[原始输出](wsl-project-validation/path-cases/path-cases.stdout.txt)。本组另记录到符号链接目录无法通过 Windows 的目录判定，后续单列兼容边界，不把它混为路径键规范化问题。

#### 已通过的基础检查及其范围

| 检查               | 结果与范围                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| 现有相关单元测试   | 18 个文件、365 项通过、3 项按平台条件跳过；不是全仓库测试数量                                           |
| TypeScript 检查    | Node 与 Web 两侧通过                                                                                    |
| 正式构建           | `electron-vite build` 成功；CSS 优化器对现有 `::highlight` 伪元素有两条警告，没有改动                   |
| Windows 小助手构建 | `pnpm build:wsl-helper` 成功，Linux x64 静态程序与同包版本 rg 已产出                                    |
| Linux Go 检查      | `go vet ./...` 和 `go test -race -count=1 ./...` 通过，后者用时 5.992 秒                                |
| 预检与复用         | 真实 WSL 版本、注册表发行版读取通过；同发行版大小写不同的并发连接共用小助手                             |
| 协议               | JSON-RPC 输出、退出码、ENOENT、中文标准输入、流式输出、复杂环境变量通过                                 |
| 路径与文件共享     | 中文、空格、单引号；Linux `:`、`?` 与 Windows 私有区字符互转和读写通过                                  |
| Git                | Linux Git、仓库根反向映射、忽略判断、可执行位、工作树添加与移除通过                                     |
| 搜索               | Linux rg 在非 TTY 标准输入条件下返回文件结果，忽略 `ignored/`；生产 Content Search 及文件树筛选入口通过 |
| 监听               | Windows 经 UNC 创建、改写、新增目录、重命名、删除时收到递归 inotify 事件                                |
| 生产 Files 入口    | 浏览、新建、保存、重命名、永久删除与越界拒绝通过                                                        |
| 探测               | package.json 的脚本读取和更新通过；未连上时缓存为 null                                                  |
| ConPTY             | 中文、ANSI 颜色、尺寸从 88×25 变为 103×31、Linux 默认 shell 通过                                        |
| Windows 命令行传参 | 中文、空格、双引号、单引号、`$`、反斜杠、`=` 的环境变量值通过                                           |
| 取消协议命令       | AbortSignal 取消后同进程组的后台任务不再写出延迟标记文件                                                |
| 闲置状态机实测     | 设置为 5 分钟后真实等待触发 `disconnected`，探测缓存保留，再次使用自动重连通过；不证明小助手已清理      |
| 最后一次冷启动     | 新装 Ubuntu 单独停止后重新连接，包含 WSL 启动和小助手初始化用时 2342 ms；这是单次样本，不是性能基准     |

生产核心入口的第一次临时脚本误将 `findGit` 的 `path` 假定为 Linux 绝对路径，产生一项假失败；实际实现合法返回 `{ path: 'git', version: '2.43.0' }`。改为验证实际 Linux Git 版本及仓库路径映射后，快速复测 7 项全通过，另一次长测的闲置和重连通过。附件保留错误断言的原始输出与纠正后的结果，不能把第一次 `electron-results.json` 里的 Git 假失败算成产品缺陷。

#### 环境配置与操作记录

以下是执行动作与命令的完整语义记录。脚本保留了实测时使用的绝对路径，需要在另一台机器上复现时替换路径。原始二进制和依赖缓存不提交；脚本、结果 JSON 与已有日志在附件中保存。

1. 阅读项目约定、MEMORY、词汇表、WSL PRD、ADR 0055、现有 WSL 测试、构建脚本和相关运行代码；检查 Git 状态与应用进程。最初源码工作区干净。
2. 执行 `wsl.exe --version`、`wsl.exe --list --verbose`、`wsl.exe --list --online` 和 `wsl.exe --help`，确认 Store WSL、WSL 2 与 `--cd` 支持。没有把 Docker 发行版当成开发用 Ubuntu。
3. 分两批执行相关 Vitest 文件。第一批 11 个文件 155 项通过，第二批 7 个文件 210 项通过、3 项跳过；`pnpm typecheck` 通过。
4. 检查当前已安装的 DevCube `resources`，未发现 `wsl` 目录，因此没有用该安装版作为当前源码的验证基线。构建当前源码的正式 renderer 与 main，没有启动 dev 服务。
5. 查询 Context7 的微软 WSL 文档，并对照本机 `--help`。用户明确授权配置 Ubuntu 后，执行 `wsl.exe --install -d Ubuntu-24.04 --no-launch --web-download --version 2`。
6. Ubuntu 下载完成，但虚拟机注册失败：`Wsl/InstallDistro/Service/RegisterDistro/CreateVm/HCS/0x800705aa`，系统资源不足。此时 Windows 约有 7 GB 空闲物理内存、约 21 GB 空闲虚拟内存，自动分页已启用，BIOS 虚拟化与 hypervisor 存在。不能据此认定普通内存耗尽。
7. 读取 WSL/Hyper-V 日志列表与近时段事件；匹配查询没有返回有关错误事件，未伪造日志结论。对照 [微软 WSL 问题 5231](https://github.com/microsoft/WSL/issues/5231) 与 [官方配置文档](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)，在之前不存在的 `%USERPROFILE%\.wslconfig` 写入下面的配置。在所有发行版均停止的前提下执行 `wsl.exe --shutdown`，重试安装成功。这是本机有效的配置，不等于已确定 HCS 错误的完整根因。

   ```ini
   [wsl2]
   processors=4
   ```

   该配置作用于所有 WSL 2 发行版，包括 Docker。没有修改 Windows 内存上限、分页文件或 BIOS，没有重启电脑、关闭用户其他应用，也没有删除 Docker 发行版。

8. 从 `https://go.dev/dl/?mode=json` 选择符合 `build/wsl/go.mod` 的 Go 1.26 分支补丁版本 1.26.9，下载官方 Windows 和 Linux 归档，分别验证 SHA256：Windows 为 `d722201a9c0c086d1610e111c48203009af690892ed708072bd5ae20160e7a59`，Linux 为 `42d158b4d8f7b61ac0a830567c940a86098fb7aac52e467a5ebec03ef5cc2f8d`。
9. 将 Windows Go 的 bin 仅加到构建进程 PATH，执行 `pnpm build:wsl-helper`。小助手大小 2654370 字节，Linux rg 大小 5728032 字节。构建有 Node DEP0190 的 `shell: true` 提示，未将提示当成 WSL 功能验证失败。
10. 以 `wsl.exe -d Ubuntu-24.04 -u root --exec /bin/bash <setup-ubuntu.sh>` 安装 `git nodejs npm ca-certificates curl build-essential locales`，生成 `zh_CN.UTF-8`，创建 `devcube` 用户，安装 Linux Go。随后执行 `wsl.exe --manage Ubuntu-24.04 --set-default-user devcube` 并验证 UID/GID。完整脚本见 [setup ubuntu](wsl-project-validation/initial/setup-ubuntu.sh.txt)。没有保存或设置用户密码，也没有修改 Windows 全局 Node。
11. 在 Ubuntu 建立独立临时目录 `/home/devcube/devcube-wsl-verification`，每轮基础测试使用带时间戳的中文、空格和单引号项目目录。文件、Git 提交、工作树与运行进程都属于这些验证目录，没有在用户真实源码仓库里提交测试数据。
12. 用真实 `wsl.exe` 和仓库 `WslConnections` 运行协议验证。第一次 ConPTY 环境变量断言误把按屏幕宽度折行的 JSON 当成原始一行；修正临时解析后传参通过。首次默认 Terminal 还触发 Ubuntu 新实例初始化，脚本在提示符准备前发送输入导致超时；改为等提示符出现再写入，Terminal 验证通过。这两次不是产品缺陷的证据。
13. 基础测试脚本经过 TypeScript 直接运行和 esbuild 临时打包两种入口，最后 10 项通过、2 项失败。两项失败对应 WSL 001/002，随后又用实际生产入口和独立诊断确认。相关脚本：[verify](wsl-project-validation/initial/verify.ts.txt)、[协议结果](wsl-project-validation/initial/results.json)。
14. 创建无主窗口的独立 Electron 验证入口，使用临时 userData/sessionData，避免改写用户正式版或开发版档案。加载实际 store、projects、wsl、git-exec、files、content-search、discovery、runner 模块。小助手按该验证 app 的 getAppPath 放置；renderer 不参与这一轮，因此不能据此宣称 Terminal 显示问题已通过。
15. 生产核心入口分别验证项目登记、Git、Files、探测、搜索与索引。真实闲置测试在 04:58:26 开始等待，约 05:03:26 收到断开，再次执行 `id -un` 自动重连通过。时间来自日志 UTC 换算为 Asia/Shanghai。
16. 生产 Runner 临时打包第一次遇到 Electron Vite 的 `?modulePath` worker 导入，普通 esbuild 不能直接处理。用临时构建插件将它指向已正式构建的 SQLite worker 路径后完成打包；没有修改生产加载器或 SQLite 实现。误启动的无效临时 Electron 进程按其确定的 PID 清理。
17. 生产 Runner 检查 npm 脚本、命令型配置和普通 Terminal 关闭。仅命令型后台进程场景残留。node-pty 的辅助进程在部分已结束控制台上报告 `AttachConsole failed`；相关 stderr 完整保留。这尚未作为一个独立产品缺陷定性，因为还需要核对 Windows 控制台退出与终止时序。
18. 进行结束小助手的三组对照，确认先关闭标准输入可清理登记目录。每次只结束本轮的小助手，没有终止用户正在体验的连接。
19. 查询 Node 官方版本元数据与文档，下载 Node.js 24.21.0 Linux x64 归档，对照 `SHASUMS256.txt` 校验，安装并配置 pnpm 10.30.3。见 [setup node](wsl-project-validation/initial/setup-node.sh.txt)。
20. 在用户尚未开始持续体验该 Ubuntu 前，单独 `wsl.exe --terminate Ubuntu-24.04`，再次测冷启动、工具版本和 Node 24 下的 ConPTY 环境变量传递。结束时关闭本轮输入通道并停止测试发行版。未终止 Docker。Node/ConPTY 的部分临时验证进程未自然退出，最后仅按验证脚本命令行匹配其自身 PID 清理，未清理用户应用。
21. 用户要求复制源码用于体验后，以 Ubuntu `devcube` 用户用 tar 将 Windows 源码和 `.git` 复制到 `/home/devcube/DevCube`。排除 `node_modules`、`out`、`dist`、`.cache`、`.idea`、构建二进制、增量缓存与日志，目标不存在才创建，不覆盖既有目录。复制后 HEAD 与原仓库均为 `c06e415`，Git 工作区干净，约 20 MB，`package.json`、`pnpm-lock.yaml`、`src/main/wsl.ts` 逐字节相同。未复制 Windows 依赖，也未替用户运行 `pnpm install`。
22. tar 对少数 `.git` 元数据报告时间戳超前约 20 秒；复制、HEAD 和内容比较均成功。没有擅自改系统时钟。完整复制脚本见 [copy project](wsl-project-validation/initial/copy-project.sh.txt)。
23. 用 Windows 仓库现有正式构建启动未打包的 Electron：`electron.exe . \\wsl.localhost\Ubuntu-24.04\home\devcube\DevCube`。开发版单实例入口将该目录登记并设为当前 Project；验证档案的 `workspaceUi.currentEntryKey` 为该 UNC，现有开发版窗口 `DevCube — DevCube` 有有效窗口句柄且响应，WSL 小助手实际启动。没有启动 `electron-vite dev` 或任何 dev 服务，没有修改产品源码。
24. 用户继续开发后 Windows main 更新为 `79f19ec`，体验副本仍是复制时的 `c06e415`，后续必须分别注明版本。为记录和继续检查创建独立工作树，并固定分支 `codex/wsl-windows-validation`，后续增量记录在同一分支提交和推送。

#### 命令复现入口

现有检查命令：

```powershell
pnpm exec vitest run src/shared/wsl-path.test.ts src/shared/path.test.ts src/main/wsl-preflight.test.ts src/main/wsl-connection.test.ts src/main/wsl-idle.test.ts src/main/command.test.ts src/main/discovery.test.ts src/main/configs.test.ts src/main/git-exec.test.ts src/main/git-argv.test.ts src/main/project-watch-classify.test.ts src/main/project-watch-schedule.test.ts src/main/rg.test.ts src/main/projects.test.ts src/main/external-open.test.ts
pnpm exec vitest run src/shared/files-path.test.ts src/shared/files-tree-search.test.ts src/shared/content-search.test.ts src/main/content-search.test.ts src/main/compress-scan.test.ts src/main/git-actions.test.ts src/main/git-data.test.ts
pnpm typecheck
pnpm exec electron-vite build
pnpm build:wsl-helper
wsl.exe -d Ubuntu-24.04 --cd /mnt/e/Projects/Webstorm/DevCube/build/wsl --exec /usr/local/go/bin/go vet ./...
wsl.exe -d Ubuntu-24.04 --cd /mnt/e/Projects/Webstorm/DevCube/build/wsl --exec /usr/local/go/bin/go test -race -count=1 ./...
```

第一条 Vitest 命令中部分历史名称不存在，Vitest 实际执行了 11 个匹配文件；其余不应被计入覆盖。手工验证文件以 `.txt` 归档，复现时将它们复制回源码的 `out/wsl-verification` 并去掉最后的 `.txt`。只有在自身测试目录中执行，尤其不要把旧的 PID 记录用于结束当前系统进程。

#### 附件与检查空白

初始全部已有结果、脚本和日志位于 [wsl project validation initial](wsl-project-validation/initial)。JSON 中保留当时的路径、PID、进程组和示例环境变量；这些是特定一次运行的证据，不是下一次运行可复用的操作目标。Go/Node 工具链归档、node_modules、编译后的大体积 CJS 和用户档案未提交。

日志文本按仓库的 LF 约定存储，行尾空格和 stderr 的末尾空行是原始诊断输出的一部分；检查这类附件时不把它们当成代码格式缺陷。原始 ConPTY 控制字符、CR/LF 和进程输出在结果 JSON 的转义字符串中保存，不依赖普通文本日志的换行格式。

待继续检查：用户报告的 Terminal 空行滚动；复杂路径形式的 Project 去重；目录重命名/搬入时的递归监听；文件名大小写、反斜杠和控制字符；工作树的独立与公共 gitdir；断开重连后的监听与探测恢复；运行会话的前台/后台与孙进程；大量文件搜索与取消；异常中断的恢复。文件夹选择器、资源管理器拖拽/右键、关闭 automount、inotify 上限、真实 VM 休眠和浏览器 localhost 转发仍没有完整实测覆盖。当前不启动 dev 服务，不改用户正在体验的 shell 配置、终端或发行版生命周期。
