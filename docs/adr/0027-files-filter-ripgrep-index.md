# 文件名筛选改走 ripgrep 文件索引

树顶过滤原先每次查询都全盘递归扫描 + 逐目录分批 `git check-ignore`（ADR-0009 的机制部分），大项目一次要几十秒、且每个按键从零重扫。我们改为用 `@vscode/ripgrep`（VS Code 同款、微软官方维护）`rg --files` 一次枚举全项目文件——天然尊重 gitignore（含嵌套与全局 excludes）、非仓库不启用，语义与 check-ignore 版一致——主进程按项目缓存为扁平名单，按键只做内存包含匹配；名单随既有文件监听（ADR-0011 / ADR-0021）的 files:changed 推送作废。这正是 VS Code 自身文件搜索的架构：枚举（IO，一次）与匹配（内存，每键）分离。

**Consequences**

- 名字命中的**空目录**不再出现在过滤结果里（名单只含文件；目录命中带整支的语义不受影响——子孙路径天然包含目录名）。
- rg 平台二进制经 optionalDependencies 分发（v1.18 起无 postinstall 下载），需列入 pnpm `onlyBuiltDependencies` 之外无额外安装步骤；electron-builder 须将 `@vscode/ripgrep-*` asarUnpack，运行时 `rgPath` 做 `app.asar → app.asar.unpacked` 映射后才能 spawn。
- 该包为 ESM-only，CJS 主进程依赖 Electron ≥ Node 22.12 的 `require(esm)`（当前 Electron 39 满足）。
