// git-details 纯函数测试：文件树构建/压缩/排序、diff 可点性、diff 端点解析、
// 正文分词（URL / issue 链接）、diff 截断与 hunk 头还原（details-diff 规格）。
import { describe, expect, it } from 'vitest'
import type { DiffHunk, GitFileChange } from '@shared/git'
import {
  DIFF_RENDER_LIMIT,
  buildFileTree,
  countDiffLines,
  diffPossible,
  fileRowTitle,
  flattenFileTree,
  formatHunkHeader,
  limitDiffHunks,
  normalizeCompare,
  resolveDiffEndpoints,
  tokenizeBody
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

describe('diffPossible', () => {
  it('未跟踪文件恒可打开 diff（主进程合成新增 hunk）', () => {
    expect(diffPossible(fc('a.bin', { type: 'U', additions: null, deletions: null }))).toBe(true)
  })

  it('二进制文件（行数为 null）不可打开 diff', () => {
    expect(diffPossible(fc('a.png', { additions: null, deletions: null }))).toBe(false)
  })

  it('有行数的文本文件可打开 diff', () => {
    expect(diffPossible(fc('a.ts'))).toBe(true)
  })
})

describe('fileRowTitle', () => {
  it('可 diff 的普通修改显示「点击查看差异 • 已修改」', () => {
    expect(fileRowTitle(fc('a.ts'))).toBe('点击查看差异 • 已修改')
  })

  it('二进制文件提示无法查看差异', () => {
    expect(fileRowTitle(fc('a.png', { additions: null, deletions: null }))).toBe(
      '无法查看差异（这是一个二进制文件） • 已修改'
    )
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

describe('tokenizeBody', () => {
  it('无链接的正文得到单个文本 token', () => {
    expect(tokenizeBody('fix: 修正编码问题', null)).toEqual([
      { kind: 'text', text: 'fix: 修正编码问题' }
    ])
  })

  it('识别 URL 并修剪结尾标点（句号归还给文本）', () => {
    expect(tokenizeBody('详见 https://example.com/a. 谢谢', null)).toEqual([
      { kind: 'text', text: '详见 ' },
      { kind: 'link', text: 'https://example.com/a', url: 'https://example.com/a' },
      { kind: 'text', text: '. 谢谢' }
    ])
  })

  it('URL 内成对括号保留、不成对右括号截掉', () => {
    expect(tokenizeBody('见 https://a.com/x_(y)', null)[1]).toEqual({
      kind: 'link',
      text: 'https://a.com/x_(y)',
      url: 'https://a.com/x_(y)'
    })
    expect(tokenizeBody('(见 https://a.com/x)', null)).toEqual([
      { kind: 'text', text: '(见 ' },
      { kind: 'link', text: 'https://a.com/x', url: 'https://a.com/x' },
      { kind: 'text', text: ')' }
    ])
  })

  it('issue 规则把 #N 替换为链接（$1 占位实例化）', () => {
    const issue = { issue: '#(\\d+)', url: 'https://github.com/x/y/issues/$1' }
    expect(tokenizeBody('fix #42 与 #7', issue)).toEqual([
      { kind: 'text', text: 'fix ' },
      { kind: 'link', text: '#42', url: 'https://github.com/x/y/issues/42' },
      { kind: 'text', text: ' 与 ' },
      { kind: 'link', text: '#7', url: 'https://github.com/x/y/issues/7' }
    ])
  })

  it('URL 与 issue 共存时互不干扰（URL 段不做 issue 匹配）', () => {
    const issue = { issue: '#(\\d+)', url: 'https://t/$1' }
    expect(tokenizeBody('#1 https://a.com/#2 尾', issue)).toEqual([
      { kind: 'link', text: '#1', url: 'https://t/1' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'https://a.com/#2', url: 'https://a.com/#2' },
      { kind: 'text', text: ' 尾' }
    ])
  })

  it('issue 正则非法时安全退化为纯文本', () => {
    expect(tokenizeBody('fix #42', { issue: '#(\\d+', url: 'https://t/$1' })).toEqual([
      { kind: 'text', text: 'fix #42' }
    ])
  })

  it('空正文得到空 token 集', () => {
    expect(tokenizeBody('', null)).toEqual([])
  })
})

/** 快捷构造一个 N 行的 hunk。 */
function hunk(lines: number, sectionHeader = ''): DiffHunk {
  return {
    oldStart: 1,
    oldLines: lines,
    newStart: 1,
    newLines: lines,
    sectionHeader,
    lines: Array.from({ length: lines }, (_, i) => ({
      kind: 'context' as const,
      text: `line ${i}`,
      oldLineNo: i + 1,
      newLineNo: i + 1
    }))
  }
}

describe('countDiffLines / limitDiffHunks', () => {
  it('统计全部 hunk 的行数之和', () => {
    expect(countDiffLines([hunk(3), hunk(5)])).toBe(8)
  })

  it('上限落在 hunk 边界内时截其 lines，且不改原对象', () => {
    const src = [hunk(3), hunk(5)]
    const out = limitDiffHunks(src, 5)
    expect(out).toHaveLength(2)
    expect(out[0].lines).toHaveLength(3)
    expect(out[1].lines).toHaveLength(2)
    expect(src[1].lines).toHaveLength(5)
  })

  it('总行数不超上限时整体保留（hunk 引用不变）', () => {
    const src = [hunk(3)]
    expect(limitDiffHunks(src, DIFF_RENDER_LIMIT)[0]).toBe(src[0])
  })

  it('上限为 0 时得到空集', () => {
    expect(limitDiffHunks([hunk(3)], 0)).toEqual([])
  })
})

describe('formatHunkHeader', () => {
  it('无上下文时输出「@@ -a,b +c,d @@」', () => {
    expect(formatHunkHeader(hunk(3))).toBe('@@ -1,3 +1,3 @@')
  })

  it('有函数上下文时附在 @@ 之后', () => {
    expect(formatHunkHeader(hunk(3, 'function foo()'))).toBe('@@ -1,3 +1,3 @@ function foo()')
  })
})
