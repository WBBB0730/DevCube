import { describe, expect, it } from 'vitest'
import { nextClickIndex } from './double-click'

/** 按一串 click 的 `detail` 依次推进，返回判为双击（偶数下）的位置（1 起）。 */
function doubleClickAt(details: number[]): number[] {
  let index = 0
  const hits: number[] = []
  details.forEach((detail, i) => {
    index = nextClickIndex(index, detail)
    if (index % 2 === 0) hits.push(i + 1)
  })
  return hits
}

describe('nextClickIndex', () => {
  it('macOS 点击计数一路累加：第 2、4、6 下各算一次双击', () => {
    expect(doubleClickAt([1, 2, 3, 4, 5, 6])).toEqual([2, 4, 6])
  })

  it('Windows / Linux 点击计数封顶 3：仍按实际下数判定', () => {
    expect(doubleClickAt([1, 2, 3, 3, 3, 3])).toEqual([2, 4, 6])
  })

  it('detail 回到 1 即开新一串', () => {
    expect(doubleClickAt([1, 2, 3, 1, 2])).toEqual([2, 5])
  })

  it('键盘触发的 click 不算双击', () => {
    expect(doubleClickAt([0, 0])).toEqual([])
  })
})
