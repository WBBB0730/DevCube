# Files 编辑器 Markdown / SVG 预览

## Problem Statement

在 Files Tab 里打开 README、文档等 Markdown 文件时只能看到源码，想确认渲染效果（表格、图片、层级）得切去别的工具，写文档的「所见」链路断了。打开 SVG 时同样只能看 XML 源码，无法立刻核对图形。

## Solution

Markdown 与 SVG 文件的工具栏出现「编辑 ↔ 预览」两态切换：编辑态还是原来的 CodeMirror。Markdown 预览态把正文换成排版后的富文本（GFM 语法、代码块、表格、相对路径图片）；SVG 预览态把源码画成图形，并在内容区右上角显示像素宽高（与位图预览同一套角标）。默认进编辑态，切换状态会话内保持。

## User Stories

1. As a 开发者, I want 打开 .md 文件时工具栏出现预览切换钮, so that 我能一键在源码与渲染结果间切换
2. As a 开发者, I want 预览渲染 GFM（表格 / 任务列表 / 删除线 / 自动链接）, so that GitHub 风格的文档所见即所得
3. As a 开发者, I want 预览里的相对路径图片正常显示, so that README 里的截图不是裂图
4. As a 开发者, I want 点击预览里的外部链接用系统浏览器打开, so that 应用内不会被导航走
5. As a 开发者, I want 切到预览前自动保存, so that 预览内容与磁盘一致
6. As a 开发者, I want 预览的配色排版与应用暗色主题一致, so that 不会出现刺眼的白底
7. As a 开发者, I want 非 Markdown / SVG 文件的工具栏没有该按钮, so that 界面不被无关控件污染
8. As a 开发者, I want 切换文件后预览态保持, so that 连续浏览多个文档不用反复点切换
9. As a 开发者, I want 文档里的原始 HTML 不被执行, so that 打开陌生仓库的 md 不会带来脚本注入
10. As a 开发者, I want 打开 .svg 文件时工具栏出现同样的预览切换钮, so that 我能在 XML 源码与图形之间切换
11. As a 开发者, I want SVG 预览不执行文件里的脚本, so that 打开陌生仓库的图标不会带来脚本注入
12. As a 开发者, I want SVG 预览内容区右上角显示像素宽高, so that 我能确认图标实际尺寸
13. As a 开发者, I want SVG 预览与位图共用缩放 / 滚轮或拖拽平移 / 方向键切图, so that 看图标和看 PNG 是同一套操作

## Implementation Decisions

- Markdown 渲染用 `react-markdown` + `remark-gfm`：库默认不渲染原始 HTML，天然防注入，不额外接 rehype-raw。
- 排版用 `@tailwindcss/typography` 的 prose 类，色板通过官方 `--tw-prose-*` 变量对齐工作区 token（Dark 主题），代码块用 `--font-mono`。
- SVG 预览用 `<img>` + `data:image/svg+xml`（CSP 已放行 `data:`），不当 inline XML，脚本不执行。打开分流仍为 text。
- 两态（编辑 / 预览）而非 WebStorm 三态分屏；状态挂在 FilesPane（同 `treeVisible` 生命周期：会话内保持、不落盘），默认编辑。Markdown 与 SVG 共用同一开关。
- 切换钮在 Files 工具栏右侧钮区最左，与「最近打开 / 在文件树中显示 / …」以既有 1×12px `--border-input` 竖线隔成单独一组（同「显示文件树」）。
- 相对路径图片：按当前文件目录解析、限制在项目根内，经既有 dc-media 协议流式读取（`buildFilesMediaUrl` 移入 shared 供渲染端复用；CSP `img-src` 放行 `dc-media:`）。越界或非图片扩展名不渲染。
- 链接一律拦截默认跳转：http/https/mailto 交 `shell.openExternal`（复用既有 IPC），锚点与相对链接不动作。
- 切到预览前 flush 保存（与「离开 Files Tab 即保存」同语义）。
- 位图预览与 SVG 预览共用看图组件：内容区右上角尺寸标注（`naturalWidth × naturalHeight`，12px `--fg-info`，无底、非等宽）；Cmd/Ctrl+滚轮按光标缩放（相对「适配视口且不放大」，约 10%–3200%；鼠标一格约 10%；触控板捏合跟手指距离——有 GestureEvent 用累计 scale，否则 Chromium 合成 ctrl+wheel 按 AppKit 手感补偿）；普通滚轮或按住拖拽平移；方向键切同一目录上一张/下一张（左/上上一张，右/下下一张，到头不回绕）。从位图切到 SVG 时自动进预览态。

## Testing Decisions

- 预览是纯渲染（react-markdown / `<img>`），无自研纯逻辑，不配组件单测；路径解析复用已有 `resolveWithinProject`（shared 已有测试覆盖）。
- 扩展名判定（`isMarkdownPath` / `isSvgPath` / `isPreviewableSourcePath` / `isImagePreviewPath` / `adjacentImagePath`）表驱动单测。
- 缩放几何（适配倍率、滚轮倍率、光标锚点滚动）表驱动单测。
- 外部行为（切换、图片、链接、尺寸标注）人工回归。

## Out of Scope

- 编辑 / 预览分屏与滚动同步（WebStorm 三态）。
- 代码块语法高亮。
- 相对链接跳转到项目内其他文件。
- Mermaid / KaTeX 等扩展渲染。
- HTML / CSV / PDF 等其它格式的预览。
- Markdown 正文里引用的 SVG 相对路径图（仍只放行位图扩展名）。

## Further Notes

若未来要三态分屏，两态的预览组件可直接复用，只动 FilesTextEditor 的布局层。
