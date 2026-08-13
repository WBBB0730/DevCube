import { describe, expect, it } from 'vitest'
import { layoutSelectionEdges } from './cm6-selection-layer'

describe('layoutSelectionEdges', () => {
  it('单行：四角全圆', () => {
    expect(layoutSelectionEdges([{ left: 10, right: 50 }])).toEqual([
      { left: 10, right: 50, tl: 'round', tr: 'round', bl: 'round', br: 'round' }
    ])
  })

  it('等宽两行：接缝四角平直，外侧四角圆', () => {
    expect(
      layoutSelectionEdges([
        { left: 10, right: 50 },
        { left: 10, right: 50 }
      ])
    ).toEqual([
      { left: 10, right: 50, tl: 'round', tr: 'round', bl: 'flat', br: 'flat' },
      { left: 10, right: 50, tl: 'flat', tr: 'flat', bl: 'round', br: 'round' }
    ])
  })

  it('亚像素差被吸附成同一条直边（平直）', () => {
    const result = layoutSelectionEdges([
      { left: 10, right: 50.4 },
      { left: 10.6, right: 50 }
    ])
    expect(result[1].left).toBe(10)
    expect(result[1].right).toBe(50.4)
    expect(result[0].bl).toBe('flat')
    expect(result[0].br).toBe('flat')
    expect(result[1].tl).toBe('flat')
    expect(result[1].tr).toBe('flat')
  })

  it('下行更宽：上行右下凹角内圆，下行右上外露圆', () => {
    const [a, b] = layoutSelectionEdges([
      { left: 10, right: 50 },
      { left: 10, right: 80 }
    ])
    expect(a.br).toBe('intern')
    expect(b.tr).toBe('round')
  })

  it('上行更宽：上行右下外露圆，下行右上凹角内圆', () => {
    const [a, b] = layoutSelectionEdges([
      { left: 10, right: 80 },
      { left: 10, right: 50 }
    ])
    expect(a.br).toBe('round')
    expect(b.tr).toBe('intern')
  })

  it('行中起选（与下行重叠）：首行左下凹角内圆，次行左上外露圆', () => {
    const [a, b] = layoutSelectionEdges([
      { left: 40, right: 80 },
      { left: 10, right: 80 }
    ])
    expect(a.bl).toBe('intern')
    expect(b.tl).toBe('round')
  })

  it('行中起选且与下行不重叠（短行）：相邻四角全部外露圆，不产生凹角', () => {
    const [a, b] = layoutSelectionEdges([
      { left: 700, right: 900 },
      { left: 162, right: 250 }
    ])
    expect(a.bl).toBe('round')
    expect(a.br).toBe('round')
    expect(b.tl).toBe('round')
    expect(b.tr).toBe('round')
  })

  it('中间行两侧都比邻行窄：左右均凹角内圆', () => {
    const [, b] = layoutSelectionEdges([
      { left: 10, right: 90 },
      { left: 30, right: 60 },
      { left: 10, right: 90 }
    ])
    expect(b.tl).toBe('intern')
    expect(b.tr).toBe('intern')
    expect(b.bl).toBe('intern')
    expect(b.br).toBe('intern')
  })
})
