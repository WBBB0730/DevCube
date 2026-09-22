# 文件打开方式：安装只注册候选，设为默认按平台走官方路径

DevCube 要能被设为图片 / PDF / 音频 / 视频的默认打开程序（`docs/prd/file-preview-window.md`）。打包声明文件关联（macOS 角色 Viewer + LSHandlerRank Alternate、Windows NSIS ProgID、Linux desktop MIME）只让 DevCube 出现在系统「打开方式」列表，**安装绝不抢走任何类型的默认**；设为默认是设置里的显式动作，按平台：

- **macOS**：Electron 只暴露 URL scheme 的默认程序接口，文件类型要走 LaunchServices。我们随包带一个用 `swiftc` 编译的单文件 CLI 小助手（`build/mac/DefaultAppHelper.swift`，`get` / `set` 两个子命令，调 NSWorkspace 官方接口、不弹确认框），放在 `Contents/Resources`，由 @electron/osx-sign 遍历 Contents 时自动签名公证。`set` 按 .app 路径指定应用。**LaunchServices 只接受声明了该文档类型的应用**：对未声明的应用设默认会静默无效（退出码 0、查询仍为空），Finder「打开方式」也只列声明过的。Dev 跑的 node_modules 里的 Electron.app 什么都没声明，于是 Dev 身份用系统自带的 `osacompile` 在 Dev 数据目录生成一个「DevCube Dev.app」AppleScript 小壳（Info.plist 声明三类文件、bundle id `com.wbbb.devcube.dev`，`on open` 把文件 `open -a` 转给运行中的 dev 实例），改完 plist 后 ad-hoc 重签并经助手调公开接口 `LSRegisterURL` 注册（不用 Support 目录下的 lsregister）——实证小壳必须落在用户目录常规位置且签名有效，临时目录里的应用不会被列为候选。与快速操作在 Dev 下同一口径：dev 实例未运行则只拉起空 Electron。不做 FinderSync 那种扩展工程（ADR-0025 的反对理由是 Xcode 工程 + 扩展 + 签名面，单文件 CLI 三者都没有）。
- **Windows**：Win8 起默认程序选择由系统用用户级签名锁住，程序不可改；伪造签名的 SetUserFTA 类 hack 明确不用。按钮 = 用 reg.exe 写 HKCU Capabilities + RegisteredApplications 注册为候选，再打开 `ms-settings:defaultapps`（Win11 深链到本应用条目）让用户点选；状态从 `FileExts\<ext>\UserChoice` 的 ProgId 探测。
- **Linux**：`xdg-mime default <desktop> <mime…>`，状态用 `xdg-mime query default`。

四类扩展名表与 Files 面板的类型判定同源（`FILES_OPEN_WITH_EXTS`），保证设成默认的类型恒能内嵌预览；`svg` 归图片组，虽然它的打开分流是文本（预览窗口起手即预览态）。音频与视频在设默认上分开（用户常只想接管其一），在 Files 树顶的类型筛选里仍并作「音视频」一类。
