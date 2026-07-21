## Problem Statement

DevCube 已能打 tag 发到 GitHub Releases，但用户仍须自己去网页下载重装。正式版与 Beta 并行安装时，还容易搞不清该跟哪条线。应用缺少统一的窗口顶栏与设置入口，更新提示也无处安放；退出时若还有配置在跑，进程会被直接杀掉，没有提醒。

## Solution

以公开仓库的 GitHub Release 为唯一更新源，包装好的安装版在应用内检查、静默下载、提示后安装（退出时若已下好也会装上）。正式版与 Beta 各跟自己的 Release，不跨线。Windows Portable 不能自动装，顶栏用同款按钮，点击打开对应 Release 页。一并换上自定义窗口顶栏（中间标题与现有逻辑一致；右侧为更新按钮与设置），设置弹层对齐 WebStorm（本轮：关于做实、快捷键只读；有真实项之前不挂偏好栏）。凡会退出整个应用的路径，若仍有运行中的 **Run Session**，必须二次确认（**Terminal** 不计入）。

## User Stories

1. 作为正式版用户，我想应用自动发现新的正式 GitHub Release，以便不用自己盯发布页。
2. 作为 Beta 用户，我想应用只发现 Beta / Pre-release，以便不会被升成正式版安装包。
3. 作为正式版用户，我不想收到 Beta / Pre-release，以便稳定线不被预发布打扰。
4. 作为用户，我想启动后稍后自动检查更新（带短随机延迟），以便不和启动抢资源、也避免多实例同时戳 GitHub。
5. 作为用户，我想应用开着时大约每 4 小时再查一次，以便当天后续发版也能收到。
6. 作为用户，我想在设置 → 关于里手动「检查更新」，以便刚发版时立刻查。
7. 作为可自动更新形态的用户，我想发现新版本后后台静默下载，以便不打断当前工作。
8. 作为可自动更新形态的用户，我想只有下载完成、可以安装时，顶栏才出现更新按钮，以便按钮含义单一。
9. 作为可自动更新形态的用户，我想点击顶栏更新按钮后重启并安装，以便马上用上新版本。
10. 作为可自动更新形态的用户，我想更新已下好后正常退出应用时也自动装上，以便不必非点顶栏按钮。
11. 作为用户，我不想关掉或「跳过」顶栏更新按钮，以便待处理更新一直可见直到装完。
12. 作为 Windows Portable 用户，我想在已知有新版本时看到同款顶栏按钮，点击后打开对应 GitHub Release，以便自行下载便携包。
13. 作为 Windows Portable 用户，我不想应用尝试对我做 NSIS 式静默安装，以便不出现失败或错包。
14. 作为 macOS 用户，我想无论当初用 dmg 还是 zip 装上的 `.app` 都能完整应用内更新，以便行为一致。
15. 作为用户，我想开发模式（未包装）完全不检查、不下载更新，以便本地开发不被误报打扰。
16. 作为用户，我想看到自定义窗口顶栏（隐藏系统标题栏），以便外观靠近 WebStorm。
17. 作为用户，我想顶栏中间标题与现在窗口标题一致——有当前 **Project** 时为「项目名 — DevCube」，否则「DevCube」——以便不学两套文案。
18. 作为用户，我想顶栏右侧有设置齿轮，以便进入应用设置。
19. 作为用户，我想点设置后出现盖在主窗口上的大弹层（不是第二个窗口），布局像 WebStorm 设置：左分类树、右内容、底「确定」关闭，以便手感熟悉。
20. 作为用户，我想设置里有「关于」：应用名与 **Release Edition**、当前版本、更新状态、「检查更新」、仓库链接；便携版另有打开 Release 的入口，以便更新与版本信息一处看清。
21. 作为用户，我不想关于里展示 Release 正文当 changelog（当前发版说明为空），以免空白或误导。
22. 作为用户，我想设置里有「快捷键」只读列表（按现有绑定展示平台文案），以便查阅、本轮不必改键。
23. 作为用户，当还有运行中的 **Run Session** 时，我想 Cmd+Q、Windows/Linux 关窗退出、以及「重启以更新」等会退出整个应用的操作都先二次确认，以便不误杀正在跑的配置。
24. 作为用户，当只有 **Terminal** 在跑、没有运行中的 **Run Session** 时，我不想被退出确认拦住，以便终端不挡退出。
25. 作为 macOS 用户，我只关窗口、应用仍留在 Dock 时，不想被当成「退出应用」来确认，以便保持现有「关窗不退出」行为。
26. 作为用户，我想检查失败时顶栏不吵、仅在关于里能看到状态/错误，以便网络抖动不弹骚扰。
27. 作为维护者，我想 Release 上除安装包与 blockmap 外挂上 `latest.yml` / `latest-mac.yml`，以便 electron-updater 能校验并下载正确制品。
28. 作为维护者，我想继续用现有「矩阵构建 → 收尾 `gh release`」流程补传 yml，而不是改回构建时 `--publish`，以便构建与发布仍然解耦。
31. 作为维护者，我想公开仓库即可更新、不要求用户侧 GitHub Token，以便分发简单。
32. 作为用户，我想正式版与 Beta 的更新与数据目录继续隔离，以便内测不影响稳定安装（见 ADR-0012）。

## Implementation Decisions

- **更新源**：`electron-updater`，`publish.provider = github`，面向公开仓库 `WBBB0730/DevCube`。不以自建 generic 站、不以改回构建期 `--publish` 为主路径。
- **身份封闭（ADR-0014）**：检查结果在采纳前按当前 **Release Edition** 过滤——正式只接受非 Pre-release；Beta 只接受 Pre-release；可辅以制品名 / 身份字段校验。明确不用官方 `channel=beta`「beta ∪ latest」漏斗作主方案。
- **可自动更新形态**：macOS 上的 `.app`（更新载体仍依赖 Release 上的 zip + `latest-mac.yml`）；Windows NSIS 安装版（`latest.yml` + setup）。Windows Portable：只检查与提示，点击顶栏按钮 / 关于入口打开对应 Release，不走 `quitAndInstall`。
- **检查节奏**：包装后的应用——启动后短 jitter 再查；运行中约每 4 小时；关于页手动检查。未包装 / 开发模式：updater 全关。
- **下载与安装**：可自动更新形态由编排层在检查通过后显式 `downloadUpdate`（`autoDownload = false`，与身份过滤同一处控制）。顶栏更新按钮仅在「已下载可安装」时显示（便携：已知有新版本时显示同款按钮）。按钮不可关闭、不可跳过版本。`autoInstallOnAppQuit = false`：已下好则在正常退出清理完成后显式安装；顶栏按钮同样走 `app.quit` → 清理 → 安装（若有运行中 Run Session 先走退出确认）。macOS 安装前卸掉会拦截退出的监听并挂 `before-quit-for-update` + `app.exit`，保证 Squirrel.Mac 装完能重开（ADR-0016）。
- **发布产物**：CI artifact / `gh release` 上传集增加 updater 元数据（至少每端的 `latest.yml` / `latest-mac.yml`），与现有 dmg/zip/exe/blockmap 一并挂到同一 Release；接受 Release 资产列表中可见 yml。
- **制品文件名（ADR-0015）**：进 Release / 写入更新清单的文件名一律用无空格的 `${name}`（`devcube` / `devcube-beta`），不用带空格的 `productName`。mac zip 形如 `${name}-${version}-${arch}-mac.zip`，与 `latest-mac.yml` 的 url 及 GitHub 资产名一致。显示名「DevCube Beta」只用于 UI。
- **窗口顶栏**：`titleBarStyle` 隐藏系统标题栏；macOS 保留原生红绿灯；Windows/Linux 用系统窗口按钮叠层（如 `titleBarOverlay`）。中间标题与现 `document.title` 逻辑一致（本轮仍写「DevCube」字面，不强制改成 Beta 显示名）。右侧：条件显示的更新按钮 + 设置齿轮。拖拽区与控件 `no-drag` 分区按平台留出安全区。
- **设置弹层**：主窗口内全屏级模态（非第二 BrowserWindow）。结构对齐 WebStorm：左分类树、右内容，底仅「确定」关闭（主色；无取消/应用——改动即时生效）。本轮栏目：关于（做实）、快捷键（只读）；有真实偏好项之前不挂「偏好」栏、不写占位文案。应用设置与 Git 仓库设置共用同一外壳。
- **退出确认**：任一会结束整个应用进程的路径，若存在状态为运行中的 **Run Session**，先确认；**Terminal** 不参与条件。macOS 仅关窗不退出不触发。确认文案含运行中 **Run Session** 数量提示（用「运行会话」表述）。更新重启安装走同一确认闸。
- **模块划分（深模块优先）**：
  - **更新策略纯函数**：输入当前版本 / **Release Edition** / 包装形态 / 候选更新信息 → 输出是否采纳、顶栏是否显示、点击动作（安装 vs 打开 Release）等；供单测。
  - **主进程更新编排**：包装检测、jitter/周期/手动检查、下载与事件、退出时安装、打开外部 Release URL；经 IPC 把状态推给渲染层。
  - **退出闸**：查询是否有运行中 Run Session；拦截 quit / 关窗退出 / quitAndInstall。
  - **渲染：顶栏 + 设置弹层 + 关于/快捷键只读 UI**。
- **与 ci-release 关系**：发版流水线与双身份仍以 `docs/prd/ci-release.md` + ADR-0012 为准；本 PRD 接管其原先划出的「应用内自动更新」范围，并要求补传 yml。

## Testing Decisions

好测试：只测可观察的策略与纯函数（给定身份/形态/候选 → 是否采纳、按钮是否显示、点击语义），以及退出闸「有/无运行中 Run Session」；不测真实 GitHub 网络、不测真实 NSIS/Squirrel 安装、不测 CI 上传。

要测的模块：

- **更新过滤与形态策略**（正式/Beta、便携/安装、可安装前不显示按钮等）。
- **退出确认条件**（仅 Run Session；Terminal 忽略）。
- 既有 **Release Edition** 解析保持绿。

先例：`release-edition`、`project-sort`、`app-shortcut` 等 shared/main 纯函数 vitest。UI 与真机更新靠维护者在包装构建上冒烟。

## Out of Scope

- 快捷键改键与冲突检测持久化
- 真实应用偏好项（主题、更新开关等）
- 官方 electron-builder 多 channel 漏斗（beta 含 latest）
- 私有仓库更新 / 用户侧 GitHub Token
- 开发模式下的更新检查
- 跳过某版本 / 暂时隐藏更新按钮
- 从 Release body 生成 changelog UI
- Windows 代码签名（仍可未签名发版；SmartScreen 体验另案）
- Linux 打包与更新
- 单独 BrowserWindow 设置窗
- 顶栏搬入 Run Configuration / 调试按钮等 WebStorm 其余控件
- 将窗口标题字面改成「DevCube Beta」（可另开；本轮与现逻辑对齐）

## Further Notes

- 双安装身份见 ADR-0012；更新过滤见 ADR-0014。
- `docs/prd/ci-release.md` 明确不做应用内更新的表述由本 PRD 承接；发版侧需补 yml。
- 仓库公开：`https://github.com/WBBB0730/DevCube`。
