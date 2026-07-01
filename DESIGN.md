# Run — 视觉与交互方向

**定位**：像素级复刻 WebStorm（JetBrains New UI · Darcula · 2026.1）的**深色**外观；仅深色主题。UI 底座 **shadcn（Base UI）+ Tailwind**，JetBrains 观感通过覆写 CSS 变量实现（圆角砍到近 0、密度压紧）。控制台 **xterm.js + JetBrains Mono**。

**色彩来源**：两套互补权威来源——① IDE UI 主题（面板 / 树选中 / 运行按钮等，用户手取）；② 编辑器/控制台配色 `Dark.icls`（Darcula 2026.1，控制台背景 / ANSI / 输出 / 语法色取自它）。两处 1 单位手取误差以 .icls 为准：最深/控制台背景 `#1E1F22`（非 `#1E2022`）、行 hover `#43454A`（非 `#43444A`）。

## 设计 Token（仅深色）

**表面 / 结构**
| 变量 | 值 | 用途 |
|---|---|---|
| `--bg-deepest` | `#1E1F22` | 控制台底、最深区、分割线（当深色凹槽） |
| `--bg-panel` | `#2B2D30` | 左树面板 / 工具栏 / 顶栏 / 输入框 / **弹出菜单** / **对话框（ConfigDialog）**背景（与列表一致） |
| `--bg-row-hover` | `#393B40` | 树行 / 触发行 hover（较深） |
| `--bg-button-hover` | `#515257` | 行内图标按钮 hover 底（较浅，与行 hover 拉开对比） |
| `--bg-caret-row` | `#26282E` | 控制台当前行（可选） |

**文字 / 图标**
| 变量 | 值 | 用途 |
|---|---|---|
| `--fg-primary` | `#DFE1E5` | 主文字 |
| `--fg-icon` | `#CED0D6` | 主图标 |
| `--fg-muted` | `#868A91` | 分组标题（候补 / 我的配置）、灰字说明 |
| `--fg-disabled` | `#6F737A` | 禁用 / 失效引用 |
| `--fg-dialog-title` | `#A7A8A9` | 弹窗标题 |

**边框 / 选中 / 强调**
| 变量 | 值 | 用途 |
|---|---|---|
| `--border-input` | `#4F5157` | input / select / dialog 描边 |
| `--separator` | `#1E1F22` | 面板间 1px 分隔 |
| `--selection-row` | `#2D436E` | 选中行圆角填充 |
| `--selection-row-hover` | `#35538F` | 选中（蓝底）行上按钮的 hover 底（非灰） |
| `--accent` | `#3574F0` | 焦点环 / 强调（New UI 主蓝，⚠ 推导，非 .icls） |
| `--link` | `#548AF7` | 链接（.icls HYPERLINK） |

**运行 / 停止按钮**
| 变量 | 值 | 用途 |
|---|---|---|
| `--run-glyph` | `#5FAD65` | 空闲态绿三角 |
| `--run-active-bg` | `#57965D` | 运行中（重新运行）实心底 |
| `--run-active-bg-hover` | `#4E8752` | 运行中 hover |
| `--stop-active-bg` | `#C94F4F` | 运行中停止按钮实心底 |
| `--stop-active-bg-hover` | `#B54747` | 停止 hover |

**状态点**
| 变量 | 值 | 状态 |
|---|---|---|
| `--status-idle` | `#868A91` | 空闲 / 从未运行 |
| `--status-running` | `#5FAD65` | 运行中 |
| `--status-success` | `#57965D` | 成功退出（exit 0） |
| `--status-failed` | `#C94F4F` | 失败退出（非 0） |

**滚动条（webkit）**
| 变量 | 值 | 用途 |
|---|---|---|
| `--scrollbar-thumb` | `#404043` | 全局细滚动条滑块（透明轨道） |
| `--scrollbar-thumb-hover` | `#626365` | 滑块 hover 变亮 |

**控制台（xterm 主题，取自 `Dark.icls`）**
| 键 | 值 | 来源 |
|---|---|---|
| background | `#1E1F22` | CONSOLE_BACKGROUND_KEY |
| foreground | `#BCBEC4` | CONSOLE_NORMAL_OUTPUT |
| cursor | `#CED0D6` | CARET_COLOR |
| selection | `#2D436E` | UI 选中蓝 |

ANSI 16 色（取自 JetBrains 终端真实 Console Colors 调色板）：

| | normal | bright |
|---|---|---|
| black | `#000000` | `#595959` |
| red | `#F0524F` | `#FF4050` |
| green | `#5C962C` | `#4FC414` |
| yellow | `#A68A0D` | `#E5BF00` |
| blue | `#3993D4` | `#1FB0FF` |
| magenta | `#A771BF` | `#ED7EED` |
| cyan | `#00A3A3` | `#00E5E5` |
| white | `#808080` | `#FFFFFF` |

## 排版 / 密度 / 形状

- **UI 字体**：Inter，13px，行高 ~20px（JetBrains New UI 默认）；**树行文字 14px**，**次要信息（角标 / 小标题）最小 12px**（终端搜索计数 11px 除外）。
- **控制台字体**：JetBrains Mono，13px，行高 1.3，字重 500（补偿 WebGL 在 macOS 渲染偏细）。
- **侧栏**固定宽 **280px**（不可拖拽）。
- **树行 / 触发行**固定高 40px（`h-10`，四周内边距 6px；固定高以免 hover 出按钮时整行跳动）；行内图标按钮 28px、图标 16px；状态点 8px。
- **圆角**：按钮 / 弹出菜单 6px（`rounded-lg`）、条目/配置行高亮 4px（`rounded`）、面板 0。
- **分隔线** 1px `--separator`。
- **滚动条**：全局细滚动条（`::-webkit-scrollbar`），宽 8px、轨道透明、滑块 `--scrollbar-thumb`（hover `--scrollbar-thumb-hover`）。

## 图标

Lucide（随 shadcn）：`Play`(运行) · `RotateCw`(重新运行) · `Square`(停止) · `MoreVertical`(更多⋮) · `Pencil`(编辑) · `Trash2`(删除) · `ChevronRight`(树展开 / 弹层箭头) · `FolderPlus`(添加项目) · `Plus`(新建命令) · `Search`/`ChevronUp`/`ChevronDown`/`X`(终端搜索框)。运行三角以 `--run-glyph` 上色。

## 布局

```
┌── 侧栏 280px 固定 ──┬────────────────────────────┐
│ 左树面板 --bg-panel  │ 控制台区 --bg-deepest       │
│                     │                            │
│ ▾ project-a  ＋ ✕   │ ┌ 状态条: 名称 · 退出码 ─┐  │
│  ● dev   ✎ 🗑 ▶      │ │                       │  │
│  ● build ✎ 🗑 ▶      │ │  xterm (JetBrains Mono)│  │
│  检测到的配置  2 ▸  │ │                       │  │
│                     │ └───────────────────────┘  │
│ ▾ project-b  ＋ ✕   │                            │
└─────────────────────┴────────────────────────────┘
   项目间留白，配置不缩进，「检测到的配置」为底部触发的临时弹出菜单
```

- **左树**：固定 280px，**项目间留白**。Project（可折叠）下**直接列出 Run Configuration**（无「我的配置」小标题；**行背景不缩进、仅内容缩进对齐**——状态点对齐文件夹图标列、名称对齐项目名，靠"补空占位列 + 居中点盒"实现）；探测脚本收进一个**临时弹出菜单**（**Base UI Popover**，即项目组件库；**深色背景 `--bg-panel` 与列表一致**；点触发浮出、点外面 / Esc 关闭；菜单项与配置行同款样式）。触发行置于配置列表最下方，UI 标签为**「检测到的配置」**（**文案与配置状态点对齐**，**数字在箭头前**，**箭头在右**）。项目行 hover 显示「新建命令」`＋` 与「更多」⋮（更多含「移除项目」）。项目名右侧显示包管理器角标（**pnpm 作为默认不显示**；hover 出按钮时让位隐藏）。
- **配置支持拖拽排序**（@dnd-kit，PointerSensor 距离 6px 激活以不误触点击；顺序落盘）。
- **行内图标按钮**四周内边距一致 6px（固定高 `h-10` + `px-1.5`）。
- **行选中**：`--selection-row` 圆角填充；其上按钮 hover 用 `--selection-row-hover`（蓝）而非灰。
- **右控制台**：跟随左树选择。**仅当选中项已有会话（跑过、有内容）才渲染 xterm**（顶部 **Tab 标签栏**，高度同左侧标题栏 40px、同 `--bg-panel` 底：状态点 + 配置名（字号同列表 14px），选中态用 `--primary` 主色下描边 3px 标示，文字在整栏含描边区垂直居中，hover 高亮 `--bg-row-hover`）；未选中或选中项没跑过时只显示占位提示，不挂载终端界面。退出后保留输出。

## 交互（呼应 CONTEXT.md / PRD）

- **行内操作 = 两个固定槽**（配置行，**空闲仅 hover / 选中显示，运行中恒显**）：**左槽** 运行 ▶ / 重跑 ↻、**右槽** 更多 ⋮ / 停止 ■——激活即两槽**原地替换**（运行→重跑、更多→停止）。更多菜单打开时其按钮保持可见（受控 open 状态）。更多菜单（Base UI Menu）含 编辑 `Pencil`（仅命令型）+ 删除 `Trash2`。运行/重跑实心绿 `--run-active-bg`、停止实心红 `--stop-active-bg`。探测脚本（弹层内）只有运行。
- **"激活" = 会话运行中态**（非鼠标按下）：配置一旦有活跃 Run Session，运行按钮即变实心绿的重新运行、旁出实心红停止。
- **克制展示**：非 hover 行只显示状态点 + 名称；hover 或选中才浮出按钮（WebStorm 手感）。
- **控制台跟随选择**、退出后保留输出（见 PRD 用户故事 22–25）；**运行 / 重跑 / 切换选择后自动聚焦终端**（可直接输入 stdin）；**每次运行先输出头部**（同一行：工作目录灰字 + `$` + 命令粗体）再接进程输出，**结束后空一行再补「进程已结束，退出代码为 N」**（标准色），并将终端切为**只读**（禁输入、隐藏光标，仍可选中 / 复制 / 搜索）。
- **终端能力**（xterm 插件）：链接可点击（经主进程 `shell.openExternal` 走系统浏览器，仅放行 http/https）；**Cmd/Ctrl+F 搜索输出**（右上浮层搜索框，Enter / Shift+Enter 下/上一条、Esc 关闭，高亮取自 Shell.icls SEARCH_RESULT 绿 `#2d543f`）；WebGL 渲染器（大量输出更顺，不可用回退 DOM）；Unicode 11 字宽（emoji / CJK 对齐）。

## 待校准

- ANSI 仅 `black`（`#27282E`）为**推导**（Shell.icls 无精确来源），其余已由导出逐项核验；`--accent`（`#3574F0`）为推导。
- UI 主题（树选中蓝、按钮绿）来自手取；如需绝对像素级，可后续从 New UI 的 `theme.json` 再校一遍。
