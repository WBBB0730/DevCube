/**
 * Rebuild DevCube app icons: WebStorm base + DEV block (+ diagonal BETA ribbon for beta).
 *
 * Geometry matches the original Claude/Pillow recipe (1024 canvas, 2× supersample).
 *
 * Usage:
 *   pnpm gen-icon
 */
import {
  createCanvas,
  GlobalFonts,
  loadImage,
  type Canvas,
  type SKRSContext2D
} from '@napi-rs/canvas'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FONT = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
const WEBSTORM_ICNS = '/Applications/WebStorm.app/Contents/Resources/webstorm.icns'

const STABLE_TARGETS = [join(ROOT, 'build/icon.png'), join(ROOT, 'resources/icon.png')]
const BETA_TARGETS = [join(ROOT, 'build/beta/icon.png')]

const BLACK = [248, 248, 775, 775] as const
const CAP_TOP = 331
const CAP_BOT = 491
const TXT_CX = 512
const DASH = [320, 670, 529, 703] as const
const SS = 2
const SIZE = 1024

function ensureWebStormPng(dest: string): string {
  mkdirSync(dirname(dest), { recursive: true })
  execFileSync('sips', ['-s', 'format', 'png', WEBSTORM_ICNS, '--out', dest], {
    stdio: 'pipe'
  })
  return dest
}

function makeDevOverlay(): Canvas {
  const W = SIZE * SS
  const canvas = createCanvas(W, W)
  const ctx = canvas.getContext('2d')
  const label = 'DEV'

  ctx.fillStyle = '#000000'
  ctx.fillRect(BLACK[0] * SS, BLACK[1] * SS, (BLACK[2] - BLACK[0]) * SS, (BLACK[3] - BLACK[1]) * SS)

  const target = (CAP_BOT - CAP_TOP) * SS
  let size = target
  for (let i = 0; i < 6; i++) {
    ctx.font = `bold ${Math.max(1, Math.floor(size))}px ArialBold`
    const m = ctx.measureText(label)
    const h = (m.actualBoundingBoxAscent ?? 0) + (m.actualBoundingBoxDescent ?? 0) || size * 0.7
    if (h) size *= target / h
  }
  size = Math.round(size)
  ctx.font = `bold ${size}px ArialBold`
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const m = ctx.measureText(label)
  const ascent = m.actualBoundingBoxAscent ?? size * 0.8
  ctx.fillText(label, TXT_CX * SS, CAP_TOP * SS + ascent)

  const [x0, y0, x1, y1] = DASH.map((v) => v * SS)
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0)

  const out = createCanvas(SIZE, SIZE)
  const octx = out.getContext('2d')
  octx.imageSmoothingEnabled = true
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(canvas, 0, 0, SIZE, SIZE)
  return out
}

/** 不透明内容包围盒（WebStorm 底图有安全边距，不能按画布 0,0 对齐）。 */
function opaqueBounds(
  ctx: SKRSContext2D,
  w: number,
  h: number
): { minX: number; minY: number; size: number } {
  const { data } = ctx.getImageData(0, 0, w, h)
  let minX = w
  let minY = h
  let maxX = 0
  let maxY = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3]! > 10) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  return { minX, minY, size: Math.min(maxX - minX + 1, maxY - minY + 1) }
}

/** 先画水平丝带再整体旋到左上角，保证字与带宽严格对齐。bounds 取自正式图标。 */
function drawBetaRibbon(
  ctx: SKRSContext2D,
  bounds: { minX: number; minY: number; size: number }
): void {
  const { minX, minY, size } = bounds
  const band = Math.round(size * 0.17)
  const span = Math.round(size * 0.85)
  const inset = Math.round(size * 0.2)

  const ribbon = createCanvas(span, band)
  const rctx = ribbon.getContext('2d')
  rctx.fillStyle = '#c45c26'
  rctx.fillRect(0, 0, span, band)
  rctx.fillStyle = '#ffffff'
  rctx.font = `bold ${Math.round(band * 0.7)}px ArialBold`
  rctx.textAlign = 'center'
  rctx.textBaseline = 'middle'
  rctx.fillText('BETA', span / 2, band / 2)

  ctx.save()
  ctx.translate(minX + inset, minY + inset)
  ctx.rotate(-Math.PI / 4)
  ctx.drawImage(ribbon, -span / 2, -band / 2)
  ctx.restore()
}

function writePng(targets: string[], png: Buffer, label: string): void {
  for (const t of targets) {
    mkdirSync(dirname(t), { recursive: true })
    writeFileSync(t, png)
    console.log(`wrote ${t} (${png.length} bytes) ${label}`)
  }
}

async function main(): Promise<void> {
  if (!GlobalFonts.registerFromPath(FONT, 'ArialBold')) {
    throw new Error(`Failed to register font: ${FONT}`)
  }

  const bgPath = ensureWebStormPng(join(ROOT, 'scripts/out/webstorm-base.png'))
  const bg = await loadImage(bgPath)
  const overlay = makeDevOverlay()

  const stable = createCanvas(SIZE, SIZE)
  const sctx = stable.getContext('2d')
  sctx.drawImage(bg, 0, 0, SIZE, SIZE)
  sctx.drawImage(overlay, 0, 0)
  writePng(STABLE_TARGETS, stable.toBuffer('image/png'), 'stable')

  const bounds = opaqueBounds(sctx, SIZE, SIZE)
  const beta = createCanvas(SIZE, SIZE)
  const bctx = beta.getContext('2d')
  bctx.drawImage(stable, 0, 0)

  const ribbonLayer = createCanvas(SIZE, SIZE)
  const rl = ribbonLayer.getContext('2d')
  drawBetaRibbon(rl, bounds)
  // 只裁丝带，避免伸出圆角进安全边距
  rl.globalCompositeOperation = 'destination-in'
  rl.drawImage(stable, 0, 0)
  bctx.drawImage(ribbonLayer, 0, 0)

  writePng(BETA_TARGETS, beta.toBuffer('image/png'), 'beta')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
