# Files Tab PDF 预览

## Problem Statement

仓库里的 PDF（设计稿导出、规格说明、论文、票据）在 Files Tab 里只能看到「无法在此编辑此文件」占位，得跳去系统应用才能看内容，Files Tab「不用跳出去看资源」的链路在 PDF 上断了。

## Solution

打开 PDF 时在正文区内嵌预览：连续滚动翻页、只渲染看得见的页、Cmd/Ctrl+滚轮与触控板捏合按光标缩放、文字可选中复制、Cmd+F 查找并高亮；工具栏钮组最左出现页码输入与缩放控件。工具栏、查找栏、快捷键与主题都是 DevCube 自己的，渲染引擎用 PDF.js。

## User Stories

1. As a 开发者, I want 打开 .pdf 文件时在右侧看到内容而不是占位, so that 看设计稿和文档不用跳出去
2. As a 开发者, I want 默认按宽度适配打开, so that 一屏就能读完整行
3. As a 开发者, I want 用 Cmd/Ctrl+滚轮或触控板捏合按光标缩放且手感与看图一致, so that 不用记两套操作
4. As a 开发者, I want 普通滚轮就是翻页滚动, so that 长文档读起来像网页
5. As a 开发者, I want 工具栏看到当前页 / 总页数并能输入页码跳转, so that 能定位到具体页
6. As a 开发者, I want 工具栏有缩小 / 放大 / 适配宽度和当前百分比, so that 不用滚轮也能调
7. As a 开发者, I want 能选中并复制 PDF 里的文字, so that 能摘录内容
8. As a 开发者, I want Cmd+F 打开和编辑器同款的查找栏，命中高亮、上一个 / 下一个、计数, so that 能在长文档里找关键词
9. As a 开发者, I want 查找支持区分大小写与全词, so that 能精确定位
10. As a 开发者, I want PDF 里的内部链接（目录跳转）可点, so that 能从目录直达章节
11. As a 开发者, I want 外部链接用系统浏览器打开, so that 应用内不被导航走
12. As a 开发者, I want 中文 / 日文等 PDF 也能正常显示字形, so that 不出现方块
13. As a 开发者, I want 打不开的 PDF（加密、损坏）看到明确提示并能「在其他应用中打开」, so that 不对着空白
14. As a 开发者, I want 换成别的 PDF 时页码、缩放回到初始状态, so that 不带着上一份的状态
15. As a 开发者, I want 深浅两套主题下预览都协调（页面保持白底、容器随主题）, so that 不刺眼
16. As a 开发者, I want 预览不执行 PDF 里的脚本、不弹表单, so that 打开陌生仓库的文件也安全
17. As a 开发者, I want 在页边 / 图片 / 页间空白处按住拖动或按住空格拖动就能抓着文档走，而按在文字上拖动仍是选字, so that 拖拽手感和看图一致又不丢复制

## Implementation Decisions

- 分流：主进程按魔数识别 `application/pdf` → 打开类型 pdf，文件走既有 `dc-media` 协议 URL；渲染层 `fetch` 一次取回交给 PDF.js（PDF.js 对非 http(s) 地址不做 Range 分段，自取与交它取等价）。
- 渲染引擎：`pdfjs-dist`（PDF.js，Apache-2.0）的官方 viewer 组件层——`PDFViewer` + `EventBus` + `PDFLinkService` + `PDFFindController`：连续滚动、只渲染可见页、缩放重绘、文字层（选中复制）、查找高亮与内链跳转都由库负责；不用 react-pdf 之类只包单页渲染的封装。用 `legacy` 构建（默认构建依赖比当前 Electron 的 Chromium 更新的 JS 特性，legacy 自带垫片）；worker 用 Vite `?url` 引入，构建不出 worker 时库自动退回主线程假 worker。
- 运行期资源：字体映射表 / 标准字体 / wasm 解码器随应用打包（electron-builder extraResources → resources/pdfjs），渲染层经 `dc-media` 协议 `a=pdfjs&f=…` 读取（协议只放行这三个子目录，MIME 按扩展名）；PDF.js 对非 http(s) 资源走 XHR，改为自备 fetch 取数工厂（协议明确支持 fetch）。不带 ICC 色彩管理资源，CMYK 走库内置换算。画布开硬件加速（`enableHWA`，PDF.js 自家 viewer 的默认值；库层默认关只是保守），整页大图类 PDF 每页渲染明显更快。单张位图解码上限 8 MP（`canvasMaxAreaInBytes`）：超限的图按 2 的幂缩小，JPEG 直接按目标尺寸解码；2 倍屏适配宽度全幅仍清晰，放大两倍以上的大照片略软。取舍依据：一页嵌多张相机原片的 PDF（实测 94 页作品集第 92 页 9 张图 1.78 亿像素、约 700 MB）会拖垮整份文档的滚动，而 PDF.js 的解码模型是每页首次渲染解一次、缩放不重解，做不到「平时省着解、放大再看原图」，要那种效果得换分块渲染模型（见 ADR-0030）。
- 壳：工具栏钮组最左一组「页码输入 / 总页数 · 缩小 · 百分比 · 放大 · 适配宽度」，以竖线与其它钮隔开（工具栏抽成独立组件并加 `extra` 插槽）；Cmd/Ctrl+滚轮与捏合复用看图的倍率常量，经 `updateScale` 带 `drawingDelay`（手势中 CSS 缩放、停手 100ms 后重绘，与看图同节奏）；Cmd+F 打开与编辑器同款查找栏（外壳抽成共用 FindBar，PDF 不提供正则开关），Enter / Shift+Enter 上下条（当前命中每次滚到视口正中，同编辑器查找；库默认贴顶留 50px，经子类覆盖 `scrollMatchIntoView` 改掉并清零其滚动边距。Chromium 页内查找与 PDF 查看器是「可见不动、不可见居中」，手感不合适时的备选）、Esc 关闭并清高亮；默认 `page-width`；正文容器可聚焦，方向键 / PageUp / PageDown 原生滚动。拖拽：按在文字 / 注解控件上让给选字与点击，其余位置抓着滚动容器走；按住空格处处抓手（拦掉原生空格翻页），光标 grab / grabbing 同看图。
- 主题：容器 `--bg-deepest`，页面保持白底、去掉库自带透明留白边框改用阴影（`removePageBorders`），查找命中 / 选中色对齐编辑器 TEXT_SEARCH_RESULT 黄 / 橙并带透明度；链接 hover 沿用库的 20% 色块，颜色由黄换成 `--link`（可点的 `<a>` 是盖在注解矩形上的透明盒子，矩形大小由作者工具决定、文字画在画布上，下划线位置和字色都做不准，主流查看器也不装饰链接文字；试过下划线后放弃）。库样式表在应用样式表顶部以级联层引入，应用覆盖天然在上层，不与库比特异性；查找高亮变量声明在每块命中元素自身，覆盖须落在同一元素。
- 安全：注解层只开链接（`AnnotationMode.ENABLE`），不启用表单与脚本。外链由库标 `target=_blank`（`externalLinkTarget`），经主进程开窗处理器校验后交系统浏览器（只放行 http/https/mailto，与 IPC openExternal 同一份白名单）；主进程另装导航守卫，渲染层主框架除重载自身外禁止任何导航（Electron 安全清单「限制导航 / 限制开窗」），任何链接漏拦也换不掉页面。
- CSP：`connect-src` 放行 `dc-media:`（取文件与资源）。

## Testing Decisions

- MIME 分流（`application/pdf` → pdf）表驱动单测（`files-kind.test.ts`）。
- 资源 URL 形状（`a` / `f` 顺序，`f` 末位可直接拼文件名）与协议只放行三个资源子目录：主进程路径校验复用既有 `resolveWithinProject`（已有测试）。
- 外链白名单（http/https/mailto 放行、其他协议与相对地址拒绝）表驱动单测。
- 渲染、缩放、查找是库行为，不配组件单测；打开 / 缩放 / 查找 / 内外链 / 损坏文件人工回归。

## Out of Scope

- 批注与高亮编辑、表单填写、签名、打印、保存。
- 缩略图与大纲侧栏、双页 / 横向滚动模式、旋转。
- 深色模式下反转页面颜色。
- 放大后按需重解图片看原图（PDF.js 模型不支持，属分块渲染引擎的能力）。
- 外部修改 PDF 后自动刷新（与图片同，尚无此机制）。

## Further Notes

- 「为什么不用 Chromium 自带阅读器」见 ADR-0030。
- 大纲侧栏若以后要做，`PDFLinkService` 已能承接 outline 跳转，只需补 UI。
