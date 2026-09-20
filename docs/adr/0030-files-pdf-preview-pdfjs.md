# Files Tab PDF 预览用 PDF.js viewer 组件，不用 Chromium 自带阅读器

Files Tab 要内嵌看 PDF。Electron 自带 Chromium 的 PDFium 阅读器，`<iframe>` 一嵌零依赖、零代码，但要给整个窗口开 `plugins: true`，工具栏是 Chrome 的、不能换肤，快捷键与查找都在 iframe 里、我们管不到，和 DESIGN.md 的一致性、看图刚调好的缩放手感都对不上；隐藏工具栏后翻页与查找 UI 又一起没了。我们改用 PDF.js（pdfjs-dist，Firefox 内置引擎，Apache-2.0）的官方 viewer 组件层：连续滚动、只渲染可见页、缩放重绘、文字层、查找、内链都是库的，DevCube 只写壳——工具栏、与编辑器同款的查找栏、复用看图常量的缩放手势、主题。「轻量」在本项目指少写业务胶水（见 files-tab PRD），不指包体积；这层壳约三百行，重活全在库里。

## Considered Options

- **Chromium 自带阅读器（iframe）**：零胶水，但外观和交互是一块飞地，且全窗口开 plugins。
- **react-pdf 等封装**：只包单页渲染，滚动、缩放、查找仍要自己写；官方 `PDFViewer` 已带。
- **主进程 PDFium 渲染成图片再走看图组件**：丢文字选择与查找，且每次缩放都要重渲。

## Consequences

- 新增 pdfjs-dist：核心加 worker 约 1.7 MB 进包；字体映射表 / 标准字体 / wasm 约 4 MB 放 resources/pdfjs，打开需要的 PDF 才加载。
- 渲染层生产态是 `file://`，fetch / XHR 都碰不到本地文件，所以这些资源经 `dc-media` 协议 `a=pdfjs` 读取，并给 PDF.js 自备 fetch 取数工厂（它只对 http(s) 用 fetch）；CSP `connect-src` 放行 `dc-media:`。
- 用 pdfjs-dist 的 `legacy` 构建：默认构建假定的浏览器比 Electron 内置 Chromium 新（6.3 已用 `Map#getOrInsertComputed`），legacy 自带垫片；Electron 升到足够新后可切回默认构建。
- PDF.js 的图片模型是「每页首次渲染解一次、缩放不重解」，只能用 `canvasMaxAreaInBytes` 定一个静态上限（我们取 8 MP），做不到放大再看原图；Firefox 桌面版不设上限、接受内存尖峰。按可见区域按需重解的分块模型是 PDFium 系（Chromium 阅读器、EmbedPDF 的 TilingLayer）的能力，是切换时的主要收益之一。
- PDF.js 大版本升级偶有 API 变动；壳里只碰 `PDFViewer` / `EventBus` / `PDFFindController` / `PDFLinkService` 四个公开对象。
