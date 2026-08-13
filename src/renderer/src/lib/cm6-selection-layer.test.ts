import { describe, expect, it } from 'vitest'
import { layoutSelectionEdges } from './cm6-selection-layer'

describe('layoutSelectionEdges', () => {
  it('单行：四角全圆', () => {
    expect(layoutSelectionEdges([{ left: 10, right: 50 }])).toEqual([
      { left: 10, right: 50, tl: true, tr: true, bl: true, br: true }
    ])
  })

  it('等宽两行：接缝四角平直，外侧四角圆', () => {
    expect(
      layoutSelectionEdges([
        { left: 10, right: 50 },
        { left: 10, right: 50 }
      ])
    ).toEqual([
      { left: 10, right: 50, tl: true, tr: true, bl: false, br: false },
      { left: 10, right: 50, tl: false, tr: false, bl: true, br: true }
    ])
  })

  it('亚像素差被吸附成同一条直边', () => {
    const result = layoutSelectionEdges([
      { left: 10, right: 50.4 },
      { left: 10.6, right: 50 }
    ])
    expect(result[1].left).toBe(10)
    expect(result[1].right).toBe(50.4)
    expect(result[0].bl).toBe(false)
    expect(result[0].br).toBe(false)
    expect(result[1].tl).toBe(false)
    expect(result[1].tr).toBe(false)
  })

  it('下行更宽：其右上角外露圆角，上行右下为凹角不圆', () => {
    const [a, b] = layoutSelectionEdges([
      { left: 10, right: 50 },
      { left: 10, right: 80 }
    ])
    expect(a.br).toBe(false)
    expect(b.tr).toBe(true)
  })

  it('上行更宽：其右下角外露圆角，下行右上为凹角不圆', () => {
    const [a, b] = layoutSelectionEdges([
      { left: 10, right: 80 },
      { left: 10, right: 50 }
    ])
    expect(a.br).toBe(true)
    expect(b.tr).toBe(false)
  })

  it('台阶小于半径的外露角不圆（圆弧放不下）', () => {
    const [a, b] = layoutSelectionEdges([
      { left: 10, right: 52 },
      { left: 10, right: 50 }
    ])
    expect(a.br).toBe(false)
    expect(b.tr).toBe(false)
  })

  it('首行中段起选（左缘缩进）：首行左下凹角不圆，次行左上外露圆', () => {
    const [a, b] = layoutSelectionEdges([
      { left: 40, right: 80 },
      { left: 10, right: 80 }
    ])
    expect(a.bl).toBe(false)
    expect(b.tl).toBe(true)
  })
})
