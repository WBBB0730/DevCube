# Run

一个以项目为维度的通用运行器：在单个面板里聚合多个项目，浏览并运行它们的命令、查看输出。它把 WebStorm 右上角的"运行配置 + 运行按钮 + 控制台"从"一窗口一项目"搬到"单面板、多项目并列"的桌面工具里。

## Language

**Project（项目）**：被登记进运行器的一个本地文件夹，是聚合面板里的一个顶层条目，拥有属于自己的 Discovered Script 与 Run Configuration。
_Avoid_: Workspace, Repo, Folder

**Discovered Script（探测脚本）**：从项目 `package.json` 的 `scripts` 实时派生出来的候补可运行项——随文件变化自动增删、只读、尚未被运行过。被运行一次即"晋升"为 Run Configuration，并从候补区消失。
_Avoid_: Task, NPM task, Script（裸用）

**Run Configuration（运行配置）**：用户"拥有"的、已保存的可运行项，分两种：

- **引用型（Referenced）**：由 Discovered Script 首次运行"晋升"而来，纯粹引用 `(Project, script 名)`，运行时从 `package.json` 解析命令、随其同步。**完全不可自定义**——名字即 script 名，没有自定义命令 / cwd / 环境变量，只能运行、停止、重跑、删除。所引用的 script 从 `package.json` 消失时**直接删除**（不存在用户手工内容会丢失）。
- **命令型（Command）**：用户拥有的一条独立命令（命令行 + 工作目录 + 环境变量），完全可自定义、独立持久化、不随任何 script 变化、也不会被自动删除。要给某个 script 加环境变量 / 改 cwd / 改命令，就新建一条命令型配置——它不引用、也不同步任何 script。

_Avoid_: Task, Profile, Preset

**Run Session（运行会话）**：某条 Run Configuration 的一次"活的执行"，拥有自己的进程、输出、状态（运行中 / 已退出 / 失败）与控制（停止、重跑）。一条配置**单实例**：同时最多只有一个活跃的 Run Session；对运行中的配置再次"运行"即"重新运行"（先停旧进程再起新的）。
_Avoid_: Run, Process, Instance, Job

### 关系

- 一个 **Project** 拥有 0..N 个 **Discovered Script**（实时派生）和 0..N 个 **Run Configuration**（已保存）。
- 运行一个 **Discovered Script** 会把它**晋升**为一条**引用型 Run Configuration**；按 `(Project, script 名)` 去重，晋升后候补区不再显示它。
- **引用型**配置所引用的 script 若从 `package.json` 消失 → 该配置**自动删除**；script 改名视作"删旧出新"（旧配置删除，新名字作为全新 Discovered Script 候补重新出现）。
- 一切自定义只落在**命令型**配置上；**引用型**不承载任何自定义，因而其自动删除永不丢失用户内容。
- 一条 **Run Configuration** 至多对应一个活跃的 **Run Session**；不同配置的 Run Session 可并发存在。

## Example dialogue

> **开发者**：我把 `~/code/web` 加进来了，它下面出来一堆东西。
> **领域专家**：那些是 **Discovered Script**——直接从它 `package.json` 的 scripts 实时读出来的候补，你还没跑过，所以是只读的。
> **开发者**：我点了 `dev` 跑起来了。
> **领域专家**：那它就**晋升**成一条 **Run Configuration** 了，进了"我的配置"，候补区里不再重复显示。它仍然引用 `package.json` 里的 `dev`，你哪天改了 script，它下次跟着变。
> **开发者**：那我再手写一条 `docker compose up` 呢？
> **领域专家**：那是第二种 **Run Configuration**——一条不依赖任何 script 的独立命令。
