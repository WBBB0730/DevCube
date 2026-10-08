import { describe, expect, it } from 'vitest'
import { treeStickyLayout, type TreeStickyInput } from './tree-sticky'

const entry = (key: string, pinned: boolean, persist = false): TreeStickyInput => ({
  key,
  pinned,
  persist
})

/** 按可见序展开成 [key, persist, slot]，便于整体比对。 */
function layout(entries: TreeStickyInput[], pinSticky: boolean): [string, boolean, number][] {
  const rows = treeStickyLayout(entries, pinSticky)
  return entries.map((e) => {
    const row = rows.get(e.key)!
    return [e.key, row.persist, row.slot]
  })
}

describe('treeStickyLayout', () => {
  it('无常驻、固定置顶关：都是段内吸顶，贴在列表顶', () => {
    expect(layout([entry('p', true), entry('a', false), entry('b', false)], false)).toEqual([
      ['p', false, 0],
      ['a', false, 0],
      ['b', false, 0]
    ])
  })

  it('固定置顶开：置顶行依次叠放，未置顶贴在整叠下方', () => {
    expect(
      layout([entry('p1', true), entry('p2', true), entry('a', false), entry('b', false)], true)
    ).toEqual([
      ['p1', false, 0],
      ['p2', false, 1],
      ['a', false, 2],
      ['b', false, 2]
    ])
  })

  it('固定置顶开：置顶的常驻条目已在叠放堆里，不再另叠', () => {
    expect(layout([entry('p1', true), entry('p2', true, true), entry('a', false)], true)).toEqual([
      ['p1', false, 0],
      ['p2', false, 1],
      ['a', false, 2]
    ])
  })

  it('未置顶常驻：钉在置顶堆下，仅排在其后的段让一行，其前不动', () => {
    expect(
      layout(
        [entry('p', true), entry('a', false), entry('b', false, true), entry('c', false)],
        true
      )
    ).toEqual([
      ['p', false, 0],
      ['a', false, 1],
      ['b', true, 1],
      ['c', false, 2]
    ])
  })

  it('固定置顶关 + 置顶常驻：摊平钉在顶，其后的置顶段与全部未置顶让一行', () => {
    expect(
      layout(
        [entry('p1', true), entry('p2', true, true), entry('p3', true), entry('a', false)],
        false
      )
    ).toEqual([
      ['p1', false, 0],
      ['p2', true, 0],
      ['p3', false, 1],
      ['a', false, 1]
    ])
  })

  it('多个常驻按可见序依次往下叠，其后的段让出相应行数', () => {
    expect(
      layout(
        [
          entry('p', true, true),
          entry('a', false),
          entry('b', false, true),
          entry('c', false),
          entry('d', false, true),
          entry('e', false)
        ],
        false
      )
    ).toEqual([
      ['p', true, 0],
      ['a', false, 1],
      ['b', true, 1],
      ['c', false, 2],
      ['d', true, 2],
      ['e', false, 3]
    ])
  })
})
