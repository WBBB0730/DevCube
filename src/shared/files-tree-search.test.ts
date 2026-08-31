import { describe, expect, it } from 'vitest'
import { filterFilesListTree, matchesFilesTreeFilter } from './files-tree-search'

const root = '/proj'

describe('matchesFilesTreeFilter', () => {
  it('空查询视为无过滤匹配需求（由调用方短路）', () => {
    expect(matchesFilesTreeFilter('src/a.ts', '')).toBe(true)
    expect(matchesFilesTreeFilter('src/a.ts', '  ')).toBe(true)
  })

  it('相对路径大小写不敏感包含', () => {
    expect(matchesFilesTreeFilter('src/Button.tsx', 'button')).toBe(true)
    expect(matchesFilesTreeFilter('src/Button.tsx', 'SRC/BTN')).toBe(false)
    expect(matchesFilesTreeFilter('src/components/button/index.ts', 'components/button')).toBe(true)
  })
})

describe('filterFilesListTree', () => {
  const relFiles = [
    'src/components/Button.tsx',
    'src/components/Modal.tsx',
    'src/app.ts',
    'README.md',
    'package.json'
  ]

  it('文件命中时构建祖先链并展开到命中', () => {
    const result = filterFilesListTree(root, relFiles, 'button')
    expect(result.childrenByDir[root]?.map((e) => e.name)).toEqual(['src'])
    expect(result.childrenByDir[`${root}/src`]?.map((e) => e.name)).toEqual(['components'])
    expect(result.childrenByDir[`${root}/src/components`]?.map((e) => e.name)).toEqual([
      'Button.tsx'
    ])
    expect(result.expandedPaths.sort()).toEqual(
      [root, `${root}/src`, `${root}/src/components`].sort()
    )
  })

  it('目录路径命中时子孙路径天然带整支', () => {
    const result = filterFilesListTree(root, relFiles, 'components')
    expect(result.childrenByDir[`${root}/src/components`]?.map((e) => e.name)).toEqual([
      'Button.tsx',
      'Modal.tsx'
    ])
    expect(result.expandedPaths).toContain(`${root}/src/components`)
  })

  it('查询大小写不敏感', () => {
    const result = filterFilesListTree(root, relFiles, 'BUTTON')
    expect(result.childrenByDir[`${root}/src/components`]?.map((e) => e.name)).toEqual([
      'Button.tsx'
    ])
  })

  it('无匹配时根下为空', () => {
    const result = filterFilesListTree(root, relFiles, 'zzz-nope')
    expect(result.childrenByDir[root]).toEqual([])
    expect(result.expandedPaths).toEqual([root])
  })

  it('路径段跨段匹配命中深层文件', () => {
    const result = filterFilesListTree(root, relFiles, 'src/app')
    expect(result.childrenByDir[`${root}/src`]?.map((e) => e.name)).toEqual(['app.ts'])
  })

  it('同级排序目录在前、名称大小写不敏感升序', () => {
    const result = filterFilesListTree(root, ['zeta/x.ts', 'alpha.ts', 'Beta.ts'], 't')
    expect(result.childrenByDir[root]?.map((e) => e.name)).toEqual(['zeta', 'alpha.ts', 'Beta.ts'])
    expect(result.childrenByDir[root]?.map((e) => e.isDirectory)).toEqual([true, false, false])
  })

  it('条目携带绝对逻辑路径与目录标记', () => {
    const result = filterFilesListTree(root, relFiles, 'modal')
    const dir = result.childrenByDir[`${root}/src`]?.[0]
    const file = result.childrenByDir[`${root}/src/components`]?.[0]
    expect(dir).toEqual({ name: 'components', path: `${root}/src/components`, isDirectory: true })
    expect(file).toEqual({
      name: 'Modal.tsx',
      path: `${root}/src/components/Modal.tsx`,
      isDirectory: false
    })
  })
})
