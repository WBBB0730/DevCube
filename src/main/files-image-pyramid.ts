/**
 * 超大位图的瓦片金字塔（Tile Pyramid）与预览图：主进程用 sharp（libvips）生成，
 * 落在 userData/media-tiles/<key>/，key = sha1(路径 + mtime + 大小)；渲染层经 dc-media 协议读取（ADR-0029）。
 * 预览图是首屏（JPEG 缩小解码，亚秒）；金字塔在后台一次性生成（秒级），之后任何倍率只取可见瓦片。
 */
import { app } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp, { type Sharp } from 'sharp'
import { buildFilesTileUrl, isFilesTileKey } from '../shared/files'
import {
  FILES_IMAGE_PREVIEW_EDGE,
  FILES_IMAGE_TILE_SIZE,
  imageTileMime,
  parseDzi,
  type FilesImagePreview,
  type FilesImagePyramid,
  type FilesImageTileFormat
} from '../shared/files-image-tiles'

const CACHE_DIR_NAME = 'media-tiles'
/** 缓存总量上限；超出按最久未用的图整目录清理。 */
const CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024
/** 生成中途崩溃留下的临时目录，超过此时长即清理。 */
const TMP_STALE_MS = 24 * 60 * 60 * 1000
const JPEG_QUALITY = 85
const DZI_BASENAME = 'image'

export function imageTilesCacheRoot(): string {
  return path.join(app.getPath('userData'), CACHE_DIR_NAME)
}

/** 超过 sharp 默认 2.68 亿像素上限也要能开；按 EXIF 自动转正，与 Chromium `<img>` 一致。 */
function openImage(sys: string): Sharp {
  return sharp(sys, { limitInputPixels: false, autoOrient: true })
}

async function cacheKeyFor(sys: string): Promise<string> {
  const st = await fs.stat(sys)
  return createHash('sha1').update(`${sys}\0${st.mtimeMs}\0${st.size}`).digest('hex')
}

async function readMeta(
  sys: string
): Promise<{ width: number; height: number; format: FilesImageTileFormat }> {
  const m = await openImage(sys).metadata()
  const width = m.autoOrient?.width ?? m.width
  const height = m.autoOrient?.height ?? m.height
  if (!width || !height) throw new Error('无法读取图片尺寸')
  return { width, height, format: m.hasAlpha ? 'png' : 'jpeg' }
}

function encode(pipeline: Sharp, format: FilesImageTileFormat): Sharp {
  return format === 'png' ? pipeline.png() : pipeline.jpeg({ quality: JPEG_QUALITY })
}

async function exists(p: string): Promise<boolean> {
  return fs
    .stat(p)
    .then(() => true)
    .catch(() => false)
}

/** 目录 mtime 即「最近使用」，供清理排序。 */
async function touch(dir: string): Promise<void> {
  const now = new Date()
  await fs.utimes(dir, now, now).catch(() => {})
}

const inflight = new Map<string, Promise<unknown>>()

/** 同一张图并发请求只生成一次。 */
function dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key)
  if (pending) return pending as Promise<T>
  const p = run().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

export async function ensureImagePreview(sys: string): Promise<FilesImagePreview> {
  const key = await cacheKeyFor(sys)
  return dedupe(`preview:${key}`, async () => {
    const dir = path.join(imageTilesCacheRoot(), key)
    const { width, height, format } = await readMeta(sys)
    const name = `preview.${format}`
    const file = path.join(dir, name)
    if (!(await exists(file))) {
      await fs.mkdir(dir, { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      await encode(
        openImage(sys).resize({
          width: FILES_IMAGE_PREVIEW_EDGE,
          height: FILES_IMAGE_PREVIEW_EDGE,
          fit: 'inside',
          withoutEnlargement: true
        }),
        format
      ).toFile(tmp)
      await fs.rename(tmp, file)
    }
    await touch(dir)
    return { url: buildFilesTileUrl(key, name, imageTileMime(format)), width, height }
  })
}

async function readDzi(file: string): Promise<ReturnType<typeof parseDzi>> {
  try {
    return parseDzi(await fs.readFile(file, 'utf8'))
  } catch {
    return null
  }
}

export async function ensureImagePyramid(sys: string): Promise<FilesImagePyramid> {
  const key = await cacheKeyFor(sys)
  return dedupe(`pyramid:${key}`, async () => {
    const root = imageTilesCacheRoot()
    const dir = path.join(root, key)
    const dziFile = path.join(dir, `${DZI_BASENAME}.dzi`)
    let dzi = await readDzi(dziFile)
    if (!dzi) {
      const { format } = await readMeta(sys)
      // 先写临时目录，整体就绪后再挪进缓存目录，避免半成品被当缓存命中
      const tmpDir = path.join(root, `${key}.${process.pid}.tmp`)
      await fs.rm(tmpDir, { recursive: true, force: true })
      await fs.mkdir(tmpDir, { recursive: true })
      await encode(openImage(sys), format)
        .tile({ size: FILES_IMAGE_TILE_SIZE, overlap: 0, layout: 'dz' })
        .toFile(path.join(tmpDir, `${DZI_BASENAME}.dz`))
      await fs.mkdir(dir, { recursive: true })
      const filesDir = path.join(dir, `${DZI_BASENAME}_files`)
      await fs.rm(filesDir, { recursive: true, force: true })
      await fs.rename(path.join(tmpDir, `${DZI_BASENAME}_files`), filesDir)
      await fs.rename(path.join(tmpDir, `${DZI_BASENAME}.dzi`), dziFile)
      await fs.rm(tmpDir, { recursive: true, force: true })
      dzi = await readDzi(dziFile)
      if (!dzi) throw new Error('金字塔生成失败')
      void pruneImageTilesCache()
    }
    await touch(dir)
    return { key, ...dzi }
  })
}

async function dirBytes(dir: string): Promise<number> {
  let total = 0
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) total += await dirBytes(p)
    else if (entry.isFile()) total += (await fs.stat(p)).size
  }
  return total
}

/** 超出总量上限时按最久未用清理；顺带清掉过期临时目录。失败不影响使用。 */
export async function pruneImageTilesCache(): Promise<void> {
  try {
    const root = imageTilesCacheRoot()
    const now = Date.now()
    const kept: { dir: string; usedAt: number; bytes: number }[] = []
    for (const name of await fs.readdir(root)) {
      const dir = path.join(root, name)
      const st = await fs.stat(dir).catch(() => null)
      if (!st || !st.isDirectory()) continue
      if (name.endsWith('.tmp')) {
        if (now - st.mtimeMs > TMP_STALE_MS) await fs.rm(dir, { recursive: true, force: true })
        continue
      }
      if (!isFilesTileKey(name)) continue
      kept.push({ dir, usedAt: st.mtimeMs, bytes: await dirBytes(dir) })
    }
    let total = kept.reduce((sum, e) => sum + e.bytes, 0)
    kept.sort((a, b) => a.usedAt - b.usedAt)
    for (const e of kept) {
      if (total <= CACHE_MAX_BYTES) break
      await fs.rm(e.dir, { recursive: true, force: true })
      total -= e.bytes
    }
  } catch {
    /* 清理失败不影响使用 */
  }
}
