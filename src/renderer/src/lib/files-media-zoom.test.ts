import { describe, expect, it } from 'vitest'
import {
  centerMediaCamera,
  clampMediaCamera,
  clampMediaZoom,
  fitBaseScale,
  isPinchZoomWheel,
  mediaCameraToViewport,
  mediaDisplaySize,
  MEDIA_ZOOM_MAX,
  MEDIA_ZOOM_MIN,
  panMediaCamera,
  zoomFromWheel,
  zoomMediaCameraAt
} from './files-media-zoom'

describe('clampMediaZoom / zoomFromWheel', () => {
  it('滚轮向下缩小、向上放大，一格约 10%', () => {
    const out = zoomFromWheel(1, 100)
    const inn = zoomFromWheel(1, -100)
    expect(out).toBeLessThan(1)
    expect(inn).toBeGreaterThan(1)
    expect(out).toBeGreaterThan(0.85)
    expect(out).toBeLessThan(0.95)
    expect(inn).toBeGreaterThan(1.05)
    expect(inn).toBeLessThan(1.15)
  })

  it('触控板捏合（Chromium 合成的 ctrl+小步进）按手指比例缩放，强于 Chrome 页缩放', () => {
    const pinch = { ctrlKey: true, deltaMode: 0 }
    expect(isPinchZoomWheel({ deltaY: 8, ...pinch })).toBe(true)
    expect(isPinchZoomWheel({ deltaY: 69, ...pinch })).toBe(true)
    expect(isPinchZoomWheel({ deltaY: 100, ...pinch })).toBe(false)
    expect(isPinchZoomWheel({ deltaY: 8, ctrlKey: true, metaKey: true, deltaMode: 0 })).toBe(false)
    const fromPinch = zoomFromWheel(1, 8, pinch)
    const chromePageZoom = Math.exp(-8 * 0.01)
    expect(fromPinch).toBeLessThan(zoomFromWheel(1, 8))
    expect(fromPinch).toBeLessThan(chromePageZoom)
    expect(fromPinch).toBeGreaterThan(0.78)
    expect(fromPinch).toBeLessThan(0.86)
  })

  it('卡在上下限', () => {
    expect(clampMediaZoom(0)).toBe(MEDIA_ZOOM_MIN)
    expect(clampMediaZoom(99)).toBe(MEDIA_ZOOM_MAX)
    expect(zoomFromWheel(MEDIA_ZOOM_MIN, 800)).toBe(MEDIA_ZOOM_MIN)
    expect(zoomFromWheel(MEDIA_ZOOM_MAX, -800)).toBe(MEDIA_ZOOM_MAX)
  })
})

describe('fitBaseScale / mediaDisplaySize', () => {
  it('小图不放大', () => {
    expect(fitBaseScale(100, 80, 400, 400)).toBe(1)
    expect(mediaDisplaySize(100, 80, 400, 400, 1)).toEqual({ w: 100, h: 80 })
  })

  it('大图缩小以完整放入', () => {
    expect(fitBaseScale(400, 200, 200, 200)).toBe(0.5)
    expect(mediaDisplaySize(400, 200, 200, 200, 2)).toEqual({ w: 400, h: 200 })
  })
})

describe('MediaCamera', () => {
  it('小图居中，放大后视口中心仍对准图中心', () => {
    const cam = centerMediaCamera(1, 100, 100, 200, 200)
    expect(cam).toEqual({ zoom: 1, x: 50, y: 50 })
    expect(zoomMediaCameraAt(cam, 2, 100, 100, 100, 100, 200, 200)).toEqual({
      zoom: 2,
      x: 0,
      y: 0
    })
  })

  it('图小于视口时平移被夹回居中', () => {
    const cam = centerMediaCamera(1, 100, 100, 200, 200)
    expect(panMediaCamera(cam, 40, -10, 100, 100, 200, 200)).toEqual(cam)
  })

  it('放大后可平移，但不会把图完全拖出视口', () => {
    const cam = centerMediaCamera(4, 100, 100, 200, 200)
    expect(cam).toEqual({ zoom: 4, x: -100, y: -100 })
    expect(panMediaCamera(cam, 80, 0, 100, 100, 200, 200).x).toBe(-180)
    expect(clampMediaCamera({ zoom: 4, x: 50, y: -100 }, 100, 100, 200, 200).x).toBe(0)
  })
})

describe('mediaCameraToViewport', () => {
  it('适配视口的横图：zoom 为显示宽 / 视口宽，中心是图中心', () => {
    // 400×200 图放进 200×200 视口 → 缩到 200×100、垂直居中
    const cam = centerMediaCamera(1, 400, 200, 200, 200)
    expect(mediaCameraToViewport(cam, 400, 200, 200, 200)).toEqual({
      zoom: 1,
      centerX: 0.5,
      centerY: 0.25
    })
  })

  it('放大到 2× 并把左上角对到视口左上：中心落在图的四分之一处', () => {
    const cam = { zoom: 2, x: 0, y: 0 }
    expect(mediaCameraToViewport(cam, 400, 200, 200, 200)).toEqual({
      zoom: 2,
      centerX: 0.25,
      centerY: 0.25
    })
  })

  it('竖图 y 也按图宽归一化', () => {
    // 100×400 图放进 200×200 视口 → 缩到 50×200、水平居中：视口中心 = 图中心 (0.5, 2)
    const cam = centerMediaCamera(1, 100, 400, 200, 200)
    expect(mediaCameraToViewport(cam, 100, 400, 200, 200)).toEqual({
      zoom: 0.25,
      centerX: 0.5,
      centerY: 2
    })
  })

  it('非法尺寸给出可用的兜底', () => {
    expect(mediaCameraToViewport({ zoom: 1, x: 0, y: 0 }, 0, 0, 200, 200)).toEqual({
      zoom: 1,
      centerX: 0.5,
      centerY: 0.5
    })
  })
})
