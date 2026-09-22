# Files Tab PDF 预览

## Problem Statement

仓库里的 PDF（设计稿导出、规格说明、论文、票据）在 Files Tab 里只能看到「无法在此编辑此文件」占位，得跳去系统应用才能看内容，Files Tab「不用跳出去看资源」的链路在 PDF 上断了。

## Solution

打开 PDF 时在正文区内嵌预览：连续滚动翻页、只渲染看得见的页、Cmd/Ctrl+滚轮与触控板捏合按光标缩放、文字可选中复制、Cmd+F 查找并高亮；正文左侧一列缩略图，点格直达那一页、翻到哪页点亮哪格，可用面包屑文件名后的开关钮收起；↑/↓ 始终上一页 / 下一页；工具栏钮组最左出现页码输入与四档「1:1 / 适应高度 / 适应宽度 / 适应窗口」钮组。工具栏、查找栏、快捷键与主题都是 DevCube 自己的，渲染引擎用 PDF.js。

## User Stories

1. As a 开发者, I want 打开 .pdf 文件时在右侧看到内容而不是占位, so that 看设计稿和文档不用跳出去
2. As a 开发者, I want 默认整页都显示得下地打开（同看图）, so that 先看到全貌再决定放大哪里
3. As a 开发者, I want 用 Cmd/Ctrl+滚轮或触控板捏合按光标缩放且手感与看图一致, so that 不用记两套操作
4. As a 开发者, I want 普通滚轮就是翻页滚动, so that 长文档读起来像网页
5. As a 开发者, I want 工具栏看到当前页 / 总页数并能输入页码跳转, so that 能定位到具体页
6. As a 开发者, I want 工具栏有「1:1 / 适应高度 / 适应宽度 / 适应窗口」四档且互斥点亮, so that 既能指定看法，也能一眼看出自己在哪一档
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
18. As a 开发者, I want 空白处双击就能在两档之间切换，而文字上双击仍是选词, so that 常用切换不必抬手去工具栏
19. As a 开发者, I want 当前处在哪一档在工具栏上看得出来, so that 不用猜自己是不是缩过了
20. As a 开发者, I want 拖窗口或显隐文件树之后所处的档位仍然贴合, so that 改完布局不用再点一次
21. As a 开发者, I want 一颗 1:1 钮按纸张实际尺寸显示, so that 能核对版面的真实大小
22. As a 开发者, I want Cmd/Ctrl+0 一键回到适应窗口、Cmd/Ctrl +/- 逐档缩放, so that 不碰滚轮也能调，且和别的看图软件一个手感
23. As a 开发者, I want 正文左侧看到每页缩略图并点击直达那一页, so that 长文档里能按版式找页、不必猜页码
24. As a 开发者, I want 正文翻到哪页缩略图就点亮哪格并滚到可见位置, so that 随时知道自己在文档的哪里
25. As a 开发者, I want 一颗钮收起 / 展开缩略图且切换文件后保持, so that 想专心看页面时能腾出宽度
26. As a 开发者, I want 几百页的 PDF 开着缩略图也不卡, so that 大文档也敢一直开着侧栏
27. As a 开发者, I want 滚过的缩略图再滚回来立刻显示、快速滚动不白干, so that 往后翻找页不用一次次等
28. As a 开发者, I want 按 ↑/↓ 就翻上一页 / 下一页，在正文和缩略图里都一样, so that 逐页看不用碰鼠标

## Implementation Decisions

- 分流：主进程按魔数识别 `application/pdf` → 打开类型 pdf，文件走既有 `dc-media` 协议 URL；渲染层 `fetch` 一次取回交给 PDF.js（PDF.js 对非 http(s) 地址不做 Range 分段，自取与交它取等价）。
- 渲染引擎：`pdfjs-dist`（PDF.js，Apache-2.0）的官方 viewer 组件层——`PDFViewer` + `EventBus` + `PDFLinkService` + `PDFFindController`：连续滚动、只渲染可见页、缩放重绘、文字层（选中复制）、查找高亮与内链跳转都由库负责；不用 react-pdf 之类只包单页渲染的封装。用 `legacy` 构建（默认构建依赖比当前 Electron 的 Chromium 更新的 JS 特性，legacy 自带垫片）；worker 用 Vite `?url` 引入，构建不出 worker 时库自动退回主线程假 worker。
- 运行期资源：字体映射表 / 标准字体 / wasm 解码器随应用打包（electron-builder extraResources → resources/pdfjs），渲染层经 `dc-media` 协议 `a=pdfjs&f=…` 读取（协议只放行这三个子目录，MIME 按扩展名）；PDF.js 对非 http(s) 资源走 XHR，改为自备 fetch 取数工厂（协议明确支持 fetch）。不带 ICC 色彩管理资源，CMYK 走库内置换算。画布开硬件加速（`enableHWA`，PDF.js 自家 viewer 的默认值；库层默认关只是保守），整页大图类 PDF 每页渲染明显更快。单张位图解码上限 8 MP（`canvasMaxAreaInBytes`）：超限的图按 2 的幂缩小，JPEG 直接按目标尺寸解码；2 倍屏适配宽度全幅仍清晰，放大两倍以上的大照片略软。取舍依据：一页嵌多张相机原片的 PDF（实测 94 页作品集第 92 页 9 张图 1.78 亿像素、约 700 MB）会拖垮整份文档的滚动，而 PDF.js 的解码模型是每页首次渲染解一次、缩放不重解，做不到「平时省着解、放大再看原图」，要那种效果得换分块渲染模型（见 ADR-0030）。
- 壳：工具栏钮组最左一组「页码输入 / 总页数 · 竖线 · 1:1 · 适应高度 · 适应宽度 · 适应窗口」，整组再以竖线与其它钮隔开（工具栏抽成独立组件并加 `extra` 插槽）。四档一一对应 PDF.js 的 `page-actual` / `page-height` / `page-width` / `page-fit`，与看图共用同一组图标与文案（1:1 是自画的方框图标——lucide 无此字形，按其 24 画布 / 2px 圆头描边规范画，框内不排文字而是描边画两竖一冒号，不依赖字体、天然对称；其余为 `GalleryVertical` / `GalleryHorizontal` / `Scan`。整组出自看图模块）；四档互斥点亮（同查找栏方形开关，读 `scalechanging` 的 `presetValue` 反查——滚轮缩出的数值倍率不带该字段，四颗随之全灭）。「适应窗口」是**独立一档**而不是「挑出较小的那条轴」：轴钉死后视口比例一变就可能让另一轴溢出，而这一档由库每次按新尺寸重算，「整页看得见」一直成立。「1:1」= 纸张实际尺寸（1 pt = 1/72 英寸，PDF.js 里 scale 1 即 96/72 CSS px），与窗口无关，也与图片那边「像素对像素」的 1:1 是不同的物理含义。Cmd/Ctrl+0 回适应窗口、Cmd/Ctrl +/- 逐档缩放（步长取库的 `DEFAULT_SCALE_DELTA` 1.1，看图那边用同一个常量；按视口中心锚定，同看图——库不带锚点时把视口左上角那点放回原处，内容会随放大往右下漂；「适应窗口」钮 title 带 ⌘0，走 `shortcutTitle`；与 Cmd+F 同一个键盘监听，仅 Files Tab 可见且焦点在预览内时响应，不进全局 `matchAppShortcut`）。这三个键要能用，得先让应用菜单别占着它们——菜单加速键优先级更高；另外 `@electron-toolkit/utils` 的 `watchWindowShortcuts` 默认在 `before-input-event` 里拦下 Cmd/Ctrl+- 与 Cmd/Ctrl+Shift+=（它以为是在关网页缩放），须传 `zoom: true` 放行，两处都见 ADR-0019。空白处双击在两条轴之间切换，让路规则同抓手（文字 / 注解上不接管），并按双击点当锚点改滚动位置（库的预设缩放只保当前页可见、不认锚点）；从「适应窗口」进来时先判它实际顶住的是哪条轴——`page-fit` 就是库在两条轴里取小的那个，比一下当前页与容器的宽高比即知（`removePageBorders` 已把库的 padding 归零，比值与库内部算的一致）——再切到另一条，否则宽图双击后还停在原地；「1:1」与滚轮缩出的自由倍率不在轴上，落适应宽度；**双击从 mousedown 的 `detail === 2` 判定，不接 `dblclick`**——拖拽期间盖着的全屏遮罩会接走 mouseup，click / dblclick 的 target 退化成两者的共同祖先，永远落不到预览区；不设加减档与百分比读数——倍率调节归滚轮与捏合，工具栏只留「回到某个确定状态」的入口；滚动容器不留内边距：库按容器 `clientHeight` 算 `page-height`，多一层 padding 就会让整页看不全，页间留白交给库的 `.page` margin（`removePageBorders` 下 `0 auto 10px`）；容器尺寸变化（拖窗口 / 文件树显隐 / 查找栏开合）时重设一次 `currentScaleValue` 让预设档跟随——库自带的 ResizeObserver 只更新内部缓存，这段历来是官方 viewer 外壳的活；**容器尺寸为 0 时一概不动**：Tab 切走是 `display:none`，按 0 重算会把页面缩到 0 宽高，之后连预设倍率都成了 `0/0`，切回来就落在一个无意义的倍率上；Cmd/Ctrl+滚轮与捏合复用看图的倍率常量，经 `updateScale` 带 `drawingDelay`（手势中 CSS 缩放、停手 100ms 后重绘，与看图同节奏）；Cmd+F 打开与编辑器同款查找栏（外壳抽成共用 FindBar，PDF 不提供正则开关），Enter / Shift+Enter 上下条（当前命中每次滚到视口正中，同编辑器查找；库默认贴顶留 50px，经子类覆盖 `scrollMatchIntoView` 改掉并清零其滚动边距。Chromium 页内查找与 PDF 查看器是「可见不动、不可见居中」，手感不合适时的备选）、Esc 关闭并清高亮；打开即 `page-fit`（对齐看图开场；原先固定 `page-width` 弃用）；正文容器可聚焦，方向键 / PageUp / PageDown 原生滚动。拖拽：按在文字 / 注解控件上让给选字与点击，其余位置抓着滚动容器走；按住空格处处抓手（拦掉原生空格翻页），光标 grab / grabbing 同看图。
- 缩略图侧栏：正文左侧固定 168px 一列（侧栏不可拖，DESIGN.md 规矩；`--bg-deepest` 垫底、右缘 1px `--separator`），每格 = 白底带阴影的小页（宽 128px，高按该页真实宽高比，横竖页混排不变形）+ 其下 12px `--fg-info` 页码；留白统一 8px（侧栏内边距、格子内边距、小图到页码、页码到底边、格子之间），侧栏宽由小图宽加留白推出；格子三态底色由深到亮：常态 `--bg-panel`（比侧栏底亮一档）、hover `--bg-row-hover`、当前页 `--selection-row` 圆角底并把页码转 `--fg-primary`（同树行）。点格 = 设当前页并把焦点还给正文；正文 `pagechanging` 驱动点亮并以最小距离滚入视口（已在视口内不动）。**↑/↓ 始终上一页 / 下一页**（不看档位；正文与侧栏内都如此，同看图的方向键切图：不抢输入框与弹层、不要求焦点在预览内；PageUp / PageDown 与 ←/→ 仍原生滚动）。PDF.js 组件层不导出其阅读器的 PDFThumbnailViewer，照其模型自写、重活仍交给库——**渲染器**（一份文档一个，随文档建 / 销毁、归 PDF 预览持有，侧栏开合不丢缓存）：一次只画一张、永远先画离侧栏视口最近的页，视口画完再顺着滚动方向预取两屏、反方向补一屏（一屏 = 视口内页数），不画整本；画好的小图 JPEG 压缩后存成 blob 对象 URL（二进制不转 base64、由浏览器托管不进 JS 堆、同图反复挂载共用解码；data URL 是 Firefox 阅读器的老写法，那边缩略图不虚拟滚动、只挂一次；渲染层 CSP 的 `img-src` 为此放行 `blob:`——blob 地址只能由本页脚本创建，不放开任何远程资源）、整个文档期间不扔、销毁时统一回收；开画的不半途作废、只有销毁才作废（快速滚动不白干）；每画完一张发库的 `thumbnailrendered`，阅读器据此释放不在其缓冲区内的页资源（否则画过小图的页把解好的大图一直留在内存里）；等正文首页画完（`onePageRendered`）才开工。**列表**用 @tanstack/react-virtual（文件树同款）只挂视口内的格子（overscan 2），把视口首尾页与滚动方向交给渲染器定优先级，格子拿到 URL 即显示、否则白页占位；页面尺寸在文档就绪后一次取齐（`getPage` 命中阅读器 `setDocument` 已做的全量预取），组件按文档 key 重挂。主视图与缩略图同一页共用操作列表与已解码图片，不重解。开关钮领在面包屑之前（`PanelLeft`，侧栏开着时点亮，激活态同四档钮 / 查找栏方形开关；侧栏在正文左侧，钮也靠左，位置不随路径长短漂移——工具栏为此加 `pathExtra` 插槽，面包屑截断时钮不缩、双击不触发文件树显隐），状态挂在 FilesPane（同 `treeVisible` / `sourcePreview`：会话内保持、不落盘、切换文件保持），默认显示；加载中先出空壳占位、打不开时不出，避免正文宽度来回跳；开合改变正文宽度后由既有 ResizeObserver 让预设档重算。
- 主题：容器 `--bg-deepest`，页面保持白底、去掉库自带透明留白边框改用阴影（`removePageBorders`），查找命中 / 选中色对齐编辑器 TEXT_SEARCH_RESULT 黄 / 橙并带透明度；链接 hover 沿用库的 20% 色块，颜色由黄换成 `--link`（可点的 `<a>` 是盖在注解矩形上的透明盒子，矩形大小由作者工具决定、文字画在画布上，下划线位置和字色都做不准，主流查看器也不装饰链接文字；试过下划线后放弃）。库样式表在应用样式表顶部以级联层引入，应用覆盖天然在上层，不与库比特异性；查找高亮变量声明在每块命中元素自身，覆盖须落在同一元素。
- 安全：注解层只开链接（`AnnotationMode.ENABLE`），不启用表单与脚本。外链由库标 `target=_blank`（`externalLinkTarget`），经主进程开窗处理器校验后交系统浏览器（只放行 http/https/mailto，与 IPC openExternal 同一份白名单）；主进程另装导航守卫，渲染层主框架除重载自身外禁止任何导航（Electron 安全清单「限制导航 / 限制开窗」），任何链接漏拦也换不掉页面。
- CSP：`connect-src` 放行 `dc-media:`（取文件与资源）；`img-src` 放行 `blob:`（缩略图缓存的对象 URL）。

## Testing Decisions

- MIME 分流（`application/pdf` → pdf）表驱动单测（`files-kind.test.ts`）。
- 资源 URL 形状（`a` / `f` 顺序，`f` 末位可直接拼文件名）与协议只放行三个资源子目录：主进程路径校验复用既有 `resolveWithinProject`（已有测试）。
- 外链白名单（http/https/mailto 放行、其他协议与相对地址拒绝）表驱动单测。
- 缩略图取页顺序（视口内优先、顺滚动方向预取、反向补、不越过首尾、窗口画完即停不画整本）表驱动单测（`files-pdf-thumbnails.test.ts`）；画图与缓存是 DOM / 库行为，不配单测。
- 渲染、缩放、查找是库行为，不配组件单测；打开 / 缩放 / 四档切换（含双击、Cmd+0、改窗口大小后是否仍贴合、切走项目再回来）/ 查找 / 内外链 / 损坏文件 / 缩略图（点格跳页、翻页跟随、↑/↓ 翻页、开合后档位重算与缓存仍在、横竖页混排、几百页文档往后快速滚动）人工回归。

## Out of Scope

- 批注与高亮编辑、表单填写、签名、打印、保存。
- 大纲侧栏、双页 / 横向滚动模式、旋转。
- 深色模式下反转页面颜色。
- 放大后按需重解图片看原图（PDF.js 模型不支持，属分块渲染引擎的能力）。
- 外部修改 PDF 后自动刷新（与图片同，尚无此机制）。

## Further Notes

- 「为什么不用 Chromium 自带阅读器」见 ADR-0030。
- 大纲侧栏若以后要做，`PDFLinkService` 已能承接 outline 跳转，只需补 UI；位置可与缩略图共用左侧栏。
