# 项目「打开于」用各桌面端官方入口

要从 DevCube 把 **Project** 根目录交到 Claude / Codex / Cursor 桌面会话时，Cursor 走官方 CLI（`cursor <path>`，缺省再回退各平台应用路径）；Claude 只走官方 deep link（`claude://code/new?folder=`），CLI 不能代表 Desktop 已装；Codex 优先官方 deep link（`codex://threads/new?path=`），CLI（`codex app <path>`）兜底，PATH 上有 `codex` 即算可用；未检测到安装的项置灰保留入口，避免「Open in…」菜单项时隐时现。菜单展示名用「Claude」（非「Claude Code」），三项按字母序排列。
