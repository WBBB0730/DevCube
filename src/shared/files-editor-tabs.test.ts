import { describe, expect, it } from 'vitest'
import {
  EMPTY_EDITOR_LAYOUT,
  activeEditorPath,
  adjacentEditorPath,
  closeAllEditors,
  closeEditor,
  closeEditorsToLeft,
  closeEditorsToRight,
  closeOtherEditors,
  deactivatedEditorPaths,
  dropEditorPaths,
  editorLayoutsEqual,
  editorTabLabels,
  editorTabLimit,
  leavingEditorPaths,
  moveEditor,
  normalizeEditorLayout,
  openEditor,
  pinEditor,
  remapEditorPaths,
  removedEditorPaths,
  splitEditor,
  type EditorLayout
} from './files-editor-tabs'

const UNLIMITED = editorTabLimit(true)
const ONE = editorTabLimit(false)

/** 简写：一栏的 Tab 写成 'a'（固定）/ '~a'（临时），当前 Tab 用 * 标 */
function pane(id: string, ...specs: string[]): EditorLayout['panes'][number] {
  let active: string | null = null
  const tabs = specs.map((s) => {
    const star = s.endsWith('*')
    const body = star ? s.slice(0, -1) : s
    const pinned = !body.startsWith('~')
    const path = pinned ? body : body.slice(1)
    if (star) active = path
    return { path, pinned }
  })
  return { id, tabs, active }
}

function layout(current: string, ...panes: EditorLayout['panes']): EditorLayout {
  return { panes, current }
}

function open(l: EditorLayout, path: string, limit: number, pin = false): EditorLayout {
  return openEditor(l, path, { pin, limit })
}

describe('openEditor', () => {
  it.each([
    ['不限', UNLIMITED],
    ['上限 1', ONE]
  ])('%s：空栏打开即一个临时 Tab', (_name, limit) => {
    expect(open(EMPTY_EDITOR_LAYOUT, '/a', limit)).toEqual(layout('p1', pane('p1', '~/a*')))
  })

  it.each([
    ['不限', UNLIMITED],
    ['上限 1', ONE]
  ])('%s：再打开别的文件替换临时 Tab', (_name, limit) => {
    const l = open(EMPTY_EDITOR_LAYOUT, '/a', limit)
    expect(open(l, '/b', limit)).toEqual(layout('p1', pane('p1', '~/b*')))
  })

  it('上限 1：要固定也不固定，下一次打开照样替换', () => {
    const l = open(EMPTY_EDITOR_LAYOUT, '/a', ONE, true)
    expect(l).toEqual(layout('p1', pane('p1', '~/a*')))
    expect(open(l, '/b', ONE, true)).toEqual(layout('p1', pane('p1', '~/b*')))
  })

  it('不限：固定的 Tab 留着，新文件在当前 Tab 右侧开临时 Tab', () => {
    const l = layout('p1', pane('p1', '/a*', '/b'))
    expect(open(l, '/c', UNLIMITED)).toEqual(layout('p1', pane('p1', '/a', '~/c*', '/b')))
  })

  it('不限：有临时 Tab 时替换它，位置不变', () => {
    const l = layout('p1', pane('p1', '/a*', '~/b', '/c'))
    expect(open(l, '/d', UNLIMITED)).toEqual(layout('p1', pane('p1', '/a', '~/d*', '/c')))
  })

  it('已开着的文件即激活，pin 时顺带固定', () => {
    const l = layout('p1', pane('p1', '/a*', '~/b'))
    expect(open(l, '/b', UNLIMITED)).toEqual(layout('p1', pane('p1', '/a', '~/b*')))
    expect(open(l, '/b', UNLIMITED, true)).toEqual(layout('p1', pane('p1', '/a', '/b*')))
  })

  it('什么都不变时原样返回', () => {
    const l = layout('p1', pane('p1', '/a*'))
    expect(open(l, '/a', UNLIMITED)).toBe(l)
  })

  it('指定栏打开，并让它成为当前栏', () => {
    const l = layout('p1', pane('p1', '/a*'), pane('p2', '/b*'))
    expect(openEditor(l, '/c', { pane: 'p2', limit: UNLIMITED })).toEqual(
      layout('p2', pane('p1', '/a*'), pane('p2', '/b', '~/c*'))
    )
  })
})

describe('pinEditor', () => {
  it('固定临时 Tab；上限 1 时不变', () => {
    const l = layout('p1', pane('p1', '~/a*'))
    expect(pinEditor(l, 'p1', '/a', UNLIMITED)).toEqual(layout('p1', pane('p1', '/a*')))
    expect(pinEditor(l, 'p1', '/a', ONE)).toBe(l)
  })
})

describe('关闭', () => {
  it('关当前 Tab 落到左邻，其次右邻', () => {
    const l = layout('p1', pane('p1', '/a', '/b*', '/c'))
    expect(closeEditor(l, 'p1', '/b')).toEqual(layout('p1', pane('p1', '/a*', '/c')))
    const first = layout('p1', pane('p1', '/a*', '/b'))
    expect(closeEditor(first, 'p1', '/a')).toEqual(layout('p1', pane('p1', '/b*')))
  })

  it('关别的 Tab 不动当前 Tab', () => {
    const l = layout('p1', pane('p1', '/a', '/b*'))
    expect(closeEditor(l, 'p1', '/a')).toEqual(layout('p1', pane('p1', '/b*')))
  })

  it('不分栏时关掉最后一个回空态', () => {
    const l = layout('p1', pane('p1', '~/a*'))
    expect(closeEditor(l, 'p1', '/a')).toEqual(layout('p1', { id: 'p1', tabs: [], active: null }))
  })

  it('分栏时一栏关空即收起，当前栏转给另一栏', () => {
    const l = layout('p2', pane('p1', '/a*'), pane('p2', '/b*'))
    expect(closeEditor(l, 'p2', '/b')).toEqual(layout('p1', pane('p1', '/a*')))
  })

  it('关闭其他 / 关闭左侧 / 关闭右侧 / 全部关闭', () => {
    const l = layout('p1', pane('p1', '/a', '/b*', '/c'))
    expect(closeOtherEditors(l, 'p1', '/c')).toEqual(layout('p1', pane('p1', '/c*')))
    expect(closeEditorsToLeft(l, 'p1', '/c')).toEqual(layout('p1', pane('p1', '/c*')))
    expect(closeEditorsToLeft(l, 'p1', '/b')).toEqual(layout('p1', pane('p1', '/b*', '/c')))
    expect(closeEditorsToLeft(l, 'p1', '/a')).toBe(l)
    expect(closeEditorsToRight(l, 'p1', '/a')).toEqual(layout('p1', pane('p1', '/a*')))
    expect(closeEditorsToRight(l, 'p1', '/b')).toEqual(layout('p1', pane('p1', '/a', '/b*')))
    expect(closeAllEditors(l, 'p1')).toEqual(layout('p1', { id: 'p1', tabs: [], active: null }))
  })
})

describe('分栏与移动', () => {
  it('向右分屏：当前文件在新栏固定打开，新栏成为当前栏', () => {
    const l = layout('p1', pane('p1', '~/a*'))
    expect(splitEditor(l, UNLIMITED)).toEqual(layout('p2', pane('p1', '~/a*'), pane('p2', '/a*')))
  })

  it('指定当前栏里的别的文件分出去', () => {
    const l = layout('p1', pane('p1', '/a*', '/b'))
    expect(splitEditor(l, UNLIMITED, '/b')).toEqual(
      layout('p2', pane('p1', '/a*', '/b'), pane('p2', '/b*'))
    )
    expect(splitEditor(l, UNLIMITED, '/nope')).toBe(l)
  })

  it('上限 1、已分栏或没有打开的文件时不分', () => {
    const l = layout('p1', pane('p1', '~/a*'))
    expect(splitEditor(l, ONE)).toBe(l)
    const split = splitEditor(l, UNLIMITED)
    expect(splitEditor(split, UNLIMITED)).toBe(split)
    expect(splitEditor(EMPTY_EDITOR_LAYOUT, UNLIMITED)).toBe(EMPTY_EDITOR_LAYOUT)
  })

  it('收起左栏后再分屏，新栏补上空出来的标识', () => {
    const l = closeEditor(layout('p1', pane('p1', '/a*'), pane('p2', '/b*')), 'p1', '/a')
    expect(splitEditor(l, UNLIMITED)).toEqual(layout('p1', pane('p2', '/b*'), pane('p1', '/b*')))
  })

  it('移到另一栏：在那里固定并激活，来源关空即收起', () => {
    const l = layout('p1', pane('p1', '~/a*', '/c'), pane('p2', '/b*'))
    expect(moveEditor(l, 'p1', '/a', 'p2')).toEqual(
      layout('p2', pane('p1', '/c*'), pane('p2', '/b', '/a*'))
    )
    const only = layout('p1', pane('p1', '/a*'), pane('p2', '/b*'))
    expect(moveEditor(only, 'p1', '/a', 'p2', 0)).toEqual(layout('p2', pane('p2', '/a*', '/b')))
  })

  it('目标栏已有同一文件即激活那个', () => {
    const l = layout('p1', pane('p1', '/a*', '/c'), pane('p2', '/a', '/b*'))
    expect(moveEditor(l, 'p1', '/a', 'p2')).toEqual(
      layout('p2', pane('p1', '/c*'), pane('p2', '/a*', '/b'))
    )
  })

  it('栏内调整顺序', () => {
    const l = layout('p1', pane('p1', '/a*', '/b', '/c'))
    expect(moveEditor(l, 'p1', '/a', 'p1', 2)).toEqual(layout('p1', pane('p1', '/b', '/c', '/a*')))
    expect(moveEditor(l, 'p1', '/a', 'p1', 0)).toBe(l)
    expect(moveEditor(l, 'p1', '/c', 'p1', 0)).toEqual(layout('p1', pane('p1', '/c', '/a*', '/b')))
  })
})

describe('adjacentEditorPath', () => {
  it('当前栏里循环取上一个 / 下一个，不足两个为 null', () => {
    const l = layout('p1', pane('p1', '/a', '/b*', '/c'))
    expect(adjacentEditorPath(l, 1)).toBe('/c')
    expect(adjacentEditorPath(layout('p1', pane('p1', '/a', '/b', '/c*')), 1)).toBe('/a')
    expect(adjacentEditorPath(layout('p1', pane('p1', '/a*', '/b')), -1)).toBe('/b')
    expect(adjacentEditorPath(layout('p1', pane('p1', '~/a*')), 1)).toBeNull()
  })
})

describe('被关掉与被切走的文件', () => {
  it('替换临时 Tab：旧文件被关掉', () => {
    const base = layout('p1', pane('p1', '/a', '~/b*'))
    const next = open(base, '/c', UNLIMITED)
    expect(removedEditorPaths(base, next)).toEqual(['/b'])
    expect(deactivatedEditorPaths(base, next)).toEqual([])
  })

  it('切到别的 Tab：原来的被切走；另一栏还显示着的不算', () => {
    const base = layout('p1', pane('p1', '/a*', '/b'))
    expect(deactivatedEditorPaths(base, open(base, '/b', UNLIMITED))).toEqual(['/a'])
    const split = layout('p1', pane('p1', '/a*', '/b'), pane('p2', '/a*'))
    expect(deactivatedEditorPaths(split, open(split, '/b', UNLIMITED))).toEqual([])
  })
})

describe('leavingEditorPaths', () => {
  it('本地：被关掉的与被切走的都要先安顿；服务器：只有被关掉的（切走的修改留着）', () => {
    const base = layout('p1', pane('p1', '/a*', '~/b'))
    const switched = open(base, '/b', UNLIMITED)
    expect(leavingEditorPaths(base, switched, { keepDeactivated: false })).toEqual(['/a'])
    expect(leavingEditorPaths(base, switched, { keepDeactivated: true })).toEqual([])
    const closed = closeEditor(base, 'p1', '/a')
    expect(leavingEditorPaths(base, closed, { keepDeactivated: true })).toEqual(['/a'])
  })
})

describe('改名与删除', () => {
  it('改名跟着新路径，换完重名的只留一个（固定的优先）', () => {
    const l = layout('p1', pane('p1', '~/d/a*', '/x'))
    const remap = (p: string): string => p.replace('/d/', '/e/')
    expect(remapEditorPaths(l, remap)).toEqual(layout('p1', pane('p1', '~/e/a*', '/x')))
    const dup = layout('p1', pane('p1', '~/a*', '/b'))
    expect(remapEditorPaths(dup, (p) => (p === '/a' ? '/b' : p))).toEqual(
      layout('p1', pane('p1', '/b*'))
    )
    expect(remapEditorPaths(l, (p) => p)).toBe(l)
  })

  it('删除去掉命中的 Tab，当前 Tab 落到邻居，栏去空即收起，当前栏能留就留', () => {
    const l = layout('p2', pane('p1', '/d/a*'), pane('p2', '/b', '/d/c*'))
    const gone = (p: string): boolean => p.startsWith('/d/')
    expect(dropEditorPaths(l, gone)).toEqual(layout('p2', pane('p2', '/b*')))
    const keepCurrent = layout('p1', pane('p1', '/x*'), pane('p2', '/d/a*', '/y'))
    expect(dropEditorPaths(keepCurrent, gone)).toEqual(
      layout('p1', pane('p1', '/x*'), pane('p2', '/y*'))
    )
    expect(dropEditorPaths(l, () => false)).toBe(l)
  })
})

describe('normalizeEditorLayout', () => {
  it('形状不对即空布局', () => {
    for (const raw of [null, undefined, 1, 'x', {}, { panes: 'x' }, { panes: [{ id: 9 }] }]) {
      expect(normalizeEditorLayout(raw, UNLIMITED)).toEqual(EMPTY_EDITOR_LAYOUT)
    }
  })

  it('去重、多出来的临时 Tab 当作固定、当前 Tab 与当前栏落在实处、至多两栏', () => {
    const raw = {
      panes: [
        {
          id: 'p1',
          tabs: [
            { path: '/a', pinned: false },
            { path: '/a', pinned: true },
            { path: '/b', pinned: false }
          ],
          active: '/nope'
        },
        { id: 'p1', tabs: [{ path: '/z', pinned: true }], active: '/z' },
        { id: 'p2', tabs: [], active: null }
      ],
      current: 'p2'
    }
    expect(normalizeEditorLayout(raw, UNLIMITED)).toEqual(layout('p1', pane('p1', '~/a*', '/b')))
  })

  it('上限 1：只留当前栏的当前 Tab，且为临时', () => {
    const l = layout('p2', pane('p1', '/a*'), pane('p2', '/b', '/c*'))
    expect(normalizeEditorLayout(l, ONE)).toEqual(layout('p2', pane('p2', '~/c*')))
  })

  it('已经规整的读回来一样', () => {
    const l = layout('p2', pane('p1', '/a*', '~/b'), pane('p2', '/c*'))
    expect(editorLayoutsEqual(normalizeEditorLayout(l, UNLIMITED), l)).toBe(true)
    expect(normalizeEditorLayout(EMPTY_EDITOR_LAYOUT, ONE)).toEqual(EMPTY_EDITOR_LAYOUT)
  })
})

describe('editorTabLabels', () => {
  it('重名的带上级文件夹名', () => {
    expect(editorTabLabels(['/p/src/index.ts', '/p/test/index.ts', '/p/a.ts'])).toEqual([
      { name: 'index.ts', hint: 'src' },
      { name: 'index.ts', hint: 'test' },
      { name: 'a.ts', hint: null }
    ])
  })
})

describe('activeEditorPath', () => {
  it('取当前栏的当前 Tab', () => {
    expect(activeEditorPath(layout('p2', pane('p1', '/a*'), pane('p2', '/b*')))).toBe('/b')
    expect(activeEditorPath(EMPTY_EDITOR_LAYOUT)).toBeNull()
  })
})
