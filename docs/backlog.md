# 待办与结论（临时）

头脑风暴结论暂存。每做完一项，删掉对应条目并把结论落到 PRD / ADR / CONTEXT.md；全部做完后删除本文件。

## 产品方向

- DevCube 在保持轻量的前提下，尽量覆盖日常开发场景，替代更多第三方软件，或做得比它们更好。
- 不往重型 IDE 走；不依赖自建服务器或第三方中转。
- 只替代第三方软件，或系统自带但不好用的功能；系统自带且够用的不做。

## 待做

顺序：SSH 终端第一个做，其余待定。

### SSH 终端

- 替代 FinalShell / Termius / Xshell。
- 已实现，待验收：见 `docs/prd/ssh-server.md`；术语见 CONTEXT.md（**Server**、**SSH Terminal**）。
- 「绕开代理直连」：已实现，待验收（ADR-0039，PRD 用户故事 23–25）。待实测：Windows（含 mihomo / sing-box 开 `strict-route`、物理网卡被 Hyper-V 外部交换机桥接）；macOS 上基于 NetworkExtension 的代理（Surge、Stash 等）。
- 连接方式改为内置实现、配置仍由系统 OpenSSH 解析（参照 WebStorm）：已实现，待验收，见 `docs/prd/ssh-connection.md`、ADR-0041；实测清单见该 PRD。Windows 待实测：`ProxyCommand` 的执行方式（暂经 cmd）、是否启用 Pageant。
- 「无项目」做好后，里面同样保留「连接到服务器」这个快捷入口。

### 远程文件管理

- 替代 WinSCP。
- 已实现，待验收：见 `docs/prd/server-files.md`、ADR-0041；术语见 CONTEXT.md（**Files Tab**）；Windows 待实测。

### 服务器状态面板

- 已实现，待验收：见 `docs/prd/server-status.md`；术语见 CONTEXT.md（**Status Tab**）。
- 以后再加：Docker 容器。
- 下一步：装了 sysstat 的服务器，读它的记录（用它自带的 `sadf` 取固定格式）做「按天看」的历史图，比如「今天 / 最近 24 小时」；没装就不显示入口。sysstat 默认每 10 分钟记一次，填不满 5 分钟的实时曲线，所以是另一块图。
- 看服务器日志：目前靠 SSH 终端里敲命令，或给服务器新建配置（如 `tail -f 日志文件`）；远程文件管理做好后，5 MB 以内的日志文件可直接打开。

### 无项目

- 左树里的一个特殊条目，名字就叫「无项目」，默认工作目录是 `~`。
- 它不是真正的 **Project**：不对 `~` 做递归监听，也不建全量文件索引。
- 包含：常驻「工具箱」Tab、**Terminal**（默认在 `~`）、SSH 终端、命令型 **Run Configuration**（放 `brew upgrade` 这类全局命令）。
- 不包含：**Git Tab**、**Files Tab**。
- 显示：排序菜单里加一个「显示无项目」开关；开启时固定显示在最上面、不参与排序，关闭时隐藏。
- 待确认：这个开关是否并入排序菜单的类型勾选（项目 / 服务器 / 数据源），成为同一组的第四项。
- 需要在 CONTEXT.md 新增术语，并为「**Project** 恒有 **Git Tab** / **Files Tab**」这条开例外；考虑写一篇 ADR。

### 工具箱

- 替代 DevUtils 和各类在线小工具网站；全部在本机处理。
- 作为「无项目」的常驻 Tab：左侧是工具列表，右侧是内容。
- 首批候选：JSON 格式化、Base64、URL 编解码、时间戳转换、JWT 解析、正则测试、二维码生成。
- 不在顶栏放「工具」按钮。

### 压缩

- 替代 Finder 自带的压缩。
- 入口：**Files Tab** 文件树右键「压缩」；Finder 右键「用 DevCube 压缩」（沿用现有的快速操作机制）。
- zip 按被压缩的文件夹或文件命名，不再叫「归档.zip」；去掉 `__MACOSX`、`.DS_Store` 等 macOS 专属文件。
- 可选：排除 `node_modules` 和 .gitignore 忽略的内容。
- 待定：Finder 里多选压缩时 zip 叫什么名字；**Files Tab** 文件树目前不支持多选。

### 对比

- 替代 Beyond Compare / Kaleidoscope。本轮不做，交互以后专门讨论。
- 已有的想法：**Files Tab**（含 **Preview Window**）右键「与剪贴板比较」和「选为比较对象 → 与已选文件比较」，可以跨项目比较，结果显示在 **Files Tab** 正文区，复用 Git 的 diff 组件；工具箱里放一个「文本对比」；文件夹对比暂不考虑。

### 数据库

- 替代 WebStorm 的数据库插件。
- 「看 + 查询」、数据源上的运行配置与按上下文的 SQL 补全：已实现，待验收，见 `docs/prd/database.md`、ADR-0042 至 ADR-0047；术语见 CONTEXT.md（**Data Source**、**Data Source Tab**、**Console Context**）。
- 以后再加：在表格里直接改数据（改动先标色，提交前预览 SQL，整批提交）；改表结构（建表、改列、索引、外键）；经由服务器的 SSH 隧道连接（届时让 **Data Source** 引用一台已登记的 **Server**）；添加 **Data Source** 时从项目里导入连接串（如 `.env` 里的 `DATABASE_URL`）。
- 以后再加（这一轮明确推迟）：ORDER BY 的叠加排序（按住 Alt 点表头追加一列）与 WHERE / ORDER BY 的输入历史；表格里 JSON 值的「查看值」面板（同 Redis 字符串值那样排版显示）；运行配置的定时运行（参数要由界面问、语句要由界面切好交给主进程，见 ADR-0044）；从控制台存为配置；**Run Session**「在左树中显示」（定位到左树里它的配置）；项目里的 **Data Source Tab** 跳到左树里对应的数据源；控制台里按光标所在的表名定位到目录。
- 以后再补：Redis 键名含非 UTF-8 字节时的端到端支持。现在列键、看键都把键名当 UTF-8 文字处理，这样的键名解码后已不是原来的键；要按原始字节取回、显示与操作（列键、看键、复制键名、最近打开），显示参照 RedisInsight 的二进制键名显示。
- 以后再补：SQLite 查询真正立刻中断。`better-sqlite3` 没有 `sqlite3_interrupt`，取消、停止、断开时正在做的一步原生调用要做完才停（见 `docs/prd/database.md`「已知的边界情况」）。可选做法：查询放进 Electron 的 `utilityProcess` 子进程，取消即结束进程；或给 `better-sqlite3` 打补丁，接上 `sqlite3_interrupt`。

## 不做

- 解压：系统自带的已经够用，唯一的缺口是 rar。
- 手机端：Electron 不支持移动端；不用服务器的话，只能在同一局域网内使用。
- 需要服务器的功能：一键分享本地服务、手机远程控制、推送通知。
- 「项目管家」方向：工作日记、便利贴、磁盘清理、项目归档、换电脑搬家。

## 未表态

- 图片压缩与转格式（替代 ImageOptim / TinyPNG）
- 代码片段库（替代 massCode / SnippetsLab）
- HTTP 请求（替代 Postman / Apifox）
- Hosts 切换（替代 SwitchHosts）
- 大日志查看（替代 Console.app / lnav）
