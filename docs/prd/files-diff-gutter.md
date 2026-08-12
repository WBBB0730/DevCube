# Files 编辑器行号栏 diff 条纹

## Problem Statement

在 Files Tab 里编辑文件时，看不出哪些行相对仓库基线发生了变化。要确认自己改了哪里，只能切到 Git Tab 打开 diff 面板，或者回到 WebStorm——失去了「边改边看到改动范围」的基本安全感。

## Solution

对齐 WebStorm 的 VCS gutter：编辑器行号栏按行显示 diff 状态——新增行绿条、修改行蓝条、删除位置灰色小三角。对比基线是文件在 HEAD 的内容，随输入实时更新，提交 / 暂存等仓库变化后自动刷新。无基线的文件（未跟踪、非仓库、二进制）不显示条纹。

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

## Implementation Decisions

- 对比基线取 **HEAD**（`git show HEAD:<path>`），非 index——已暂存未提交的行仍显示条纹，对齐 WebStorm。
- 基线读取走主进程新增的 Files IPC（路径越界校验与其他 Files 通道同款）；非仓库、HEAD 无此路径（含未跟踪 / 重命名未提交）、二进制（魔数嗅探）、超过文本上限时返回 null，渲染端据此不挂条纹扩展。
- 行级 diff 在渲染端用 `@codemirror/merge` 的 Chunk API 计算：打开 / 基线变化时全量 build，输入时增量 update；扫描量限制与官方 merge view 默认一致。
- 标记通过 CodeMirror 官方 `lineNumberMarkers` facet 附着在行号元素上（不新增 gutter 列）：条纹画在行号列右缘，删除三角骑在下一行顶部边界。
- 删除末行时，前一行的换行符也在变更范围内，chunk 的 B 侧非空——该场景按「修改」标记（与 CodeMirror merge view 行为一致），不特判。
- 基线刷新时机：打开文本文件、`git:changed` 事件（提交 / 暂存 / 工作区 watcher）；保存不刷新（HEAD 未变）。
- 三色取自 Dark.icls 的 ADDED / MODIFIED / DELETED_LINES_COLOR。

## Testing Decisions

- 纯函数 `gitGutterLineKinds`（chunk → 行号状态归类）配 vitest：无差异、新增、修改、删除落点、末行删除、相邻变更合并、新文件基线，与既有渲染端纯函数测试（`components/git/*.test.ts`）同款风格。
- IPC / 渲染接线不做单测（外部行为靠人工回归），与 Files Tab 现状一致。

## Out of Scope

- 点击条纹弹出 hunk 详情 / 回滚（WebStorm 式弹窗）。
- 重命名未提交文件的基线跟踪（按新路径取 HEAD 落空 → 不显示条纹，效果同 VS Code）。
- 空白改动忽略、基线切换（index / 任意 rev）等配置项。

## Further Notes

条纹只是状态展示，不承载任何操作；后续若做「把 diff 搬进 Files Tab」，可复用同一基线通道。
