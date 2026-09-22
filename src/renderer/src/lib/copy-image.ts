/**
 * 把正文里的图（位图 / SVG 数据 URL / 超大图的预览图）栅格化成 PNG 写进系统剪贴板。
 * 在渲染层用 canvas 走一遍：Chromium 能显示的格式（webp / gif / bmp / svg…）都能复制，
 * 主进程的 nativeImage 只认 PNG / JPEG。`dc-media://` 带 CORS 头，按 anonymous 加载即不污染 canvas。
 */
export async function copyImageToClipboard(src: string): Promise<void> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('图片加载失败'))
  })
  img.src = src
  await loaded
  // 无固有尺寸的 SVG 回落到 1024，别复制出一张空图
  const width = img.naturalWidth || 1024
  const height = img.naturalHeight || Math.round((width * 3) / 4)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.drawImage(img, 0, 0, width, height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('图片编码失败')
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}
