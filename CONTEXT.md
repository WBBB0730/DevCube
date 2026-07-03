# Runlet

一个以项目为维度的通用运行器：在单个面板里聚合多个项目，浏览并运行它们的命令、查看输出。它把 WebStorm 右上角的"运行配置 + 运行按钮 + 控制台"从"一窗口一项目"搬到"单面板、多项目并列"的桌面工具里。

## Language

**Project（项目）**：被登记进运行器的一个本地文件夹，是聚合面板里的一个顶层条目，拥有属于自己的 Discovered Script 与 Run Configuration。
_Avoid_: Workspace, Repo, Folder

**Discovered Script（探测脚本）**：从项目 `package.json` 的 `scripts` 实时派生出来的候补可运行项——随文件变化自动增删、只读、尚未被选中或运行过。被选中或运行一次即"晋升"为 Run Configuration，并从候补区消失。
_Avoid_: Task, NPM task, Script（裸用）

**Run Configuration（运行配置）**：用户"拥有"的、已保存的可运行项，分两种：

- **引用型（Referenced）**：由 Discovered Script 首次选中或运行"晋升"而来，纯粹引用 `(Project, script 名)`，运行时从 `package.json` 解析命令、随其同步。**完全不可自定义**——名字即 script 名，没有自定义命令 / cwd / 环境变量，只能运行、停止、重跑、删除。所引用的 script 从 `package.json` 消失时**直接删除**（不存在用户手工内容会丢失）。
- **命令型（Command）**：用户拥有的一条独立命令（命令行 + 工作目录 + 环境变量），完全可自定义、独立持久化、不随任何 script 变化、也不会被自动删除。要给某个 script 加环境变量 / 改 cwd / 改命令，就新建一条命令型配置——它不引用、也不同步任何 script。

_Avoid_: Task, Profile, Preset

**Run Session（运行会话）**：某条 Run Configuration 的一次"活的执行"，拥有自己的进程、输出、状态（运行中 / 已退出 / 失败）与控制（停止、重跑）。一条配置**单实例**：同时最多只有一个活跃的 Run Session；对运行中的配置再次"运行"即"重新运行"（先停旧进程再起新的）。
_Avoid_: Run, Process, Instance, Job

**Terminal（终端）**：项目下的一个自由交互 shell 会话——在项目根目录起一个 `$SHELL`，可随意敲命令，**不绑定任何 Run Configuration / Discovered Script**。纯内存、不持久化；shell 进程结束即销毁。与 **Run Session** 并列但语义不同：Run Session 是"某条配置的一次执行"，Terminal 是"项目下的一个自由 shell"。一个项目可同时拥有任意多个 Terminal。
_Avoid_: Shell（裸用）, 控制台

**Git Tab（Git 标签页）**：项目的 Git 图谱视图——展示该项目仓库的提交历史图、引用与详情，并可从中执行 git 操作。每项目**恒有一个**、常驻 Tab 栏最前、不可关闭；它不是会话（无进程、无输出流），是 Tab 模型中唯一的非会话 Tab。项目不是 git 仓库时显示兜底提示。
_Avoid_: Git 面板, 图谱 Tab, 仓库视图

### 关系

- 一个 **Project** 拥有 0..N 个 **Discovered Script**（实时派生）和 0..N 个 **Run Configuration**（已保存）。
- 选中或运行一个 **Discovered Script** 都会把它**晋升**为一条**引用型 Run Configuration**（不必等运行）；按 `(Project, script 名)` 去重，晋升后候补区不再显示它。
- **引用型**配置所引用的 script 若从 `package.json` 消失 → 该配置**自动删除**；script 改名视作"删旧出新"（旧配置删除，新名字作为全新 Discovered Script 候补重新出现）。
- 一切自定义只落在**命令型**配置上；**引用型**不承载任何自定义，因而其自动删除永不丢失用户内容。
- 一条 **Run Configuration** 至多对应一个活跃的 **Run Session**；不同配置的 Run Session 可并发存在。
- 一个 **Project** 拥有 0..N 个 **Terminal**（cwd 为项目根、不绑定任何 Run Configuration、随其 shell 退出而销毁）。
- **Terminal** 与 **Run Session** 都是"活的会话"，但 Terminal 不由任何配置派生、彼此独立——不做单实例去重，同一项目可并存任意多个。
- 一个 **Project** 恒有一个 **Git Tab**（非会话、不可关闭、常驻其 Tab 栏最前）；它与 Run Session / Terminal 的 Tab 共用激活与循环规则。

## Example dialogue

> **开发者**：我把 `~/code/web` 加进来了，它下面出来一堆东西。
> **领域专家**：那些是 **Discovered Script**——直接从它 `package.json` 的 scripts 实时读出来的候补，你还没选中或跑过，所以是只读的。
> **开发者**：我在候补菜单里点了 `dev`。
> **领域专家**：一选中它就**晋升**成一条 **Run Configuration** 了，不必等运行——进了"我的配置"，候补区里不再重复显示。它仍然引用 `package.json` 里的 `dev`，你哪天改了 script，它下次跟着变。
> **开发者**：那我再手写一条 `docker compose up` 呢？
> **领域专家**：那是第二种 **Run Configuration**——一条不依赖任何 script 的独立命令。
> **开发者**：我想在这个项目里随手跑几条 `git`、`ls`，不想每次都建配置。
> **领域专家**：那就在它下面开个 **Terminal**——项目根目录里的一个自由 shell，跟任何配置都无关，想开几个开几个，关掉就没了（不持久化）。它不是 **Run Session**，别混为一谈。
