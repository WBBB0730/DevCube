import { describe, expect, it } from 'vitest'
import { applyPanelSizesPatch, normalizePanelSizes } from './panel-sizes'

describe('normalizePanelSizes', () => {
  it('只留已知键里的有限正数', () => {
    expect(
      normalizePanelSizes({
        projectTree: 320,
        treePanel: 0,
        gitDetailsHeight: Number.NaN,
        gitDetailsSplit: '40',
        contentSearchSplit: 62.5,
        unknown: 100
      })
    ).toEqual({ projectTree: 320, contentSearchSplit: 62.5 })
  })

  it('老档案没有这一项或不是对象时为空', () => {
    expect(normalizePanelSizes(undefined)).toEqual({})
    expect(normalizePanelSizes(null)).toEqual({})
    expect(normalizePanelSizes([280])).toEqual({})
  })
})

describe('applyPanelSizesPatch', () => {
  it('数值记下、null 清掉，其余不动', () => {
    expect(
      applyPanelSizesPatch(
        { projectTree: 300, treePanel: 260 },
        { treePanel: null, gitDetailsHeight: 320 }
      )
    ).toEqual({ projectTree: 300, gitDetailsHeight: 320 })
  })

  it('不改传入的那份', () => {
    const sizes = { projectTree: 300 }
    applyPanelSizesPatch(sizes, { projectTree: null })
    expect(sizes).toEqual({ projectTree: 300 })
  })
})
