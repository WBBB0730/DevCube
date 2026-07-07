// git-details 纯函数测试：文件树构建/压缩/排序、diff 可点性、diff 端点解析、
// 正文分词（URL 自动链接）（details-diff 规格）。
import { describe, expect, it } from 'vitest'
import { GIT_INDEX, UNCOMMITTED, type GitFileChange } from '@shared/git'
import {
  buildFileTree,
  diffPossible,
  fileRowTitle,
  filesInSelection,
  flattenFileTree,
  normalizeCompare,
  pathspecOf,
  resolveDiffEndpoints,
  tokenizeBody,
  uncommittedDiffEndpoints
} from './git-details'

/** 快捷构造一个文件变更。 */
function fc(path: string, overrides: Partial<GitFileChange> = {}): GitFileChange {
  return {
    oldFilePath: path,
    newFilePath: path,
    type: 'M',
    additions: 1,
    deletions: 1,
    ...overrides
  }
}

describe('pathspecOf', () => {
  it('重命名（R）返回旧 + 新两路径，其余仅新路径', () => {
    expect(pathspecOf(fc('a.ts'))).toEqual(['a.ts'])
    expect(pathspecOf(fc('new.ts', { oldFilePath: 'old.ts', type: 'R' }))).toEqual([
      'old.ts',
      'new.ts'
    ])
  })
})

describe('filesInSelection', () => {
  const files = [fc('src/a.ts'), fc('src/util/b.ts'), fc('src/util/c.ts'), fc('README.md')]

  it('文件 key 精确命中自身', () => {
    expect(filesInSelection(files, new Set(['README.md'])).map((f) => f.newFilePath)).toEqual([
      'README.md'
    ])
  })

  it('目录 key（folderPath）命中其下全部文件', () => {
    expect(filesInSelection(files, new Set(['src/util'])).map((f) => f.newFilePath)).toEqual([
      'src/util/b.ts',
      'src/util/c.ts'
    ])
  })

  it('目录与其内文件同选不重复，按 files 原序输出', () => {
    expect(
      filesInSelection(files, new Set(['src/util', 'src/util/b.ts', 'src/a.ts'])).map(
        (f) => f.newFilePath
      )
    ).toEqual(['src/a.ts', 'src/util/b.ts', 'src/util/c.ts'])
  })

  it('前缀相近的目录不误伤（src 不命中 src-gen）', () => {
    const fs2 = [fc('src/a.ts'), fc('src-gen/x.ts')]
    expect(filesInSelection(fs2, new Set(['src'])).map((f) => f.newFilePath)).toEqual(['src/a.ts'])
  })

  it('空选区返回空列表', () => {
    expect(filesInSelection(files, new Set())).toEqual([])
  })
})

describe('diffPossible', () => {
  it('未跟踪文件可打开 diff', () => {
    expect(diffPossible(fc('a.bin', { type: 'U', additions: null, deletions: null }))).toBe(true)
  })

  it('无行数的文件（如二进制）也可打开 diff（是否二进制由点开后判定）', () => {
    expect(diffPossible(fc('a.png', { additions: null, deletions: null }))).toBe(true)
  })

  it('有行数的文本文件可打开 diff', () => {
    expect(diffPossible(fc('a.ts'))).toBe(true)
  })

  it('未跟踪目录整体条目不可打开 diff', () => {
    expect(
      diffPossible(fc('vendor', { type: 'U', additions: null, deletions: null, isDir: true }))
    ).toBe(false)
  })
})

describe('fileRowTitle', () => {
  it('可 diff 的普通修改显示「点击查看差异 • 已修改」', () => {
    expect(fileRowTitle(fc('a.ts'))).toBe('点击查看差异 • 已修改')
  })

  it('无行数的文件（如二进制）同样提示点击查看', () => {
    expect(fileRowTitle(fc('a.png', { additions: null, deletions: null }))).toBe(
      '点击查看差异 • 已修改'
    )
  })

  it('未跟踪目录整体条目提示无法查看差异', () => {
    expect(
      fileRowTitle(fc('vendor', { type: 'U', additions: null, deletions: null, isDir: true }))
    ).toBe('无法查看差异（这是一个未跟踪目录） • 未跟踪')
  })

  it('重命名附注旧路径 → 新路径', () => {
    const file = fc('b.ts', { oldFilePath: 'a.ts', type: 'R' })
    expect(fileRowTitle(file)).toBe('点击查看差异 • 已重命名 (a.ts → b.ts)')
  })
})

describe('buildFileTree + flattenFileTree', () => {
  it('按 newFilePath 分段建树并展平：文件夹在前、同类按名称排序', () => {
    const rows = flattenFileTree(
      buildFileTree([fc('readme.md'), fc('src/b.ts'), fc('src/a.ts')]),
      new Set()
    )
    expect(rows).toEqual([
      { kind: 'folder', name: 'src', folderPath: 'src', depth: 0, open: true },
      { kind: 'file', name: 'a.ts', index: 2, depth: 1 },
      { kind: 'file', name: 'b.ts', index: 1, depth: 1 },
      { kind: 'file', name: 'readme.md', index: 0, depth: 0 }
    ])
  })

  it('单链文件夹压缩为「a / b / c」且开合对象是链上最深文件夹', () => {
    const rows = flattenFileTree(buildFileTree([fc('src/main/deep/x.ts')]), new Set())
    expect(rows[0]).toEqual({
      kind: 'folder',
      name: 'src / main / deep',
      folderPath: 'src/main/deep',
      depth: 0,
      open: true
    })
    expect(rows[1]).toEqual({ kind: 'file', name: 'x.ts', index: 0, depth: 1 })
  })

  it('链上出现分叉即停止压缩', () => {
    const rows = flattenFileTree(
      buildFileTree([fc('src/main/a.ts'), fc('src/render/b.ts')]),
      new Set()
    )
    expect(rows.map((r) => (r.kind === 'folder' ? r.name : r.name))).toEqual([
      'src',
      'main',
      'a.ts',
      'render',
      'b.ts'
    ])
  })

  it('收起的文件夹不输出其子行且 open=false', () => {
    const rows = flattenFileTree(buildFileTree([fc('src/a.ts'), fc('readme.md')]), new Set(['src']))
    expect(rows).toEqual([
      { kind: 'folder', name: 'src', folderPath: 'src', depth: 0, open: false },
      { kind: 'file', name: 'readme.md', index: 1, depth: 0 }
    ])
  })

  it('空文件列表得到空行集', () => {
    expect(flattenFileTree(buildFileTree([]), new Set())).toEqual([])
  })
})

describe('normalizeCompare', () => {
  const rowIndexOf = (hash: string): number => ['*', 'bbb', 'aaa'].indexOf(hash)

  it('行序靠下（较老）的一方归一化为 from', () => {
    expect(normalizeCompare('bbb', 'aaa', rowIndexOf)).toEqual({
      fromHash: 'aaa',
      toHash: 'bbb'
    })
    expect(normalizeCompare('aaa', 'bbb', rowIndexOf)).toEqual({
      fromHash: 'aaa',
      toHash: 'bbb'
    })
  })

  it('未提交行（下标 0）恒为 to', () => {
    expect(normalizeCompare('*', 'aaa', rowIndexOf)).toEqual({ fromHash: 'aaa', toHash: '*' })
  })
})

describe('resolveDiffEndpoints', () => {
  const rowIndexOf = (hash: string): number => ['*', 'ccc', 'bbb', 'aaa'].indexOf(hash)
  const stash = { selector: 'refs/stash@{0}', baseHash: 'aaa', untrackedFilesHash: 'uuu' }

  it('普通提交详情：from === to === hash（提交自身变更，旧侧 ^ 由主进程处理）', () => {
    expect(
      resolveDiffEndpoints(fc('a.ts'), { hash: 'bbb', stash: null, compareWith: null }, rowIndexOf)
    ).toEqual({ fromHash: 'bbb', toHash: 'bbb' })
  })

  it('未提交行详情：HEAD → 工作区（*）', () => {
    expect(
      resolveDiffEndpoints(fc('a.ts'), { hash: '*', stash: null, compareWith: null }, rowIndexOf)
    ).toEqual({ fromHash: 'HEAD', toHash: '*' })
  })

  it('stash 详情的普通文件：baseHash → stash 提交', () => {
    expect(
      resolveDiffEndpoints(fc('a.ts'), { hash: 'bbb', stash, compareWith: null }, rowIndexOf)
    ).toEqual({ fromHash: 'aaa', toHash: 'bbb' })
  })

  it('stash 详情的未跟踪文件：两端都是第三父提交', () => {
    const file = fc('n.ts', { type: 'U', additions: null, deletions: null })
    expect(
      resolveDiffEndpoints(file, { hash: 'bbb', stash, compareWith: null }, rowIndexOf)
    ).toEqual({ fromHash: 'uuu', toHash: 'uuu' })
  })

  it('stash 无第三父时未跟踪文件按普通文件走 baseHash → stash', () => {
    const file = fc('n.ts', { type: 'U', additions: null, deletions: null })
    const noUntracked = { ...stash, untrackedFilesHash: null }
    expect(
      resolveDiffEndpoints(file, { hash: 'bbb', stash: noUntracked, compareWith: null }, rowIndexOf)
    ).toEqual({ fromHash: 'aaa', toHash: 'bbb' })
  })

  it('比较模式：无视点击顺序，行序归一化 from=较老', () => {
    expect(
      resolveDiffEndpoints(fc('a.ts'), { hash: 'ccc', stash: null, compareWith: 'aaa' }, rowIndexOf)
    ).toEqual({ fromHash: 'aaa', toHash: 'ccc' })
  })

  it('比较到未提交行：* 恒为 to', () => {
    expect(
      resolveDiffEndpoints(fc('a.ts'), { hash: 'bbb', stash: null, compareWith: '*' }, rowIndexOf)
    ).toEqual({ fromHash: 'bbb', toHash: '*' })
  })
})

describe('uncommittedDiffEndpoints', () => {
  it('已暂存段：HEAD → 暂存区（::index）', () => {
    expect(uncommittedDiffEndpoints('staged')).toEqual({ fromHash: 'HEAD', toHash: GIT_INDEX })
  })

  it('未暂存段：暂存区（::index）→ 工作区（*）；未跟踪行同用此端点，diff 按 U 优先走 no-index', () => {
    expect(uncommittedDiffEndpoints('unstaged')).toEqual({
      fromHash: GIT_INDEX,
      toHash: UNCOMMITTED
    })
  })
})

describe('tokenizeBody', () => {
  it('无链接的正文得到单个文本 token', () => {
    expect(tokenizeBody('fix: 修正编码问题')).toEqual([{ kind: 'text', text: 'fix: 修正编码问题' }])
  })

  it('识别 URL 并修剪结尾标点（句号归还给文本）', () => {
    expect(tokenizeBody('详见 https://example.com/a. 谢谢')).toEqual([
      { kind: 'text', text: '详见 ' },
      { kind: 'link', text: 'https://example.com/a', url: 'https://example.com/a' },
      { kind: 'text', text: '. 谢谢' }
    ])
  })

  it('URL 内成对括号保留、不成对右括号截掉', () => {
    expect(tokenizeBody('见 https://a.com/x_(y)')[1]).toEqual({
      kind: 'link',
      text: 'https://a.com/x_(y)',
      url: 'https://a.com/x_(y)'
    })
    expect(tokenizeBody('(见 https://a.com/x)')).toEqual([
      { kind: 'text', text: '(见 ' },
      { kind: 'link', text: 'https://a.com/x', url: 'https://a.com/x' },
      { kind: 'text', text: ')' }
    ])
  })

  it('空正文得到空 token 集', () => {
    expect(tokenizeBody('')).toEqual([])
  })
})
