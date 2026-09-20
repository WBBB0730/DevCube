/**
 * Files Tab 看图分档与瓦片金字塔（Tile Pyramid）描述。
 * 普通位图交给浏览器原生 `<img>` 流水线；超大位图由主进程用 sharp 切成 Deep Zoom 金字塔，
 * 渲染层用 OpenSeadragon 只取可见瓦片（见 ADR-0029）。
 */

/** 像素数超过此值，或任一边超过 Chromium 单张 GPU 纹理上限（16384），走瓦片金字塔。 */
export const FILES_IMAGE_TILE_MIN_PIXELS = 32_000_000
export const FILES_IMAGE_TILE_MAX_EDGE = 16384
/** Deep Zoom 瓦片边长（像素）。 */
export const FILES_IMAGE_TILE_SIZE = 512
/** 金字塔就绪前先显示的预览图长边（像素），够 2× 屏适配视口。 */
export const FILES_IMAGE_PREVIEW_EDGE = 4096

export type FilesImageTileFormat = 'jpeg' | 'png'

/** 超大位图首屏：预览图 URL + 自动转正后的原图像素尺寸。 */
export type FilesImagePreview = { url: string; width: number; height: number }

/** 金字塔就绪后的描述；瓦片 URL 由 `buildFilesTileUrl(key, \`{level}/{x}_{y}.{format}\`)` 组装。 */
export type FilesImagePyramid = {
  key: string
  width: number
  height: number
  tileSize: number
  overlap: number
  format: FilesImageTileFormat
}

export function needsImageTiles(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false
  return (
    width * height > FILES_IMAGE_TILE_MIN_PIXELS ||
    Math.max(width, height) > FILES_IMAGE_TILE_MAX_EDGE
  )
}

/** 瓦片 / 预览图的 MIME。 */
export function imageTileMime(format: FilesImageTileFormat): string {
  return format === 'png' ? 'image/png' : 'image/jpeg'
}

function attr(xml: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(xml)
  return m ? m[1]! : null
}

/**
 * 解析 sharp `tile({ layout: 'dz' })` 写出的 `.dzi`（Deep Zoom XML）。
 * 只认本应用自己生成的形状；缺字段或非法即 null。
 */
export function parseDzi(xml: string): {
  width: number
  height: number
  tileSize: number
  overlap: number
  format: FilesImageTileFormat
} | null {
  const imageTag = /<Image\b[^>]*>/.exec(xml)?.[0]
  const sizeTag = /<Size\b[^>]*\/?>/.exec(xml)?.[0]
  if (!imageTag || !sizeTag) return null
  const tileSize = Number(attr(imageTag, 'TileSize'))
  const overlap = Number(attr(imageTag, 'Overlap') ?? '0')
  const formatRaw = (attr(imageTag, 'Format') ?? '').toLowerCase()
  const width = Number(attr(sizeTag, 'Width'))
  const height = Number(attr(sizeTag, 'Height'))
  const format: FilesImageTileFormat | null =
    formatRaw === 'jpeg' || formatRaw === 'jpg' ? 'jpeg' : formatRaw === 'png' ? 'png' : null
  if (
    !format ||
    !Number.isInteger(tileSize) ||
    tileSize <= 0 ||
    !Number.isInteger(overlap) ||
    overlap < 0 ||
    !Number.isInteger(width) ||
    width <= 0 ||
    !Number.isInteger(height) ||
    height <= 0
  ) {
    return null
  }
  return { width, height, tileSize, overlap, format }
}

/** 相对金字塔目录的瓦片路径（Deep Zoom `image_files/{level}/{x}_{y}.{format}`）。 */
export function imageTileRelPath(
  level: number,
  x: number,
  y: number,
  format: FilesImageTileFormat
): string {
  return `image_files/${level}/${x}_${y}.${format}`
}
