# DevCube — 视觉与交互方向

**定位**：像素级复刻 WebStorm（JetBrains New UI · 2026.1）的外观。深色对齐 **Darcula**，浅色对齐 **New UI Light**；两档，不跟随系统，默认深色（切换机制见 ADR-0026）。UI 底座 **shadcn（Base UI）+ Tailwind**，JetBrains 观感通过覆写 CSS 变量实现（圆角砍到近 0、密度压紧）。控制台 **xterm.js + JetBrains Mono**。

**色彩来源**

深色沿用历史两套来源——① IDE UI 主题（面板 / 树选中 / 运行按钮等，**用户手取**）；② 编辑器/控制台配色 `Dark.icls`（**原件已入库 `docs/reference/Dark.icls`**）。两处 1 单位手取误差以 .icls 为准：最深/控制台背景 `#1E1F22`（非 `#1E2022`）、行 hover `#43454A`（非 `#43444A`）。

浅色**不手取**，全部从 WebStorm 2026.1 的 `Contents/lib/intellij.platform.ide.impl.jar` 内解出，**原件已入库 `docs/reference/`**（同 Dark.icls 的待遇，取色一律以它们为准、不凭记忆）：

| 层                       | jar 内路径                            | 入库文件                                              |
| ------------------------ | ------------------------------------- | ----------------------------------------------------- |
| UI（面板 / 选中 / 按钮） | `themes/expUI/expUI_light.theme.json` | `reference/expUI_light.theme.json`                    |
| 编辑器（语法 / Git 色）  | `themes/expUI/expUI_lightScheme.xml`  | `reference/expUI_lightScheme.xml`                     |
| 两者继承的基方案 + ANSI  | `DefaultColorSchemesManager.xml`      | `reference/DefaultColorScheme.xml`（只摘 Default 段） |

生效链由 `product-backend.jar!META-INF/plugin.xml` 坐实：`themeProvider ExperimentalLight(targetUi="new")` → `expUI_light.theme.json` → `editorScheme:"Light"` → `bundledColorScheme id="Light"` → `expUI_lightScheme.xml`。`themes/Light.xml` 是 `targetUi="classic"` 的旧 UI 方案（注册名 `IntelliJ Light`），**不生效**。

⚠ 解析这些 XML 时注意短写十六进制：长度 <6 的 `value` 按整数左补零（`ValueElementReader.toColor`），如 `6dcc` = `#006DCC` 而非 `#0066CC`。

下表中标「推导」的，是浅色方案里确实没有对等取值、由代码级 fallback 或同族键推出来的；其余均为直取。

## 设计 Token

**表面 / 结构**

| 变量                | 深色      | 浅色      | 用途                                                                                            |
| ------------------- | --------- | --------- | ----------------------------------------------------------------------------------------------- |
| `--bg-deepest`      | `#1E1F22` | `#FFFFFF` | 控制台底 / 编辑器底、最深区；深色下兼当分割凹槽，**浅色下语义反转**（比面板更亮，分割另走描边） |
| `--bg-panel`        | `#2B2D30` | `#F7F8FA` | 左树面板 / 工具栏 / 顶栏 / Tab 栏（浅色取 `ToolWindow.background`）                             |
| `--bg-elevated`     | `#2B2D30` | `#FFFFFF` | 浮起于面板之上的表面：弹层（菜单 / 下拉 / 浮窗 / 对话框）、输入控件、按钮。深色下与面板同值     |
| `--bg-row-hover`    | `#393B40` | `#EDF3FF` | 树行 / 触发行 hover（浅色取 `*.hoverBackground`，蓝调）                                         |
| `--bg-button-hover` | `#515257` | `#E6E6E8` | 行内图标按钮 hover 底（浅色为 `ActionButton.hoverBackground` `#00000012` 合成于面板）           |
| `--mask`            | 黑 50%    | 黑 20%    | 全屏弹层遮罩（浅底压黑要淡得多，否则整屏发灰）                                                  |
| `--mask-weak`       | 黑 40%    | 黑 16%    | 叠在弹层之上的内层确认遮罩                                                                      |

CARET_ROW_COLOR（深 `#26282E` / 浅 `#F5F8FE`）**不是 CSS 变量**——控制台当前行没做，Files 编辑器的行号栏活动行由 `cm6-setup.ts` 的 `caretRowGutter` 持有，正文活动行用等效半透明叠色（见「排版 / 密度 / 形状」）。

**文字 / 图标**

| 变量                | 深色      | 浅色      | 用途                                                                                                          |
| ------------------- | --------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| `--fg-primary`      | `#DFE1E5` | `#000000` | 主文字（New UI Light 正文确为纯黑，未软化）                                                                   |
| `--fg-icon`         | `#CED0D6` | `#6C707E` | 主图标（浅色为实测 `expui/general/*.svg`）                                                                    |
| `--fg-muted`        | `#868A91` | `#818594` | 分组标题（候补 / 我的配置）、灰字说明                                                                         |
| `--fg-disabled`     | `#6F737A` | `#A8ADBD` | 禁用 / 失效引用（深浅两侧 muted 与 disabled 的明暗关系相反）                                                  |
| `--fg-dialog-title` | `#A7A8A9` | `#494B57` | 弹窗标题（两侧都是**推导**，theme.json 无此角色）                                                             |
| `--fg-code`         | `#BCBEC4` | `#080808` | 代码前景（.icls TEXT/CONSOLE FOREGROUND 同值；MD 预览代码块。cm6-setup / xterm-theme 为语义隔离各自持有同值） |

**边框 / 选中 / 强调**

| 变量                    | 深色      | 浅色      | 用途                                                                                                                                                                            |
| ----------------------- | --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--border-input`        | `#4F5157` | `#C9CCD6` | input / select / dialog 描边（`Component.borderColor`）                                                                                                                         |
| `--separator`           | `#1E1F22` | `#EBECF0` | 面板间 1px 分隔（深色是凹槽 = `--bg-deepest`，浅色是描边 ≠ `--bg-deepest`）                                                                                                     |
| `--selection-row`       | `#2D436E` | `#D4E2FF` | 选中行圆角填充（`*.selectionBackground`）                                                                                                                                       |
| `--selection-row-hover` | `#35538F` | `#C2D6FC` | 选中（蓝底）行上按钮的 hover 底（非灰；`List.Button.hoverBackground`）                                                                                                          |
| `--editor-selection`    | `#224283` | `#A6D2FF` | Files 编辑器文本选区（≠ 行选中蓝）。深色 `#224283` 是手取值，官方 Darcula 为 `#214283`                                                                                          |
| `--primary`             | `#3574F0` | 同深色    | 强调主蓝（New UI，浅深共用同一颗）。CSS 落名为 shadcn 语义 `--primary`；**CSS 里的 `--accent` 是 shadcn hover 语义，勿与主蓝混用**。**焦点环全局关闭**（`--ring: transparent`） |
| `--link`                | `#548AF7` | `#006DCC` | 链接（HYPERLINK_ATTRIBUTES）                                                                                                                                                    |
| `--search-match-bg`     | `#BA9752` | `#FEE6B1` | 内容搜索列表命中胶囊底（New UI `SearchMatch.startBackground`＝`endBackground`：深 Yellow5 / 浅 Yellow7，起止同色即纯色）                                                        |
| `--search-match-fg`     | `#000000` | `#323232` | 命中胶囊文字（平台 `STYLE_SEARCH_MATCH` 写死 `JBColor(Gray._50, Gray._0)`，两侧均深字）                                                                                         |
| `--fg-info`             | `#6F737A` | `#818594` | 附属信息灰字（New UI `*.infoForeground`：两侧同取 Gray7，恰与深色 `--fg-disabled` / 浅色 `--fg-muted` 各撞值但语义独立；内容搜索列表的行号 / 目录路径 / 计数）                  |

**运行 / 停止按钮**

| 变量                     | 深色      | 浅色      | 用途                                                                                                                                  |
| ------------------------ | --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `--run-glyph`            | `#5FAD65` | `#208A3C` | 空闲态绿三角。浅色不取 `RunWidget.runIconColor`——那颗服务的是 New UI 的深色主工具栏，白底对比度不够，改取图标本体 `expui/run/run.svg` |
| `--run-active-bg`        | `#57965D` | `#599E5E` | 运行中（重新运行）实心底（`RunWidget.runningBackground`）                                                                             |
| `--run-active-bg-hover`  | `#4E8752` | `#508F55` | 运行中 hover（`RunWidget.hoverBackground` `#00000019` 合成于底色）                                                                    |
| `--stop-active-bg`       | `#C94F4F` | 同深色    | 运行中停止按钮实心底（浅深同值）                                                                                                      |
| `--stop-active-bg-hover` | `#B54747` | 同深色    | 停止 hover                                                                                                                            |

两侧实心底上的图标都保持白色（同 JetBrains）。

**状态点**

| 变量               | 深色      | 浅色      | 状态                                                                   |
| ------------------ | --------- | --------- | ---------------------------------------------------------------------- |
| `--status-idle`    | `#868A91` | `#818594` | 空闲 / 从未运行                                                        |
| `--status-running` | `#5FAD65` | `#208A3C` | 运行中                                                                 |
| `--status-success` | `#57965D` | `#208A3C` | 成功退出（exit 0）                                                     |
| `--status-failed`  | `#C94F4F` | `#DB3B4B` | 失败退出（非 0）。深色下与 `--stop-active-bg` 同值，**浅色下两者解绑** |

这四颗除了 8px 状态点，还兼作提交面板「+N / -N」的 12px 文字色，所以浅色取的是 New UI Light 的**前景**变体（`Badge.greenOutlineForeground` / `Label.errorForeground`，即 Green4 / Red4），不是图标填充用的 Green6 `#55A76A` / Red5 `#E55765`——后者在白底上只有 3:1 上下，当图标够用、当文字太淡。代价是浅色下「运行中」与「成功退出」同色（深色下两者也只差 2 个单位，本就近乎不可辨）。

**Git 文件状态色**（FILESTATUS_*；提交面板 / Files 树文件名与图标）

| 变量                     | 深色      | 浅色      | 来源 / 用途                                                                        |
| ------------------------ | --------- | --------- | ---------------------------------------------------------------------------------- |
| `--git-status-added`     | `#73BD79` | `#067D17` | FILESTATUS_ADDED；新增（A）；**未跟踪（U）也用此色**（不对齐 FILESTATUS_UNKNOWN）  |
| `--git-status-modified`  | `#70AEFF` | `#0033B3` | FILESTATUS_MODIFIED / RENAMED；修改 / 重命名（M / R）                              |
| `--git-status-deleted`   | `#6F737A` | `#6C707E` | FILESTATUS_DELETED；删除（D）。深色下与 `--fg-disabled` 同值，浅色下不再同值       |
| `--git-status-conflict`  | `#DE6A66` | `#DE1B2E` | FILESTATUS_IDEA_FILESTATUS_MERGED_WITH_CONFLICTS / changelistConflict；冲突（`!`） |
| `--git-status-merged`    | `#CF84CF` | `#643CB8` | FILESTATUS_MERGED；已合并（预留）                                                  |
| `--git-status-ignored`   | `#D69A6B` | `#8C4F00` | FILESTATUS_IDEA_FILESTATUS_IGNORED；已忽略（预留）                                 |
| `--git-status-untracked` | `#E88F89` | `#B23247` | FILESTATUS_UNKNOWN（**预留，当前 U 不用**）                                        |

**Git 行状态色**（\*\_LINES_COLOR；Files 编辑器行号栏 diff 条纹）

| 变量                  | 深色      | 浅色      | 来源 / 用途                         |
| --------------------- | --------- | --------- | ----------------------------------- |
| `--git-line-added`    | `#549159` | `#7FC784` | ADDED_LINES_COLOR；新增行绿条       |
| `--git-line-modified` | `#375FAD` | `#88ADF7` | MODIFIED_LINES_COLOR；修改行蓝条    |
| `--git-line-deleted`  | `#868A91` | `#767A8A` | DELETED_LINES_COLOR；删除位置灰短条 |

**滚动条（webkit）**

| 变量                      | 深色      | 浅色      | 用途                                                                         |
| ------------------------- | --------- | --------- | ---------------------------------------------------------------------------- |
| `--scrollbar-thumb`       | `#404043` | `#C6C6C8` | 全局细滚动条滑块（透明轨道）                                                 |
| `--scrollbar-thumb-hover` | `#626365` | `#7B7C7D` | 滑块 hover（浅色取 `ScrollBar.Mac.*` 的带 alpha 值合成，hover 提亮幅度更强） |

深色这两颗在 theme.json 里没有出处（平台 Java 侧写死），属历史手取值。

**控制台（xterm 主题）**

| 键         | 深色      | 浅色      | 来源                                                      |
| ---------- | --------- | --------- | --------------------------------------------------------- |
| background | `#1E1F22` | `#FFFFFF` | CONSOLE_BACKGROUND_KEY                                    |
| foreground | `#BCBEC4` | `#000000` | CONSOLE_NORMAL_OUTPUT                                     |
| cursor     | `#CED0D6` | `#000000` | CARET_COLOR                                               |
| selection  | `#2D436E` | `#A6D2FF` | 深色是手取的 UI 选中蓝；浅色取 .icls SELECTION_BACKGROUND |

ANSI 16 色取自配色方案的 `CONSOLE_*_OUTPUT`（深色 = Darcula，浅色 = Default 基方案，均在 `DefaultColorSchemesManager.xml`）。深色一组已与该文件逐项核对，16/16 一致。

|         | 深色 normal | 深色 bright | 浅色 normal | 浅色 bright |
| ------- | ----------- | ----------- | ----------- | ----------- |
| black   | `#000000`   | `#595959`   | `#000000`   | `#656565`   |
| red     | `#F0524F`   | `#FF4050`   | `#CE0505`   | `#FF1616`   |
| green   | `#5C962C`   | `#4FC414`   | `#067D17`   | `#16B42C`   |
| yellow  | `#A68A0D`   | `#E5BF00`   | `#B28C00`   | `#ECC32C`   |
| blue    | `#3993D4`   | `#1FB0FF`   | `#063FDB`   | `#2D61F0`   |
| magenta | `#A771BF`   | `#ED7EED`   | `#B309B3`   | `#E617E6`   |
| cyan    | `#00A3A3`   | `#00E5E5`   | `#028E8E`   | `#15C1C1`   |
| white   | `#808080`   | `#FFFFFF`   | `#929292`   | `#C9C9C9`   |

浅色的白 / 亮白在白底上对比度很低，这是 JetBrains 的原样取值，**不做可读性调整**。

平台里另有一套 `BLOCK_TERMINAL_*`（新终端用），与上表差别不小；DevCube 两侧都用 `CONSOLE_*`，以保持浅深口径一致。

**Files 编辑器语法色**（`cm6-setup.ts` 的 `DARK_SCHEME` / `LIGHT_SCHEME`）

两套一一对应，逐项出处见该文件行内注释。浅色有三项方案里没有对等值，取的是推导值：`docTag`（浅色 DEFAULT_DOC_COMMENT_TAG 只有下划线色，前景继承 doc 注释 `#8C8C8C`）、`badChar`（取 WRONG_REFERENCES_ATTRIBUTES `#F50000`）、`searchSelected`（取同块 ERROR_STRIPE_COLOR `#C47233`）。另有三项靠代码级 TextAttributesKey fallback 得到：`method` → FUNCTION_DECLARATION、`cssUrl` → HTML_ATTRIBUTE_VALUE → STRING、`htmlTagName` → DEFAULT_KEYWORD。

## 排版 / 密度 / 形状

- **UI 字体**：Inter，13px，行高 ~20px（JetBrains New UI 默认）；**树行文字 14px**，**次要信息（角标 / 小标题）最小 12px**（终端搜索计数 11px 除外）。
- **控制台字体**：JetBrains Mono，13px，行高 1.3，字重 500（补偿 WebGL 在 macOS 渲染偏细）。
- **Files 编辑器字体**（对齐 WebStorm 默认编辑器配色方案）：JetBrains Mono，13px，字重 500（补偿 macOS 灰度平滑渲染偏细，同控制台思路），无连字；行高 CSS `1.7`（`.files-codemirror`）；文本选区 `--editor-selection`（随主题翻），自绘分层矩形（官方 `layer()` 扩展点，见 `cm6-selection-layer`）——按整行块高度画（行距平摊、多行连续无缝）、跨行时行末并入一格空格宽代表换行符、圆角按外轮廓合成（VS Code selections.ts 同款三态角：相邻行边缘亚像素吸附，对齐接缝平直贯通、外露角圆 3px、凹角以「反圆角补丁」出内圆弧——选区色垫底 + 编辑器底色单角圆角覆盖；凹角判定带水平重叠守卫，行中起选等不重叠场景按外露圆角；按视觉行块迭代（跨折叠一块一行），结束在行首的零宽尾行不产出矩形）；活动行为等效半透明叠色（深色 `rgba(163,181,234,.06)` 叠在 `#1E1F22` 上精确等于 `#26282E`；浅色 `rgba(88,138,238,.06)` 叠在 `#FFFFFF` 上精确等于 `#F5F8FE`），选区从其下透出；正文/行号/语法色见 `cm6-setup` 的两套方案表。
- **JetBrains Mono 来源**：自托管官方完整可变字体（`src/renderer/src/assets/fonts/jetbrains-mono/`，v2.304），**不用** `@fontsource-variable/jetbrains-mono` 子集——后者不含 `⇧⌃⌥⌘`，快捷键显示会回退杂字体。设置 → 快捷键列用 `font-mono`。
- **侧栏**固定宽 **280px**（不可拖拽）。
- **树行 / 触发行**固定高 40px（`h-10`，四周内边距 6px；固定高以免 hover 出按钮时整行跳动）；行内图标按钮 28px、图标 16px；状态点 8px。共享 `Input` 高 28px（`h-7`），与常规图标钮对齐。
- **过渡**：凡 hover 变底色 / 变图标色的图标钮与 Tab `×` 一律带 `transition-colors`（Tailwind 默认 150ms）；展开箭头旋转 `transition-transform`；Tab 栏渐隐遮罩 `transition-opacity`。**hover 出钮**一律 `opacity-0 group-hover:opacity-100` + `transition` 渐显且不改变布局：钮常驻占位（提交面板文件行的 `…` 钮），或绝对定位盖在行尾、被盖住的尾字同步 `transition-opacity` 渐隐（工作树弹层的行尾钮，分支名平时贴右缘）；左树配置行的两个固定槽是例外（运行中恒显、原地替换，显隐切换）。
- **圆角**：按钮 / 弹出菜单 6px（`rounded-lg`）、条目/配置行高亮 4px（`rounded`）、面板 0；**弹窗类**（设置弹层 / 小对话框）统一 10px（`rounded-dialog` = `--radius-dialog`，对齐 macOS Big Sur+ 窗口系统圆角 ≈10pt——frameless 窗口四角由系统绘制，应用内弹窗与之等效）。
- **分段按钮**（JetBrains New UI SegmentedButton 的等价物，`ui/segmented-control.tsx`）：高 32px（`h-8`）外容器 6px 圆角 + `--border-input` 描边 + `--bg-panel` 底 + 1px 内边距；内部各段 4px 圆角、**不描边**，选中态纯靠底色 `--selection-row`（同左树选中行），未选中段 hover 走 `--bg-row-hover`。JetBrains 为该控件单列了 `SegmentedButton.selectedButtonColor` / `selected*BorderColor` 四个键，**刻意不采用**——只服务一个控件的颜色不该在全局 token 里单占，且描边 + 浮起底色的画法在本工作区会与容器描边叠成双层边。语义走 Base UI **Radio** 而非 ToggleGroup——后者单选态下再点已选项会取消，落到「一个都没选」，不适合必选项。
- **分隔线** 1px `--separator`（深色下是凹槽、浅色下是浅描边，见 token 表）。**弹出菜单分组线**用 `--border-input`（浅，同排序菜单）。
- **滚动条**：全局细滚动条（`::-webkit-scrollbar`），宽 8px、轨道透明、滑块 `--scrollbar-thumb`（hover `--scrollbar-thumb-hover`）；Tab 栏单独隐藏滚动条，但保留滚动能力。

## 图标

Lucide（随 shadcn）：`Play`(运行) · `RotateCw`(重新运行 / Git 刷新) · `Square`(停止) · `Eraser`(清空运行会话输出) · `MoreVertical`(更多⋮) · `Pencil`(编辑) · `Trash2`(删除) · `ChevronRight`(树展开 / 弹层箭头) · `FolderPlus`(添加项目) · `FolderOpen`(打开文件夹 / Files Tab 标签「文件」 / Files「在文件夹中显示」) · `FileClock`(Files「最近打开文件」) · `ListTree`(Files「在文件树中显示」) · `Minus`(Files「隐藏文件树」) · `PanelRight`(Files「显示文件树」) · `SquareArrowOutUpRight`(Files「在其他应用中打开」) · `Eye`(Files Markdown「预览」，回编辑用既有 `Pencil`) · `Undo2`(Files gutter 弹窗「回滚该块」) · `Copy`(同弹窗「复制旧文本」) · `ChevronsUpDown`(Files 文件树「全部展开」) · `ChevronsDownUp`(Files 文件树「全部折叠」) · `FilePlusCorner`(新建配置) · `ArrowUpDown`(项目排序) · `AArrowDown`/`AArrowUp`(名称升/降序) · `ClockArrowDown`/`ClockArrowUp`(时间升/降序) · `Plus`(新建终端) · `Terminal`(终端 Tab) · `Search`(左栏项目筛选 / Files 树顶筛选 / 终端搜索框)/`ChevronUp`/`ChevronDown`/`X`(筛选清空 / 终端搜索框 / 关闭 Tab)。运行三角以 `--run-glyph` 上色。

应用顶栏 / 设置：`Settings`(应用设置齿轮；Git 仓库设置仍用同图标) · 更新按钮用 `CircleArrowUp`（有则显示、无则整颗隐藏）。

内容搜索面板专用：`CaseSensitive`(区分大小写) · `WholeWord`(全词匹配) · `Regex`(正则表达式)；文件行沿用 `File`、状态行 `LoaderCircle`、「按文件分组」复用 `ListTree`。

Git 图谱专用：`GitBranch`(Git Tab) · `SlidersHorizontal`(视图选项) · `GitCommitHorizontal`(提交，等同点「未提交的更改」行) · `RotateCw`(刷新) · `CircleArrowDown`(拉取) · `CircleArrowUp`(推送) · `GitBranchPlus`(创建分支) · `FolderGit2`(工作树图标钮 / 左树链接工作树项目的文件夹图标 / 分支已在其他工作树检出的标记) · `Settings`(仓库设置) · `LoaderCircle`(加载 / 动作进行中) · `TriangleAlert`(操作失败) · `Ellipsis`(提交面板文件行 … 菜单)。

## 布局

```
┌─────────────────── 应用顶栏 h-10 ───────────────────┐
│ 红绿灯(mac) │   中间标题（同 document.title）  更新? ⚙ │
├── 侧栏 280px 固定 ──┬────────────────────────────┤
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

- **应用顶栏**（自定义窗口顶栏，高 40px、`--bg-panel`，对齐 WebStorm）：隐藏系统标题栏；macOS 保留原生红绿灯并留出安全拖拽区；Windows/Linux 用系统窗口按钮叠层。**中间**标题与 `document.title` 同一套——有当前 **Project** 为「`{名} — DevCube`」，否则「DevCube」——**加粗**（`font-bold` / 700），颜色与设置弹层标题同为 `--fg-dialog-title`。**右侧**：更新按钮（有待处理更新才显示，否则整颗隐藏）+ 设置齿轮（`Settings`）。可拖拽区与按钮 `no-drag` 分区。产品范围见 `docs/prd/in-app-update.md`。
- **原生应用菜单**（系统菜单栏 / 窗口菜单栏，非应用内右键菜单）：生产环境 Windows/Linux **无**窗口菜单栏；macOS 仅系统栏精简 role 菜单（App / Edit / Window），**不含** Reload / 开发者工具。开发环境额外保留 View（含刷新与开发者工具）。取舍见 ADR-0019。
- **更新按钮**：可自动更新形态仅在「已下载可安装」时出现，点击→重启安装（有运行中 **Run Session** 时先走全局退出确认）；Windows Portable 外观相同，在已知有新版本时出现，点击→打开对应 GitHub Release。检查中/下载中/失败时不显示。不可关闭或跳过。
- **设置弹层**（应用「设置」、Git「仓库设置」、命令配置新建/编辑共用 `SettingsModal` 外壳）：盖在主窗口上的全屏级模态（非第二窗口）——外框圆角 10px（`rounded-dialog`，对齐 macOS 窗口系统圆角）；顶栏标题居中、**加粗**（`font-bold`）、`--fg-dialog-title`；无标题栏关闭钮（Esc / 点遮罩关）。默认底栏「确定」（主色；点即关闭）；命令配置底栏为「取消 / 保存」。应用设置另有左侧分类树（无搜索）、右内容；分类项之间留 1px 缝（`gap-px`）。栏目：关于（版本、**Release Edition**、更新状态、检查更新、仓库链接）、偏好（全平台常挂）：「主题」分段按钮——深色 / 浅色，默认深色，选中即生效；其下「默认终端」下拉仅 Windows 出现——Git Bash / PowerShell / cmd，未检测到的项置灰、系统集成（仅 macOS / Windows；**External Open** 系统入口的安装/移除行：名称 + 说明 + 右侧按钮，文案统一「在 X 中添加 / 安装 Y」句式、按钮动词统一「安装 / 移除」、进行中按钮内转圈 `LoaderCircle`；状态实时探测；Codex 未检测到桌面端则不出现该行，「打开于」仍置灰）、快捷键（只读）。**提示类信息不内联进设置界面**：失败统一走「操作失败」错误框（`DialogMask + DialogPanel` + 等宽正文 + 「知道了」，Git 同款；Esc 先收错误框再关设置）。
- **内容搜索面板**（Content Search，⌘⇧F / Ctrl+Shift+F，作用于当前项目；术语见 CONTEXT.md，产品范围见 `docs/prd/content-search.md`）：盖在主窗口上的居中浮层（DialogMask + 760px×80vh（上限 960px）面板，`rounded-dialog`），形态对齐 WebStorm Find in Files。顶行 = `Search` + 查询框 + 大小写 / 全词 / 正则三颗**方形**开关钮（`size-6`，lucide 等宽图标 16px：`CaseSensitive` / `WholeWord` / `Regex`——文字字标 Cc/W/.* 宽度不一致故弃用，lucide 大小写字形为 Aa 系、接受；激活态 `--selection-row` 蓝底同 Git 查找部件）+ 1×16px `--border-input` 竖线 + 文件掩码输入（glob，逗号分隔多个）+ 关闭 `X`；其下状态行（12px muted：空查询提示 / 搜索中 `LoaderCircle` 转圈 / 「N 处匹配 · M 个文件」/ 封顶提示，错误文案 `--status-failed`；右侧「按文件分组」图标开关 `ListTree`，激活态同方形开关钮，默认开）；中部结果列表（虚拟滚动、行高 24px；行号 / 目录路径 / 计数等附属信息统一 12px `--fg-info` 灰——取 WebStorm 弹窗 UsageTableCellRenderer 的 ORDINAL / `*.infoForeground` 语义。**两种视图**：分组开 = **文件汇总行 + 命中行**（Find 工具窗式）——文件行**可点击收起 / 展开**（开合箭头 `ChevronRight` 置**行最右**、树式朝向——展开 ∨ / 收起 ▶（accordion 的 ∨/∧ 试过而弃：默认展开态朝上不符直觉）+ hover `--bg-row-hover`；收起后该文件命中行不产行、↑↓ 导航自动跳过、新一轮搜索重置为全展开）= `File` 图标 + 文件名（13px 正文色）+ 目录路径（`--fg-info` 截断；**项目根下文件无目录时不渲染该节点**，避免空节点白占 gap 造成徽标间距不一致）+ **计数徽标跟随在后**（h-4/min-w-4 圆角胶囊：`--bg-button-hover` 实底 + `--fg-dialog-title` 11px 数字（muted 对比不足、正文 / icon 色过亮，逐档试到此）；「N 处」文案、fg-info 15% 透明淡底、行头 / 行末位与整体移除均实测过而弃，定稿此形态），命中行 = 行文本**顶头**（分组缩进 pl-8）+ **行尾右侧**行号（12px `--fg-info`、比例数字，无纵向对位需求不开 tabular-nums）；分组关 = 弹窗式平铺——命中行行尾「文件名 行号」（连续同文件时仅文件名淡化 50% 表从属，同弹窗 REPEATED_FILE_ATTRIBUTES 语义）；行文本对齐编辑器字排（`.code-line-text`：JetBrains Mono / 13px / 字重 500 / 关连字，同 `.files-codemirror`，行高交由 24px 行容器；**整行按语言语法着色**——单行 Lezer 解析 + 编辑器同源 HighlightStyle 的无 themeType 裸版（`cm6-highlight-line`，跨行结构按普通代码着色的近似可接受）；正文底色 `--fg-code`；去首缩进、超长按命中开窗加省略号；命中词画 SearchMatch 胶囊——`--search-match-bg` 底 + `--search-match-fg` 深字（胶囊内不透语法色）、圆角 2.5px，对齐平台 `STYLE_SEARCH_MATCH` / `UIUtil.drawSearchMatch` 的画法，选中蓝底行照画；与编辑器 Cmd+F 的 `--find-match-*` 是两套键，勿混用）；选中行 `--selection-row`、hover `--bg-row-hover`；底部只读 CodeMirror 预览：与上半区**五五开分栏、上边可拖**（比例钳 [0.2, 0.8]，1px 分隔线 + 6px 骑线热区——WebStorm OnePixelSplitter 的等价物；**上半区 = 汇总状态行 + 列表、下半区 = 预览标题栏 + 正文**，两半各含自己的头部行对称计算；**每次打开面板重置五五开、不持久化**，刻意不学 WebStorm 的比例记忆）；预览顶部**标题栏**（h-7：文件名 13px 正文色 + 目录路径 12px `--fg-info`，对齐弹窗 myUsagePreviewTitle 的「文件名 + 灰路径」）；正文复用编辑器主题 / 语法高亮、活动行高亮、滚至命中行居中；二进制 / 超限占位「无法预览此文件」。↑↓ 移动选择、Enter / 双击 → Files Tab 打开并选中命中区间、Esc / 点遮罩关闭——面板键盘交互统一走 **window 捕获监听**（与焦点位置无关；React onKeyDown 会因焦点落到 body 而失灵，勿回退）；文件行 / 平铺行尾文件名 / 预览标题栏 hover `title` 显示完整相对路径（同名文件可辨）；搜索词、开关与分组视图**按项目**会话内记忆（不跨项目、不落盘）。引擎 = 主进程 rg `--json` 流式推送（防抖 200ms、换词杀旧进程、封顶 1 万条即停），gitignore / 隐藏文件 / IDE 忽略口径同树顶过滤（ADR-0027）。
- **退出确认**：凡会退出整个应用的路径，若仍有运行中的 **Run Session**，二次确认；**Terminal** 不计入。macOS 仅关窗不退出不触发。文案：「还有 N 个运行会话在运行」/「退出应用将结束这些会话。确定退出？」。
- **左树**：固定 280px，**项目间留白**。Project（可折叠）下**直接列出 Run Configuration**（无「我的配置」小标题；**行背景不缩进、仅内容缩进对齐**——状态点对齐文件夹图标列、名称对齐项目名，靠"补空占位列 + 居中点盒"实现）；探测脚本收进一个**临时弹出菜单**（**Base UI Popover**，即项目组件库；背景 `--bg-elevated`（浮起于列表之上；深色下与面板同值，浅色下为纯白）；点触发浮出、点外面 / Esc 关闭，**选中或运行菜单项即刻关闭**；菜单项与配置行同款样式）。触发行置于配置列表最下方，UI 标签为**「检测到的配置」**（**文案与配置状态点对齐**，**数字在箭头前**，**箭头在右**）。项目行 hover 显示「更多」⋮；**右键或「更多」菜单打开期间**项目行保持与 hover 相同的行底（及 ⋮ / 角标让位），因指针已移入菜单会丢掉 `:hover`；配置行同理（右键 /「更多」打开期间保持行底与按钮可见）；项目行右键与「更多」共用菜单项：**打开文件夹**（`FolderOpen`）/ **新建终端**（`Terminal`）/ **新建配置**（`FilePlusCorner`）/ **置顶** 或 **取消置顶**（`Pin` / `PinOff`，在「移除」之上）/ **移除项目**。已 **Pin** 时空闲在「更多」同槽显示小图钉（muted），hover / 拖拽时**原地换成** ⋮（不挤到旁边）。无行内单独图钉按钮。项目名右侧显示包管理器角标（**pnpm 作为默认不显示**；hover 出按钮时让位隐藏）。链接工作树项目的文件夹图标由 `Folder` 换成 `FolderGit2`（hover 说明「xx」的工作树与主工作树路径；主工作树本身不换）。
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
- **控制台跟随选择**、退出后保留输出（见 PRD 用户故事 22–25）；**运行 / 重跑 / 切换选择后自动聚焦终端**（可直接输入 stdin）；**每次运行经 shell 先打印头部**（同一行：工作目录灰字 + `$` + 命令粗体，见 ADR-0023）再接进程输出，**结束后空一行再补「进程已结束，退出代码为 N」**（标准色），并将终端切为**只读**（禁输入、隐藏光标，仍可选中 / 复制 / 搜索）。
- **终端能力**（xterm 插件）：链接可点击（经主进程 `shell.openExternal` 走系统浏览器，仅放行 http/https）；**Cmd/Ctrl+F 搜索输出**（右上浮层搜索框，Enter / Shift+Enter 下/上一条、Esc 关闭，命中高亮随主题——深色取 Shell.icls SEARCH_RESULT 绿、浅色取 TEXT_SEARCH_RESULT 黄，见 token 表的 `--find-match-*`；切主题会按当前词重画一次）；WebGL 渲染器（大量输出更顺，不可用回退 DOM）；Unicode 11 字宽（emoji / CJK 对齐）。

## Tab 栏（以项目为维度）

右控制台顶部的 Tab 栏承载**当前项目**的全部 Tab。除**常驻的 Git Tab / Files Tab**外，其余每个 Tab = 一个活的会话（Run Session 或 Terminal）。高 40px `h-10`、底 `--bg-panel`、底边 1px `--separator`，与左标题栏同高同色同底边；术语见 CONTEXT.md、取舍见 ADR-0003（含修订）、ADR-0005（常驻非会话 Tab + 默认激活）：

- **Git Tab**：**每项目常驻第一个、不可关闭**（无 `×`）。`GitBranch` 图标 16px + 「Git」（14px）+ 当前分支名用括号包住（如 `Git (main)`，muted 色、截断；detached HEAD 显示缩写 hash；项目成为当前项目时即预加载，Tab 栏始终显示分支名，不必等点开 Git Tab；此后随 git:changed 保鲜）；左右内边距对称（`pl-3 pr-3`，12px，因无 `×`）。选中态与 hover 同其它 Tab。它不是会话——数据状态存独立 git store，切走仅隐藏不卸载；当前项目由 App 预加载，打开 Git Tab 时若已就绪则只重验仓库根。
- **Files Tab**：**每项目常驻第二个、不可关闭**（无 `×`，紧接 Git 之后、会话之前）。`FolderOpen` 图标 16px + 「文件」（14px）；左右内边距对称（同 Git，因无 `×`）。文件树（不按 `.gitignore` 过滤；隐藏 WebStorm Ignored Files 默认项如 `.git` / `.DS_Store`）+ 单文件正文：文本用 CodeMirror 6（实验对照分支；**仅语法高亮与文本编辑**——无 lint / 补全；Monaco 对照见 `backup/files-tab-monaco`；行号栏按相对 HEAD 的行状态显示 VCS 条纹——增绿 / 改蓝、删除为骑在行界上的灰短条，色取配色方案的 VCS 行状态（`--git-line-*`，随主题翻）；条纹 4px 圆头细条、水平贴行号列右缘，连续同状态行连成一段（段端上下各收 2px，段间留出空隙）；条纹本体可点（命中带 = 行号列右缘 6px，与 hover 加宽后的条同宽）：hover 以 hunk 为单位整块联动——pointer、条纹 4→6px / 删除短条放大（100ms 过渡，圆头 9999px 胶囊语义随宽度自适应），点击（松开时）弹出该改动块小窗——横向与编辑器内容区对齐并铺满（弹窗内文字与代码逐列对齐）、上边贴块尾行；工具条（`Undo2` 回滚该块 / `Copy` 复制旧文本 / `ChevronUp`·`ChevronDown` 上一个·下一个改动，跳转先把目标块滚到编辑器上 40% 固定位）+ 基线旧行只读预览（同主题语法高亮，added 块只出工具条），Esc / 点外 / 编辑 / 手动滚动即关；Markdown 文件可在「编辑 ↔ 预览」两态切换，预览 react-markdown + GFM、prose 排版对齐工作区 token，见 `docs/prd/files-diff-gutter.md` / `files-markdown-preview.md`）；图片内嵌预览；可播音视频居中原生控件预览；其余占位并提供「在其他应用中打开」。工具栏：相对路径**可点面包屑**（左对齐；段间 `ChevronRight`、目录段 muted、文件名有工作区 Git 状态则用 `--git-status-*` 否则 `--fg-primary`；hover 只改文字色、无底；点目录/文件名 → 右侧树展开并滚到对应行；无未保存圆点）+ Markdown「预览 / 编辑」两态切换（`Eye`/`Pencil`，仅 Markdown 文件显示，位于右侧钮区最左、与其后钮以 1×12px `--border-input` 竖线隔开；切入预览前自动保存）+「最近打开文件」(`FileClock`，下拉最近 10 个：文件名正文色 + 目录路径 muted，空则「暂无最近打开文件」；无正文时也显示) +「在文件树中显示」(`ListTree`，定位当前文件；若树已隐藏则先显示再滚到行) +「在文件夹中显示」(`FolderOpen`) +「在其他应用中打开」(`SquareArrowOutUpRight`) + 文件树隐藏时最右「显示文件树」(`PanelRight`，与左侧钮组之间 1×12px `--border-input` 竖线)；**双击编辑区标题栏**切换文件树显隐（面包屑与右侧钮组不触发），文案对齐 Git 菜单 / VS Code Reveal。**文件树行交互对齐左树、尺寸更紧凑**：树顶 header（同高 h-10）左侧常驻筛选（`Search` + 占位「筛选」，有内容时清空 `X`，样式同左栏项目筛选；冷索引首查时树区居中「正在扫描…」+ `LoaderCircle` 转圈，120ms 延迟出现防闪烁，同 diff 加载骨架）；焦点在树上时可打印字写入、Esc 清空；按相对路径包含收窄**同一棵树**（基于 ripgrep 文件名索引，ADR-0027；保留结构；目录命中带整支；无匹配「无匹配文件」；不过滤高亮）；右侧「全部展开」(`ChevronsUpDown`) /「全部折叠」(`ChevronsDownUp`) / 最右「隐藏文件树」(`Minus`)（过滤期间展开/折叠只作用于过滤后的树）；固定宽 280px；可整块隐藏（编辑区占满，不留窄条把手；可见性不持久化，重挂载默认展开）；**树行虚拟滚动**（@tanstack/react-virtual：按展开态拍平成行数组、行高固定 32、仅渲染视口内行——过滤命中或展开条目再多，渲染成本恒定；滚动定位按行下标而非 DOM 查找）；`h-8` / `rounded` / 13px / `transition-colors`；目录名默认 `text-foreground`、选中 `--fg-primary`；文件名/图标按工作区 Git 状态色（同提交面板 `FILE_STATUS_COLOR`，无状态时图标 `--fg-icon`、名正文色），选中压成 `--fg-primary`；选中行 `--selection-row`（hover 不变色），未选中 `hover:bg-row-hover`；行背景全宽、仅内容按层级缩进；图标/箭头 14px（`size-3.5`；文件夹/文件图标 `--fg-icon` 或状态色，箭头 `muted` 不同色）；目录始终 `Folder`（展开不换 `FolderOpen`，靠箭头旋转表示开合）。**编辑器内查找**（Cmd/Ctrl+F，焦点在编辑器时）：**编辑器顶部整宽查找栏**（h-9、`bg-panel`、底边 `--separator`，占位压下正文——对齐 WebStorm 编辑器查找栏形态，右上浮层版试过而改；控件样式仍同查找族）——`Search` + 输入 + 计数 x/y（封顶 999+，无结果「无结果」；坏正则原位红字）+ 大小写 / 全词 / 正则三颗方形图标开关（同内容搜索面板）+ `ChevronUp`/`ChevronDown` 导航（Enter / Shift+Enter，回绕循环、命中滚至视口中部并设为选区）+ `X`；Esc 关闭回焦编辑器。引擎复用 @codemirror/search 的 SearchQuery，**默认搜索面板退役**（其高亮与面板生命周期绑死，浮层形态由 `cm6-find` 自持同款高亮插件；searchKeymap 一并关闭，Alt-G 跳行 / Cmd-D 选下一个等默认键随之移除）；命中色即既有 `.cm-searchMatch` 主题（TEXT_SEARCH_RESULT）。不做替换。事件自动保存；无内层多文件 Tab。**树行 / 空白区右键菜单**（受控 ContextMenu + 鼠标点虚拟 anchor，同 Git 图谱菜单模式）：菜单项带图标（同左树项目菜单）、按四组排布：**新建**（新建文件 `FilePlus` / 新建文件夹 `FolderPlus`，全部目标；文件行作用于所在目录）→ **打开**（在文件夹中显示 `FolderOpen`，全部；在其他应用中打开 `SquareArrowOutUpRight`，仅文件；在终端中打开 `Terminal`，全部——文件开在所在目录、cwd 限项目内且不随壳持久化）→ **复制信息**（复制路径 `Copy`，全部；复制相对路径 `Copy`，非根）→ **改动自身**（重命名 目录 `FolderPen` / 文件 `FilePen`、删除 `Trash2`，非根；危险项垫底，同左树「移除项目」）。菜单打开期间目标行保持 hover 行底（同左树），新建与重命名走通用小对话框外壳（`ui/form-dialog`，同 Git 对话框族：WebStorm 式提示语 + 输入 + border-t 底部按钮条，Enter 提交防输入法合成、提交中锁死弹窗；磁盘冲突弹窗同壳；重命名预选主文件名），删除确认后移入系统回收站；新建文件成功即打开，重命名 / 删除联动当前打开文件与最近列表。复制 / 移动不做（CONTEXT.md 边界）。左栏 ProjectTree 不动。Git「打开文件」进入本 Tab。切走隐藏不卸载；每项目持久化上次打开路径与树展开（路径无效则静默空态）。布局为左正文 / 右文件树；未打开条目时空态文案「在右侧选择文件」。
- **运行会话 Tab**：**每条有会话的配置一个**（运行中或已退出未关闭）。状态点 + 配置名（14px）；`×` 常驻（背景仅 hover，圆形、颜色过渡）——运行中＝**停止并关闭**（温和停止，不二次确认），已退出＝关闭并弃输出（树上状态点回灰）。**顺序跟随树中配置顺序**；重跑复用原 Tab（单实例语义不变）。
- **终端 Tab（Terminal）**：`Terminal` 图标 16px + 名称；`×` 同上（关闭即杀 shell）。默认名「终端 / 终端 (2) …」按项目内序号，**双击可改名**（按项目持久化）。**组内支持拖拽排序**（仅水平、钳制在终端组内，不与运行会话组混排；顺序按项目持久化）。整组排在运行会话组之后。冷启动恢复壳、第一次激活才起 shell（无历史输出）；关 Tab / shell 自退出与落盘同步。
- **末尾 `+`**（`Plus`，tooltip「新建终端」）：在当前项目根目录起一个交互 `$SHELL` 的新终端 Tab 并聚焦。
- **选中态** 3px `--primary` 主色下描边、**hover** `--bg-row-hover`；每个 Tab 均保持单行且不参与收缩，过多时只允许横向溢出，滚动条隐藏且不出现纵向滚动。左侧无留白，右侧以固定占位保留 8px；两侧各有 16px 的 `--bg-panel` → 同色全透明渐变遮罩，对应方向还有超过 1px 的隐藏内容时完整显示，抵达边缘时隐藏，并使用项目默认透明度过渡；遮罩不响应指针。鼠标悬停栏内时普通滚轮直接横向滚动，无需按 Shift；触控板原生横向手势保持原方向。终端 Tab 的拖拽同样只沿横轴移动。每次激活 Tab（包括切换项目后恢复其激活 Tab）时，若目标不在横向视口内，则以最小距离自动滚入视口，并避开渐变遮罩。
- 每个会话 Tab 常驻各自的 xterm 实例（切走仅隐藏、不卸载，跨项目亦然），故后台会话仍在跑、滚动历史与现场保留；切回某项目恢复其激活 Tab。Git / Files 面板同「切走隐藏不卸载」。
- **激活解析**：每项目记「激活的 Tab」（跨重启持久化）。Tab 顺序 = Git → Files → 运行会话（树序）→ 终端。**点配置** → 有会话聚焦其 Tab、没跑过**不动当前激活 Tab**；**运行 / 重跑** → 聚焦其 Tab 并聚焦终端；**点项目行** → 保持该项目原激活 Tab；**点 Tab** → 只切视图、**不改树选择**（树选择与 Tab 激活解耦）。**关闭**激活 Tab → 左邻（其次右邻）；常驻 Tab 上 Cmd+W 无效。**默认激活**（无合法记忆 / 解析缺省）：有运行中的 Run Session 则取 Tab 栏从左到右第一个运行中的，否则按 Tab 序（即 **Git Tab**）——有项目即无占位态。Run Session Tab 本身不跨冷启动恢复。

**当前项目与选中**：左树**当前项目**与**行选中**分开标示——当前项目的项目行常驻浅底 `--bg-row-hover`、名称 `font-semibold`（600）；单击项目行＝选中「项目本身」（右侧切到它的 Tab 栏、项目行以 `--selection-row` 蓝底、清空配置选中）；单击配置行＝选中该配置（只高亮配置行蓝底，项目行退回浅底+加粗，不共用蓝底）。**当前项目吸顶**（滚过自身标题后钉住，再往下滚也不走；未滚到前不占坑）：未置顶则摊平钉在置顶堆下（列表直接子节点 + 1px 缝）；**仅排在其后的**未置顶段吸顶再下移一格（其前仍用原 top）。已置顶且「固定置顶」开：已在叠放堆内不再叠；「固定置顶」关：当前置顶摊平钉在 `top:0`，其后置顶段与全部未置顶再让一行。未置顶展开态提到父级，避免切换当前时丢折叠。**折叠 / 展开由左侧箭头或整行双击触发**。新建 / 点选某终端也会把其项目设为当前。当前项目与左树选中跨重启持久化（配置已删则回落项目行；恢复当前项目时更新 `lastOpenedAt`）。项目行上的「更多」按钮，其 hover 底色跟随行态（选中蓝底行用 `--selection-row-hover`）。空项目（尚无配置与探测脚本）亦可点行进入并新建终端。

**终端交互**：终端**始终可交互**（不像运行会话退出后转只读）；切到 / 新建即自动聚焦、可直接输入；shell 自行结束（`exit` / Ctrl-D / 崩溃）即**自动关闭**该 Tab。xterm 能力（Cmd/Ctrl+F 搜索、链接点击、WebGL、Unicode 11）运行会话与终端一致。

**快捷键**（逻辑键；UI `title` 文案走 `formatShortcutLabel`，见 ADR-0013）：

| 动作                                                      | 逻辑键                                  |
| --------------------------------------------------------- | --------------------------------------- |
| 新建终端                                                  | CmdOrCtrl+T                             |
| 关闭当前会话/终端 Tab（常驻 Git/Files 无效）              | CmdOrCtrl+W                             |
| Tab 循环 下一 / 上一（顺手）                              | Alt+CmdOrCtrl+→ / ←                     |
| Tab 循环 下一 / 上一（主流备选）                          | Ctrl+Tab / Ctrl+Shift+Tab               |
| 直达第 1–9 个 Tab（Git=1、Files=2，其后按栏序；越界忽略） | CmdOrCtrl+1…9                           |
| 聚焦左树项目筛选                                          | Alt+CmdOrCtrl+P                         |
| 切 Files Tab 并聚焦文件树筛选                             | Alt+CmdOrCtrl+F                         |
| 内容搜索（当前项目，浮层面板）                            | CmdOrCtrl+Shift+F                       |
| 上一 / 下一项目（左树当前排序+筛选可见序，循环）          | Alt+CmdOrCtrl+↑ / ↓                     |
| Git：查找 / 刷新                                          | CmdOrCtrl+F / CmdOrCtrl+R（仅 Git Tab） |
| Files 编辑器：查找                                        | CmdOrCtrl+F（焦点在编辑器时）           |

注册方式：主进程 `webContents.before-input-event` 匹配并 `preventDefault`，再 IPC 到渲染端执行（窗口聚焦时优先于页面/xterm/Chromium 默认；**不能**压过 macOS Mission Control 等系统级快捷键，也不使用 `globalShortcut` 抢其它 App）。文案规则见 ADR-0013。

## Git 图谱（Git Tab）

移植自 vscode-git-graph，观感套进本工作区的 token 体系；术语见 CONTEXT.md（Git Tab），产品范围见 `docs/prd/git-graph.md`。

**主题按上游做法**：12 色调色板与未提交灰 `#808080` 在上游是配置项的固定默认值、代码里没有任何明暗主题检测，**两套主题下保持原值不变**。上游真正随主题走的是背景类——图谱背景、连线光晕、圆点描边、HEAD 空心圆填充、引用标签图标挖空色，它用 `--vscode-editor-background`，本工作区对应 `--bg-deepest`（已如此实现）。

- **顶部工具栏**（高 40px、底 `--bg-panel`，同 Tab 栏）：左 = 「分支：」+ 分支筛选下拉 + 工作树图标钮（`FolderGit2`，同视图选项钮观感，title 带当前工作树名与路径；弹层照分支下拉：同宽 + 顶部筛选框 + 同款列表行，主工作树显示「主工作树」；列表按 `git worktree list` 序、当前项打 ✓、行尾灰字为其分支或短 hash、目录已不存在的行半透明不可点、hover 显示路径；点其他行 = 前往其 Project，未登记则先登记；弹层顶部一行 `Plus`「新建工作树…」；行悬停时行尾灰字让位给图标钮（同左树行尾钮的让位写法，不顶开布局；钮右缘与上下同为 2px）——可删的行 `Trash2` 删除工作树（主工作树与本项目所在行没有）、失效行 `Eraser` 清理登记；仓库无工作树数据时整颗隐藏）+ 视图选项 Popover（`SlidersHorizontal`，五个数据可见性开关 + 提交排序三选一）+ `Search` 查找（紧挨视图选项）；右 = 图标钮组（`GitCommitHorizontal` 提交 / `RotateCw` 刷新 / `CircleArrowDown` 拉取当前分支 / `CircleArrowUp` 推送当前分支 / `GitBranchPlus` 创建分支 / `Settings` 仓库设置——面板为隐藏的远程、用户信息、远程管理、工作树存放目录四区）。提交钮等同点图上「未提交的更改」行打开提交面板，无改动也可用（只勾「修正」改信息等场景）；仅空图（空仓库且无改动，详情面板无处停靠）时禁用。刷新 = fetch + 静默软重载（fetch 期间刷新钮转圈，不弹进行中遮罩）；拉取 / 推送在 detached HEAD 或没有远程时禁用（禁用即可，不显提示文案；无上游也可打开，remote 与分支在对话框表单里选）；拉取在操作进行中（变基/合并/拣选/回滚中断）时也禁用，title 注明原因（「变基进行中，请先完成或中止」按状态措辞）。**切分支筛选 / 改视图开关走图谱级重载**：只给图谱区盖半透明 loading，工具栏与分支下拉不闪没。
- **操作进行中状态条**：变基/合并/拣选/回滚中断（冲突等）时，工具栏下方常驻一条紧凑状态条（h-9、`bg-panel`、顶部 `--separator` 细线，`TriangleAlert` 用 `--status-failed`）：左 = 状态文案（「变基进行中——解决冲突并暂存后继续，或中止」；merge 为「解决冲突后在提交面板完成提交，或中止」），右 = 小按钮组「继续 / 跳过 / 中止」（merge 仅「中止」；按钮 h-6 描边款，观感对齐错误态「重试」钮）。继续 / 跳过点击即执行（走进行中遮罩，失败落既有错误框）；中止先弹危险确认。期间会撞车的入口统一防误触：右键菜单的检出 / 合并 / 变基 / 拉取 / 拣选 / 回滚 / 丢弃提交 / 重置 / 贮藏应用·弹出·建分支**置灰 + hover 原因**（只禁用不隐藏，防菜单结构跳变），双击标签检出在 handler 早退（无可视禁用面，原因由状态条解释）。
- **提交表格**：紧凑行高 24px（图谱网格 `grid.y`）、13px。列 = 图谱 / 描述 / 日期 / 作者 / 提交哈希（8 位缩写，`font-mono`）。图谱列宽随分支线内容同步（下限一列宽 32px，图谱表头窄边距 `px-1` 恰容「图谱」二字）、上限视图 1/3，超出用 SVG 右缘 12px 渐隐。
- **分支线配色**：12 色循环调色板 `--git-graph-color0..11`（沿用参考默认值）；行级 `data-color="i"` 注入 `--git-graph-color`，圆点/标签/HEAD 空心圆引用它。未提交更改行与其线为灰 `--git-uncommitted`。
- **引用标签顺序**：stash → 当前分支（提前）→ 其余本地分支 → 远程分支；tag 独立一组。当前提交行加粗、HEAD 圆点空心。已合并进 HEAD 的 merge commit 半透明（mute）。被其他工作树检出的本地分支标签在名后附 `FolderGit2` 小图标（hover 说明工作树名与路径）；对它双击 / 右键检出不跑 git，改弹「前往该项目」提示。
- **详情面板**：吊底停靠（默认高 250px、顶边可拖 [100,600]），左右分栏可拖（比例 [0.2,0.8]）。左 = 提交/贮藏元信息（hash 可复制、父提交可跳、`mailto`/URL 链接）、右 = 文件变更树（单链文件夹压缩、圆角块行、**目录行逐级 sticky 吸顶**、状态色见 `--git-status-*`（A/U 增绿 · M/R 改蓝 · D 删灰 · `!` 冲突）、`+N -M`；**当前打开 diff 的文件行以 `--selection-row` 高亮、文件名转白 `--fg-primary`**；文件行单击开 diff、双击打开工作区文件进 Files Tab（已删除 / 未跟踪目录除外）；文件行右键菜单打开期间保持 hover 行底）。
- **提交面板**：未提交行的详情即提交面板（ADR-0006，对齐 SourceTree）——左 = 提交信息多行框，其下一行「修正上次提交」「绕过提交钩子」「推送」三个勾选在左、「提交」按钮靠右（不再收进二级菜单）；绕过提交钩子 = `--no-verify`（命名对齐 SourceTree / GitHub Desktop 的 Bypass commit hooks），提交成功即自动取消勾选；右 =「已暂存 / 未暂存」两段文件树（**区头即可折叠顶级目录：箭头旋转过渡、双击 / 点箭头折叠整段、单击滚动到该段；区头 checkbox 同目录逻辑（整段全暂存才勾）、双向 sticky 常驻（已暂存钉顶、未暂存未到时钉底预告 / 滚到时钉在已暂存区头下方，两段标题恒可见）；内部目录行逐级 sticky 吸顶**、**目录行 checkbox 暂存/取消该目录下全部文件**、勾选文件即 `git add`、取消勾选即 unstage、**勾选后复选框原地即时翻转、文件先不移段（乐观勾选），期间面板锁定禁止暂存操作；待 git 确认、真实数据落地后文件才移到另一段，失败则还原复选框并解锁**、文件行单击 = 看 HEAD→暂存 或 暂存→工作区 diff（不写选区，只记 shift 锚点）、双击 = 打开工作区文件进 Files Tab（已删除除外）、**高亮一种视觉两种数据：无显式选区时跟随打开中的 diff 文件（`diffView` 派生影子，关 diff 即失、换段自动跟随，与详情树一致）；显式选区（目录行单击 / Cmd/Ctrl 加减选 / Shift 范围选 / 右键选区外行重置为该行）存在时全局压制影子只显示选区**、选中行以 `--selection-row` 高亮、文件名转白 `--fg-primary`、跨两段互斥（切段即清空）、右键选区出批量菜单（暂存 / 取消暂存 / 撤销更改 / 删除未跟踪 所选）、点选区内任一行的复选框即对整批联合暂存 / 取消、**刷新落地后从选区与锚点剔除树中已消失的 key（幽灵清理，其余选中保留）**、行尾 `Ellipsis` 菜单：撤销更改 / 删除未跟踪文件 / 打开文件 / **在文件夹中显示** / 复制路径——菜单打开期间行保持 hover 底、⋯ 常显（右键路径经选区重置本就蓝底持久）；暂存类操作静默即时、不弹进行中遮罩）。复选框/单选统一用 shadcn `Checkbox`/`RadioGroup`（Base UI）。默认高 392。面板不随「未提交更改」行消失而自动关闭（目标是工作区、恒不过期）：无改动时可从工具栏直接打开（两段皆空占位），提交/丢弃清空全部改动后仍保持打开。
- **Diff 面板**：应用内 diff，临时盖板，`absolute` **只覆盖图谱表格区**（吊底详情/文件列表仍可见，点文件看 diff 时能继续切文件）。再点已激活的 Git Tab、换详情目标、或当前文件树里没了该文件即关（切走 Tab / 切项目保留现场，回来接着看）；Esc / × 仍可关。活端点随仓库重拉（换段跟过去），历史提交不刷。正文由 `@git-diff-view/react` 渲染（语法高亮 + 词级 diff 内置、无虚拟滚动，ADR-0007）；头部可切**统一（`AlignJustify`）/ 左右对比（`Columns2`）**两视图，偏好存 `viewPrefs.diffSplitView` 跨会话记忆、**默认左右对比**。**横竖滚动条常驻面板边缘**（`main.css` 限高库滚动容器，split 两栏纵横同步由库内置 syncScroll 承接）。配色在 `main.css` 以库的同选择器覆盖其主题变量、全部引用既有 token：hunk 头底 `--diff-hunk-header-bg`、新增 `--diff-add-bg`、删除 `--diff-del-bg`、词级高亮 `--diff-add-word-bg` / `--diff-del-word-bg`、正文底 `--bg-deepest`、等宽 `--font-mono`；二进制兜底，120ms 延迟加载态。
- **查找**：`Cmd/Ctrl+F` 右上浮层（样式同终端搜索框），命中行高亮 `--find-match-bg`、当前项 `--find-match-active-bg`（深色取 Shell.icls SEARCH_RESULT 绿、浅色取 TEXT_SEARCH_RESULT 黄，见 token 表）。
- **右键菜单 / 对话框**：Base UI Menu（鼠标坐标虚拟 anchor）；命令配置走 `SettingsModal`（`w-[440px]`）。危险操作先确认，追问链（强删 / 重名替换 / 推标签预警）对齐参考。小对话框外壳（Mask / 440px 面板 / 提示语 + 底部按钮条）抽至 `ui/form-dialog`，与 Files 弹窗共用单一定义源。拉取 / 推送对话框已表单化（remote 与分支选择、整合方式三选一、目标远程分支可输可选、可勾选推送分支上的标签，分支字段旁附行内刷新钮静默 fetch）。新建工作树也是表单式：检出方式三选一（新建分支 / 检出空闲的已有分支 / 分离 HEAD，字段随选项切换）、名称默认由分支名派生（斜杠换横线，手动改过即不跟随）、位置只读展示 = 仓库设置的存放目录 + 名称（默认 `../<主项目名>.worktrees`）；建好即登记为项目并前往。删除工作树先确认、脏工作树再追问「强制删除」，两处主按钮均用危险色（`destructive` 变体，对话框按钮描述新增 `destructive` 标记）；已登记为项目且有运行中会话 / 终端时只提示不删，成功后连项目一并移除。动作进行中遮罩（可隐藏继续看图）、失败转错误框。交互式变基在项目 Terminal Tab 里启动。
- **键盘**：`Esc` 分层关闭（diff → 详情 → 菜单 → 对话框 → 查找）、`Cmd/Ctrl+R` 软刷新、`Cmd/Ctrl+F` 查找；焦点在输入控件时让位。
- **链接放行**：详情里的链接经 `shell.openExternal`，放行 `http/https/mailto`。
- **图标**：见「图标」节的「Git 图谱专用」一行。

## 待校准

- 深色 ANSI 16 色已与 `DefaultColorSchemesManager.xml` 的 Darcula `CONSOLE_*_OUTPUT` 逐项核对，16/16 一致（含 `black` `#000000`），不再有推导项。`--accent`（`#43454A`）仍为**推导**——shadcn hover 语义，非取自任何 IDE 键。
- **深色**的 UI 主题（树选中蓝、按钮绿）仍是手取；浅色已改从 `expUI_light.theme.json` 直取，反过来印证了几处深色手取值差 1 单位（`--selection-row` `#2D436E` vs `#2E436E`、`--border-input` `#4F5157` vs `#4E5157`、`--editor-selection` `#224283` vs `#214283`、`--run-active-bg` / `--status-success` `#57965D` vs `#57965C`）。如需绝对像素级，可后续照浅色的做法把深色也从 `expUI_dark.theme.json` 校一遍。
- 深色的 diff 配色（`--diff-add-bg` / `--diff-del-bg` / `--diff-*-word-bg` / `--diff-hunk-header-bg`）为 Darcula 系**推导**，未从 `.icls` 逐项核验；浅色取自 Default 基方案的 `DIFF_INSERTED` / `DIFF_DELETED`，其中词级色映射到同键 `ERROR_STRIPE_COLOR` 也是**推导**。`--git-graph-color0..11` 沿用 vscode-git-graph 默认调色板，两套主题都不变（见上）。
