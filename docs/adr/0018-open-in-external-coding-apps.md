# 项目「打开于」用各桌面端官方入口

要从 DevCube 把 **Project** 根目录交到 Claude / Codex / Cursor / T3 Code 桌面会话时：

- **Cursor** 走官方 CLI（`cursor <path>`，缺省再回退各平台应用路径）。
- **Claude** 只走官方 deep link（`claude://code/new?folder=`），CLI 不能代表 Desktop 已装。
- **Codex** 优先官方 deep link（`codex://threads/new?path=`），CLI（`codex app <path>`）兜底，PATH 上有 `codex` 即算可用。
- **T3 Code** 没有按目录打开项目的 deep link，官方入口为 CLI `t3 app <path>`（兼容各发布渠道的桌面应用名 `T3 Code` / `T3 Code (Beta)` / `T3 Code (Nightly)` / `T3 Code (Alpha)` 及桌面端写入的 `~/.t3/bin/t3`）。因 `t3 app` 要求桌面端先运行，若首次调用因桌面端未启动/未就绪失败且检测到本机桌面端，自动先拉起桌面端并轮询重试直至就绪。

菜单展示名分别为「Claude」「Codex」「Cursor」「T3 Code」，按字母序排列。只展示本机检测到的已安装项，不再把未装项置灰占位；全部未安装时隐藏整个「打开于」子菜单（与「连接到服务器 / 数据源」为空时的规则一致）。渲染端缓存上次探测结果以消除右键菜单闪烁，并在每次打开菜单时后台静默刷新。
