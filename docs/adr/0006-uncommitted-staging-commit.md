# 未提交视图从只读升级为带暂存区的提交面板

vscode-git-graph 的未提交更改视图是只读的（提交/暂存交给 VS Code 的 SCM 视图，移植时已删「打开源代码管理视图」）。为让开发者无需离开 Runlet 就能提交，我们把 Git Tab 的**未提交更改行**详情从只读升级为一个带完整暂存区的**提交面板**，行为对齐 SourceTree：分「已暂存 / 未暂存」两段管理文件、勾选即 `git add`、取消勾选即 unstage、提交提交 index，支持修正（amend）与提交并推送。这刻意偏离了「未提交视图只读」的移植基线。

## Considered Options

- **全量提交（无暂存）**：一个信息框 + 提交全部更改。最简，但无法只提交一部分。
- **勾选提交（不暴露暂存区）**：文件复选框选中即提交，内部临时 stage。较轻，但与真实 git 心智模型、SourceTree 手感不符。
- **完整暂存区（选中）**：已暂存/未暂存两段、逐文件 stage/unstage、提交 index。最贴 SourceTree/JetBrains 与真实 git，代价是数据模型改动最大。

## Consequences

- 未提交行的文件数据源从单一 `git diff HEAD`（合并差异）改为 **`git diff --cached`（已暂存 HEAD↔index）+ `git diff`（未暂存 index↔工作区）+ 未跟踪文件**；同一文件可同时出现在两段（已暂存 = 暂存时快照，未暂存 = 后续改动）。
- diff 面板需支持 **index 为端点**：点已暂存文件看 HEAD→index、点未暂存文件看 index→工作区。
- 新增写操作 stage / unstage / discard / commit（含 amend）；暂存类操作**静默即时**（不弹进行中遮罩、不置全局 loading），操作后悄悄重拉两段列表。
- 「提交并推送」在提交后打开既有 push-branch 对话框（含强制），与工具栏「推送」同路径。
- 提交面板仍是吊底详情面板（版式 A：左提交信息 + 按钮、右两段文件树）。
- 图上未提交行的行级右键菜单（贮藏 / 重置 / 清理）保持不变。
- 仅文件级暂存；hunk / 行级部分暂存不做。
