# Git Tab 是每项目常驻的非会话 Tab，破例于「一个 Tab = 一个活的会话」

DevCube 引入 Git 图谱（移植 vscode-git-graph）后，需要一个每项目的入口。ADR-0003（修订）确立的 Tab 模型是「一个 Tab = 一个活的会话」，而 Git 图谱不是会话——没有进程、没有输出流、不该被「关闭即弃会话」的语义管辖。我们决定让每个项目的 Tab 栏**常驻一个 Git Tab**：恒排最前、不可关闭（无 ×，Cmd+W 无效）、键为 `git:<projectPath>`，与会话 Tab 共用同一套激活/循环/回落规则。数据渲染面板与 xterm 一致地「切走隐藏不卸载」，但首次可见才拉取。

## Considered Options

- **常驻第一个 Tab（选中）**：入口零操作、好发现；非 git 仓库项目该 Tab 显示兜底提示。代价：Tab 栏永远至少一个 Tab，「占位态」（无任何 Tab）从此消失；Tab 不再全是会话。
- **按需按钮打开 / 左树入口**：不打破不变量，但入口多一跳，且「关闭后状态是否保留」引入新问题。

## Consequences

- `resolveTabs` 增加恒存在的 `gitKey`；激活回落顺序为 首个运行会话 → 首个终端 → Git Tab（保持运行器优先）；关闭最左会话 Tab 落到 Git Tab。
- 渲染端 `closeTab` / Cmd+W 对 `git:` 前缀键为 no-op。
- Git 图谱的数据状态存于独立的 git store（按项目分桶），Tab 隐藏或组件卸载都不丢。
