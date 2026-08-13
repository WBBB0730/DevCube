# Files 编辑器行号栏 diff 条纹

## Problem Statement

在 Files Tab 里编辑文件时，看不出哪些行相对仓库基线发生了变化。要确认自己改了哪里，只能切到 Git Tab 打开 diff 面板，或者回到 WebStorm——失去了「边改边看到改动范围」的基本安全感。

## Solution

对齐 WebStorm 的 VCS gutter：编辑器行号栏按行显示 diff 状态——新增行绿条、修改行蓝条、删除位置骑在行界上的灰色短条。对比基线是文件在 HEAD 的内容，随输入实时更新，提交 / 暂存等仓库变化后自动刷新。无基线的文件（未跟踪、非仓库、二进制）不显示条纹。

点击带标记的行号格子弹出该改动块的小窗（对齐 WebStorm 点击条纹）：基线旧行预览（同主题语法高亮）+ 工具条——回滚该块、复制旧文本、上一个 / 下一个改动跳转；新增块没有旧行，只出工具条。

## User Stories

1. As a 开发者, I want 编辑文件时行号旁标出新增的行, so that 我不用打开 diff 就知道自己加了哪些内容
2. As a 开发者, I want 修改过的行显示与新增不同的颜色, so that 我能区分「改了原有内容」和「加了新内容」
3. As a 开发者, I want 被删除的位置有一个标记, so that 我知道那里曾有内容被删掉
4. As a 开发者, I want 条纹随我的输入实时更新, so that 撤销回原文后条纹立即消失、所见即所得
5. As a 开发者, I want 提交之后条纹自动清空, so that 条纹始终反映「相对 HEAD 的未提交改动」
6. As a 开发者, I want 在 Git Tab 暂存文件后条纹保持不变, so that 已暂存但未提交的行仍被视为改动（与 WebStorm 口径一致）
7. As a 开发者, I want 未跟踪的新文件不显示条纹, so that 整页绿条不会造成噪音
8. As a 开发者, I want 打开非 git 项目的文件时一切如常, so that 该功能不干扰无仓库场景
9. As a 开发者, I want 条纹颜色与 WebStorm Dark 主题一致, so that 两个工具间切换没有认知成本
10. As a 开发者, I want 点击条纹弹出该块的旧内容, so that 不离开编辑器就能看到这块改了什么
11. As a 开发者, I want 在弹窗里一键回滚该块, so that 误改能就地撤销而不用手动恢复
12. As a 开发者, I want 复制该块的旧文本, so that 需要旧内容时不必去 Git 面板翻
13. As a 开发者, I want 在弹窗里跳到上一个 / 下一个改动, so that 能顺着改动逐块检查
14. As a 开发者, I want 带标记的行号格子 hover 时有反馈（pointer 光标、条纹加宽）, so that 我知道这里可以点
15. As a 开发者, I want 编辑或滚动时弹窗自动关闭, so that 弹窗不会指着已经漂移的位置

## Implementation Decisions

- 对比基线取 **HEAD**（`git show HEAD:<path>`），非 index——已暂存未提交的行仍显示条纹，对齐 WebStorm。
- 基线读取走主进程新增的 Files IPC（路径越界校验与其他 Files 通道同款）；非仓库、HEAD 无此路径（含未跟踪 / 重命名未提交）、二进制（魔数嗅探）、超过文本上限时返回 null，渲染端据此不挂条纹扩展。
- 行级 diff 在渲染端用 jsdiff（`diff` 包）的 `diffLines` 计算——与 VS Code / JetBrains 行状态跟踪同款的**按行比较**，行语义与 git 一致（含 EOF 换行）。曾用 `@codemirror/merge` 的字符级 Chunk API，因行模型错配把「文末追加」误标为修改而替换（增量更新随之放弃：每次输入全量重 diff，实测 1 万行约 2ms；超过 3 万行的守卫内不显示条纹）。基线在扩展构造时按 CM 文档口径归一换行（CRLF → LF）。
- 标记通过 CodeMirror 官方 `lineNumberMarkers` facet 附着在行号元素上（不新增 gutter 列）：条纹画在行号列右缘，删除短条骑在下一行顶部边界。
- diff 结果以 **hunk 列表**为一等数据（当前侧行区间 + 基线侧旧行 + 文末删除特殊位），行号→颜色是派生视图；弹窗、回滚、跳转都吃同一份 hunks。
- 点击接线走 CodeMirror 官方 gutter API：basicSetup 的 lineNumbers / foldGutter 关闭，改由带 `domEventHandlers` 的自建行号 gutter + foldGutter 组合提供（保证行号在折叠列左侧的既有列序）；点击回调经 Facet 注入，行号 gutter 无条件挂载、无基线时点击为 no-op。
- 弹窗为受控 Base UI Popover + 行号格子虚拟锚点；旧行预览是只读 mini CodeMirror（复用同一套 Darcula 主题与按路径选语言）。关闭时机：Esc / 点外 / 手动滚动 / 文档变化（含弹窗内回滚本身）；上一/下一跳转的程序滚动豁免，滚动落地后经 `requestMeasure` 读新锚点重定位。
- 回滚是纯函数计算的单次区间替换（modified 换回旧行 / added 删行 / deleted 插回旧行），执行走 `view.dispatch`，落盘吃既有 dirty → 自动保存管线，不新增 IPC。
- 基线刷新时机：打开文本文件、`git:changed` 事件（提交 / 暂存 / 工作区 watcher）；保存不刷新（HEAD 未变）。
- 三色取自 Dark.icls 的 ADDED / MODIFIED / DELETED_LINES_COLOR。

## Testing Decisions

- 纯函数 `gitGutterLineKinds`（基线 + 当前文本 → 行号状态）配 vitest：无差异、中间新增、文末追加（README 回归）、修改、删除落点、末行删除、空行填内容、无尾换行追加、CRLF 归一、新文件基线，与既有渲染端纯函数测试（`components/git/*.test.ts`）同款风格。
- `gitGutterHunks` 断言块结构（旧行、标记行、atEof）；`hunkRollbackChange` 用**往返测试**——对唯一 hunk 执行回滚后必须恢复为基线原文，覆盖 modified / added / deleted 各自的中间、文末、无尾换行、空基线边界。
- IPC / 渲染接线不做单测（外部行为靠人工回归），与 Files Tab 现状一致。

## Out of Scope

- 弹窗内「打开完整 diff」与空白差异开关（WebStorm 有）。
- 重命名未提交文件的基线跟踪（按新路径取 HEAD 落空 → 不显示条纹，效果同 VS Code）。
- 空白改动忽略、基线切换（index / 任意 rev）等配置项。

## Further Notes

hunk 数据层（区间 + 旧行）与后续「把 diff 搬进 Files Tab」共享；条纹、弹窗、回滚都是它的消费者。
