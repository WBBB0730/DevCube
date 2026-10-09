import { describe, expect, it } from 'vitest'
import { nextThumbnailPage, pageThumbSize } from './files-page-thumbnails'

describe('pageThumbSize', () => {
  it.each([
    ['A4 竖页恰好用满整个框（pt）', 595, 842, { width: 128, height: 181 }],
    ['A4 竖页恰好用满整个框（mm）', 210, 297, { width: 128, height: 181 }],
    ['Letter 竖页用满框宽', 612, 792, { width: 128, height: 166 }],
    ['16:9 横页用满框宽', 1920, 1080, { width: 128, height: 72 }],
    ['正方形', 100, 100, { width: 128, height: 128 }],
    ['Legal 比 A4 长，顶住框高缩窄', 612, 1008, { width: 110, height: 181 }],
    ['手机长截图顶住框高缩窄', 1170, 2532, { width: 84, height: 181 }],
    ['1:5 长页顶住框高缩窄', 100, 500, { width: 36, height: 181 }],
    ['极端宽页高至少 1px', 14400, 3, { width: 128, height: 1 }],
    ['极端长页宽至少 1px', 3, 14400, { width: 1, height: 181 }]
  ])('%s', (_, w, h, size) => {
    expect(pageThumbSize(w, h)).toEqual(size)
  })
})

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
