# ci-release

**CI 与发版**

## Problem Statement

DevCube 目前只能在本机手动打包，没有可重复的 Win / Mac 发布流水线。正式版与 beta 需要可并行安装、互不影响，版本号要用约定方式管理，并把可下载制品发到 GitHub Releases。缺少签名/公证时，Mac 外发体验差；每次冷启动 CI 也很慢。

## Solution

建立「本地 bumpp 打版本 → 推符合约定的 git tag → GitHub Actions 双端打包并上传 GitHub Releases」的发布流程；正式版与 beta 使用不同安装身份（见 ADR-0012）。`main` 上持续校验代码，并为之后的发版产出 pnpm / Electron 缓存（每周定时保活）。Mac 强制签名并公证；Windows 出未签名包。应用内更新见 `docs/prd/in-app-update.md`（本流水线需挂 updater 元数据 yml）。

## User Stories

1. 作为维护者，我想在本地用 bumpp 升版本并打 tag，以便版本与 git 历史一一对应、由人确认后再发。
2. 作为维护者，我想只推 `v*` tag 就触发发布 CI，以便不必在网页上手工点构建。
3. 作为维护者，我想 tag 必须指向 `main` 上的提交，否则 CI 失败，以便避免从 feature 分支误发版。
4. 作为维护者，我想 `v1.0.0` 这类无 prerelease 的版本打出正式版身份的包，以便给稳定用户使用。
5. 作为维护者，我想 `v1.0.0-beta` / `v1.0.0-beta.1` 版本打出 beta 身份的包，以便内测与正式版并行存在。
6. 作为维护者，我想 `alpha` / `rc` 等其它预发布形态直接阻止发版，以便 **Release Edition** 只有正式与 beta 两种。
7. 作为用户，我想正式版有自己的应用标识、显示名为 DevCube，以便与系统里其它应用区分。
8. 作为用户，我想 beta 有独立的应用标识、显示名为 DevCube Beta，以便与正式版并行安装且一眼可辨。
9. 作为用户，我想正式版与 beta 的本地数据（项目列表、Pin、Run Configuration 等）互不影响，以便内测不会写坏正式环境。
10. 作为用户，我想在 macOS Apple Silicon 上下载到 arm64 的安装包与便携包，以便本机可直接使用。
11. 作为用户，我想在 Windows x64 上下载到安装包与便携包，以便本机可直接使用。
12. 作为用户，我想 Mac 有 dmg（安装）与 zip（便携），以便按习惯选择安装或解压即用。
13. 作为用户，我想 Windows 有 nsis 安装包与 portable 便携版，以便按习惯选择。
14. 作为用户，我想在 GitHub Releases 找到对应 tag 的全部双端制品，以便一处下载。
15. 作为用户，我想正式版 Release 为普通 latest 发布、正文是这一版的更新日志（没写则为空），以便页面干净、不拿版本号当 changelog。
16. 作为用户，我想 beta Release 标记为 Pre-release、正文与同号正式版相同，以便不覆盖 latest，且与正式版区分。
17. 作为维护者，我想 Win / Mac 矩阵构建先上传 artifact，全部成功后再挂到同一 Release，以便避免半成品 Release 或并发抢建。
18. 作为维护者，我想某一端构建失败时不发布不完整的 Release，以便用户不会下到残缺版本。
19. 作为 Mac 用户，我想下载的包已经 Developer ID 签名并完成 Apple 公证，以便少被 Gatekeeper 阻拦。
20. 作为维护者，我想用 App Store Connect API Key（而非 Apple ID 密码）做公证，以便 CI 更稳、权限可控。
21. 作为维护者，我想把证书与 API Key 放进 GitHub Secrets，以便仓库里不出现私钥。
22. 作为维护者，我想 Windows 包可以未签名发布，以便不被 Windows 证书采购卡住。
23. 作为维护者，我想 push 到 `main`（以及每周定时）时产出并保活 pnpm / Electron 缓存，以便之后的发版 job 少冷启动。
24. 作为维护者，我想 `main` 在 Win 与 Mac runner 上各跑一遍完整质量门禁，但不打安装包、不签名、不上传 Release，以便尽早发现跨平台问题。
25. 作为维护者，我想发布 workflow 只读恢复 `main` 产出的 pnpm / Electron 缓存而不写入，以便缓存语义真实、不占配额。
26. 作为维护者，我想由一份构建配置按 `package.json` version 切换安装身份与图标，以便正式/beta 差异集中、不靠 workflow 里零散覆盖。
27. 作为维护者，我想 `pnpm gen-icon` 无参数一次生成正式与 beta 两套图标并写入约定路径，以便不会互相覆盖。
28. 作为维护者，我想两套图标都提交进仓库，CI 不跑 gen-icon，以便不依赖本机 WebStorm / `sips` / 系统字体。
29. 作为用户，我想正式与 beta 共用同一套 DEV 底图视觉，beta 额外叠一层斜向 beta 标，以便仍是 DevCube 家族又一眼可辨。
30. 作为维护者，我想本地仍可用现有 `build:win` / `build:mac` 等脚本打本机包，并随动态配置吃到正确身份，以便发版前可本地冒烟。
31. 作为维护者，我想 publish 目标面向 GitHub、Release 上挂好更新清单（electron-updater 据此检查更新），但实际上传以 Actions 挂 Release 为准，以便构建与发布解耦。
32. 作为维护者，我想 Linux 不打包不发布，以便范围聚焦 Win + Mac。
33. 作为维护者，我想 Actions 依赖固定到完整 commit SHA，workflow 默认只读、仅发布 job 获取写权限，以便降低供应链与令牌风险。

## Implementation Decisions

- **版本与触发**：维护者本地 `pnpm release`（bumpp）升 `package.json` version、提交、打 `v*` tag 并推送。只有推 `v*` tag 触发发布 workflow；tag 的提交不是 `main` 的祖先则失败。
- **Release Edition 判定**：从 version 解析——无 prerelease → 正式身份；prerelease 仅接受 `-beta` / `-beta.N` → beta 身份。其它 prerelease 直接报错并阻止构建或发版。
- **安装与数据身份（ADR-0012）**：正式：`appId` `com.wbbb.devcube`，`productName` DevCube，Windows 可执行名 `devcube`，数据目录 `DevCube`。beta：`appId` `com.wbbb.devcube.beta`，`productName` DevCube Beta，可执行名 `devcube-beta`，数据目录 `DevCube Beta`。数据目录沿用既有默认名、与显示名解耦，不跨身份共享。
- **构建配置模块**：electron-builder 自动发现的 TypeScript 配置，由 version 派生身份字段与图标；不维护两份易漂移的静态 YAML，也不靠命令行另传配置路径。
- **制品矩阵**：`macos` runner → arm64 的 `dmg` + `zip`；`windows` runner → x64 的 `nsis` + `portable`。不打 Linux；不打 Mac universal / Win arm64。文件名用 `${name}`（无空格），见 ADR-0015。
- **发布编排**：矩阵 job 只构建并 `upload-artifact`；全部成功后，收尾 job 用官方 GitHub CLI 创建 Release、上传全部 artifact，再发布——正式非 prerelease、beta 为 Pre-release，**正文取手写更新日志里这一版那段**（beta 取同号正式版；没写为空，见 `docs/prd/changelog.md`）。不在各矩阵 job 里竞态 `electron-builder --publish`，也不暴露半成品 Release。
- **Mac 签名与公证**：发布 Mac job 强制 Developer ID 签名与公证；凭证为证书（及密码）+ App Store Connect API Key（Key ID / Issuer ID / `.p8` 的 Base64 内容），全部来自 GitHub Secrets。缺少任一凭证或私钥不是有效的 PKCS#8 时在打包前失败；打包后显式校验应用签名与公证票据。非 tag 的本地构建不强制签名或公证。
- **Windows 签名**：不配置；确保未提供证书时构建仍成功（勿传入空证书路径导致误解析）。
- **自动更新**：本流水线须把 `latest.yml` / `latest-mac.yml` 与安装包一并挂到 GitHub Release（`publish.provider = github`，构建仍 `--publish never`，由收尾 `gh release` 上传）；应用内更新见 `docs/prd/in-app-update.md`。
- **质量门禁**：`push` 到 `main` 与每周定时，Win + Mac 矩阵跑 lint、test、typecheck 与应用构建（Windows 另编译压缩右键扩展，ADR-0049），不运行 electron-builder、不上传 Release。tag 上只在 ubuntu 跑一遍同样的检查，与打包 job 并行，由发布 job 要求两者都通过才发布；代价是门禁失败或 tag 不在 main 上时，打包与公证照跑一遍但不发布。
- **缓存**：缓存 pnpm store 与 Electron 下载目录，只由 `main` 的 CI 写入——GitHub 缓存按 ref 隔离，tag 上的运行只能读到默认分支的；tag 上的打包只读恢复、不写入。键含 lockfile 哈希并带前缀回退，lockfile 变了也能复用未变部分（setup-node 自带的 pnpm 缓存只认精确键，故不用）。每周定时是为了顶住「7 天未被访问即清除」，发版间隔常超过一周。electron-builder 自身的工具缓存不做（只有打包会产出，跨 tag 无法复用）。
- **安装包依赖**：`dependencies` 只放主进程与预加载在运行时引用的包，界面层专用的依赖放 `devDependencies`；electron-builder 只打前者及其依赖闭包，界面层的库已由 electron-vite 编进产物（ADR-0036）。
- **图标**：gen-icon 无参数，一次写出正式 / beta 两套，另写一份裁掉透明安全边距的 Windows 图标。共用 WebStorm 底 + 黑块 + `DEV` + 横线；仅 beta 再叠斜向 beta 标。生成物提交入库；动态配置按身份指向对应图标，Windows 用裁切版。
- **深模块（可单测）**：「version → 发行身份」只在一个纯函数里实现：输入版本字符串，输出正式/beta 判别及全部身份字段（appId、productName、数据目录、可执行名、是否 Pre-release、图标等）。动态配置、Windows 运行时身份（AppUserModelID）、数据路径与 CI 元数据脚本都消费它，避免多处复制字符串规则。
- **Actions 安全**：第三方与官方 Actions 均固定到审核过的完整 commit SHA。workflow 默认 `contents: read`，只有最终发布 job 获取 `contents: write`。

## Testing Decisions

好测试：只测外部可观察的纯函数行为（给定 version → 身份结果），不测 GitHub Actions 编排、不测真实签名/公证、不测 electron-builder 出包。

要测的模块：

- **发行身份解析**：正式 / beta 判别与各身份字段符合约定；`alpha` / `rc` / 非法 beta 标识会失败。
- **数据路径配置**：正式、Beta 与未包装开发分别落到 `appData` 下的 `DevCube`、`DevCube Beta`、`DevCube Dev`，目标目录在设置前已创建。

不写 workflow 的 e2e；图标像素与 Apple 公证靠维护者在 CI/真机冒烟。

跨平台断言：门禁在 Win + Mac 上跑同一套 vitest，而 `node:path` / `node:url` 默认跟**宿主**走（Windows 上 `join` 产出反斜杠，`pathToFileURL` 补上盘符）。按路径语义归属分两种处理，不可混用：

- **语义天然是 POSIX**（macOS / Linux 专属功能）：在**实现**里锁死 posix 语义（`posix.join`、`pathToFileURL(p, { windows: false })`），测试照常写死 POSIX 字面量。见 `cli-shim`、`open-in-app`、`clipboard-file`、`dev-opener-app`。
- **语义跟用户所在平台走**（argv、cwd 等真实输入）：保留平台原生 API，**期望值**用同一个 API 算出。见 `external-open`。

这类问题已踩中三次，而 Windows job 一挂就连带 Windows 侧缓存停更。

先例：仓库内 vitest「构造输入 → 断言输出」的 shared/main 纯函数测试（如 `project-sort`、`runnable`）。

## Out of Scope

- 应用内自动更新（见 `docs/prd/in-app-update.md` 与 ADR-0014；本 PRD 不含 updater UI 实现）
- Windows 代码签名
- Linux 打包与发布
- Mac universal / Intel-only、Windows arm64
- `alpha` / `rc` 等非 beta 预发布通道
- 正式版与 beta 共享用户数据或导入/导出配置
- CI 内运行 gen-icon
- 从 git 提交自动生成 Release 正文（更新日志手写，见 `docs/prd/changelog.md`）
- 草稿 Release 人工点 Publish
- App Store / Microsoft Store 上架
- 变更日志网站或独立下载站

## Further Notes

- 双安装身份决策见 ADR-0012。
- 应用内更新与 Release 上挂的 `latest.yml` / `latest-mac.yml` 见 `docs/prd/in-app-update.md`、ADR-0014。
- Apple 签名与公证 Secrets 只影响 tag 发布，缺失时发布会在 Mac 打包前明确失败，不阻断 `main` CI。
- bumpp 提交信息只是版本号，不作 Release 说明来源；正文来自手写的 `CHANGELOG.md`（`docs/prd/changelog.md`、ADR-0035）。
- pnpm 官方当前的 GitHub Actions 示例用 `pnpm/setup`（自带缓存，要求 pnpm 11+）；本仓库仍是 pnpm 10，故沿用 `actions/cache` + `pnpm store path`。GitHub 会在仓库 60 天无活动后自动停用定时 workflow，届时需手动重新启用。
- 失败或被取消的 job 不保存缓存：Windows 门禁一挂，Windows 侧缓存就停更；bumpp 一次推 beta 与正式两个 tag 时，两次 `main` push 的前一个 CI 被 `cancel-in-progress` 取消，同样不写。lockfile 没变时问题不显形，一变就只能前缀回退到旧缓存。
- 每周定时已验证按时运行。发版时的只读恢复也会刷新缓存的最后访问时间，所以定时只在「发版间隔超过一周」时才兜底，该场景尚未验证。
- 缓存收益（实测）全在 macOS 的 Install：1:21 → 0:42，省掉 electron 包 postinstall 约 100MB 的下载；打包时的 Electron 下载复用同一 job 刚下好的 zip，冷热都不到 1 秒。Windows 的 Install 由 1:51 变成 2:33，与缓存无关，慢在 `electron-builder install-app-deps` 的重建。
- 发版提速（实测）：触发到可发布 10:43 → 6:05。门禁与打包并行省约 2 分钟；依赖挪栏（ADR-0036）让 macOS 安装包约 176 → 124 MB、公证后的压缩约 110 → 47 秒。剩下最大的一块是苹果侧的签名加公证（历次 153–259 秒），没有正规手段压缩。
- DMG 的差分校验块（`.dmg.blockmap`）没人用：macOS 应用内更新只取 zip。`dmg.writeUpdateInfo: false` 可不生成它，但该选项在类型定义里标为 `@private`、不在公开文档，收益也不确定（它与 zip 压缩同时进行），故不采用。
