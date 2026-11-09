import { describe, expect, it } from 'vitest'
import {
  dropScopedKeys,
  paneScopeKey,
  remapScopedKeys,
  seedPaneScope,
  lineAtPos,
  monotonicLinePoints,
  posAtLine,
  viewStateOf,
  type FilesViewMemory,
  type LinePoint
} from './files-view-state'

describe('monotonicLinePoints', () => {
  it('同一行上嵌套的块只留最外层（文档顺序在前的那个）', () => {
    expect(
      monotonicLinePoints([
        { line: 2, pos: 40 }, // ul
        { line: 2, pos: 40 }, // 首个 li
        { line: 3, pos: 60 }
      ])
    ).toEqual([
      { line: 2, pos: 40 },
      { line: 3, pos: 60 }
    ])
  })

  it('不按源码顺序排的点跳过（脚注区排在文末、源码却在中间）', () => {
    expect(
      monotonicLinePoints([
        { line: 0, pos: 0 },
        { line: 10, pos: 100 },
        { line: 4, pos: 300 }, // 脚注定义
        { line: 20, pos: 400 }
      ])
    ).toEqual([
      { line: 0, pos: 0 },
      { line: 10, pos: 100 },
      { line: 20, pos: 400 }
    ])
  })

  it('位置没往下走的点跳过（高度为 0 的块与下一块同一顶边）', () => {
    expect(
      monotonicLinePoints([
        { line: 0, pos: 0 },
        { line: 3, pos: 50 },
        { line: 4, pos: 50 },
        { line: 6, pos: 90 }
      ])
    ).toEqual([
      { line: 0, pos: 0 },
      { line: 3, pos: 50 },
      { line: 6, pos: 90 }
    ])
  })
})

describe('posAtLine / lineAtPos', () => {
  const points: LinePoint[] = [
    { line: 0, pos: 0 },
    { line: 4, pos: 100 },
    { line: 10, pos: 400 }
  ]

  it('落在对应点上即取其值', () => {
    expect(posAtLine(points, 4)).toBe(100)
    expect(lineAtPos(points, 400)).toBe(10)
  })

  it('两点之间按比例插值', () => {
    expect(posAtLine(points, 2)).toBe(50)
    expect(posAtLine(points, 7)).toBe(250)
    expect(lineAtPos(points, 250)).toBe(7)
  })

  it('超出两端贴边', () => {
    expect(posAtLine(points, -1)).toBe(0)
    expect(posAtLine(points, 99)).toBe(400)
    expect(lineAtPos(points, 9999)).toBe(10)
  })

  it('同一视图里来回换算回到原处', () => {
    for (const pos of [0, 13, 100, 237.5, 399]) {
      expect(posAtLine(points, lineAtPos(points, pos))).toBeCloseTo(pos)
    }
  })

  it('没有对应点时为 0', () => {
    expect(posAtLine([], 5)).toBe(0)
    expect(lineAtPos([], 5)).toBe(0)
  })
})

describe('按文件记的阅读位置', () => {
  it('同一路径恒为同一份，记下的值读得回来', () => {
    const memory: FilesViewMemory = new Map()
    const state = viewStateOf(memory, '/p/a.md')
    state.set('line', 12.5)
    expect(viewStateOf(memory, '/p/a.md')).toBe(state)
    expect(viewStateOf(memory, '/p/a.md').get('line')).toBe(12.5)
    expect(viewStateOf(memory, '/p/b.md').get('line')).toBeUndefined()
  })
})

describe('按「栏 + 文件」记的状态', () => {
  it('某栏第一次打开某文件时取另一栏的那份（另起一份），本栏已有就不动', () => {
    const memory: FilesViewMemory = new Map()
    viewStateOf(memory, paneScopeKey('p1', '/p/a.md')).set('line', 30)
    seedPaneScope(memory, 'p2', '/p/a.md', ['p1'], (v) => v.clone())
    const seeded = viewStateOf(memory, paneScopeKey('p2', '/p/a.md'))
    expect(seeded.get('line')).toBe(30)
    seeded.set('line', 5)
    expect(viewStateOf(memory, paneScopeKey('p1', '/p/a.md')).get('line')).toBe(30)
    seedPaneScope(memory, 'p2', '/p/a.md', ['p1'], (v) => v.clone())
    expect(viewStateOf(memory, paneScopeKey('p2', '/p/a.md')).get('line')).toBe(5)
  })

  it('改名时整份跟到新路径（含目录下的文件），栏不变、视图手里的仍是同一份', () => {
    const memory: FilesViewMemory = new Map()
    const left = viewStateOf(memory, paneScopeKey('p1', '/p/docs/a.md'))
    const right = viewStateOf(memory, paneScopeKey('p2', '/p/docs/a.md'))
    const other = viewStateOf(memory, paneScopeKey('p1', '/p/b.md'))
    remapScopedKeys(memory, (p) => p.replace(/^\/p\/docs(?=\/|$)/, '/p/guide'))
    expect([...memory.keys()].sort()).toEqual(
      [
        paneScopeKey('p1', '/p/b.md'),
        paneScopeKey('p1', '/p/guide/a.md'),
        paneScopeKey('p2', '/p/guide/a.md')
      ].sort()
    )
    expect(memory.get(paneScopeKey('p1', '/p/guide/a.md'))).toBe(left)
    expect(memory.get(paneScopeKey('p2', '/p/guide/a.md'))).toBe(right)
    expect(memory.get(paneScopeKey('p1', '/p/b.md'))).toBe(other)
  })

  it('删除时丢掉（含目录下的文件），不误伤同名前缀', () => {
    const memory: FilesViewMemory = new Map()
    viewStateOf(memory, paneScopeKey('p1', '/p/docs/a.md'))
    viewStateOf(memory, paneScopeKey('p2', '/p/docs/sub/b.md'))
    viewStateOf(memory, paneScopeKey('p1', '/p/docs.md'))
    dropScopedKeys(memory, (p) => p === '/p/docs' || p.startsWith('/p/docs/'))
    expect([...memory.keys()]).toEqual([paneScopeKey('p1', '/p/docs.md')])
  })
})
