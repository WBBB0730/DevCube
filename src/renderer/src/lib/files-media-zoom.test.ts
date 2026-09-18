import { describe, expect, it } from 'vitest'
import {
  clampMediaZoom,
  fitBaseScale,
  imagePointFromCursor,
  isPinchZoomWheel,
  mediaDisplaySize,
  MEDIA_ZOOM_MAX,
  MEDIA_ZOOM_MIN,
  scrollToImagePoint,
  zoomFromWheel
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

  it('触控板捏合（ctrl+小步进）按手指比例缩放，强于 Chrome 页缩放', () => {
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

describe('imagePointFromCursor / scrollToImagePoint', () => {
  it('居中小图：视口中心对准图中心', () => {
    const pt = imagePointFromCursor({
      cursorX: 100,
      cursorY: 100,
      scrollLeft: 0,
      scrollTop: 0,
      viewportW: 200,
      viewportH: 200,
      displayW: 100,
      displayH: 100
    })
    expect(pt).toEqual({ x: 50, y: 50 })
    expect(
      scrollToImagePoint({
        imageX: 50,
        imageY: 50,
        cursorX: 100,
        cursorY: 100,
        viewportW: 200,
        viewportH: 200,
        displayW: 100,
        displayH: 100
      })
    ).toEqual({ left: 0, top: 0 })
  })

  it('放大到铺满视口后仍对准同一像素', () => {
    const pt = imagePointFromCursor({
      cursorX: 100,
      cursorY: 100,
      scrollLeft: 0,
      scrollTop: 0,
      viewportW: 200,
      viewportH: 200,
      displayW: 100,
      displayH: 100
    })
    const next = { x: pt.x * 2, y: pt.y * 2 }
    expect(
      scrollToImagePoint({
        imageX: next.x,
        imageY: next.y,
        cursorX: 100,
        cursorY: 100,
        viewportW: 200,
        viewportH: 200,
        displayW: 200,
        displayH: 200
      })
    ).toEqual({ left: 0, top: 0 })
  })
})
