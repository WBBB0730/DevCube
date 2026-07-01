# Run — 视觉与交互方向

**定位**：像素级复刻 WebStorm（JetBrains New UI · Darcula · 2026.1）的**深色**外观；仅深色主题。UI 底座 **shadcn（Base UI）+ Tailwind**，JetBrains 观感通过覆写 CSS 变量实现（圆角砍到近 0、密度压紧）。控制台 **xterm.js + JetBrains Mono**。

**色彩来源**：两套互补权威来源——① IDE UI 主题（面板 / 树选中 / 运行按钮等，用户手取）；② 编辑器/控制台配色 `Dark.icls`（Darcula 2026.1，控制台背景 / ANSI / 输出 / 语法色取自它）。两处 1 单位手取误差以 .icls 为准：最深/控制台背景 `#1E1F22`（非 `#1E2022`）、行 hover `#43454A`（非 `#43444A`）。

## 设计 Token（仅深色）

**表面 / 结构**
| 变量 | 值 | 用途 |
|---|---|---|
| `--bg-deepest` | `#1E1F22` | 控制台底、最深区、分割线（当深色凹槽） |
| `--bg-panel` | `#2B2D30` | 左树面板 / 工具栏 / 顶栏 / 输入框背景 |
| `--bg-popover` | `#393B40` | 下拉 / 菜单 / 弹层背景 |
| `--bg-row-hover` | `#43454A` | 树行 hover |
| `--bg-button-hover` | `#404144` | 运行按钮空闲态 hover 底 |
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
- **树行高** 28px；行内图标按钮 24px、图标 16px；状态点 8px。分组标题固定 28px 高（hover 出「新建」按钮用 opacity 切换，不改变行高）。
- **圆角**：控件 4px、**条目/配置行高亮圆角**、面板 0。
- **分隔线** 1px `--separator`。

## 图标

Lucide（随 shadcn）：`Play`(运行) · `RotateCw`(重新运行) · `Square`(停止) · `Pencil`(编辑) · `Trash2`(删除) · `ChevronRight`(树展开) · `Plus`(添加/新建) · `X`(移除)。运行三角以 `--run-glyph` 上色。

## 布局

```
┌── 侧栏 280px 固定 ──┬────────────────────────────┐
│ 左树面板 --bg-panel  │ 控制台区 --bg-deepest       │
│                     │                            │
│ ▾ project-a  ＋ ✕   │ ┌ 状态条: 名称 · 退出码 ─┐  │
│  ● dev   ✎ 🗑 ▶      │ │                       │  │
│  ● build ✎ 🗑 ▶      │ │  xterm (JetBrains Mono)│  │
│  ▾ 探测脚本  2       │ │                       │  │
│                     │ └───────────────────────┘  │
│ ▾ project-b  ＋ ✕   │                            │
└─────────────────────┴────────────────────────────┘
   项目间留白，配置不缩进，探测脚本为底部触发的临时弹出菜单
```

- **左树**：固定 280px，**项目间留白**。Project（可折叠）下**直接列出 Run Configuration**（无「我的配置」小标题、**不缩进**）；**探测脚本收进一个临时弹出菜单**（@floating-ui/react 浮层，点触发行浮出、点外面 / Esc 关闭；菜单项与配置行同款样式），触发行置于配置列表最下方并显示数量。「新建命令」入口在项目行 hover 的 `＋`。
- **配置支持拖拽排序**（@dnd-kit，PointerSensor 距离 6px 激活以不误触点击；顺序落盘）。
- **行选中**：`--selection-row` 圆角填充；其上按钮 hover 用 `--selection-row-hover`（蓝）而非灰。
- **右控制台**：跟随左树选择；顶部极简状态条（名称 + 退出码/状态）；主体为选中会话的 xterm，退出后保留输出。

## 交互（呼应 CONTEXT.md / PRD）

- **行内操作**（hover/选中浮出）：空闲 = 配置行有 编辑 `Pencil` + 删除 `Trash2`，末尾运行（绿三角 `--run-glyph`）；运行中 = 重新运行（实心绿 `--run-active-bg`）+ 停止（实心红 `--stop-active-bg`）。
- **"激活" = 会话运行中态**（非鼠标按下）：配置一旦有活跃 Run Session，运行按钮即变实心绿的重新运行、旁出实心红停止。
- **克制展示**：非 hover 行只显示状态点 + 名称；hover 或选中才浮出按钮（WebStorm 手感）。
- **控制台跟随选择**、退出后保留输出（见 PRD 用户故事 22–25）。

## 待校准

- `--accent`（`#3574F0`）与 ANSI 的 black/bright 少数值为**推导**，日后可对 JetBrains 终端配色再精校。
- UI 主题（树选中蓝、按钮绿）来自手取；如需绝对像素级，可后续从 New UI 的 `theme.json` 再校一遍。
