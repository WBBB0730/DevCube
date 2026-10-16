# settings-keymap

**设置 · 快捷键列表补全与分组**

## Problem Statement

设置 → 快捷键只列了主进程拦截的十几个全局快捷键，**Files Tab**、**Git Tab**、终端、**Data Source Tab** 各自处理的键（查找、刷新、保存、执行、缩放、翻页、Diff 跳转等）一个都没有。想知道某个视图里能按什么，只能靠按钮的 title 或自己试。列表也是平铺的一长串，看不出哪个键在哪里有效。

## Solution

列表补全为 DevCube 自己定义的全部快捷键，按使用场景分组：通用 / 项目与 Tab / 文件 / 文件树 / Git / 终端 / 数据源。多个场景都有、行为一致的键（查找、查找栏导航、最近打开）只在「通用」列一次，其余各组只列本场景特有的。成对的动作（上一个 / 下一个）合成一行。只在某个平台存在的条目只在该平台显示。

| 分组 | 条目（键位按 macOS 写，其他平台按 ADR-0013 换算） |
| --- | --- |
| 通用 | 查找 ⌘F（Files 编辑器与预览、Git、终端、数据源编辑器与表格，焦点在其中时）· 查找下一个 / 上一个 Enter / ⇧Enter（焦点在查找框时；Git 查找另有 F3 / ⇧F3）· 最近打开的文件或数据源对象 ⌘E |
| 项目与 Tab | 聚焦项目、服务器和数据源筛选 ⌥⌘P · 上一个 / 下一个项目、服务器或数据源 ⌥⌘↑ / ⌥⌘↓ · 上一个 / 下一个 Tab ⌥⌘← / ⌥⌘→ · 循环下一个 / 上一个 Tab ⌃Tab / ⌃⇧Tab · 选择第 n 个 Tab ⌘1…9 · 新建终端或数据源标签页 ⌘T · 关闭 Tab ⌘W |
| 文件 | 聚焦文件筛选（服务器为前往路径）⌥⌘F · 搜索文件内容 ⇧⌘F · 保存服务器上的文件 ⌘S · 上一个 / 下一个媒体文件 ← / →（看图与音视频 ↑ / ↓ 也可以）· PDF / PPT 上一页 / 下一页 ↑ / ↓ · 适应窗口 / 放大 / 缩小 ⌘0 / ⌘+ / ⌘-（看图、PDF、PPT、Excel）· 按住空格拖动画面（PDF、PPT） |
| 文件树 | 移动选中 / 扩大选择 ↑ / ↓、⇧↑ / ⇧↓ · 展开 / 收起 → / ←（同 WebStorm，见 `files-tree-move-copy.md`）· 进入文件 Enter · 重命名 F2 · 删除 ⌘⌫（Windows / Linux 为 Delete） |
| Git | 刷新 ⌘R · Diff 下一处 / 上一处改动 F7 / ⇧F7 · Diff 上一个 / 下一个文件 ⌥← / ⌥→ |
| 终端 | 复制 / 粘贴：Windows 为 Ctrl+Shift+C（有选中时 Ctrl+C 也行）/ Ctrl+V 或 Ctrl+Shift+V，Linux 为 Ctrl+Shift+C / Ctrl+Shift+V；macOS 不显示（走编辑菜单的 ⌘C / ⌘V） |
| 数据源 | 执行光标所在的语句或选中的部分 ⌘Enter · 唤起补全 ⌃Space（macOS 另有 ⌥\` / ⌥I）· 表格全选 ⌘A · 表格扩大选区 ⇧+方向键 |

## User Stories

1. As a 用户, I want 设置里能查到 DevCube 的全部快捷键, so that 不用逐个按钮看 title 或靠试
2. As a 用户, I want 快捷键按使用场景分组, so that 想知道 Git 里能按什么时直接看 Git 一组
3. As a 用户, I want 到处都能用的查找只列一次, so that 列表不被同一个键刷屏
4. As a 用户, I want 上一个 / 下一个这类成对的动作合成一行, so that 列表短、好扫读
5. As a Windows / Linux 用户, I want 看到终端里复制粘贴的键, so that 知道 Ctrl+C 什么时候是中断、什么时候是复制
6. As a macOS 用户, I want 只看到本平台存在的条目, so that 不被用不上的键干扰

## Implementation Decisions

- 收录范围：只收 DevCube 自己定义的键。系统与编辑器通用键（撤销、剪切复制粘贴、全选、CodeMirror 自带的编辑与折叠键）、Esc 关闭与 Enter 确认这类通用约定、鼠标与触控板手势（⌘+滚轮、捏合、双击换档）不收。
- 列表数据仍放在共享模块，改为「分组 → 条目」两层；一条可带多个组合（成对动作），可声明只在某些平台出现。键位文案一律走 `formatShortcutLabel`（ADR-0013）。
- 列表与按钮 title 都要用的键（查找栏的 Enter / ⇧Enter、Diff 的 F7 / ⌥← / ⌥→ 等）补进共享的快捷键常量，两处共用一份、不各写各的文案；只在列表里出现的就地写在列表里。
- 分组标题沿用设置里其他栏目的组标题样式；行样式不变（左动作、右键位，键位 `font-mono`）。
- DESIGN.md 的快捷键表与这份清单保持同一份内容。

## Testing Decisions

- 列表按平台过滤表驱动单测：终端复制粘贴只在 Windows / Linux 出现、内容随平台不同；其余条目三平台都有。
- 既有的键位文案单测（`formatShortcutLabel`、`1…9` 范围文案）保留。
- 列表与实际按键行为是否一致人工回归。

## Out of Scope

- 改键、冲突检测（同 `in-app-update.md`）。
- 列表内搜索。
- 鼠标与触控板手势说明。

## Further Notes

- 文件树的剪切 / 复制 / 粘贴、全选就是系统通用键，按收录范围不列。
