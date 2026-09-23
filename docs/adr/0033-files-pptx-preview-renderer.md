# Files Tab PPT 预览用 pptx-renderer 单页渲染自排页面列表，库的缺陷以 pnpm 补丁修在库上

Files Tab 要内嵌看 PPT。我们用两份真实样本（设计类简历、28 页 30 MB 的图文教程）加一份可编辑版对照原图，逐页对比了两个纯前端渲染库：@aiden0z/pptx-renderer（TypeScript，HTML / SVG 输出，每个版本拿 PowerPoint 真机导出图做视觉回归）与 @extend-ai/react-pptx（Rust 编译成 WebAssembly）。两者都完整画出了形状、渐变、表格、裁切图片与文字；react-pptx 的缺字体回退与分散对齐更好，但行距与 WPS 不一致（WPS 里文字压到图片上，它排得更紧），且只有 0.2 版、出问题只能等作者、还要给渲染层放行 WebAssembly。选 pptx-renderer。只用它的单页渲染（`renderSlide`），页面列表、四档缩放、翻页、查找、缩略图由 DevCube 自己排：它自带的查看器每改一次倍率就清空重画、自管滚动，与看图 / PDF 那套按光标缩放和四档对不上；而它本就先按原尺寸排好一页再整体 CSS 缩放，所以自排列表时缩放只改倍率、不重画。

它的缺陷不在我们这边绕，用 pnpm 自带的补丁（`patchedDependencies`，钉在 1.3.0）直接修在库上：缺字体时按原字体风格补同风格的备选（原先只给几个已知中文黑体补，其余落到浏览器默认衬线字）；分散对齐让最后一行也铺满；给画出的元素、项目符号与表格格子贴标记，让查找结果能精确落到页面上的字。补丁暂不提交给上游。

## Considered Options

- **@extend-ai/react-pptx**：字体观感最好、能读老 .ppt，但行距不对、太新、不可修，见上。
- **pptx-renderer 自带查看器（`PptxViewer`）**：零胶水，但缩放即重建全部页面、滚动归它管，四档与按光标缩放做不出来。
- **字体问题在我们这边用库的 `fontFaces` 配映射表**：要逐个列字体名、换个没见过的字体又漏；根子在库的回退规则，修在库上一次覆盖所有字体。
- **借 LibreOffice 等外部软件转 PDF、商业 SDK**：依赖外部软件或付费授权，不做。

## Consequences

- 补丁只改库的 ES 构建（渲染层只加载它）；升级库版本时补丁对不上，pnpm 安装直接失败，须按新版本重做补丁（或等上游修复后删掉）。
- 查找高亮依赖补丁贴的标记（`data-pptx-node` = 层:编号，层取母版 / 版式 / 本页，编号在层内唯一；`data-pptx-cell`；`data-pptx-bullet`）；页面文字与库的文字对不上（如公式）时宁可不标。
- 渲染层 CSP 的 `media-src` 放行 `blob:`：幻灯片里的音视频由库解出后以对象 URL 播放（同缩略图放行 `img-src blob:` 的理由，blob 地址只能由本页脚本创建）。
- 关掉库借 PDF.js 画「EMF 里内嵌 PDF」矢量插图的能力（`pdfjs: false`）：它要在 blob 模块线程里加载 PDF.js，生产态渲染层是 `file://`，这条路要另开多项限制，这类插图暂不显示。
