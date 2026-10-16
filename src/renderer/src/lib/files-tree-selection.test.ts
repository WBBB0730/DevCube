import { describe, expect, it } from 'vitest'
import { logicalParentPath } from '@shared/files-path'
import {
  dropHidden,
  remapSelection,
  selectAll,
  selectedInOrder,
  selectOnly,
  selectPaths,
  selectRange,
  toggleSelected,
  treeArrowAction,
  type TreeArrowAction,
  type TreeKeyRow
} from './files-tree-selection'

const ROWS = ['/p/a', '/p/a/x', '/p/a/y', '/p/b', '/p/c']
const paths = (s: { paths: ReadonlySet<string> }): string[] => [...s.paths].sort()

describe('选中', () => {
  it('单选：选中、焦点、锚点都是它', () => {
    expect(selectOnly('/p/a')).toEqual({ paths: new Set(['/p/a']), focus: '/p/a', anchor: '/p/a' })
  })

  it('选中一批：锚点在第一个、焦点在最后一个', () => {
    expect(selectPaths(['/p/a', '/p/b'])).toEqual({
      paths: new Set(['/p/a', '/p/b']),
      focus: '/p/b',
      anchor: '/p/a'
    })
  })

  it('⌘ 点选切换单项，焦点与锚点落到它', () => {
    const s = toggleSelected(selectOnly('/p/a'), '/p/b')
    expect(paths(s)).toEqual(['/p/a', '/p/b'])
    expect(s.focus).toBe('/p/b')
    const off = toggleSelected(s, '/p/a')
    expect(paths(off)).toEqual(['/p/b'])
    expect(off.anchor).toBe('/p/a')
  })

  it('⇧ 连选从锚点起算、锚点不动，往上往下都行', () => {
    const down = selectRange(selectOnly('/p/a/x'), ROWS, '/p/b')
    expect(paths(down)).toEqual(['/p/a/x', '/p/a/y', '/p/b'])
    expect(down.anchor).toBe('/p/a/x')
    const up = selectRange(down, ROWS, '/p/a')
    expect(paths(up)).toEqual(['/p/a', '/p/a/x'])
  })

  it('⇧ 连选时锚点已看不见：从点的那一行起', () => {
    const s = selectRange({ paths: new Set(), focus: null, anchor: '/gone' }, ROWS, '/p/b')
    expect(paths(s)).toEqual(['/p/b'])
  })

  it('全选看得见的行，焦点不变', () => {
    const s = selectAll(selectOnly('/p/b'), ROWS)
    expect(s.paths.size).toBe(ROWS.length)
    expect(s.focus).toBe('/p/b')
  })

  it('按树上的顺序取选中的行', () => {
    const s = toggleSelected(selectOnly('/p/c'), '/p/a/x')
    expect(selectedInOrder(s, ROWS)).toEqual(['/p/a/x', '/p/c'])
  })
})

describe('dropHidden', () => {
  it('收起后看不见的移出选中，焦点也清掉', () => {
    const s = toggleSelected(selectOnly('/p/a/x'), '/p/b')
    const next = dropHidden(s, new Set(ROWS), new Set(['/p/a', '/p/b', '/p/c']))
    expect(paths(next)).toEqual(['/p/b'])
    expect(next.focus).toBe('/p/b')
    const hidden = dropHidden(selectOnly('/p/a/x'), new Set(ROWS), new Set(['/p/a']))
    expect(hidden.focus).toBeNull()
  })

  it('本来就还没出现的不动（先选中、再展开到它）', () => {
    const s = selectOnly('/p/d/z')
    expect(dropHidden(s, new Set(ROWS), new Set(ROWS))).toBe(s)
  })
})

describe('remapSelection', () => {
  it('选中、焦点与锚点跟着改路径', () => {
    const s = remapSelection(selectOnly('/p/a/x'), (p) => p.replace('/p/a', '/p/z'))
    expect(s).toEqual({ paths: new Set(['/p/z/x']), focus: '/p/z/x', anchor: '/p/z/x' })
  })
})

describe('treeArrowAction（同 WebStorm）', () => {
  const rows: TreeKeyRow[] = [
    { path: '/p/a', isDirectory: true, expanded: true },
    { path: '/p/a/x', isDirectory: false, expanded: false },
    { path: '/p/b', isDirectory: true, expanded: false },
    { path: '/p/c.txt', isDirectory: false, expanded: false }
  ]
  const act = (focus: string | null, key: Parameters<typeof treeArrowAction>[2]): TreeArrowAction =>
    treeArrowAction(rows, focus, key, logicalParentPath)

  it('↑ / ↓ 上一行 / 下一行，到头不动；没有焦点行从头 / 从尾起', () => {
    expect(act('/p/a/x', 'ArrowDown')).toEqual({ kind: 'move', path: '/p/b' })
    expect(act('/p/a/x', 'ArrowUp')).toEqual({ kind: 'move', path: '/p/a' })
    expect(act('/p/c.txt', 'ArrowDown')).toBeNull()
    expect(act(null, 'ArrowDown')).toEqual({ kind: 'move', path: '/p/a' })
    expect(act(null, 'ArrowUp')).toEqual({ kind: 'move', path: '/p/c.txt' })
  })

  it('→ 收起的文件夹展开，展开的文件夹与文件同 ↓', () => {
    expect(act('/p/b', 'ArrowRight')).toEqual({ kind: 'expand', path: '/p/b' })
    expect(act('/p/a', 'ArrowRight')).toEqual({ kind: 'move', path: '/p/a/x' })
    expect(act('/p/a/x', 'ArrowRight')).toEqual({ kind: 'move', path: '/p/b' })
  })

  it('← 展开的文件夹收起，其余跳到所在文件夹；所在文件夹是根时不动', () => {
    expect(act('/p/a', 'ArrowLeft')).toEqual({ kind: 'collapse', path: '/p/a' })
    expect(act('/p/a/x', 'ArrowLeft')).toEqual({ kind: 'move', path: '/p/a' })
    expect(act('/p/b', 'ArrowLeft')).toBeNull()
    expect(act('/p/c.txt', 'ArrowLeft')).toBeNull()
  })
})
