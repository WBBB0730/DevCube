import { describe, expect, it } from 'vitest'
import type { FilesDirEntry } from './files'
import { flattenFilesTree } from './files-tree-flatten'

const root = '/proj'

function entry(name: string, rel: string, isDirectory: boolean): FilesDirEntry {
  return { name, path: `${root}/${rel}`, isDirectory }
}

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
  [`${root}/src/components`]: [entry('Button.tsx', 'src/components/Button.tsx', false)]
}

describe('flattenFilesTree', () => {
  it('根子级恒可见、未展开目录不出子级', () => {
    const rows = flattenFilesTree(root, childrenByDir, new Set())
    expect(rows.map((r) => r.name)).toEqual(['src', 'README.md', 'package.json'])
  })

  it('展开目录后子级按视觉序插入、深度逐级 +1', () => {
    const rows = flattenFilesTree(root, childrenByDir, new Set([`${root}/src`]))
    expect(rows.map((r) => [r.name, r.depth])).toEqual([
      ['src', 0],
      ['components', 1],
      ['app.ts', 1],
      ['README.md', 0],
      ['package.json', 0]
    ])
  })

  it('多级展开递归拍平', () => {
    const rows = flattenFilesTree(
      root,
      childrenByDir,
      new Set([`${root}/src`, `${root}/src/components`])
    )
    expect(rows.map((r) => r.name)).toEqual([
      'src',
      'components',
      'Button.tsx',
      'app.ts',
      'README.md',
      'package.json'
    ])
    expect(rows[2]).toEqual({
      path: `${root}/src/components/Button.tsx`,
      name: 'Button.tsx',
      depth: 2,
      isDirectory: false
    })
  })

  it('展开集合里未加载的目录不产子级', () => {
    const rows = flattenFilesTree(
      root,
      { [root]: [entry('lazy', 'lazy', true)] },
      new Set([`${root}/lazy`])
    )
    expect(rows.map((r) => r.name)).toEqual(['lazy'])
  })
})
