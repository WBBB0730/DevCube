# 界面语言钉成简体中文：macOS 安装包只声明简体中文，各平台启动时指定中文

本应用界面一律中文（ADR-0019），但有两类文案不走我们的代码，要分别处理。

**macOS 往应用里加的系统项**：Window 菜单里的填充、居中、移动与调整大小、全屏幕拼贴、移到显示器与窗口列表，编辑菜单里的自动填充、开始听写、表情与符号等。它们的语言由系统在「用户偏好语言」与「应用声明支持的语言」之间取交集决定，而应用支持哪些语言，看的是安装包里的 `.lproj` 目录。Electron 默认带了 50 多种语言，于是这些系统项跟着系统语言走，英文系统下与中文界面混排。因此 macOS 打包时用 electron-builder 的 `electronLanguages: ['zh_CN']` 只保留简体中文。它同时清理应用 Resources 与 Electron Framework 里的语言目录，系统找不到别的可选语言，这些系统项就固定显示中文。Info.plist 另补 `CFBundleDevelopmentRegion: zh_CN`，声明应用的默认语言；Xcode 新建项目都会写这一项，electron-builder 不写。

**Chromium 自己的文案**：视频画中画小窗里的「返回标签页」等，跟 Chromium 的应用语言走。Windows / Linux 上应用语言随系统，英文系统下是英文；开发版的 Electron.app 不带 `.lproj`，macOS 上也落成英文（实测中文系统下为 `en-US`）。因此主进程在 `app.ready` 之前加 `--lang=zh-CN`（`app.commandLine.appendSwitch`），各平台与开发版的应用语言都钉成简体中文。

## Considered Options

- **macOS 只靠 `--lang`**：只改 Chromium 自己的语言，管不到 macOS 往菜单与对话框里加的系统项，所以 macOS 两样都要。
- **运行时给本应用写 `AppleLanguages` 偏好**：等于替用户改「系统设置 → 语言与地区 → 应用程序」里的设置，属于越权 hack。
- **只写 `CFBundleDevelopmentRegion` / `CFBundleLocalizations`**：`.lproj` 目录还在，应用仍声明支持那些语言，英文系统照样匹配到英文。
- **Windows / Linux 不改，随系统语言**：英文系统下画中画等 Chromium 文案是英文，与中文界面混排。

## Consequences

- 任何系统下，界面层的默认语言都是中文：`navigator.language`、默认 `Intl` 与不传 locale 的 `localeCompare` 都按中文规则，名称排序里的中文按拼音排；中文系统下与原先一致。
- macOS 安装包少了 50 多种用不到的语言资源。
- 将来要做多语言，需先撤掉这两条限制，再按需列出支持的语言。
