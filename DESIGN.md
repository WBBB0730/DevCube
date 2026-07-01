# Run — 视觉与交互方向

**定位**：像素级复刻 WebStorm（JetBrains New UI · Darcula · 2026.1）的**深色**外观；仅深色主题。UI 底座 **shadcn（Base UI）+ Tailwind**，JetBrains 观感通过覆写 CSS 变量实现（圆角砍到近 0、密度压紧）。控制台 **xterm.js + JetBrains Mono**。

**色彩来源**：两套互补权威来源——① IDE UI 主题（面板 / 树选中 / 运行按钮等，用户手取）；② 编辑器/控制台配色 `Dark.icls`（Darcula 2026.1，控制台背景 / ANSI / 输出 / 语法色取自它）。两处 1 单位手取误差以 .icls 为准：最深/控制台背景 `#1E1F22`（非 `#1E2022`）、行 hover `#43454A`（非 `#43444A`）。

## 设计 Token（仅深色）

**表面 / 结构**
| 变量 | 值 | 用途 |
|---|---|---|
| `--bg-deepest` | `#1E1F22` | 控制台底、最深区、分割线（当深色凹槽） |
| `--bg-panel` | `#2B2D30` | 左树面板 / 工具栏 / 顶栏 / 输入框 / **弹出菜单**背景（与列表一致） |
| `--bg-popover` | `#393B40` | 对话框（ConfigDialog）背景 |
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

**控制台（xterm 主题，取自 `Dark.icls`）**
| 键 | 值 | 来源 |
|---|---|---|
| background | `#1E1F22` | CONSOLE_BACKGROUND_KEY |
| foreground | `#BCBEC4` | CONSOLE_NORMAL_OUTPUT |
| cursor | `#CED0D6` | CARET_COLOR |
| selection | `#2D436E` | UI 选中蓝 |

ANSI 16 色（从 .icls 语法/输出色派生，地道 Darcula）：

| | normal | bright |
|---|---|---|
| black | `#27282E` | `#6F737A` |
| red | `#F75464` | `#FA6675` |
| green | `#6AAB73` | `#73BD79` |
| yellow | `#E0BB65` | `#F2C55C` |
| blue | `#56A8F5` | `#5C92FF` |
| magenta | `#C77DBB` | `#B189F5` |
| cyan | `#2AACB8` | `#42C3D4` |
| white | `#BCBEC4` | `#DFE1E5` |

## 排版 / 密度 / 形状

- **UI 字体**：Inter，13px，行高 ~20px（JetBrains New UI 默认）。
- **控制台字体**：JetBrains Mono，13px。
- **侧栏**固定宽 **280px**（不可拖拽）。
- **树行 / 触发行**固定高 40px（`h-10`，四周内边距 6px；固定高以免 hover 出按钮时整行跳动）；行内图标按钮 28px、图标 16px；状态点 8px。
- **圆角**：按钮 / 弹出菜单 6px（`rounded-lg`）、条目/配置行高亮 4px（`rounded`）、面板 0。
- **分隔线** 1px `--separator`。

## 图标

Lucide（随 shadcn）：`Play`(运行) · `RotateCw`(重新运行) · `Square`(停止) · `MoreVertical`(更多⋮) · `Pencil`(编辑) · `Trash2`(删除) · `ChevronRight`(树展开 / 弹层箭头) · `FolderPlus`(添加项目) · `Plus`(新建命令) · `X`(移除)。运行三角以 `--run-glyph` 上色。

## 布局

```
┌── 侧栏 280px 固定 ──┬────────────────────────────┐
│ 左树面板 --bg-panel  │ 控制台区 --bg-deepest       │
│                     │                            │
│ ▾ project-a  ＋ ✕   │ ┌ 状态条: 名称 · 退出码 ─┐  │
│  ● dev   ✎ 🗑 ▶      │ │                       │  │
│  ● build ✎ 🗑 ▶      │ │  xterm (JetBrains Mono)│  │
│  2 检测到的配置  ▸  │ │                       │  │
│                     │ └───────────────────────┘  │
│ ▾ project-b  ＋ ✕   │                            │
└─────────────────────┴────────────────────────────┘
   项目间留白，配置不缩进，「检测到的配置」为底部触发的临时弹出菜单
```

- **左树**：固定 280px，**项目间留白**。Project（可折叠）下**直接列出 Run Configuration**（无「我的配置」小标题；**行背景不缩进、仅内容缩进对齐**——状态点对齐文件夹图标列、名称对齐项目名，靠"补空占位列 + 居中点盒"实现）；探测脚本收进一个**临时弹出菜单**（**Base UI Popover**，即项目组件库；**深色背景 `--bg-panel` 与列表一致**；点触发浮出、点外面 / Esc 关闭；菜单项与配置行同款样式）。触发行置于配置列表最下方，UI 标签为**「检测到的配置」**（**数字在前、与配置状态点对齐**，文案随后，**箭头在右**）。「新建命令」入口在项目行 hover 的 `＋`。
- **配置支持拖拽排序**（@dnd-kit，PointerSensor 距离 6px 激活以不误触点击；顺序落盘）。
- **行内图标按钮**四周内边距一致 6px（固定高 `h-10` + `px-1.5`）。
- **行选中**：`--selection-row` 圆角填充；其上按钮 hover 用 `--selection-row-hover`（蓝）而非灰。
- **右控制台**：跟随左树选择；顶部极简状态条（名称 + 退出码/状态）；主体为选中会话的 xterm，退出后保留输出。

## 交互（呼应 CONTEXT.md / PRD）

- **行内操作 = 两个固定槽**（配置行）：**左槽** 运行 ▶ / 重跑 ↻、**右槽** 更多 ⋮ / 停止 ■——激活即两槽**原地替换**（运行→重跑、更多→停止）。更多菜单（Base UI Menu）含 编辑 `Pencil`（仅命令型）+ 删除 `Trash2`。运行/重跑实心绿 `--run-active-bg`、停止实心红 `--stop-active-bg`。探测脚本（弹层内）只有运行。
- **"激活" = 会话运行中态**（非鼠标按下）：配置一旦有活跃 Run Session，运行按钮即变实心绿的重新运行、旁出实心红停止。
- **克制展示**：非 hover 行只显示状态点 + 名称；hover 或选中才浮出按钮（WebStorm 手感）。
- **控制台跟随选择**、退出后保留输出（见 PRD 用户故事 22–25）。

## 待校准

- `--accent`（`#3574F0`）与 ANSI 的 black/bright 少数值为**推导**，日后可对 JetBrains 终端配色再精校。
- UI 主题（树选中蓝、按钮绿）来自手取；如需绝对像素级，可后续从 New UI 的 `theme.json` 再校一遍。
