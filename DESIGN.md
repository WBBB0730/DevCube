# DevCube — 视觉与交互方向

**定位**：像素级复刻 WebStorm（JetBrains New UI · Darcula · 2026.1）的**深色**外观；仅深色主题。UI 底座 **shadcn（Base UI）+ Tailwind**，JetBrains 观感通过覆写 CSS 变量实现（圆角砍到近 0、密度压紧）。控制台 **xterm.js + JetBrains Mono**。

**色彩来源**：两套互补权威来源——① IDE UI 主题（面板 / 树选中 / 运行按钮等，用户手取）；② 编辑器/控制台配色 `Dark.icls`（Darcula 2026.1，控制台背景 / ANSI / 输出 / 语法色取自它）。两处 1 单位手取误差以 .icls 为准：最深/控制台背景 `#1E1F22`（非 `#1E2022`）、行 hover `#43454A`（非 `#43444A`）。

## 设计 Token（仅深色）

**表面 / 结构**

| 变量                | 值        | 用途                                                                                            |
| ------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| `--bg-deepest`      | `#1E1F22` | 控制台底、最深区、分割线（当深色凹槽）                                                          |
| `--bg-panel`        | `#2B2D30` | 左树面板 / 工具栏 / 顶栏 / 输入框 / **弹出菜单** / **对话框（ConfigDialog）**背景（与列表一致） |
| `--bg-row-hover`    | `#393B40` | 树行 / 触发行 hover（较深）                                                                     |
| `--bg-button-hover` | `#515257` | 行内图标按钮 hover 底（较浅，与行 hover 拉开对比）                                              |
| `--bg-caret-row`    | `#26282E` | 控制台当前行（可选）                                                                            |

**文字 / 图标**

| 变量                | 值        | 用途                                  |
| ------------------- | --------- | ------------------------------------- |
| `--fg-primary`      | `#DFE1E5` | 主文字                                |
| `--fg-icon`         | `#CED0D6` | 主图标                                |
| `--fg-muted`        | `#868A91` | 分组标题（候补 / 我的配置）、灰字说明 |
| `--fg-disabled`     | `#6F737A` | 禁用 / 失效引用                       |
| `--fg-dialog-title` | `#A7A8A9` | 弹窗标题                              |

**边框 / 选中 / 强调**

| 变量                    | 值        | 用途                                                                               |
| ----------------------- | --------- | ---------------------------------------------------------------------------------- |
| `--border-input`        | `#4F5157` | input / select / dialog 描边                                                       |
| `--separator`           | `#1E1F22` | 面板间 1px 分隔                                                                    |
| `--selection-row`       | `#2D436E` | 选中行圆角填充                                                                     |
| `--selection-row-hover` | `#35538F` | 选中（蓝底）行上按钮的 hover 底（非灰）                                            |
| `--editor-selection`    | `#224283` | Files 编辑器文本选区（WebStorm；≠ 行选中蓝）                                       |
| `--accent`              | `#3574F0` | 强调（New UI 主蓝，⚠ 推导，非 .icls）；**焦点环全局关闭**（`--ring: transparent`） |
| `--link`                | `#548AF7` | 链接（.icls HYPERLINK）                                                            |

**运行 / 停止按钮**

| 变量                     | 值        | 用途                     |
| ------------------------ | --------- | ------------------------ |
| `--run-glyph`            | `#5FAD65` | 空闲态绿三角             |
| `--run-active-bg`        | `#57965D` | 运行中（重新运行）实心底 |
| `--run-active-bg-hover`  | `#4E8752` | 运行中 hover             |
| `--stop-active-bg`       | `#C94F4F` | 运行中停止按钮实心底     |
| `--stop-active-bg-hover` | `#B54747` | 停止 hover               |

**状态点**

| 变量               | 值        | 状态               |
| ------------------ | --------- | ------------------ |
| `--status-idle`    | `#868A91` | 空闲 / 从未运行    |
| `--status-running` | `#5FAD65` | 运行中             |
| `--status-success` | `#57965D` | 成功退出（exit 0） |
| `--status-failed`  | `#C94F4F` | 失败退出（非 0）   |

**Git 文件状态色**（`Dark.icls` FILESTATUS_*；提交面板 / Files 树文件名与图标）

| 变量                     | 值        | 来源 / 用途                                                                       |
| ------------------------ | --------- | --------------------------------------------------------------------------------- |
| `--git-status-added`     | `#73BD79` | FILESTATUS_ADDED；新增（A）；**未跟踪（U）也用此色**（不对齐 FILESTATUS_UNKNOWN） |
| `--git-status-modified`  | `#70AEFF` | FILESTATUS_MODIFIED / RENAMED；修改 / 重命名（M / R）                             |
| `--git-status-deleted`   | `#6F737A` | FILESTATUS_DELETED；删除（D）；与 `--fg-disabled` 同值                            |
| `--git-status-conflict`  | `#DE6A66` | FILESTATUS__*MERGED_WITH*__CONFLICTS / changelistConflict；冲突（`!`）            |
| `--git-status-merged`    | `#CF84CF` | FILESTATUS_MERGED；已合并（预留）                                                 |
| `--git-status-ignored`   | `#D69A6B` | FILESTATUS_IDEA_FILESTATUS_IGNORED；已忽略（预留）                                |
| `--git-status-untracked` | `#E88F89` | FILESTATUS_UNKNOWN（**预留，当前 U 不用**）                                       |

**滚动条（webkit）**

| 变量                      | 值        | 用途                         |
| ------------------------- | --------- | ---------------------------- |
| `--scrollbar-thumb`       | `#404043` | 全局细滚动条滑块（透明轨道） |
| `--scrollbar-thumb-hover` | `#626365` | 滑块 hover 变亮              |

**控制台（xterm 主题，取自 `Dark.icls`）**

| 键         | 值        | 来源                   |
| ---------- | --------- | ---------------------- |
| background | `#1E1F22` | CONSOLE_BACKGROUND_KEY |
| foreground | `#BCBEC4` | CONSOLE_NORMAL_OUTPUT  |
| cursor     | `#CED0D6` | CARET_COLOR            |
| selection  | `#2D436E` | UI 选中蓝              |

ANSI 16 色（取自 JetBrains 终端真实 Console Colors 调色板）：

|         | normal    | bright    |
| ------- | --------- | --------- |
| black   | `#000000` | `#595959` |
| red     | `#F0524F` | `#FF4050` |
| green   | `#5C962C` | `#4FC414` |
| yellow  | `#A68A0D` | `#E5BF00` |
| blue    | `#3993D4` | `#1FB0FF` |
| magenta | `#A771BF` | `#ED7EED` |
| cyan    | `#00A3A3` | `#00E5E5` |
| white   | `#808080` | `#FFFFFF` |

## 排版 / 密度 / 形状

- **UI 字体**：Inter，13px，行高 ~20px（JetBrains New UI 默认）；**树行文字 14px**，**次要信息（角标 / 小标题）最小 12px**（终端搜索计数 11px 除外）。
- **控制台字体**：JetBrains Mono，13px，行高 1.3，字重 500（补偿 WebGL 在 macOS 渲染偏细）。
- **Files 编辑器字体**（对齐 WebStorm 默认编辑器 + `Dark.icls`）：JetBrains Mono，13px，字重 400，无连字；行高 CSS `1.7`（`.files-codemirror`）；文本选区 `--editor-selection` `#224283`；正文/行号/光标行/语法色见 `cm6-setup`（背景 `#1E1F22`、前景 `#BCBEC4`、行号 `#4B5059`、光标行 `#26282E` 等）。
- **侧栏**固定宽 **280px**（不可拖拽）。
- **树行 / 触发行**固定高 40px（`h-10`，四周内边距 6px；固定高以免 hover 出按钮时整行跳动）；行内图标按钮 28px、图标 16px；状态点 8px。
- **圆角**：按钮 / 弹出菜单 6px（`rounded-lg`）、条目/配置行高亮 4px（`rounded`）、面板 0。
- **分隔线** 1px `--separator`。
- **滚动条**：全局细滚动条（`::-webkit-scrollbar`），宽 8px、轨道透明、滑块 `--scrollbar-thumb`（hover `--scrollbar-thumb-hover`）。

## 图标

Lucide（随 shadcn）：`Play`(运行) · `RotateCw`(重新运行 / Git 刷新) · `Square`(停止) · `Eraser`(清空运行会话输出) · `MoreVertical`(更多⋮) · `Pencil`(编辑) · `Trash2`(删除) · `ChevronRight`(树展开 / 弹层箭头) · `FolderPlus`(添加项目) · `FolderOpen`(打开文件夹 / Files Tab 标签「文件」 / Files「在文件夹中显示」) · `FileClock`(Files「最近打开文件」) · `ListTree`(Files「在文件树中显示」) · `Minus`(Files「隐藏文件树」) · `PanelRight`(Files「显示文件树」) · `SquareArrowOutUpRight`(Files「在其他应用中打开」) · `ChevronsUpDown`(Files 文件树「全部展开」) · `ChevronsDownUp`(Files 文件树「全部折叠」) · `FilePlusCorner`(新建配置) · `ArrowUpDown`(项目排序) · `AArrowDown`/`AArrowUp`(名称升/降序) · `ClockArrowDown`/`ClockArrowUp`(时间升/降序) · `Plus`(新建终端) · `Terminal`(终端 Tab) · `Search`(左栏项目筛选 / Files 树顶筛选 / 终端搜索框)/`ChevronUp`/`ChevronDown`/`X`(筛选清空 / 终端搜索框 / 关闭 Tab)。运行三角以 `--run-glyph` 上色。

Git 图谱专用：`GitBranch`(Git Tab) · `SlidersHorizontal`(视图选项) · `GitCommitHorizontal`(提交，等同点「未提交的更改」行) · `RotateCw`(刷新) · `CircleArrowDown`(拉取) · `CircleArrowUp`(推送) · `GitBranchPlus`(创建分支) · `Settings`(仓库设置) · `LoaderCircle`(加载 / 动作进行中) · `TriangleAlert`(操作失败) · `Ellipsis`(提交面板文件行 … 菜单)。

## 布局

```
┌── 侧栏 280px 固定 ──┬────────────────────────────┐
│ 左树面板 --bg-panel  │ 控制台区 --bg-deepest       │
│                     │ Tab 栏                     │
│ ▾ project-a  ＋ ✕   │ ┌ 操作栏: ▶ ■ ⌫       ┐ │
│  ● dev   ✎ 🗑 ▶      │ │                       │  │
│  ● build ✎ 🗑 ▶      │ │  xterm (JetBrains Mono)│  │
│  检测到的配置  2 ▸  │ │                       │  │
│                     │ └───────────────────────┘  │
│ ▾ project-b  ＋ ✕   │                            │
└─────────────────────┴────────────────────────────┘
   项目间留白，配置不缩进，「检测到的配置」为底部触发的临时弹出菜单
```

- **左树**：固定 280px，**项目间留白**。Project（可折叠）下**直接列出 Run Configuration**（无「我的配置」小标题；**行背景不缩进、仅内容缩进对齐**——状态点对齐文件夹图标列、名称对齐项目名，靠"补空占位列 + 居中点盒"实现）；探测脚本收进一个**临时弹出菜单**（**Base UI Popover**，即项目组件库；**深色背景 `--bg-panel` 与列表一致**；点触发浮出、点外面 / Esc 关闭，**选中或运行菜单项即刻关闭**；菜单项与配置行同款样式）。触发行置于配置列表最下方，UI 标签为**「检测到的配置」**（**文案与配置状态点对齐**，**数字在箭头前**，**箭头在右**）。项目行 hover 显示「更多」⋮；项目行右键与「更多」共用菜单项：**打开文件夹**（`FolderOpen`）/ **新建终端**（`Terminal`）/ **新建配置**（`FilePlusCorner`）/ **置顶** 或 **取消置顶**（`Pin` / `PinOff`，在「移除」之上）/ **移除项目**。已 **Pin** 时空闲在「更多」同槽显示小图钉（muted），hover / 拖拽时**原地换成** ⋮（不挤到旁边）。无行内单独图钉按钮。项目名右侧显示包管理器角标（**pnpm 作为默认不显示**；hover 出按钮时让位隐藏）。
- **Pin 与列表**：**Pin** 分区——已置顶整段在未置顶之上，组内仍走当前排序；新项目默认不 Pin。置顶 / 取消置顶分别进入目标区块**开头**（改落盘序，不自动切排序 mode）。置顶**标题行**为列表直接子节点；**默认** `position: sticky` 按序叠放（`top: n×(40+1)`，行间 1px 不透明缝）；排序菜单「固定置顶」可关叠放——关后每项包进段容器、当前段 `top:0` 吸顶，**下一段把上一段顶走**（不覆盖）。未置顶**标题行**在本项目块内吸顶，贴在置顶堆下方（被下一段顶走）。配置区照常滚走。**点击项目标题**：标题已完全在列表视口内则不滚；已滚过段起点（吸顶）则经非 sticky 段锚滚回段首（`scroll-margin-top` 预留吸顶高度；对齐 Git 段头跳转）。术语见 CONTEXT.md / `docs/prd/project-pin.md`。
- **标题栏**：左侧低调筛选（透明底 + 小 `Search` 图标，聚焦时才出行 hover 底；有内容时右侧出清空 `X`；焦点在列表上可打印字写入、Esc 清空，同 Files 树顶筛选；按项目名大小写不敏感包含过滤，只显示匹配项；筛选结果仍保持 Pin 分区）。右侧排序按钮（`ArrowUpDown`）+ 新建/添加（`FolderPlus`）。排序菜单：自定义 / 名称 / 添加时间 / 打开时间；**分隔线**；**固定置顶**（勾选开关：开＝已 Pin 行滚动叠放吸顶；关＝不叠放，但视口最上的项目行仍当前段吸顶。默认开，持久化于 `projectSortPrefs.pinSticky`）。**默认添加时间倒序**（新→旧；已持久化偏好不覆盖）。名称与添加时间再点同一项翻转升/降序；**打开时间固定最近→最远、不可翻转**；自定义无方向。当前项左侧单一图标兼作选中——自定义用勾、名称用 `AArrowDown`/`AArrowUp`、添加时间用 `ClockArrowDown`/`ClockArrowUp`、打开时间只用 `ClockArrowDown`；「固定置顶」开时左侧勾。**打开时间排序下**选中/打开某项目后等它排到本组最前，再以 `scrollIntoView({ block: 'nearest' })` 滚入视口（不再特供滚到列表顶）。**新增项目**：插入落盘数组头（未置顶区靠前；勿与 **Pin** 混淆），并写入 `lastOpenedAt`；添加时间倒序靠 `addedAt` 自然靠前；名称 / 添加时间升序不强制靠前；**添加成功或命中已登记项目后均选中该项目**，并以 `scrollIntoView({ block: 'nearest' })` 滚入视口（已可见则不动，对齐 Git 父提交跳转）。底边 1px `--separator`（与右 Tab 栏同）。
- **项目支持拖拽排序**（无筛选时任意排序模式均可拖；@dnd-kit，PointerSensor 距离 6px；**仅垂直**；**钳制在当前 Pin 组边缘**（并与列表可视区取交），不可拖出组外；**不可跨 Pin 边界**——组内可排，跨界在碰撞检测阶段即忽略、不落盘、不改 Pin；置顶 / 未置顶分属两个 SortableContext）。**仅当松手后顺序实质变化**才落盘，并在非自定义模式下自动切到「自定义」；拖了但未改序则不覆盖原自定义顺序。**拖拽进行中所有项目暂时收起**，锚点按所见视口 Y（含吸顶）；收起后关 sticky，用 `needScrollTop = offsetTop - anchor` 钉住被拖项：偏上加顶 padding、可滚则设 scrollTop、超出 maxScroll 时用底 padding 撑高再滚（**不用负 margin**）；拖中向下滚按增量吃掉顶 padding 并回退等量 scrollTop；**拖拽中左树其它元素不响应 hover**。**松手后**记下被拖项视口位置，展开后仅用 scrollTop 尽量拉回（不加 padding）。筛选中禁用拖拽（菜单仍可开关 Pin）。
- **配置支持拖拽排序**（@dnd-kit，PointerSensor 距离 6px 激活以不误触点击；**仅垂直移动、钳制在本项目配置列表内**——父容器不含「检测到的配置」触发行；顺序落盘、松手即时生效不回跳；拖中同样抑制左树其它 hover）。
- **行内图标按钮**四周内边距一致 6px（固定高 `h-10` + `px-1.5`）。
- **行选中**：`--selection-row` 圆角填充；其上按钮 hover 用 `--selection-row-hover`（蓝）而非灰。
- **右控制台**：顶部为**当前项目的 Tab 栏**（详见下「Tab 栏」）；**激活运行会话 Tab 时**其下再出一行**操作栏**（高 40px、`--bg-panel`、底边 1px `--separator`，与 Tab 栏 / 左标题栏同高同色）；再下方是当前激活 Tab 的 xterm 正文。Git / 终端 Tab 不出操作栏。无激活 Tab 时显示占位提示（「点击 ▶ 运行配置」）。Tab 高度同左侧标题栏 40px、同 `--bg-panel` 底，选中态用 `--primary` 主色下描边 3px、文字在整栏含描边区垂直居中、hover 高亮 `--bg-row-hover`。
- **运行会话操作栏**（仅激活运行会话 Tab 时）：仅按钮——运行 ▶ / 重跑 ↻、停止 ■、清空 `Eraser`；尺寸/间距与左树同款。无配置名/状态文案（Tab 已承载）。停止仅运行中可点；清空清掉该会话控制台输出（进程继续，主进程无头缓冲同步清空）。

## 交互（呼应 CONTEXT.md / PRD）

- **行内操作 = 两个固定槽**（配置行，**空闲仅 hover / 选中显示，运行中恒显**）：**左槽** 运行 ▶ / 重跑 ↻、**右槽** 更多 ⋮ / 停止 ■——激活即两槽**原地替换**（运行→重跑、更多→停止）。更多菜单打开时其按钮保持可见（受控 open 状态）。配置行右键与「更多」共用菜单项：编辑 `Pencil`（仅命令型）+ 删除 `Trash2`（运行中亦可右键）。运行/重跑实心绿 `--run-active-bg`、停止实心红 `--stop-active-bg`。探测脚本（弹层内）只有运行；**选中或运行即晋升**进「我的配置」（不必等运行），并即刻关闭弹层。
- **"激活" = 会话运行中态**（非鼠标按下）：配置一旦有活跃 Run Session，运行按钮即变实心绿的重新运行、旁出实心红停止。
- **克制展示**：非 hover 行只显示状态点 + 名称；hover 或选中才浮出按钮（WebStorm 手感）。
- **控制台跟随选择**、退出后保留输出（见 PRD 用户故事 22–25）；**运行 / 重跑 / 切换选择后自动聚焦终端**（可直接输入 stdin）；**每次运行先输出头部**（同一行：工作目录灰字 + `$` + 命令粗体）再接进程输出，**结束后空一行再补「进程已结束，退出代码为 N」**（标准色），并将终端切为**只读**（禁输入、隐藏光标，仍可选中 / 复制 / 搜索）。
- **终端能力**（xterm 插件）：链接可点击（经主进程 `shell.openExternal` 走系统浏览器，仅放行 http/https）；**Cmd/Ctrl+F 搜索输出**（右上浮层搜索框，Enter / Shift+Enter 下/上一条、Esc 关闭，高亮取自 Shell.icls SEARCH_RESULT 绿 `#2d543f`）；WebGL 渲染器（大量输出更顺，不可用回退 DOM）；Unicode 11 字宽（emoji / CJK 对齐）。

## Tab 栏（以项目为维度）

右控制台顶部的 Tab 栏承载**当前项目**的全部 Tab。除**常驻的 Git Tab / Files Tab**外，其余每个 Tab = 一个活的会话（Run Session 或 Terminal）。高 40px `h-10`、底 `--bg-panel`、底边 1px `--separator`，与左标题栏同高同色同底边；术语见 CONTEXT.md、取舍见 ADR-0003（含修订）、ADR-0005（常驻非会话 Tab + 默认激活）：

- **Git Tab**：**每项目常驻第一个、不可关闭**（无 `×`）。`GitBranch` 图标 16px + 「Git」（14px）+ 当前分支名用括号包住（如 `Git (main)`，muted 色、截断；detached HEAD 显示缩写 hash；项目成为当前项目时即预加载，Tab 栏始终显示分支名，不必等点开 Git Tab；此后随 git:changed 保鲜）；左右内边距对称（`pl-3 pr-3`，12px，因无 `×`）。选中态与 hover 同其它 Tab。它不是会话——数据状态存独立 git store，切走仅隐藏不卸载；当前项目由 App 预加载，打开 Git Tab 时若已就绪则只重验仓库根。
- **Files Tab**：**每项目常驻第二个、不可关闭**（无 `×`，紧接 Git 之后、会话之前）。`FolderOpen` 图标 16px + 「文件」（14px）；左右内边距对称（同 Git，因无 `×`）。文件树（不按 `.gitignore` 过滤；隐藏 WebStorm Ignored Files 默认项如 `.git` / `.DS_Store`）+ 单文件正文：文本用 CodeMirror 6（实验对照分支；**仅语法高亮与文本编辑**——无 lint / 补全；Monaco 对照见 `backup/files-tab-monaco`）；图片内嵌预览；可播音视频居中原生控件预览；其余占位并提供「在其他应用中打开」。工具栏：相对路径**可点面包屑**（左对齐；段间 `ChevronRight`、目录段 muted、文件名有工作区 Git 状态则用 `--git-status-*` 否则 `--fg-primary`；hover 只改文字色、无底；点目录/文件名 → 右侧树展开并滚到对应行；无未保存圆点）+「最近打开文件」(`FileClock`，下拉最近 10 个：文件名正文色 + 目录路径 muted，空则「暂无最近打开文件」；无正文时也显示) +「在文件树中显示」(`ListTree`，定位当前文件；若树已隐藏则先显示再滚到行) +「在文件夹中显示」(`FolderOpen`) +「在其他应用中打开」(`SquareArrowOutUpRight`) + 文件树隐藏时最右「显示文件树」(`PanelRight`，与左侧钮组之间 1×12px `--border-input` 竖线)；**双击编辑区标题栏**切换文件树显隐（面包屑与右侧钮组不触发），文案对齐 Git 菜单 / VS Code Reveal。**文件树行交互对齐左树、尺寸更紧凑**：树顶 header（同高 h-10）左侧常驻筛选（`Search` + 占位「筛选」，有内容时清空 `X`，样式同左栏项目筛选；扫描中极轻提示）；焦点在树上时可打印字写入、Esc 清空；按相对路径包含收窄**同一棵树**（保留结构；目录命中带整支；无匹配「无匹配文件」；不过滤高亮）；右侧「全部展开」(`ChevronsUpDown`) /「全部折叠」(`ChevronsDownUp`) / 最右「隐藏文件树」(`Minus`)（过滤期间展开/折叠只作用于过滤后的树）；固定宽 280px；可整块隐藏（编辑区占满，不留窄条把手；可见性不持久化，重挂载默认展开）；`h-8` / `rounded` / 13px / `transition-colors`；目录名默认 `text-foreground`、选中 `--fg-primary`；文件名/图标按工作区 Git 状态色（同提交面板 `FILE_STATUS_COLOR`，无状态时图标 `--fg-icon`、名正文色），选中压成 `--fg-primary`；选中行 `--selection-row`（hover 不变色），未选中 `hover:bg-row-hover`；行背景全宽、仅内容按层级缩进；图标/箭头 14px（`size-3.5`；文件夹/文件图标 `--fg-icon` 或状态色，箭头 `muted` 不同色）；目录始终 `Folder`（展开不换 `FolderOpen`，靠箭头旋转表示开合）。事件自动保存；无内层多文件 Tab、无文件 CRUD。左栏 ProjectTree 不动。Git「打开文件」进入本 Tab。切走隐藏不卸载；每项目持久化上次打开路径与树展开（路径无效则静默空态）。布局为左正文 / 右文件树；未打开条目时空态文案「在右侧选择文件」。
- **运行会话 Tab**：**每条有会话的配置一个**（运行中或已退出未关闭）。状态点 + 配置名（14px）；`×` 常驻（背景仅 hover，圆形、颜色过渡）——运行中＝**停止并关闭**（温和停止，不二次确认），已退出＝关闭并弃输出（树上状态点回灰）。**顺序跟随树中配置顺序**；重跑复用原 Tab（单实例语义不变）。
- **终端 Tab（Terminal）**：`Terminal` 图标 16px + 名称；`×` 同上（关闭即杀 shell）。默认名「终端 / 终端 (2) …」按项目内序号，**双击可改名**（按项目持久化）。**组内支持拖拽排序**（仅水平、钳制在终端组内，不与运行会话组混排；顺序按项目持久化）。整组排在运行会话组之后。冷启动恢复壳、第一次激活才起 shell（无历史输出）；关 Tab / shell 自退出与落盘同步。
- **末尾 `+`**（`Plus`，tooltip「新建终端」）：在当前项目根目录起一个交互 `$SHELL` 的新终端 Tab 并聚焦。
- **选中态** 3px `--primary` 主色下描边、**hover** `--bg-row-hover`；Tab 过多时横向溢出、走全局细滚动条。
- 每个会话 Tab 常驻各自的 xterm 实例（切走仅隐藏、不卸载，跨项目亦然），故后台会话仍在跑、滚动历史与现场保留；切回某项目恢复其激活 Tab。Git / Files 面板同「切走隐藏不卸载」。
- **激活解析**：每项目记「激活的 Tab」（跨重启持久化）。Tab 顺序 = Git → Files → 运行会话（树序）→ 终端。**点配置** → 有会话聚焦其 Tab、没跑过**不动当前激活 Tab**；**运行 / 重跑** → 聚焦其 Tab 并聚焦终端；**点项目行** → 保持该项目原激活 Tab；**点 Tab** → 只切视图、**不改树选择**（树选择与 Tab 激活解耦）。**关闭**激活 Tab → 左邻（其次右邻）；常驻 Tab 上 Cmd+W 无效。**默认激活**（无合法记忆 / 解析缺省）：有运行中的 Run Session 则取 Tab 栏从左到右第一个运行中的，否则按 Tab 序（即 **Git Tab**）——有项目即无占位态。Run Session Tab 本身不跨冷启动恢复。

**当前项目与选中**：左树**项目行与配置行是同一层级的互斥选中**——单击项目行＝选中「项目本身」（右侧切到它的 Tab 栏、项目行以 `--selection-row` 高亮、清空配置选中）；单击配置行＝选中该配置（只高亮配置行，不连带高亮其项目行）。**折叠 / 展开由左侧箭头或整行双击触发**。新建 / 点选某终端也会把其项目设为当前。当前项目与左树选中跨重启持久化（配置已删则回落项目行；恢复当前项目时更新 `lastOpenedAt`）。项目行上的「更多」按钮，其 hover 底色跟随行态（选中蓝底行用 `--selection-row-hover`）。空项目（尚无配置与探测脚本）亦可点行进入并新建终端。

**终端交互**：终端**始终可交互**（不像运行会话退出后转只读）；切到 / 新建即自动聚焦、可直接输入；shell 自行结束（`exit` / Ctrl-D / 崩溃）即**自动关闭**该 Tab。xterm 能力（Cmd/Ctrl+F 搜索、链接点击、WebGL、Unicode 11）运行会话与终端一致。**快捷键**：`Cmd/Ctrl+T` 在当前项目新建终端、`Cmd/Ctrl+W` 关闭当前激活的 Tab（运行会话或终端；运行中温和停止；Git Tab 无操作）、`Ctrl+Tab` / `Ctrl+Shift+Tab` 在当前项目的全部 Tab 间循环。

## Git 图谱（Git Tab）

移植自 vscode-git-graph，观感套进本工作区的深色（Darcula）体系；术语见 CONTEXT.md（Git Tab），产品范围见 `docs/prd/git-graph.md`。

- **顶部工具栏**（高 40px、底 `--bg-panel`，同 Tab 栏）：左 = 分支筛选下拉 + 视图选项 Popover（`SlidersHorizontal`，五个数据可见性开关 + 提交排序三选一）+ `Search` 查找（紧挨视图选项）；右 = 图标钮组（`GitCommitHorizontal` 提交 / `RotateCw` 刷新 / `CircleArrowDown` 拉取当前分支 / `CircleArrowUp` 推送当前分支 / `GitBranchPlus` 创建分支 / `Settings` 仓库设置——面板仅剩隐藏的远程、用户信息、远程管理）。提交钮等同点图上「未提交的更改」行打开提交面板，无改动也可用（只勾「修正」改信息等场景）；仅空图（空仓库且无改动，详情面板无处停靠）时禁用。刷新 = fetch + 静默软重载（fetch 期间刷新钮转圈，不弹进行中遮罩）；拉取 / 推送在 detached HEAD 或没有远程时禁用（禁用即可，不显提示文案；无上游也可打开，remote 与分支在对话框表单里选）；拉取在操作进行中（变基/合并/拣选/回滚中断）时也禁用，title 注明原因（「变基进行中，请先完成或中止」按状态措辞）。**切分支筛选 / 改视图开关走图谱级重载**：只给图谱区盖半透明 loading，工具栏与分支下拉不闪没。
- **操作进行中状态条**：变基/合并/拣选/回滚中断（冲突等）时，工具栏下方常驻一条紧凑状态条（h-9、`bg-panel`、顶部 `--separator` 细线，`TriangleAlert` 用 `--status-failed`）：左 = 状态文案（「变基进行中——解决冲突并暂存后继续，或中止」；merge 为「解决冲突后在提交面板完成提交，或中止」），右 = 小按钮组「继续 / 跳过 / 中止」（merge 仅「中止」；按钮 h-6 描边款，观感对齐错误态「重试」钮）。继续 / 跳过点击即执行（走进行中遮罩，失败落既有错误框）；中止先弹危险确认。期间会撞车的入口统一防误触：右键菜单的检出 / 合并 / 变基 / 拉取 / 拣选 / 回滚 / 丢弃提交 / 重置 / 贮藏应用·弹出·建分支**置灰 + hover 原因**（只禁用不隐藏，防菜单结构跳变），双击标签检出在 handler 早退（无可视禁用面，原因由状态条解释）。
- **提交表格**：紧凑行高 24px（图谱网格 `grid.y`）、13px。列 = 图谱 / 描述 / 日期 / 作者 / 提交哈希（8 位缩写，`font-mono`）。图谱列宽随分支线内容同步（下限一列宽 32px，图谱表头窄边距 `px-1` 恰容「图谱」二字）、上限视图 1/3，超出用 SVG 右缘 12px 渐隐。
- **分支线配色**：12 色循环调色板 `--git-graph-color0..11`（沿用参考默认值）；行级 `data-color="i"` 注入 `--git-graph-color`，圆点/标签/HEAD 空心圆引用它。未提交更改行与其线为灰 `--git-uncommitted`。
- **引用标签顺序**：stash → 当前分支（提前）→ 其余本地分支 → 远程分支；tag 独立一组。当前提交行加粗、HEAD 圆点空心。已合并进 HEAD 的 merge commit 半透明（mute）。
- **详情面板**：吊底停靠（默认高 250px、顶边可拖 [100,600]），左右分栏可拖（比例 [0.2,0.8]）。左 = 提交/贮藏元信息（hash 可复制、父提交可跳、`mailto`/URL 链接）、右 = 文件变更树（单链文件夹压缩、圆角块行、**目录行逐级 sticky 吸顶**、状态色见 `--git-status-*`（A/U 增绿 · M/R 改蓝 · D 删灰 · `!` 冲突）、`+N -M`；**当前打开 diff 的文件行以 `--selection-row` 高亮、文件名转白 `--fg-primary`**）。
- **提交面板**：未提交行的详情即提交面板（ADR-0006，对齐 SourceTree）——左 = 提交信息多行框，其下一行「修正上次提交」勾选在左、「提交并推送」(ghost) 与「提交」按钮靠右（不再收进二级菜单）；右 =「已暂存 / 未暂存」两段文件树（**区头即可折叠顶级目录：箭头旋转过渡、双击 / 点箭头折叠整段、单击滚动到该段；区头 checkbox 同目录逻辑（整段全暂存才勾）、双向 sticky 常驻（已暂存钉顶、未暂存未到时钉底预告 / 滚到时钉在已暂存区头下方，两段标题恒可见）；内部目录行逐级 sticky 吸顶**、**目录行 checkbox 暂存/取消该目录下全部文件**、勾选文件即 `git add`、取消勾选即 unstage、**勾选后复选框原地即时翻转、文件先不移段（乐观勾选），期间面板锁定禁止暂存操作；待 git 确认、真实数据落地后文件才移到另一段，失败则还原复选框并解锁**、文件行单击 = 选中并看 HEAD→暂存 或 暂存→工作区 diff、目录行单击 = 选中（chevron 或双击开合）、**支持文件管理器式多选（Cmd/Ctrl 加减选、Shift 范围选，文件与目录皆可选）、选中行以 `--selection-row` 高亮、文件名转白 `--fg-primary`、跨两段互斥（切段即清空）、右键选区出批量菜单（暂存 / 取消暂存 / 撤销更改 / 删除未跟踪 所选）、点选区内任一行的复选框即对整批联合暂存 / 取消**、行尾 `Ellipsis` 菜单：撤销更改 / 删除未跟踪文件 / 打开文件 / **在文件夹中显示** / 复制路径；暂存类操作静默即时、不弹进行中遮罩）。复选框/单选统一用 shadcn `Checkbox`/`RadioGroup`（Base UI）。默认高 392。面板不随「未提交更改」行消失而自动关闭（目标是工作区、恒不过期）：无改动时可从工具栏直接打开（两段皆空占位），提交/丢弃清空全部改动后仍保持打开。
- **Diff 面板**：应用内 diff，`absolute` **只覆盖图谱表格区**（吊底详情/文件列表仍可见，点文件看 diff 时能继续切文件）。正文由 `@git-diff-view/react` 渲染（语法高亮 + 词级 diff 内置、无虚拟滚动，ADR-0007）；头部可切**统一（`AlignJustify`）/ 左右对比（`Columns2`）**两视图，偏好存 `viewPrefs.diffSplitView` 跨会话记忆、**默认左右对比**。**横竖滚动条常驻面板边缘**（`main.css` 限高库滚动容器，split 两栏纵横同步由库内置 syncScroll 承接）。配色在 `main.css` 以库的同选择器覆盖其主题变量、全部引用既有 token：hunk 头底 `--diff-hunk-header-bg`、新增 `--diff-add-bg`、删除 `--diff-del-bg`、词级高亮 `--diff-add-word-bg` / `--diff-del-word-bg`、正文底 `--bg-deepest`、等宽 `--font-mono`；二进制兜底，120ms 延迟加载态。
- **查找**：`Cmd/Ctrl+F` 右上浮层（样式同终端搜索框），命中行高亮 `--find-match-bg`、当前项 `--find-match-active-bg`（取自 Shell.icls SEARCH_RESULT 绿）。
- **右键菜单 / 对话框**：Base UI Menu（鼠标坐标虚拟 anchor）+ ConfigDialog 同款遮罩弹窗（`w-[440px] bg-panel`）；危险操作先确认，追问链（强删 / 重名替换 / 推标签预警）对齐参考。拉取 / 推送对话框已表单化（remote 与分支选择、整合方式三选一、目标远程分支可输可选、可勾选推送分支上的标签，分支字段旁附行内刷新钮静默 fetch）。动作进行中遮罩（可隐藏继续看图）、失败转错误框。交互式变基在项目 Terminal Tab 里启动。
- **键盘**：`Esc` 分层关闭（diff → 详情 → 菜单 → 对话框 → 查找）、`Cmd/Ctrl+R` 软刷新、`Cmd/Ctrl+F` 查找；焦点在输入控件时让位。
- **链接放行**：详情里的链接经 `shell.openExternal`，放行 `http/https/mailto`。
- **图标**：见「图标」节的「Git 图谱专用」一行。

## 待校准

- ANSI 仅 `black`（`#27282E`）为**推导**（Shell.icls 无精确来源），其余已由导出逐项核验；`--accent`（`#3574F0`）为推导。
- UI 主题（树选中蓝、按钮绿）来自手取；如需绝对像素级，可后续从 New UI 的 `theme.json` 再校一遍。
- Git 图谱的 diff 配色（`--diff-add-bg` / `--diff-del-bg` / `--diff-*-word-bg` / `--diff-hunk-header-bg`）为 Darcula 系**推导**，未从 `.icls` 逐项核验；`--git-graph-color0..11` 沿用 vscode-git-graph 默认调色板，未按本工作区重新配色。
