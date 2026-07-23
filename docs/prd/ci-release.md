## Problem Statement

DevCube 目前只能在本机手动打包，没有可重复的 Win / Mac 发布流水线。正式版与 beta 需要可并行安装、互不影响，版本号要用约定方式管理，并把可下载制品发到 GitHub Releases。缺少签名/公证时，Mac 外发体验差；每次冷启动 CI 也很慢。

## Solution

建立「本地 bumpp 打版本 → 推符合约定的 git tag → GitHub Actions 双端打包并上传 GitHub Releases」的发布流程；正式版与 beta 使用不同安装身份（见 ADR-0012）。`main` 上持续校验代码并预热依赖与 Electron 缓存。本轮 Mac 强制签名并公证；Windows 先出未签名包。应用内更新见 `docs/prd/in-app-update.md`（本流水线需挂 updater 元数据 yml）。

## User Stories

1. 作为维护者，我想在本地用 bumpp 升版本并打 tag，以便版本与 git 历史一一对应、由人确认后再发。
2. 作为维护者，我想只推 `v*` tag 就触发发布 CI，以便不必在网页上手工点构建。
3. 作为维护者，我想 tag 必须指向 `main` 上的提交，否则 CI 失败，以便避免从 feature 分支误发版。
4. 作为维护者，我想 `v1.0.0` 这类无 prerelease 的版本打出正式版身份的包，以便给稳定用户使用。
5. 作为维护者，我想 `v1.0.0-beta` / `v1.0.0-beta.1` 版本打出 beta 身份的包，以便内测与正式版并行存在。
6. 作为维护者，我想 `alpha` / `rc` 等其它预发布形态直接阻止发版，以便通道语义保持简单（只会有正式与 beta）。
7. 作为用户，我想正式版的应用标识为 `com.wbbb.devcube`、显示名为 DevCube，以便与系统里其它应用区分。
8. 作为用户，我想 beta 的应用标识为 `com.wbbb.devcube.beta`、显示名为 DevCube Beta（可执行名如 `devcube-beta`），以便与正式版并行安装且一眼可辨。
9. 作为用户，我想正式版与 beta 的本地数据（项目列表、Pin、Run Configuration 等）互不影响，以便内测不会写坏正式环境。
10. 作为用户，我想在 macOS Apple Silicon 上下载到 arm64 的安装包与便携包，以便本机可直接使用。
11. 作为用户，我想在 Windows x64 上下载到安装包与便携包，以便本机可直接使用。
12. 作为用户，我想 Mac 有 dmg（安装）与 zip（便携），以便按习惯选择安装或解压即用。
13. 作为用户，我想 Windows 有 nsis 安装包与 portable 便携版，以便按习惯选择。
14. 作为用户，我想在 GitHub Releases 找到对应 tag 的全部双端制品，以便一处下载。
15. 作为用户，我想正式版 Release 为普通 latest 发布、说明为空，以便页面干净、不拿版本号当 changelog。
16. 作为用户，我想 beta Release 标记为 Pre-release、说明为空，以便不覆盖 latest，且与正式版区分。
17. 作为维护者，我想 Win / Mac 矩阵构建先上传 artifact，全部成功后再挂到同一 Release，以便避免半成品 Release 或并发抢建。
18. 作为维护者，我想某一端构建失败时不发布不完整的 Release（或等价地不留下误导性的可下载集合），以便用户不会下到残缺版本。
19. 作为 Mac 用户，我想下载的包已经 Developer ID 签名并完成 Apple 公证，以便少被 Gatekeeper 阻拦。
20. 作为维护者，我想用 App Store Connect API Key（而非 Apple ID 密码）做公证，以便 CI 更稳、权限可控。
21. 作为维护者，我想把证书与 API Key 放进 GitHub Secrets，以便仓库里不出现私钥。
22. 作为维护者，我想本轮 Windows 包可以未签名先发，以便不被 Windows 证书采购卡住。
23. 作为维护者，我不想本轮接应用内自动更新，以便先跑通「打 tag → 可下载」，updater 以后再做。
24. 作为维护者，我想 push 到 `main` 时自动预热 pnpm / Electron 缓存，以便发版 job 少冷启动。
25. 作为维护者，我想 `main` 在 Win 与 Mac runner 上各跑一遍完整质量门禁，但不打安装包、不签名、不上传 Release，以便尽早发现跨平台问题。
26. 作为维护者，我想发布 workflow 对 pnpm / Electron 使用与 `main` 相同的缓存键，并单独复用 electron-builder 缓存，以便缓存语义真实、清晰。
27. 作为维护者，我想用一份 electron-builder 自动发现的动态配置，按 `package.json` version 切换安装身份与图标，以便正式/beta 差异集中、不靠 workflow 里零散覆盖。
28. 作为维护者，我想 `pnpm gen-icon` 无参数一次生成正式与 beta 两套图标并写入约定路径，以便不会互相覆盖。
29. 作为维护者，我想两套图标都提交进仓库，CI 不跑 gen-icon，以便不依赖本机 WebStorm / `sips` / 系统字体。
30. 作为用户，我想正式与 beta 共用同一套 DEV 底图视觉，beta 额外叠一层斜向 beta 标，以便仍是 DevCube 家族又一眼可辨（斜标样式可后续微调）。
31. 作为维护者，我想本地仍可用现有 `build:win` / `build:mac` 等脚本打本机包，并随动态配置吃到正确身份，以便发版前可本地冒烟。
32. 作为维护者，我想 publish 目标面向 GitHub（供日后 `--publish` 或 updater 使用），但本轮实际上传以 Actions 挂 Release 为准，以便构建与发布解耦。
33. 作为维护者，我想 Linux 本轮不打包不发布，以便范围聚焦 Win + Mac。
34. 作为维护者，我想在文档/ADR 里能看到「为何双安装身份」的决定，以便后人不要改回单 appId。
35. 作为维护者，我想 Actions 依赖固定到完整 commit SHA，workflow 默认只读、仅发布 job 获取写权限，以便降低供应链与令牌风险。

## Implementation Decisions

- **版本与触发**：维护者本地执行 bumpp（已有 `release` 脚本）升级 `package.json` version、提交并创建 `v*` tag 后推送。仅 `push` tags 匹配 `v*` 触发发布 workflow；workflow 校验该 tag 的 commit 是 `main` 的祖先（或等价「在 main 上」），否则失败。
- **通道判定**：从 version 解析——无 prerelease → 正式身份；prerelease 仅接受 `-beta` / `-beta.N` → beta 身份。其它 prerelease 直接报错并阻止构建或发版。
- **安装身份（ADR-0012）**：正式：`appId` `com.wbbb.devcube`，`productName` DevCube，Windows 可执行名 `devcube`。beta：`appId` `com.wbbb.devcube.beta`，`productName` DevCube Beta，可执行名 `devcube-beta`。打包元数据与 Windows 运行时 AppUserModelID 消费同一份身份解析结果；不同身份带来隔离的用户数据目录，不另做数据共享。
- **构建配置模块**：使用 electron-builder 自动发现的 TypeScript 配置，由 version 派生身份字段、图标目录与 `extraMetadata`。默认/正式字段与现网一致；beta 覆盖上述差异。避免维护两份易漂移的静态 YAML，也不依赖命令行额外传入配置路径。
- **制品矩阵**：`macos` runner → arm64 的 `dmg` + `zip`；`windows` runner → x64 的 `nsis` + `portable`。不打 Linux；不打 Mac universal / Win arm64。文件名用 `${name}`（无空格），见 ADR-0015。
- **发布编排**：矩阵 job 只构建并 `upload-artifact`；全部成功后，收尾 job 用官方 GitHub CLI 创建 Release、上传全部 artifact，再发布——正式非 prerelease、beta 为 Pre-release，**body 留空**。不在各矩阵 job 里竞态 `electron-builder --publish`，也不暴露半成品 Release。
- **Mac 签名与公证**：发布 Mac job 强制 Developer ID 签名与公证；凭证为证书（及密码）+ App Store Connect API Key（Key ID / Issuer ID / `.p8` 的 Base64 内容），全部来自 GitHub Secrets。workflow 将 Base64 内容解码到 runner 临时文件，验证其为有效的 PKCS#8 私钥，并把该文件的绝对路径交给 electron-builder。缺少任一凭证或私钥格式无效时在打包前失败；打包后显式校验应用签名与公证票据。非 tag 的本地构建不强制签名或公证。
- **Windows 签名**：本轮不配置；确保未提供证书时构建仍成功（勿传入空证书路径导致误解析）。
- **自动更新**：应用内更新见 `docs/prd/in-app-update.md`；本流水线须把 `latest.yml` / `latest-mac.yml` 与安装包一并挂到 GitHub Release（`publish.provider = github`，构建仍 `--publish never`，由收尾 `gh release` 上传）。
- **质量门禁与缓存**：`push` 到 `main` 时 Win + Mac 矩阵执行 lint、test、typecheck 与应用构建，缓存 pnpm store和 Electron 二进制；不运行 electron-builder、不缓存其未产生的数据、不上传 Release。tag workflow 先在同一提交执行相同门禁；打包 job 复用 pnpm / Electron 缓存，并独立缓存真实产生的 electron-builder 数据。
- **图标**：改造 gen-icon——去掉全部 CLI 参数；一次运行写出正式 / beta 目标路径，并额外写出裁掉透明安全边距的 Windows 图标（`icon-win.png`）。共用 WebStorm 底 + 黑块 + `DEV` + 横线；仅 beta 再叠斜向 beta 标（几何/颜色允许后续改脚本微调）。生成物提交入库；动态配置按身份指向对应图标，`win.icon` 用裁切版。
- **深模块（可单测）**：抽出「version → 发行身份」纯函数：输入版本字符串，输出正式/beta 判别及身份字段集合（appId、productName、executableName、是否 Pre-release、图标侧标识等）。动态配置、Windows 运行时身份与 CI 元数据脚本都消费同一语义，避免多处复制字符串规则。
- **Actions 安全**：第三方与官方 Actions 均固定到审核过的完整 commit SHA。workflow 默认 `contents: read`，只有最终发布 job 获取 `contents: write`。

## Testing Decisions

好测试：只测外部可观察的纯函数行为（给定 version → 身份结果），不测 GitHub Actions 编排、不测真实签名/公证、不测 electron-builder 出包。

要测的模块：

- **发行身份解析**：`1.0.0` → 正式；`1.0.0-beta.1` / `1.2.3-beta` → beta；字段（appId、productName、executableName、prerelease 标志）与约定一致；`alpha` / `rc` / 非法 beta 标识会失败。

不写 workflow 的 e2e；图标像素与 Apple 公证靠维护者在 CI/真机冒烟。

先例：仓库内 vitest「构造输入 → 断言输出」的 shared/main 纯函数测试（如 `project-sort`、`runnable`）。

## Out of Scope

- 应用内自动更新（已移交 `docs/prd/in-app-update.md` 与 ADR-0014；本 PRD 仍不含 updater UI 实现）
- Windows 代码签名
- Linux 打包与发布
- Mac universal / Intel-only、Windows arm64
- `alpha` / `rc` 等非 beta 预发布通道
- 正式版与 beta 共享用户数据或导入/导出配置
- CI 内运行 gen-icon
- Release 自动生成 changelog / 非空 body
- 草稿 Release 人工点 Publish
- App Store / Microsoft Store 上架
- 变更日志网站或独立下载站

## Further Notes

- 双安装身份决策见 ADR-0012。
- 应用内更新与 Release 上补传 `latest.yml` / `latest-mac.yml` 见 `docs/prd/in-app-update.md`、ADR-0014。
- Apple 签名与公证 Secrets 由维护者在首次发布前提供；它们只影响 tag 发布，缺失时发布会在 Mac 打包前明确失败，不阻断 `main` CI。
- bumpp 提交信息通常就是版本号，故 Release 说明刻意留空，避免无信息噪音。
- 本仓库只维护 PRD，不另开 issue / 不跑 triage，除非另行要求。
