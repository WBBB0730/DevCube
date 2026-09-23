import { describe, expect, it } from 'vitest'
import {
  PPTX_PAGE_GAP,
  PPTX_SCALE_MAX,
  PPTX_SCALE_MIN,
  pptxContentSize,
  pptxCurrentPage,
  pptxFitScale,
  pptxMatchSpan,
  pptxNodeKey,
  pptxPageLeft,
  pptxRowHeight,
  pptxScrollAfterZoom,
  pptxStepScale,
  pptxVisibleRange,
  pptxWheelScale
} from './files-pptx'

const slide = { width: 1280, height: 720 }

describe('pptxFitScale', () => {
  it('四档：原尺寸、两条轴铺满、整页放得下', () => {
    const view = { width: 640, height: 720 }
    expect(pptxFitScale('actual', slide, view)).toBe(1)
    expect(pptxFitScale('width', slide, view)).toBe(0.5)
    expect(pptxFitScale('height', slide, view)).toBe(1)
    expect(pptxFitScale('window', slide, view)).toBe(0.5)
    expect(pptxFitScale('window', slide, { width: 1280, height: 360 })).toBe(0.5)
  })

  it('夹在倍率上下限之内', () => {
    expect(pptxFitScale('width', slide, { width: 1, height: 1 })).toBe(PPTX_SCALE_MIN)
    expect(pptxFitScale('width', slide, { width: 128_000, height: 72_000 })).toBe(25)
    expect(PPTX_SCALE_MAX).toBe(25)
  })
})

describe('逐档与滚轮缩放（同 PDF.js updateScale）', () => {
  it('逐档：乘 1.1 后按 0.1 取整，放大向上、缩小向下，落在整齐倍率上', () => {
    expect(pptxStepScale(0.563, 1)).toBe(0.7)
    expect(pptxStepScale(0.7, 1)).toBe(0.8)
    expect(pptxStepScale(1, 1)).toBe(1.1)
    expect(pptxStepScale(1.1, 1)).toBe(1.3)
    expect(pptxStepScale(0.563, -1)).toBe(0.5)
    expect(pptxStepScale(1, -1)).toBe(0.9)
    expect(pptxStepScale(1, 2)).toBe(1.3)
  })

  it('逐档夹在上下限之内', () => {
    expect(pptxStepScale(0.1, -1)).toBe(PPTX_SCALE_MIN)
    expect(pptxStepScale(25, 1)).toBe(PPTX_SCALE_MAX)
  })

  it('滚轮：新倍率按 0.01 取整并夹在上下限之内', () => {
    expect(pptxWheelScale(1, 1.1)).toBe(1.1)
    expect(pptxWheelScale(0.5634, 1.05)).toBe(0.59)
    expect(pptxWheelScale(24, 1.1)).toBe(PPTX_SCALE_MAX)
  })
})

describe('页面列表几何', () => {
  it('行高 = 页高 + 页间留白；总高减去末页下方留白', () => {
    expect(pptxRowHeight(slide, 0.5)).toBe(360 + PPTX_PAGE_GAP)
    expect(pptxContentSize(slide, 0.5, 3, { width: 1000, height: 500 })).toEqual({
      width: 1000,
      height: 3 * (360 + PPTX_PAGE_GAP) - PPTX_PAGE_GAP
    })
  })

  it('页窄于视口时居中，宽于视口时贴左并撑宽内容区', () => {
    expect(pptxPageLeft(slide, 0.5, { width: 1000, height: 500 })).toBe(180)
    expect(pptxPageLeft(slide, 1, { width: 1000, height: 500 })).toBe(0)
    expect(pptxContentSize(slide, 1, 1, { width: 1000, height: 500 }).width).toBe(1280)
  })

  it('只挂视口内的页，上下各多挂 overscan 页，不越过首尾', () => {
    const row = pptxRowHeight(slide, 0.5) // 370
    expect(pptxVisibleRange(0, 500, row, 10, 1)).toEqual({ first: 0, last: 2 })
    expect(pptxVisibleRange(row * 5 + 1, 500, row, 10, 1)).toEqual({ first: 4, last: 7 })
    expect(pptxVisibleRange(row * 9, 500, row, 10, 1)).toEqual({ first: 8, last: 9 })
    expect(pptxVisibleRange(0, 500, row, 0, 1)).toBeNull()
  })
})

describe('pptxScrollAfterZoom', () => {
  const view = { width: 1000, height: 600 }

  it('锚点下的页内那一点缩放后仍在锚点处', () => {
    // 倍率 0.5：第 2 页（下标 1）页顶在 370，锚点落在它页内 100px 处、页左缘 180 右侧 50px
    const scroll = { left: 0, top: 370 }
    const anchor = { x: 230, y: 100 }
    const to = pptxScrollAfterZoom({ scroll, anchor, view, slide, from: 0.5, to: 1 })
    // 倍率 1：该页页顶 730，页内比例 100/360 → 200px；页宽 1280 贴左，页内比例 50/640 → 100px
    expect(to.top).toBeCloseTo(730 + 200 - 100)
    expect(to.left).toBeCloseTo(100 - 230)
  })

  it('锚点落在页间留白里：留白不随倍率缩放', () => {
    const scroll = { left: 0, top: 0 }
    const anchor = { x: 500, y: 365 } // 倍率 0.5 下第 1 页页底 360 之下 5px
    const to = pptxScrollAfterZoom({ scroll, anchor, view, slide, from: 0.5, to: 1 })
    expect(to.top).toBeCloseTo(720 + 5 - 365)
  })
})

describe('pptxCurrentPage', () => {
  const at = (scrollTop: number, current: number, viewHeight = 400): number =>
    pptxCurrentPage({
      scrollTop,
      viewHeight,
      slideHeight: 180,
      rowHeight: 180 + PPTX_PAGE_GAP,
      pages: 5,
      current
    })

  it('原来的页仍整页可见就不变（末尾几页一屏装下时 ↓ 仍能逐页前进）', () => {
    // 滚到底（内容高 5×190−10=940，视口 400）：第 4、5 页都整页可见
    const bottom = 5 * 190 - PPTX_PAGE_GAP - 400
    expect(at(bottom, 5)).toBe(5)
    expect(at(bottom, 4)).toBe(4)
    expect(at(bottom, 2)).toBe(4)
  })

  it('原来的页露不全就取露出比例最大的，并列取靠前的', () => {
    expect(at(0, 3)).toBe(1)
    expect(at(190 + 90, 1, 180)).toBe(2)
    expect(at(190 * 2 + 5, 1, 180)).toBe(3)
  })
})

describe('pptxNodeKey', () => {
  it('按 nodePath 分出母版 / 版式 / 本页，编号只在层内唯一', () => {
    expect(pptxNodeKey({ nodePath: 'slides/2/nodes/5', nodeId: '5' })).toBe('slide:5')
    expect(pptxNodeKey({ nodePath: 'slides/2/master/nodes/5', nodeId: '5' })).toBe('master:5')
    expect(pptxNodeKey({ nodePath: 'slides/2/layout/nodes/7', nodeId: '7' })).toBe('layout:7')
    expect(pptxNodeKey({ nodePath: 'slides/0/nodes/9/children/1/12', nodeId: '12' })).toBe(
      'slide:12'
    )
  })
})

describe('pptxMatchSpan', () => {
  it('跨文字节点的命中落到起止节点与节点内偏移', () => {
    // 页面上是「工作」「履历」两个小段
    expect(pptxMatchSpan('工作履历', 1, 3, ['工作', '履历'])).toEqual({
      start: [0, 1],
      end: [1, 1]
    })
  })

  it('库的段落 \\n 在页面上不占字符', () => {
    const text = '第一段\n第二段命中'
    const start = text.indexOf('命中')
    expect(pptxMatchSpan(text, start, start + 2, ['第一段', '第二段', '命中'])).toEqual({
      start: [2, 0],
      end: [2, 2]
    })
  })

  it('起点在节点边界取后一个节点，终点在边界取前一个节点', () => {
    expect(pptxMatchSpan('ab', 0, 1, ['a', 'b'])).toEqual({ start: [0, 0], end: [0, 1] })
    expect(pptxMatchSpan('ab', 1, 2, ['a', 'b'])).toEqual({ start: [1, 0], end: [1, 1] })
  })

  it('页面把连续空格画成不换行空格也算对得上', () => {
    expect(pptxMatchSpan('a  b', 0, 4, ['a \u00a0b'])).toEqual({ start: [0, 0], end: [0, 4] })
  })

  it('页面文字与库的文字对不上就不标', () => {
    expect(pptxMatchSpan('x+y=1 命中', 6, 8, ['x', '+', 'y', '命中'])).toBeNull()
  })
})
