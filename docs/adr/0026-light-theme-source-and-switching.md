# 浅色主题：取色源与切换机制

加浅色主题时，两件事需要定：颜色从哪来，以及主题怎么落到界面上。

**取色源不手取。** 深色的 UI 色当年是肉眼手取的（编辑器色另有 `docs/reference/Dark.icls` 兜底）。浅色改为从 WebStorm 的 `intellij.platform.ide.impl.jar` 里直接解出三份原件——`expUI_light.theme.json`（UI 层）、`expUI_lightScheme.xml`（编辑器层）、`DefaultColorSchemesManager.xml`（两者继承的基方案与 ANSI 调色板，只摘 Default 段），一并入库 `docs/reference/`。手取会引入 1 单位误差（深色侧已知三处），而这些文件是 IDE 运行时真正读的东西，没有第二解释。逐项取值与出处记在 DESIGN.md 的浅色列。

**切换机制走 `nativeTheme.themeSource` + `prefers-color-scheme`。** 主进程在建窗前按偏好把 `themeSource` 钉成 `'dark'` / `'light'`——它是强制值，不是「跟随系统」，系统外观不参与。渲染层的 CSS 只写一个 `@media (prefers-color-scheme: light)` 覆写块，取值由 Chromium 从 themeSource 推出。

选它而不是「往 `<html>` 上写 `data-theme` 属性」，是因为后者在本仓库走不通也不必要：`index.html` 的 CSP 是 `script-src 'self'`，塞不了抢在首帧前执行的行内引导脚本；而 CSS 媒体查询在样式表解析时就已定音，天然零闪烁。附带好处是原生菜单、Windows 托盘菜单、系统对话框都跟着 themeSource 走，不用逐个上色。

代价是应用主题与进程级的 OS 外观 override 绑定，将来若要做「跟随系统」以外的第三档（比如按时间自动切），仍得回到这一层来实现。窗口底色与 Windows 顶栏叠层不受 themeSource 影响，是建窗选项，需在 `main/theme.ts` 里手动同步。

**吃不了 CSS 变量的四处 JS 侧色源**（xterm 调色板、CodeMirror 主题与语法高亮、终端搜索装饰、diff 面板的 `data-theme`）各备两套，由渲染层 store 里的 `theme` 驱动；该值初始从 `matchMedia` 读，与 CSS 同源，不依赖运行时事件时序。

**Git 图谱的 12 色调色板与未提交灰不随主题变**，这是照抄上游 vscode-git-graph 的做法：那些色在上游是配置项的固定默认值，代码里没有任何明暗检测；真正随主题走的是图谱背景 / 连线光晕 / 圆点描边这类背景色，本工作区已用 `--bg-deepest` 表达。
