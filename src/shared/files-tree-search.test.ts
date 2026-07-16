import { describe, expect, it } from 'vitest'
import type { FilesDirEntry } from './files'
import { filterFilesTree, matchesFilesTreeFilter } from './files-tree-search'

const root = '/proj'

function entry(name: string, rel: string, isDirectory: boolean): FilesDirEntry {
  return { name, path: `${root}/${rel}`, isDirectory }
}

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

describe('filterFilesTree', () => {
  const childrenByDir: Record<string, FilesDirEntry[]> = {
    [root]: [
      entry('src', 'src', true),
      entry('README.md', 'README.md', false),
      entry('package.json', 'package.json', false)
    ],
    [`${root}/src`]: [
      entry('components', 'src/components', true),
      entry('app.ts', 'src/app.ts', false)
    ],
    [`${root}/src/components`]: [
      entry('Button.tsx', 'src/components/Button.tsx', false),
      entry('Modal.tsx', 'src/components/Modal.tsx', false)
    ]
  }

  it('空查询返回原树且不强制展开', () => {
    const result = filterFilesTree(root, childrenByDir, '  ')
    expect(result.childrenByDir).toBe(childrenByDir)
    expect(result.expandedPaths).toEqual([])
  })

  it('文件命中时保留祖先并展开到命中', () => {
    const result = filterFilesTree(root, childrenByDir, 'button')
    expect(result.childrenByDir[root]?.map((e) => e.name)).toEqual(['src'])
    expect(result.childrenByDir[`${root}/src`]?.map((e) => e.name)).toEqual(['components'])
    expect(result.childrenByDir[`${root}/src/components`]?.map((e) => e.name)).toEqual([
      'Button.tsx'
    ])
    expect(result.expandedPaths.sort()).toEqual(
      [root, `${root}/src`, `${root}/src/components`].sort()
    )
  })

  it('目录路径命中时纳入整支子树', () => {
    const result = filterFilesTree(root, childrenByDir, 'components')
    expect(result.childrenByDir[`${root}/src/components`]?.map((e) => e.name)).toEqual([
      'Button.tsx',
      'Modal.tsx'
    ])
    expect(result.expandedPaths).toContain(`${root}/src/components`)
  })

  it('无匹配时根下为空', () => {
    const result = filterFilesTree(root, childrenByDir, 'zzz-nope')
    expect(result.childrenByDir[root]).toEqual([])
    expect(result.expandedPaths).toEqual([root])
  })

  it('路径段匹配命中深层文件', () => {
    const result = filterFilesTree(root, childrenByDir, 'src/app')
    expect(result.childrenByDir[`${root}/src`]?.map((e) => e.name)).toEqual(['app.ts'])
  })
})
