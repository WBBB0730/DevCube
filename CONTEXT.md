# DevCube

一个以项目为维度的通用运行器：在单个面板里聚合多个项目，浏览并运行它们的命令、查看输出。它把 WebStorm 右上角的"运行配置 + 运行按钮 + 控制台"从"一窗口一项目"搬到"单面板、多项目并列"的桌面工具里。

## Language

**Project（项目）**：被登记进运行器的一个本地文件夹，是聚合面板里的一个顶层条目，拥有属于自己的 Discovered Script 与 Run Configuration。
_Avoid_: Workspace, Repo, Folder

**Pin（置顶）**：附着在 **Project** 上的持久布尔标记。已置顶的 Project 在左树中整段排在未置顶的 Project 之上（组内仍服从当前排序）；滚动左树时，所有已置顶的**项目行**依次叠在列表顶部保持可见（行间留 1px 间隙），配置行照常滚走。未置顶项目滚过时，其**项目行**作为当前段贴在置顶堆下方，被下一段顶走。
_Avoid_: Favorite, Star, 收藏, Bookmark

**Discovered Script（探测脚本）**：从项目 `package.json` 的 `scripts` 实时派生出来的候补——随文件变化自动增删、只读、尚未被选中或运行过。被选中或运行一次即"晋升"为 Run Configuration，并从候补区消失。
_Avoid_: Task, NPM task, Script（裸用）, 可运行项

**Run Configuration（运行配置）**：用户"拥有"的、已保存的可运行配置，分两种：

- **引用型（Referenced）**：由 Discovered Script 首次选中或运行"晋升"而来，纯粹引用 `(Project, script 名)`，运行时从 `package.json` 解析命令、随其同步。**完全不可自定义**——名字即 script 名，没有自定义命令 / cwd / 环境变量，只能运行、停止、重跑、删除。所引用的 script 从 `package.json` 消失时**直接删除**（不存在用户手工内容会丢失）。
- **命令型（Command）**：用户拥有的一条独立命令（命令行 + 工作目录 + 环境变量），完全可自定义、独立持久化、不随任何 script 变化、也不会被自动删除。要给某个 script 加环境变量 / 改 cwd / 改命令，就新建一条命令型配置——它不引用、也不同步任何 script。

_Avoid_: Task, Profile, Preset

**Run Session（运行会话）**：某条 Run Configuration 的一次"活的执行"，拥有自己的进程、输出、状态（运行中 / 已退出 / 失败）与控制（停止、重跑）。一条配置**单实例**：同时最多只有一个活跃的 Run Session；对运行中的配置再次"运行"即"重新运行"（先停旧进程再起新的）。
_Avoid_: Run, Process, Instance, Job

**Terminal（终端）**：项目下的一个自由交互 shell 会话——在项目根目录起一个 `$SHELL`，可随意敲命令，**不绑定任何 Run Configuration / Discovered Script**。壳（稳定身份、显示名、在项目 Tab 栏中的顺序）可按项目持久化；**进程与输出不持久化**——重启后需再次拉起空 shell，历史输出不恢复。shell 进程结束即销毁其活会话并关闭对应 Tab。与 **Run Session** 并列但语义不同：Run Session 是"某条配置的一次执行"，Terminal 是"项目下的一个自由 shell"。一个项目可同时拥有任意多个 Terminal。
_Avoid_: Shell（裸用）, 控制台

**Git Tab（Git 标签页）**：项目的 Git 图谱视图——展示该项目仓库的提交历史图、引用与详情，并可从中执行 git 操作。每项目**恒有一个**、常驻 Tab 栏最前、不可关闭；它不是会话（无进程、无输出流），是 Tab 模型中的非会话 Tab 之一。项目不是 git 仓库时显示兜底提示与初始化仓库入口；仓库状态（是否仓库 / 仓库根）随文件系统变化自动跟进，不需要重新添加项目。
_Avoid_: Git 面板, 图谱 Tab, 仓库视图

**Files Tab（文件标签页）**：项目的文件浏览与编辑视图——展示该项目根下文件系统可见的**全部**条目（不按 `.gitignore` 等忽略规则过滤）。已展开的文件树与当前打开条目随磁盘变化自动跟进。打开条目时按类型分流：文本进编辑器；图片内嵌预览；Chromium 可播的音视频内嵌预览；其余只读占位并可以系统应用打开。同一时刻**至多打开一个条目**（点树即切换，无内层多文件 Tab）。正文在左、文件树在右。**不做**文件管理（无新建 / 重命名 / 删除 / 复制 / 移动）——那些仍走系统文件管理器或 **Terminal**。每项目**恒有一个**、常驻 Tab 栏**第二位**（紧接 **Git Tab** 之后、会话 Tab 之前）、不可关闭；它不是会话（无进程、无输出流），是 Tab 模型中的非会话 Tab 之一（与 **Git Tab** 同类）。
_Avoid_: Editor Tab, Code Tab, 文件面板, 编辑器 Tab, Workspace

**未提交更改行（未提交更改）**：Git 图谱最上方一条合成的虚拟行，代表工作区相对 HEAD 的改动（HEAD 未出生的空仓库相对空树；仅有改动时才出现）。HEAD 未出生时它不锚定任何提交，承担首次提交的入口。选中它，其详情面板即该项目的**提交入口**——按「已暂存 / 未暂存」两段管理文件、勾选即暂存、并从中提交（支持修正、提交并推送）。
_Avoid_: 工作区行, WIP 行, 暂存行

**Release Edition（发行身份）**：正式版或 Beta 二者之一，决定一次安装的系统身份（与另一身份可并行、数据隔离、显示名可辨），并由 semver 派生——无 prerelease 为正式版，仅 `-beta` / `-beta.N` 为 Beta。应用内更新只跟随**同一发行身份**的 GitHub Release，不跨线。
_Avoid_: Channel（裸用）, Track, Flavor, Variant, 通道（指安装身份时）

### Flagged ambiguities

- **「置顶」一词两义**：口语/ DESIGN 里曾用「置顶」形容「新项目在某种排序下落到列表最前」——那是排序结果，不是 **Pin**。域语言里 **Pin / 置顶** 专指上述持久布尔标记。

### 关系

- 一个 **Project** 拥有 0..1 个 **Pin** 状态（已置顶 / 未置顶）。左树展示时已置顶与未置顶各成一个区块：置顶区块整体在上，区块内顺序由当前项目排序决定；自定义序下两区块边界密封（拖拽不可跨界改 Pin）。置顶时进入置顶区块**开头**，取消置顶时进入未置顶区块**开头**（自定义序落盘如此；其他排序模式的展示序仍由该模式决定）。滚动时所有已置顶的**项目行**在列表顶依次叠放保持可见（行间 1px），配置行不吸顶；未置顶的**项目行**滚过时贴在置顶堆下作为当前段，被下一段顶走。
- 一个 **Project** 拥有 0..N 个 **Discovered Script**（实时派生）和 0..N 个 **Run Configuration**（已保存）。
- 选中或运行一个 **Discovered Script** 都会把它**晋升**为一条**引用型 Run Configuration**（不必等运行）；按 `(Project, script 名)` 去重，晋升后候补区不再显示它。
- **引用型**配置所引用的 script 若从 `package.json` 消失 → 该配置**自动删除**；script 改名视作"删旧出新"（旧配置删除，新名字作为全新 Discovered Script 候补重新出现）。
- 一切自定义只落在**命令型**配置上；**引用型**不承载任何自定义，因而其自动删除永不丢失用户内容。
- 一条 **Run Configuration** 至多对应一个活跃的 **Run Session**；不同配置的 Run Session 可并发存在。
- 一个 **Project** 拥有 0..N 个 **Terminal**（cwd 为项目根、不绑定任何 Run Configuration；活 shell 随退出而销毁；壳可跨重启按项目恢复）。
- **Terminal** 与 **Run Session** 都是"活的会话"，但 Terminal 不由任何配置派生、彼此独立——不做单实例去重，同一项目可并存任意多个。
- 一个 **Project** 恒有一个 **Git Tab**（非会话、不可关闭、常驻其 Tab 栏最前）；它与 **Files Tab** / Run Session / Terminal 的 Tab 共用激活与循环规则。
- 一个 **Project** 恒有一个 **Files Tab**（非会话、不可关闭、常驻其 Tab 栏第二位，紧接 Git Tab）；它与 Git Tab / Run Session / Terminal 的 Tab 共用激活与循环规则。一个 Files Tab 同一时刻至多打开一个条目。
- 从 **Git Tab**「打开文件」进入该项目的 **Files Tab** 并打开对应路径；Files Tab 另提供「在其他应用中打开」（系统默认应用）。
- 工作台按项目记住激活 Tab，并全局记住当前 **Project** 与左树选中；合法记忆优先于默认激活。**默认激活 Tab**（无合法记忆 / 首次解析）：若有运行中的 **Run Session**，取 Tab 栏从左到右第一个运行中的；否则按 Tab 栏顺序（常驻下即落在 **Git Tab**）。**关闭**激活 Tab 仍回落左邻，其次右邻（不套用上述默认规则）。**Run Session** Tab 不随工作台落盘跨冷启动恢复。
- 一个 **Git Tab** 的图谱含 0..1 个 **未提交更改行**（工作区有改动才合成）；它是该项目在 DevCube 内的提交入口。
- 一次安装恰好属于一个 **Release Edition**；正式版只消费非 Pre-release 的 GitHub Release，Beta 只消费 Pre-release 的 GitHub Release，二者不互相升级。

## Example dialogue

> **开发者**：我把 `~/code/web` 加进来了，它下面出来一堆东西。
> **领域专家**：那些是 **Discovered Script**——直接从它 `package.json` 的 scripts 实时读出来的候补，你还没选中或跑过，所以是只读的。
> **开发者**：我在候补菜单里点了 `dev`。
> **领域专家**：一选中它就**晋升**成一条 **Run Configuration** 了，不必等运行——进了"我的配置"，候补区里不再重复显示。它仍然引用 `package.json` 里的 `dev`，你哪天改了 script，它下次跟着变。
> **开发者**：那我再手写一条 `docker compose up` 呢？
> **领域专家**：那是第二种 **Run Configuration**——一条不依赖任何 script 的独立命令。
> **开发者**：我想在这个项目里随手跑几条 `git`、`ls`，不想每次都建配置。
> **领域专家**：那就在它下面开个 **Terminal**——项目根目录里的一个自由 shell，跟任何配置都无关，想开几个开几个。关掉或 shell 自己退出，Tab 就没了；重启后仍会按你留下的名字和顺序把壳找回来，但里面是新的空 shell，上次输出不保留。它不是 **Run Session**，别混为一谈。
> **开发者**：`web` 我天天用，想让它永远在列表最上面，哪怕按名称排序。
> **领域专家**：给它打上 **Pin**——已置顶的项目整段浮在未置顶之上；组内仍按你选的排序排。往下滚时，置顶项目的名字行会叠在列表顶上不走（中间留一条细缝），配置行照常滚；滚到未置顶项目时，它的名字行会贴在置顶堆下面，直到被下一个项目顶走。这和「新加的项目碰巧排到最前」不是一回事。
> **开发者**：我想改一下 `src/app.ts`，又不想离开这个面板去开 WebStorm。
> **领域专家**：切到它的 **Files Tab**——和 **Git Tab** 一样常驻、不可关，排在 Git 后面。右边是项目根下的完整文件树，左边一次只开一个文件；从 Git 图谱里「打开文件」也会进这里。新建删除还是去 Finder 或 **Terminal**，这儿不做文件管理。
> **开发者**：我同时装着 DevCube 和 DevCube Beta，应用内更新会不会把 Beta 升成正式版？
> **领域专家**：不会。各自是不同的 **Release Edition**——正式版只跟正式 Release，Beta 只跟 Pre-release，数据目录也分开，更新不跨线。
