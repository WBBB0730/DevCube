# Files 树顶过滤尊重 gitignore，树展示不尊重

Files 树展示故意**不按** `.gitignore` 过滤（仍可见 `node_modules` 等），但树顶过滤若同样全盘扫会又慢又吵。我们决定过滤扫盘时叠加两套跳过规则：既有 IDE Ignored Files 默认名单，以及 `git check-ignore`（含 `.gitignore` / exclude / 全局 excludes）；非 git 项目则只走 IDE 名单。不做「排除目录」UI、不引入第二套用户可配排除。

树里仍可手动展开被 ignore 的目录；过滤只是收窄用的望远镜，和 VS Code「explorer 可见 / search 更凶」同一分法。

`check-ignore` 走命令行路径列表时**不要**加 `-z`（多数 Git、含 Apple Git 要求 `-z` 仅配合 `--stdin`，否则 fatal 128）——一旦整批失败，等于没跳过 ignore，会扫进 `node_modules` 把过滤卡死。
