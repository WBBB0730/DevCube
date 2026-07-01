# 运行配置集中存储于应用 userData，而非写入各项目仓库

Run 是个人的多项目聚合器，运行配置属于"用户的工作台"而非某个仓库的资产。因此把项目列表与 Run Configuration 集中存在 Electron `userData` 的一份 JSON 里，不在任何项目文件夹内落盘。Discovered Script 与 Run Session 不持久化。

## Considered Options

- **集中存 userData**（选中）：零仓库侵入、不与 WebStorm `.idea/` 冲突、模型简单。代价：配置不随仓库走、不可与队友共享；项目按绝对路径识别，文件夹搬家会失联。
- **每项目就地存储（如 `.run/`）**：可提交、可共享、随仓库走，但污染用户仓库、需处理 .gitignore 与既有工具冲突，不符合"个人工具"定位。

## Consequences

- 项目以**绝对路径**为标识；移动文件夹会使其配置失联（后续可加"重新定位"能力）。
- 配置不具备跨仓库共享 / 团队协作能力（当前非目标）。
