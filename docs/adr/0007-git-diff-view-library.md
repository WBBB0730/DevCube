# Diff 面板改用 @git-diff-view/react 渲染

自研 diff 渲染缺语法高亮与词级 diff；而 diff 渲染本就不在 vscode-git-graph 的移植面内（参考实现直接委托 VS Code 原生 diff editor），故按纯工程权衡改用 `@git-diff-view/react` 整块渲染——语法高亮、词级 diff、统一/左右对比内置，且以 git 原始 unified diff 文本为一等输入（注意：库**无**虚拟滚动，大文件为全量渲染——已接受此代价，不做渲染端截断）。随之 IPC 契约从「主进程解析好的结构化 hunks」改为「原始 diff 文本透传」（`DiffFileData.raw`，整段含 header 作为 `hunks` 数组的单元素，经 node 实测为库要求的格式）：主进程仅保留命令选择与二进制判定，`parseUnifiedDiff` 及渲染端 split 配对/截断等纯函数整体移除。渲染端按官方 git mode 用法构造 `DiffFile` 实例（`initRaw()`）交给 `diffFile` prop。

库无主题与滚动行为的官方定制 API（`diffViewThemeColors` 是 CLI 包专属 prop），以下三处为**有意为之的库内部 CSS 覆盖**（main.css，升级库后需观感回归）：

- **主题色**：以库的同选择器（`.diff-tailwindcss-wrapper[data-theme='dark'] .diff-style-root`）按源序后置覆盖其 CSS 主题变量，取值全部引用既有 Darcula token。
- **等宽字体**：库在滚动容器上内联硬编码 Menlo，`!important` 压回 `--font-mono`（JetBrains Mono）。
- **滚动结构**：库的滚动容器默认与整表同高（横向滚动条藏在表尾，滚到底才可见）；将高度链（wrapper → style-root → view-wrapper → split-diff-view）传导至 `.diff-table-scroll-container` 并改其 `overflow-y: auto`，横竖滚动条即常驻面板边缘。实测（本地 harness 四写法对照）仅此法有效——外层固定高度、`DiffView` 的 style prop 均无效；split 两栏纵横同步由库内置 `syncScroll` 承接。

## 考虑过的方案

- **react-diff-viewer-continued**：一等输入是两段全文，吃 git diff 是二等路径（`oldValue` 塞 diff、`newValue` 留空），语法高亮需自接 Prism 且逐行——每一项都被 git-diff-view 支配，排除。
- **react-diff-view**（可组合）：保留自研壳、只借 tokenize / 词级能力，可控性最好；但组装工作量大，在「开箱即用」诉求下不如整块替换。
- **自研 + Shiki**：最贴 IDE 观感、纯函数架构不破；需自写高亮编排层，在「快速落地」权衡下被否。
