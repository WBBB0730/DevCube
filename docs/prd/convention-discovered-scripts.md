## Problem Statement

我把 Go / Rust / Flutter / .NET / Compose 等项目加进 DevCube 时，左树候补往往是空的——除非碰巧有 `package.json`。这些生态最常用的其实是约定命令（`go test`、`cargo run`、`flutter run`…），我却只能手写命令型配置。我希望自动探测不局限于 Node，同时已上线用户的旧引用型配置不能坏掉。

## Solution

把 **Discovered Script** 的来源从「仅清单脚本」扩到「清单脚本 + 约定命令」。第一批约定按项目根指纹给出少量常用命令；候补菜单用来源小标题分组；引用与会话按 `(Project, 来源, 名)` 去重。引用型落盘必须带来源，不做旧档案兼容。

## User Stories

1. 作为用户，当 Project 根有 `go.mod` 时，我想在候补里看到 Go 约定命令，以便零配置跑测试与入口。
2. 作为用户，当 Project 根有 `Cargo.toml` 时，我想看到 Rust / Cargo 约定命令，以便直接 `run` / `test` / `build` / `check`。
3. 作为用户，当 Project 是 Flutter 工程（`pubspec.yaml` 且依赖 flutter）时，我想看到 Flutter 约定命令，以便直接 `run` / `test` / `analyze`。
4. 作为用户，当 Project 根有 `*.csproj` 或 `*.sln` 时，我想看到 .NET 约定命令，以便直接 `run` / `test` / `build`。
5. 作为用户，当 Project 根有 `compose.yaml` 或 `docker-compose.yml`（及常见 `.yaml` / `.yml` 变体）时，我想看到 Compose 约定命令，以便直接 `up` / `up -d`。
6. 作为用户，当 Project 仍有顶层 `package.json` scripts 时，我想继续看到清单脚本候补，以便 Node 工作流不回退。
7. 作为用户，当同一 Project 同时命中多个来源时，我想在候补菜单里看到**全部**来源，以便 Go+Compose 这类组合不被丢掉。
8. 作为用户，我想让候补菜单按来源用**小标题**分组，且未命中的来源不出现空组，以便一眼分辨 scripts 与各约定。
9. 作为用户，我想让约定命令与清单脚本一样可被选中或运行后**晋升**为引用型 Run Configuration，以便常用项沉到「我的配置」。
10. 作为用户，我想让晋升去重键为 `(Project, 来源, 名)`，以便不同来源下同名 `test` 互不覆盖。
11. 作为用户，我想让引用型运行时按来源解析命令（清单脚本仍走包管理器 `run`；约定命令走该条约定的固定命令行），以便不再误用 `npm run` 去跑 `cargo test`。
12. 作为用户，当清单脚本从 `package.json` 消失，或约定所依据的指纹不再成立时，我想让对应引用型**自动删除**，以便不留悬空项。
13. 作为用户，我想让约定候补随指纹文件的出现/消失实时增删，以便加删 `go.mod` / Compose 文件后立刻反映。
14. 作为用户，我想在左树已晋升配置上仍能靠名字认出约定项，并与清单脚本晋升项并列，以便多生态项目也好扫一眼。
15. 作为用户，当我想给某条约定加 env / 改命令时，我想仍通过**新建命令型配置**定制，以便引用型保持纯净、可被自动删除。
16. 作为用户，我不希望第一版去解析 Makefile / Xcode scheme / 全量 Gradle task，以便保持简单、可预期。
17. 作为用户，我不希望第一版做 Composer / Deno / Taskfile 等清单脚本扩展，以便本迭代专注约定命令。

## Implementation Decisions

**域与持久化（见 ADR-0020）。**

- Discovered Script 统一概念，来源两类：清单脚本（既有 `package.json` scripts）与约定命令（指纹目录）。
- 引用型与会话键：`(Project, 来源, 名)`。来源为稳定标识（如清单脚本 / go / cargo / flutter / dotnet / compose）；落盘必须带来源，不做旧档案兼容。
- 对账：清单脚本来源对照当前 scripts 集合；约定来源对照「该指纹是否仍命中且该约定名仍在目录中」。

**第一批指纹与约定目录（名 → 命令；cwd 项目根）。**

- **go**（`go.mod`）：`run` → `go run .`；`test` → `go test ./...`；`build` → `go build`。
- **cargo**（`Cargo.toml`）：`run` / `test` / `build` / `check` → 对应 `cargo …`。
- **flutter**（`pubspec.yaml` 且声明 flutter SDK 依赖）：`run` / `test` / `analyze` → 对应 `flutter …`。
- **dotnet**（项目根存在 `*.csproj` 或 `*.sln`）：`run` / `test` / `build` → 对应 `dotnet …`。
- **compose**（`compose.yaml` / `compose.yml` / `docker-compose.yaml` / `docker-compose.yml`）：`up` → `docker compose up`；`up -d` → `docker compose up -d`。
- 纯 Dart（无 flutter）本迭代不做；Maven / Gradle Wrapper / Makefile / Xcode 不做。

**模块划分。**

- **探测目录（纯）**：输入项目根可见的指纹事实 → 输出带上来源的 Discovered Script 列表（清单脚本解析与约定表可并列组合）；晋升过滤仍按 `(来源, 名)` 去掉已引用项。
- **指纹采集（IO）**：读项目根判断各指纹是否命中（含 Flutter 的 pubspec 轻量解析、.NET 根目录扩展名枚举）。
- **命令解析**：按引用来源生成实际 shell 命令——清单脚本沿用包管理器 `run`；约定用来源目录中的固定命令行。
- **晋升 / 对账**：扩展为带来源；对账同时覆盖清单与约定。
- **文件监听**：在现有顶层 package/lockfile 之外，纳入第一批指纹相关路径（及 .NET 根级工程文件变化所需的最小监听）。实现上与 Files / Git 共用每项目一条 @parcel/watcher 递归订阅（ADR-0021）；**响应面**仍只含项目根级清单 / 指纹文件（分类层挑出，不因整树事件对账）。
- **聚合树 / IPC / UI**：候补带来源；晋升与运行目标带来源；候补菜单按来源小标题分组，无项不渲染该组。

**执行与兼容。**

- 约定命令与清单脚本一样经登录 shell 起 PTY；停止杀进程树等行为不变。
- 命令型配置模型不变。
- 与 ADR-0002 一致：配置仍集中存 userData，不写回仓库。

## Testing Decisions

**好测试的标准。** 只测外部可观察行为：给定指纹事实 / 已晋升集合，得到的候补、晋升结果、对账删除、解析出的命令是否正确；以及「给定绝对路径 → 是否归入 discovery 通道」。不测 `@parcel/watcher` 本身、不测真实起进程。

**要测的模块/行为：**

- 各指纹命中/未命中时的约定目录（含 Flutter 有无 flutter SDK、Compose 文件名变体、.NET csproj/sln）。
- 多来源并存时候补合并与来源区分；未命中不产出该来源项。
- 晋升去重按 `(来源, 名)`；跨来源同名不合并。
- 对账：清单脚本消失删对应引用；指纹消失删该来源全部约定引用；其它来源不受影响。
- 命令解析：清单脚本仍 `pm run`；约定出来源固定命令。
- 路径分类：根级 `package.json` / 约定指纹 → discovery；非根级同名文件不进 discovery（`project-watch-classify`）。

**先例。** 现有 `discovery` / `configs`（promote、reconcile）与 `command` 纯函数测试；本特性沿用「纯核心 + IO 薄包装」范式。

## Out of Scope

- Composer / Deno / Task / Just 等更多清单脚本源。
- Makefile、Xcode scheme、全量 Gradle/Maven 任务列举。
- Python 通用约定、纯 Dart、Zig、SwiftPM、Laravel/Rails/Django 专用指纹。
- 约定命令的用户可配置目录（改名、增删条目）。
- 旧引用型（无来源字段）的读档兼容 / 迁移。
- Monorepo 子包展开（仍只看 Project 根，与既有清单脚本策略一致）。

## Further Notes

- 域语言见 `CONTEXT.md`（Discovered Script 含清单脚本与约定命令）；持久化与键设计见 ADR-0020。
- 每生态具体命令表可在实现中按上表落地；若某条命令在真实生态中明显别扭，实现时可微调字面量，但不得扩大指纹范围或改为「调工具列举任务」。
