# macOS 安装包只声明简体中文

本应用界面一律中文（ADR-0019），但 macOS 往应用里加的系统项不走我们的文案：Window 菜单里的填充、居中、移动与调整大小、全屏幕拼贴、移到显示器与窗口列表，编辑菜单里的自动填充、开始听写、表情与符号等。它们的语言由系统在「用户偏好语言」与「应用声明支持的语言」之间取交集决定，而应用支持哪些语言，看的是安装包里的 `.lproj` 目录。Electron 默认带了 50 多种语言，于是这些系统项跟着系统语言走，英文系统下与中文界面混排。

因此 macOS 打包时用 electron-builder 的 `electronLanguages: ['zh_CN']` 只保留简体中文。它同时清理应用 Resources 与 Electron Framework 里的语言目录，系统找不到别的可选语言，这些系统项就固定显示中文。Info.plist 另补 `CFBundleDevelopmentRegion: zh_CN`，声明应用的默认语言；Xcode 新建项目都会写这一项，electron-builder 不写。

## Considered Options

- **启动时加 `--lang` 开关**：只改 Chromium 自己的语言，管不到 macOS 往菜单与对话框里加的系统项。
- **运行时给本应用写 `AppleLanguages` 偏好**：等于替用户改「系统设置 → 语言与地区 → 应用程序」里的设置，属于越权 hack。
- **只写 `CFBundleDevelopmentRegion` / `CFBundleLocalizations`**：`.lproj` 目录还在，应用仍声明支持那些语言，英文系统照样匹配到英文。

## Consequences

- 只作用于 macOS。Win/Linux 生产环境没有应用菜单，不改。
- 英文等非中文系统下，界面层的默认语言也是中文：`navigator.language`、默认 `Intl` 与不传 locale 的 `localeCompare` 都按中文规则，名称排序里的中文按拼音排；中文系统下与原先一致。
- 安装包少了 50 多种用不到的语言资源。
- 将来要做多语言，需先撤掉这条限制，再按需列出支持的语言。
