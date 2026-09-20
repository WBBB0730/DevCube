# Files Tab 看图：普通位图走浏览器原生 `<img>`，超大位图走 sharp 金字塔 + OpenSeadragon

Files Tab 看图曾用 canvas 自绘：整图 `createImageBitmap` 后每帧从一张大纹理抠可见块、缩放停手再整图重解，几千万像素就明显卡顿，放大后要么糊要么挤爆 GPU 缓存。我们改成两档：像素数 ≤ 3200 万且单边 ≤ 16384 的位图（含 SVG、GIF）交给 Chromium 自己的 `<img>` 流水线——手势期间只改 CSS transform（纯合成器），缩放停手 100ms 后把倍率烙进 width/height 让浏览器按新尺寸重新栅格化（PhotoSwipe / macOS 预览同法），解码、切瓦片、GPU 缓存全是浏览器内置；超过阈值的位图由主进程用 sharp（libvips）一次性生成 Deep Zoom 瓦片金字塔到 `userData/media-tiles/<sha1(路径+mtime+大小)>/`（1.1 亿像素约 0.8 秒、5.8 亿像素约 3 秒，总量超 2GB 按最久未用整目录清理），渲染层用 OpenSeadragon 只取可见瓦片；金字塔就绪前先显示 sharp 缩小解码的预览图（亚秒）。两档共用同一套相机与手势数学（OpenSeadragon 关掉自带鼠标导航，由相机驱动视口），手感一致、可继续自定义。

## Considered Options

- **FlowVision 式每次停手整图重解到显示尺寸**：无预处理，但每次停手都等一次整图解码（1.1 亿像素约 0.35 秒、5 亿像素约 1.5 秒），且 100% 时把整幅位图交给 GPU；Chromium 里单边超 16384 的图根本上不了单张纹理。
- **全部图都走 OpenSeadragon**：只有一套渲染，但普通图多一次 sharp 往返与瓦片写盘，GIF 不动、小 SVG 放大发糊；`<img>` 在这一档更好。
- **自研分块渲染**：与成熟的 OpenSeadragon 重复造轮子，上一版失败正是这条路。

## Consequences

- 新增原生依赖 sharp（预编译 N-API，addon 与 libvips 动态库须 asarUnpack；输入要显式关掉 2.68 亿像素上限）与 OpenSeadragon（自带类型声明）。
- `dc-media` 协议额外放行瓦片缓存目录（`t=键&f=相对路径`），并带 `Access-Control-Allow-Origin`——OpenSeadragon 的 WebGL 绘制器要把 `<img crossorigin>` 传进 WebGL。
- 超大图首次打开约 0.3–0.5 秒出预览，金字塔秒级后台就绪；之后命中缓存即开。缓存目录随 userData 按 Stable / Beta / Dev 分线。
