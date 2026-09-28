# SSH 连接（内置实现）

> 提案中（ADR-0041），尚未实施。实施前，现行行为以 `ssh-server.md`、`server-status.md`、`server-files.md` 为准。

## Problem Statement

同一台 **Server**，开 **SSH Terminal**、看 **Status Tab**、用 **Files Tab** 是三条互不相干的 `ssh` 连接：没记住密码时要输三次，每条各自掉线、各自重连。提问经 askpass 小程序转给 DevCube，只能拿到提问原文，靠文字猜是指纹确认、密码还是私钥口令。一条 `ssh` 里没法再开独立通道，浏览服务器上的文件会被正在进行的下载堵住，取消后还要等已发出的数据传完。SFTP 客户端是自己写的，Windows 上以管道启动系统 `ssh` 也一直没实测。

## Solution

照 JetBrains IDE（实测 WebStorm 2026.1）的混合做法：

- **配置仍交给系统 OpenSSH 解析**：每次连接前跑 `ssh -G <目标>`，取它算好的生效配置。`~/.ssh/config` 里的 `Include`、`Match`、`Host *`、跳板机、私钥、agent 设置，与在终端里敲 `ssh` 读到的完全一样。
- **连接由 DevCube 内置的 `ssh2` 完成**：每台 **Server** 一条共享连接，**SSH Terminal**、**Status Tab**、**Files Tab**、服务器上的 **Run Configuration** 都是这条连接上的通道，只登录一次。
- **认证、指纹核对、跳板机、代理命令、ssh-agent、保活**由 DevCube 按 OpenSSH 的语义实现，与 WebStorm 一样。
- **提问改为原生弹窗**：确切知道这次问的是主机指纹、密码、私钥口令，还是服务器的交互式提问（验证码、多步认证）；文案照抄 WebStorm。
- **文件管理改用 `ssh2` 自带的 SFTP**：浏览与传输各用一个通道，互不堵塞；删除自写的 SFTP 客户端。
- 其余用户可见的行为不变：添加 / 编辑服务器、记住密码、测试连接、断线按回车重连、绕开代理直连、跨重启只恢复不自动连接。

## User Stories

1. 作为用户，同一台服务器，我先连上 **Status Tab** 并输了密码，之后打开 **Files Tab**、新建 **SSH Terminal** 时直接连上，不再问密码。
2. 作为用户，第一次连接某台服务器时，我想看到它的主机密钥类型与 SHA256 指纹，确认后记入 known_hosts；之后在终端里敲 `ssh` 也认这条记录，反之亦然。
3. 作为用户，服务器的主机密钥变了时，我想看到醒目的警告（可能有人在中间截听），可以选择更新 known_hosts 后继续，或者取消。
4. 作为用户，我的私钥设了口令时，我想在弹窗里看到是哪个私钥文件在问，输入后可以勾选记住。
5. 作为用户，服务器要求验证码或多步认证时，我想按服务器给出的提问逐项回答，提问与说明原样显示。
6. 作为用户，我在 `~/.ssh/config` 里写的跳板机（`ProxyJump`）、代理命令（`ProxyCommand`）、私钥（`IdentityFile`、`IdentitiesOnly`）、agent（`IdentityAgent`）、保活（`ServerAliveInterval`）在 DevCube 里照样生效。
7. 作为用户，网络断开时，这台服务器的所有 Tab 同时显示断开原因（中文），各自可以重连；**SSH Terminal** 仍是按回车重连。
8. 作为用户，连接失败时我想看到明确的中文原因，例如连接被拒绝、连接超时、找不到主机、认证失败，而不是 ssh 的英文报错。
9. 作为用户，**Files Tab** 里有上传或下载在进行时，我仍然可以浏览目录、打开文件。
10. 作为用户，我想 **SSH Terminal** 按我 ssh 配置里的 `SendEnv` 把本机的语言环境传给服务器，中文不乱码，与在终端里敲 `ssh` 一致。
11. 作为 Windows 用户，我想只要系统装有 OpenSSH（Windows 10 / 11 自带）就能连，连接不依赖以管道启动的 `ssh.exe`。
12. 作为用户，我用的是 DevCube 不支持的登录方式（硬件密钥、证书、Kerberos）时，我想看到明确说明，而不是莫名其妙地认证失败。

## Implementation Decisions

### 参照的 WebStorm 做法（2026.1 安装包实测）

| WebStorm                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | DevCube                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 连接用内置的 sshj                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 连接用内置的 `ssh2`（1.17）                                                                                                                                |
| 「配置文件解析器」默认 OpenSSH：跑 `ssh -G`，要求系统装有 OpenSSH；另有自写的旧版解析器                                                                                                                                                                                                                                                                                                                                                                                    | 只用 `ssh -G`，不做旧版解析器                                                                                                                              |
| 读取的配置项：hostname、port、user、identityfile、identitiesonly、identityagent、proxyjump、proxycommand、preferredauthentications、pubkey / password / kbdinteractive / gssapi authentication、stricthostkeychecking、userknownhostsfile、globalknownhostsfile、hashknownhosts、serveraliveinterval、serveralivecountmax、connecttimeout、kexalgorithms、hostkeyalgorithms、ciphers、macs、compression、forwardagent、forwardx11、local / remote forward、sendenv、setenv | 见下「配置解析」；多读 hostkeyalias、addressfamily、bindaddress、bindinterface、numberofpasswordprompts、batchmode、remotecommand，不读 gssapi、forward 类 |
| 不处理：CertificateFile、HostKeyAlias、BindAddress、UseKeychain、AddKeysToAgent、ControlMaster、known_hosts 的 `@cert-authority` / `@revoked`                                                                                                                                                                                                                                                                                                                              | 证书、UseKeychain、AddKeysToAgent、ControlMaster 同样不处理；HostKeyAlias、BindAddress、`@revoked` 处理                                                    |
| 连接池按主机、用户、端口复用会话；一条会话默认最多同时开 8 个通道                                                                                                                                                                                                                                                                                                                                                                                                          | 按 **Server** 复用；每条连接至多 8 个通道，超出另开一条                                                                                                    |
| known_hosts 用 sshj 的解析（支持哈希条目），按 `HashKnownHosts` 决定写入时是否哈希；结果分一致 / 已更改 / 未知                                                                                                                                                                                                                                                                                                                                                             | 同左，自己实现解析                                                                                                                                         |
| 主机密钥未知时问「确定要继续连接吗」；已更改时警告并问是否更新后继续；可按连接设 StrictHostKeyChecking（是 / 询问 / 接受新的 / 否）                                                                                                                                                                                                                                                                                                                                        | 同左（「更新并连接」只在询问档）；StrictHostKeyChecking 取自 ssh 配置，不在 DevCube 里另设                                                                 |
| 认证按顺序逐个尝试，支持多步认证（partial success）                                                                                                                                                                                                                                                                                                                                                                                                                        | 同左                                                                                                                                                       |
| agent：Unix 套接字、Windows 的 OpenSSH 命名管道、Pageant                                                                                                                                                                                                                                                                                                                                                                                                                   | `ssh2` 自带这三种；Pageant 何时启用见「认证」                                                                                                              |
| 保活取自 ServerAliveInterval / ServerAliveCountMax                                                                                                                                                                                                                                                                                                                                                                                                                         | 同左；未设时用 15 秒、3 次                                                                                                                                 |
| SFTP 通道出错或被关后自动重开                                                                                                                                                                                                                                                                                                                                                                                                                                              | 同左                                                                                                                                                       |
| 密码与口令可以「保存到重启」或「永久保存」                                                                                                                                                                                                                                                                                                                                                                                                                                 | 只有「记住」（永久，加密存放），与现有的记住密码一致                                                                                                       |

### 配置解析

- 每次建立连接前跑 `ssh -G`：引用 `~/.ssh/config` 的 **Server** 为 `ssh -G <别名>`；手填的为 `ssh -G -p <端口> [-l <用户>] [-i <私钥>] <地址>`，同样套用用户配置里的 `Host *` 等通用设置，与今天手填目标跑 `ssh` 的效果一致。`ssh` 按登录 shell 的 PATH 查找（沿用现有做法）；找不到时报「找不到 ssh」，与今天一样，不另设不读配置的退路。
- 用到的字段与用法：
  - `hostname`、`port`、`user`：连接目标。
  - `identityfile`（可多条）、`identitiesonly`、`identityagent`：认证用的私钥与 agent。
  - `preferredauthentications`、`pubkeyauthentication`、`passwordauthentication`、`kbdinteractiveauthentication`、`numberofpasswordprompts`、`batchmode`：认证顺序与开关。
  - `stricthostkeychecking`、`userknownhostsfile`、`globalknownhostsfile`、`hashknownhosts`、`hostkeyalias`：主机密钥核对。
  - `proxyjump`、`proxycommand`：跳板机与代理命令。
  - `bindaddress`、`bindinterface`、`addressfamily`：本机出口与地址族。
  - `serveraliveinterval`、`serveralivecountmax`、`connecttimeout`：保活与超时。
  - `kexalgorithms`、`hostkeyalgorithms`、`ciphers`、`macs`、`compression`：算法。
  - `sendenv`、`setenv`：传给服务器的环境变量。
  - `remotecommand`：**SSH Terminal** 以它代替登录 shell，同 `ssh`。
- `ssh -G` 不展开 `ProxyCommand` 里的 `%h`、`%p`、`%r`、`%n`、`%%`（实测 OpenSSH 9.9），由 DevCube 展开。`ProxyJump` 原样输出为 `[用户@]主机[:端口]` 逗号列表，每一跳再各跑一次 `ssh -G` 取它自己的配置。
- 不支持的配置项（`certificatefile`、`usekeychain`、`addkeystoagent`、`controlmaster`、`forwardagent`、`forwardx11`、各类 `forward`、`localcommand`、GSSAPI）一律忽略，不报错；只有因此连不上时，在失败原因里点明（见「报错」）。

### 连接与通道

- **一台 Server 一条共享连接**（照抄 WebStorm 的连接池）：第一个需要连接的通道触发建立，建立期间其余请求等同一次结果，只问一次；最后一个通道关闭即断开连接。每条连接至多同时 8 个通道（OpenSSH 服务端 `MaxSessions` 默认 10，WebStorm 默认 8），超出时另开一条（没记住密码会再问一次）。编辑或移除服务器即断开它的全部连接；DevCube 退出时一并结束。
- 各功能占用的通道：

| 功能                             | 通道                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| **SSH Terminal**                 | shell，分配伪终端（`xterm-256color`，随窗口调整大小）                               |
| 「在 SSH 终端中打开」            | exec 并分配伪终端：`cd '<目录>' && exec "$SHELL" -l`（同今天）                      |
| 服务器上的 **Run Configuration** | exec 并分配伪终端，命令串同今天                                                     |
| **Status Tab**                   | exec，不分配伪终端：`sh -c '<脚本>'`，每 2 秒往标准输入写换行（同今天）             |
| **Files Tab**                    | 两个 SFTP 通道：浏览（列目录、查信息、读写文本、打开预览）与传输（上传 / 下载队列） |
| 测试连接                         | 单独的临时连接，只认证不开通道，结束即断，不进连接池                                |

- 各 Tab 的「断开连接」只关自己的通道；这台服务器的连接还有别的通道在用就保留。连接意外断开时，它上面的所有通道同时以同一个原因结束，各 Tab 显示断开状态，各自重连。
- **SSH Terminal** 的会话由 runner 管理，今天是本机 PTY 里的 `ssh` 进程；改为在 shell 通道之上实现 runner 需要的那几样：写入、调整大小、结束、输出、退出。无头屏幕缓冲与输出管线不变。连接前服务器发来的欢迎横幅（banner）写进触发这次连接的终端。结束行：通道正常退出为「连接已断开，退出代码为 N，按回车重新连接」（同今天）；连接断开为「连接已断开：<原因>，按回车重新连接」。
- 保活：`ServerAliveInterval` 有值用它，否则 15 秒、3 次无应答即断开，与今天状态、文件连接的参数一致。超时：`ConnectTimeout` 有值用它，否则 15 秒。

### 认证

- 顺序取 `PreferredAuthentications`（OpenSSH 默认为 gssapi-with-mic、hostbased、publickey、keyboard-interactive、password；GSSAPI 与 hostbased 跳过），再按 `*Authentication` 开关去掉关闭的；服务器返回「部分成功」时按剩下的方法继续（多步认证）。
- publickey：先试 agent 里的密钥（`IdentitiesOnly yes` 时只试与 `IdentityFile` 对应的那些），再试存在的 `IdentityFile`。读不了的类型（`sk-` 硬件密钥、xmss 等）跳过，与 OpenSSH 跳过不存在的文件一样。私钥有口令时弹窗询问，显示文件路径，可以勾选记住（按私钥的绝对路径加密存放）；记住的口令不对时重新问。
- agent：`IdentityAgent none` 不用；指定了路径用它；否则用登录 shell 环境里的 `SSH_AUTH_SOCK`；Windows 上都没有时用 OpenSSH 的命名管道 `\\.\pipe\openssh-ssh-agent`。WebStorm 另支持 Pageant，它何时改用 Pageant 从安装包里看不出（代码经过混淆），实施时实测后再定。
- password：记住的密码每次连接只自动用一次，被拒后弹窗（沿用今天的规则与「记住密码」勾选逻辑）；最多问 `NumberOfPasswordPrompts` 次（默认 3）。
- keyboard-interactive：服务器只问一项、不回显、提问里含 password / 密码时，当作密码处理（可自动用记住的密码）；其余提问（验证码等）弹窗，原样显示服务器给的标题、说明与各项提问，按各项是否回显决定输入框是否遮挡。
- `BatchMode yes` 时不弹任何提问，需要提问即以认证失败结束。
- 测试连接：规则同今天。表单里填了密码就只用它答一次，不向用户弹密码框；主机指纹、私钥口令、交互式提问照常弹窗；测试本身不记住密码与口令。

### 主机密钥核对

- 读 `UserKnownHostsFile` 与 `GlobalKnownHostsFile` 列出的全部文件（今天的 OpenSSH 默认为 `~/.ssh/known_hosts`、`~/.ssh/known_hosts2`、`/etc/ssh/ssh_known_hosts`、`/etc/ssh/ssh_known_hosts2`），与终端里的 `ssh` 共用。
- 核对用的名字：有 `HostKeyAlias` 用它，否则用 `hostname`；端口不是 22 时写成 `[名字]:端口`。条目支持明文、逗号分隔、`*` / `?` 通配、`!` 取反、哈希（`|1|盐|HMAC-SHA1`）；`@revoked` 标记的密钥一律拒绝；`@cert-authority` 忽略（不支持主机证书）。
- 结果与处理：同 OpenSSH 的语义，只在询问档（默认）照 WebStorm 多给一个「更新并连接」：

| StrictHostKeyChecking | 未知                 | 已更改                                                   |
| --------------------- | -------------------- | -------------------------------------------------------- |
| ask（默认）           | 弹窗确认，确认后写入 | 警告弹窗，可选「更新并连接」（OpenSSH 此时直接拒绝）     |
| accept-new            | 直接写入             | 拒绝连接                                                 |
| yes                   | 拒绝连接             | 拒绝连接                                                 |
| no / off              | 直接写入             | 照样连接，不改记录；同 OpenSSH，这次不用密码与交互式认证 |

- 写入：追加到第一个 `UserKnownHostsFile`（目录与文件不存在时创建，权限 700 / 600）；`HashKnownHosts yes` 时写哈希条目。更新：删掉该名字、该类型的旧条目后写入新条目。
- 指纹显示同 OpenSSH：`SHA256:` 加上不带填充的 Base64，附密钥类型。

### 跳板机、代理命令与直连

- `ProxyJump`：逐跳建立，后一跳经前一跳的转发通道连接；每一跳各自按它的 `ssh -G` 结果认证、核对主机密钥，弹窗里写明是哪一跳。
- `ProxyCommand`：同 OpenSSH，用用户的 shell 以 `exec` 执行（posix 为 `$SHELL -c 'exec <命令>'`，环境取登录 shell 的），以它的标准输入输出作为连接；Windows 版 OpenSSH 的执行方式实施时核实后照做。
- 绕开代理直连（ADR-0039）：建立连接时绑定实体网卡的地址（`localAddress`）；目标是域名时照今天的做法查出真实地址后连该地址，主机密钥仍按原主机名核对。有 `ProxyJump` 或 `ProxyCommand` 时不插手（同今天）。用户配置了 `BindAddress` 时绑定该地址；配置了 `BindInterface` 时取该网卡的 IPv4 地址绑定。

### 算法与环境变量

- 算法：用 `ssh -G` 给出的各类列表与 `ssh2` 支持的列表取交集，保持用户配置的顺序。交集为空时连接失败，原因写明是哪一类算法。抗量子密钥交换（`sntrup761`、`mlkem768`）`ssh2` 不支持，交集里自然没有，退到 curve25519。
- 环境变量：`SendEnv` 的模式与登录 shell 环境里的变量匹配，匹配上的随 shell / exec 通道发送；`SetEnv` 的键值照发。服务器按自己的 `AcceptEnv` 取舍，与 `ssh` 相同。

### 提问弹窗

- 取代 askpass 弹窗，仍排在同一处、同一时刻只显示一个。标题「SSH：正在连接到 <用户>@<主机>」（经跳板机时写明是哪一跳）。
- 文案照抄 WebStorm 的中文版：
  - 主机未知：「无法确定主机 '<主机>' 的真实性。<类型> 密钥指纹为 <指纹>。确定要继续连接吗？」，按钮「连接」「取消」。
  - 主机已更改：「警告：远程主机标识已更改！可能有人在做坏事！此刻可能有人在偷听您（中间人攻击）！也可能是主机密钥刚被更改。远程主机发送的 <类型> 密钥的指纹为 <指纹>。是否要更新 <known_hosts 文件> 中的密钥并恢复连接？」，按钮「更新并连接」（危险样式）、「取消」。
  - 密码：「密码：」加「记住密码」（沿用今天）。
  - 私钥口令：「文件的私钥口令：<路径>」加「记住口令」。
  - 交互式提问：显示服务器给的标题与说明，每项提问一个输入框。
- 记住的密码被拒后重问时，沿用今天的提示与勾选规则。

### 报错

连接失败的原因按类型给中文，与 WebStorm 一样前缀「无法连接到 <主机>：」：

| 情形               | 原因                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| 连接被拒绝         | 连接被拒绝                                                                                      |
| 连接或握手超时     | 连接超时                                                                                        |
| 域名解析失败       | 找不到主机                                                                                      |
| 网络不可达         | 网络不可达                                                                                      |
| 连接被重置         | 连接被服务器重置                                                                                |
| 保活无应答         | 服务器无响应                                                                                    |
| 所有认证方式都失败 | 认证失败；若只有不支持的密钥类型（`sk-`、证书）可用，补一句「DevCube 不支持硬件密钥与证书登录」 |
| 主机密钥被拒       | 主机密钥核对失败                                                                                |
| 算法交集为空       | 与服务器没有共同支持的<类别>算法                                                                |
| 其他               | 原文                                                                                            |

### 文件（Files Tab）

- 改用 `ssh2` 的 SFTP，删除自写的 SFTP 客户端与在途窗口的自适应调节（ADR-0040）。两个通道都照 WebStorm：出错或被关后，下次使用时自动重开。
- 浏览通道：列目录、查信息、新建、重命名、删除、读写文本、打开时的下载。传输通道：上传 / 下载队列。上传下载进行时，浏览与打开照常。
- 读写按块并发，同时在途固定 8 块、每块 32 KB（共 256 KB）：慢线路上取消或切走后只需等这 256 KB 传完；快线路上单个文件的速度上限约为 256 KB ÷ 往返时间。取消即停止发新请求，已发出的回复收到后丢弃。
- 其余行为（副本、刷新、保存、冲突、同名询问等）不变，见 `server-files.md`。

### 删除与保留

- 删除：askpass 小助手（第二个主进程入口、启动脚本、本地套接字、RunAsNode 依赖）；终端、状态、文件、测试连接四处拼 `ssh` 参数的代码；自写的 SFTP 客户端与报文编解码。
- 保留：在登录 shell 的 PATH 里找 `ssh`；`ssh -G` 的输出解析；从 `~/.ssh/config` 列出可添加的主机（`ssh-config` 库加自行展开 `Include`）；直连查实体网卡与 DNS 的部分；记住密码的加密存放。
- 依赖：`ssh2`（`asn1`、`bcrypt-pbkdf`）；它可选的原生加速模块不是必需，打包时不强求。

### 分步实施

每一步都能单独发布；未改到的功能继续走系统 `ssh`。

1. 连接层：`ssh -G` 到连接参数的换算、认证、主机密钥核对、跳板机与代理命令、直连、保活、连接池、提问弹窗与报错；先接到「测试连接」。
2. **Status Tab** 改到 exec 通道。
3. **Files Tab** 改到两个 SFTP 通道，删除自写客户端。
4. **SSH Terminal** 与服务器上的 **Run Configuration** 改到 shell / exec 通道，删除 askpass。
5. 收尾：ADR-0038、ADR-0040 标为被 ADR-0041 取代，更新 ADR-0039 的机制描述；CONTEXT.md 改写 **Server** 相关条目（新增「一台 Server 一条共享连接」的术语，改掉「状态连接、文件连接独立于 SSH Terminal」）；DESIGN.md 写入新的提问弹窗；`ssh-server.md`、`server-status.md`、`server-files.md` 的连接部分改为引用本文。

## Testing Decisions

沿用项目约定：只测纯函数，零 mock。

- `ssh -G` 输出到连接参数的换算：各字段、缺省值、手填目标的参数、不支持项被忽略。
- `ProxyJump` 列表解析；`ProxyCommand` 的 `%h` / `%p` / `%r` / `%n` / `%%` 展开。
- known_hosts：明文、逗号列表、通配、取反、哈希条目的匹配；`[主机]:端口`；`@revoked` 拒绝、`@cert-authority` 忽略；同主机多种密钥类型；写入行的格式（哈希与不哈希）；更新时删掉的旧条目。
- StrictHostKeyChecking 与核对结果的决策表（含 no / off 时禁用密码与交互式认证）；SHA256 指纹格式。
- 认证顺序：`PreferredAuthentications` 与各开关；`IdentitiesOnly` 对 agent 密钥的筛选；跳过不支持的密钥类型；keyboard-interactive 的「当作密码」判断；`NumberOfPasswordPrompts`；`BatchMode`。
- `SendEnv` 模式匹配；算法取交集与空交集的原因。
- 报错文案的归类。
- 连接池的通道计数：满 8 个另开一条、最后一个通道关闭即断开。

实测清单（实施时逐项记录）：密码登录；无口令私钥；有口令私钥（含记住与记错后重问）；macOS 钥匙串里的 agent；Windows 的 OpenSSH agent 与 Pageant；`ProxyJump` 两跳；`ProxyCommand`；哈希的 known_hosts；主机密钥变更；验证码 / 多步认证；开着 TUN 代理的直连；服务器 `MaxSessions` 的上限；Windows 10 / 11 自带 OpenSSH 的 `ssh -G`。

## Out of Scope

- 硬件密钥（`sk-` 类型）、证书登录（`CertificateFile`、主机证书）、GSSAPI / Kerberos：`ssh2` 不支持。
- macOS `UseKeychain` 取私钥口令：改由 DevCube 问一次并可记住。
- `ControlMaster`、端口转发、`ForwardAgent`、X11、`LocalCommand`。
- WebStorm 的 HTTP / SOCKS 代理设置、连接级的 StrictHostKeyChecking 与 HashKnownHosts 选项：一律以 ssh 配置为准。
- 系统没有 `ssh` 时自己解析配置（WebStorm 的旧版解析器）。
- 「保存到重启」这一档记住方式。
- 管理记住的私钥口令的界面。

## Further Notes

- 取舍见 ADR-0041（提案中）；实施后取代 ADR-0038、ADR-0040，更新 ADR-0039 的机制。
- 调研记录（2026-09-29）：
  - WebStorm 2026.1 安装包：连接库为 sshj；「高级设置 → SSH → 配置文件解析器」默认 OpenSSH，官方说明为「使用 'ssh -G' 命令解析配置文件，系统中必须已安装 OpenSSH」；注册表 `ssh.use.openssh.config` 默认开；`ssh.max.concurrent.channel.creations.per.session` 默认 8；known_hosts 用 sshj 的 `OpenSSHKnownHosts`，按 `HashKnownHosts` 写入；另有 Windows 命名管道 agent、MSYS2 套接字、Pageant、代理命令、跳板机、Kerberos、sudo 运行 SFTP 等实现。
  - `ssh2` 1.17.0（2025-08）：连接参数有 `localAddress`、`sock`、异步 `hostVerifier`、`authHandler`（可按剩余方法与部分成功决定下一步）、`keepaliveInterval` / `keepaliveCountMax`、`readyTimeout`、`agent`（Unix 套接字、Windows 命名管道、`pageant`）；SFTP 的 `fastGet` / `fastPut` 可设并发与块大小；私钥支持 OpenSSH、PEM、PuTTY 格式；算法里没有抗量子密钥交换、证书与 `sk-` 类型；不读 `~/.ssh/config`。
  - 本机 OpenSSH 9.9：`man ssh_config` 的 `StrictHostKeyChecking`（ask / accept-new / yes 遇到已更改一律拒绝，no / off 放行但有限制）、`PreferredAuthentications` 默认值、`ProxyCommand` 用用户的 shell 以 `exec` 执行、令牌为 `%%` `%h` `%n` `%p` `%r`；`ssh -G` 不展开 `ProxyCommand` 的令牌；手填目标用 `-p` / `-l` / `-i` 可得完整生效配置（不存在的 `-i` 文件被略过并警告）；`ProxyJump` 原样输出。
- VS Code Remote-SSH 与 Zed 用系统 `ssh`，并在服务器上装自己的服务端程序读写文件（VS Code 支持拖入上传与右键下载）；DevCube 不往服务器上装程序，不走这条路。
