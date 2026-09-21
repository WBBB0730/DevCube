import { describe, expect, it } from 'vitest'
import { nextThumbnailPage } from './files-pdf-thumbnails'

const doneSet =
  (...pages: number[]): ((page: number) => boolean) =>
  (page) =>
    pages.includes(page)

describe('nextThumbnailPage', () => {
  it('视口内未画的按顺序优先', () => {
    expect(
      nextThumbnailPage({ first: 5, last: 8, direction: 'forward' }, 20, doneSet(5, 6), 8, 4)
    ).toBe(7)
    expect(
      nextThumbnailPage({ first: 5, last: 8, direction: 'backward' }, 20, doneSet(5, 6), 8, 4)
    ).toBe(7)
  })

  it('视口画完后顺着滚动方向往前预取，前面的预取窗口用尽再反方向补', () => {
    const visibleDone = doneSet(5, 6, 7, 8)
    expect(
      nextThumbnailPage({ first: 5, last: 8, direction: 'forward' }, 20, visibleDone, 2, 1)
    ).toBe(9)
    expect(
      nextThumbnailPage({ first: 5, last: 8, direction: 'backward' }, 20, visibleDone, 2, 1)
    ).toBe(4)
    expect(
      nextThumbnailPage(
        { first: 5, last: 8, direction: 'forward' },
        20,
        doneSet(5, 6, 7, 8, 9, 10),
        2,
        1
      )
    ).toBe(4)
  })

  it('预取不越过文档首尾；窗口内都画好返回 null，不画整本', () => {
    expect(
      nextThumbnailPage({ first: 1, last: 2, direction: 'backward' }, 20, doneSet(1, 2), 2, 1)
    ).toBe(3)
    expect(
      nextThumbnailPage({ first: 19, last: 20, direction: 'forward' }, 20, doneSet(19, 20), 2, 1)
    ).toBe(18)
    expect(
      nextThumbnailPage(
        { first: 5, last: 8, direction: 'forward' },
        20,
        doneSet(4, 5, 6, 7, 8, 9, 10),
        2,
        1
      )
    ).toBeNull()
  })

  it('视口越界按文档裁剪', () => {
    expect(
      nextThumbnailPage({ first: 0, last: 99, direction: 'forward' }, 3, () => false, 2, 1)
    ).toBe(1)
    expect(
      nextThumbnailPage({ first: 0, last: 99, direction: 'forward' }, 3, () => true, 2, 1)
    ).toBeNull()
  })
})
