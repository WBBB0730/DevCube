// buildMenuItems / groupMenuItems / matchIssues 的纯函数测试：构造小提交集与上下文，
// 断言菜单结构（文案、可见性、checked 态）与点击产生的请求（记录式动作出口，零 mock）。
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GIT_REPO_SETTINGS,
  DEFAULT_GIT_VIEW_PREFS,
  UNCOMMITTED,
  type GitAction,
  type GitCommit,
  type GitRepoSettings
} from '@shared/git'
import {
  buildMenuItems,
  groupMenuItems,
  matchIssues,
  type GitMenuContext,
  type GitMenuItem
} from './GitContextMenu'
import type { GitDialogRequest, GitMenuTarget } from './git-view-types'

function commit(hash: string, parents: string[], extra: Partial<GitCommit> = {}): GitCommit {
  return {
    hash,
    parents,
    author: '张三',
    email: 'a@b.c',
    date: 1700000000,
    message: `提交 ${hash}`,
    heads: [],
    tags: [],
    remotes: [],
    stash: null,
    ...extra
  }
}

interface Recorded {
  ctx: GitMenuContext
  ran: GitAction[]
  opened: GitDialogRequest[]
  copied: string[]
  filters: (string[] | null)[]
  patches: Partial<GitRepoSettings>[]
  externals: string[]
  paths: string[]
  diffs: { from: string; to: string }[]
}

/** 记录式上下文：动作出口只往数组里记（构造输入 → 断言输出，不需要 mock 框架）。 */
function makeCtx(overrides: Partial<GitMenuContext> = {}): Recorded {
  const rec: Recorded = {
    ran: [],
    opened: [],
    copied: [],
    filters: [],
    patches: [],
    externals: [],
    paths: [],
    diffs: [],
    ctx: null as unknown as GitMenuContext
  }
  rec.ctx = {
    projectPath: '/repo',
    commits: [],
    headHash: null,
    currentBranch: null,
    remotes: [],
    branches: [],
    branchFilter: null,
    settings: DEFAULT_GIT_REPO_SETTINGS,
    viewPrefs: DEFAULT_GIT_VIEW_PREFS,
    actions: {
      runAction: (action) => rec.ran.push(action),
      openDialog: (req) => rec.opened.push(req),
      setBranchFilter: (b) => rec.filters.push(b),
      updateSettings: (p) => rec.patches.push(p),
      openDiff: (_f, from, to) => rec.diffs.push({ from, to }),
      copyText: (text) => rec.copied.push(text),
      openExternal: (url) => rec.externals.push(url),
      openPath: (p) => rec.paths.push(p)
    },
    ...overrides
  }
  return rec
}

function titles(items: (GitMenuItem | 'divider')[]): string[] {
  return items.filter((i): i is GitMenuItem => i !== 'divider').map((i) => i.title)
}

function click(items: (GitMenuItem | 'divider')[], title: string): void {
  const item = items.find((i) => i !== 'divider' && i.title === title) as GitMenuItem | undefined
  expect(item).toBeDefined()
  item!.onClick()
}

/** 线性历史：c2（HEAD）→ c1 → c0（根）。 */
function linearCtx(overrides: Partial<GitMenuContext> = {}): Recorded {
  return makeCtx({
    commits: [commit('c2', ['c1']), commit('c1', ['c0']), commit('c0', [])],
    headHash: 'c2',
    ...overrides
  })
}

describe('buildMenuItems', () => {
  it('提交菜单：线性历史中间提交可丢弃，包含全部固定项', () => {
    const rec = linearCtx()
    const items = buildMenuItems({ kind: 'commit', hash: 'c1' }, rec.ctx)
    expect(titles(items)).toEqual([
      '添加标签…',
      '创建分支…',
      '检出提交…',
      '拣选提交…',
      '回滚提交…',
      '丢弃提交…',
      '合并到当前分支…',
      '将当前分支变基到此提交…',
      '将当前分支重置到此提交…',
      '复制提交哈希',
      '复制提交说明'
    ])
  })

  it('提交菜单：根提交（无父）不显示丢弃提交', () => {
    const rec = linearCtx()
    const items = buildMenuItems({ kind: 'commit', hash: 'c0' }, rec.ctx)
    expect(titles(items)).not.toContain('丢弃提交…')
  })

  it('提交菜单：勾选过「总是允许」后检出提交无省略号且直接执行', () => {
    const rec = linearCtx({
      viewPrefs: { ...DEFAULT_GIT_VIEW_PREFS, alwaysAcceptCheckoutCommit: true }
    })
    const items = buildMenuItems({ kind: 'commit', hash: 'c1' }, rec.ctx)
    expect(titles(items)).toContain('检出提交')
    click(items, '检出提交')
    expect(rec.ran).toEqual([{ kind: 'checkout-commit', hash: 'c1' }])
    expect(rec.opened).toHaveLength(0)
  })

  it('提交菜单：复制提交说明只取消息首行', () => {
    const rec = makeCtx({
      commits: [commit('c9', [], { message: '主题行\n正文第二行' })],
      headHash: 'c9'
    })
    const items = buildMenuItems({ kind: 'commit', hash: 'c9' }, rec.ctx)
    click(items, '复制提交说明')
    expect(rec.copied).toEqual(['主题行'])
  })

  it('本地分支菜单：当前分支隐藏检出/删除/合并/变基四项', () => {
    const rec = linearCtx({ currentBranch: 'main', branches: ['main'] })
    const got = titles(buildMenuItems({ kind: 'branch', name: 'main', hash: 'c2' }, rec.ctx))
    expect(got).toEqual(['重命名分支…', '在分支下拉中选中', '复制分支名'])
  })

  it('本地分支菜单：非当前分支 + 有远程时项齐全，删除请求携带含同名分支的远程', () => {
    const rec = linearCtx({
      currentBranch: 'main',
      remotes: ['origin', 'up'],
      branches: ['main', 'dev', 'remotes/origin/dev']
    })
    const items = buildMenuItems({ kind: 'branch', name: 'dev', hash: 'c1' }, rec.ctx)
    expect(titles(items)).toEqual([
      '检出分支',
      '重命名分支…',
      '删除分支…',
      '合并到当前分支…',
      '将当前分支变基到该分支…',
      '推送分支…',
      '在分支下拉中选中',
      '复制分支名'
    ])
    click(items, '删除分支…')
    expect(rec.opened).toEqual([
      { kind: 'delete-branch', branch: 'dev', remotesWithBranch: ['origin'] }
    ])
  })

  it('本地分支菜单：已在分支筛选中时显示「取消选中」，点击后从筛选移除并回落 null', () => {
    const rec = linearCtx({ currentBranch: 'main', branchFilter: ['dev'] })
    const items = buildMenuItems({ kind: 'branch', name: 'dev', hash: 'c1' }, rec.ctx)
    expect(titles(items)).toContain('在分支下拉中取消选中')
    click(items, '在分支下拉中取消选中')
    expect(rec.filters).toEqual([null])
  })

  it('本地分支菜单：issue 规则匹配单个 issue 时直接打开外部链接', () => {
    const rec = linearCtx({
      settings: {
        ...DEFAULT_GIT_REPO_SETTINGS,
        issueLinkingConfig: { issue: '#(\\d+)', url: 'https://x/i/$1' }
      }
    })
    const items = buildMenuItems({ kind: 'branch', name: 'fix-#42', hash: 'c1' }, rec.ctx)
    expect(titles(items)).toContain('查看 Issue')
    click(items, '查看 Issue')
    expect(rec.externals).toEqual(['https://x/i/42'])
  })

  it('远程分支菜单：孤儿远程 ref（remote=null）隐藏删除/获取/拉取', () => {
    const rec = linearCtx()
    const target: GitMenuTarget = {
      kind: 'remote-branch',
      fullRef: 'gone/dev',
      remote: null,
      hash: 'c1'
    }
    expect(titles(buildMenuItems(target, rec.ctx))).toEqual([
      '检出分支…',
      '合并到当前分支…',
      '在分支下拉中选中',
      '复制分支名'
    ])
  })

  it('远程分支菜单：同名本地分支存在且非当前分支时显示「获取到本地分支…」', () => {
    const rec = linearCtx({
      currentBranch: 'main',
      remotes: ['origin'],
      branches: ['main', 'dev', 'remotes/origin/dev']
    })
    const target: GitMenuTarget = {
      kind: 'remote-branch',
      fullRef: 'origin/dev',
      remote: 'origin',
      hash: 'c1'
    }
    const items = buildMenuItems(target, rec.ctx)
    expect(titles(items)).toContain('获取到本地分支…')
    click(items, '在分支下拉中选中')
    expect(rec.filters).toEqual([['remotes/origin/dev']])
  })

  it('标签菜单：轻量标签无「查看详情」，无远程时无「推送标签…」', () => {
    const rec = linearCtx()
    const target: GitMenuTarget = { kind: 'tag', name: 'v1', annotated: false, hash: 'c1' }
    expect(titles(buildMenuItems(target, rec.ctx))).toEqual(['删除标签…', '复制标签名'])
  })

  it('stash 菜单：复制贮藏名给完整 selector、复制贮藏哈希给提交 hash', () => {
    const stash = { selector: 'refs/stash@{0}', baseHash: 'c1', untrackedFilesHash: null }
    const rec = linearCtx()
    const items = buildMenuItems({ kind: 'stash', hash: 's0', stash }, rec.ctx)
    click(items, '复制贮藏名')
    click(items, '复制贮藏哈希')
    expect(rec.copied).toEqual(['refs/stash@{0}', 's0'])
  })

  it('未提交更改行菜单：贮藏 / 重置 / 清理三项（源代码管理视图已删除）', () => {
    const rec = makeCtx({ commits: [commit(UNCOMMITTED, ['c2'])] })
    expect(titles(buildMenuItems({ kind: 'uncommitted' }, rec.ctx))).toEqual([
      '贮藏未提交的更改…',
      '重置未提交的更改…',
      '清理未跟踪文件…'
    ])
  })

  it('表头菜单：默认排序 date 项打勾，点击拓扑排序写入设置', () => {
    const rec = linearCtx()
    const items = buildMenuItems({ kind: 'header' }, rec.ctx)
    const checked = items
      .filter((i): i is GitMenuItem => i !== 'divider')
      .map((i) => [i.title, i.checked])
    expect(checked).toEqual([
      ['按提交时间排序', true],
      ['按作者时间排序', false],
      ['拓扑排序', false]
    ])
    click(items, '拓扑排序')
    expect(rec.patches).toEqual([{ commitOrdering: 'topo' }])
  })

  it('文件行菜单：已删除文件无「打开文件」，比较模式无「重置到此版本」', () => {
    const rec = linearCtx()
    const target: GitMenuTarget = {
      kind: 'file',
      file: { oldFilePath: 'a.ts', newFilePath: 'a.ts', type: 'D', additions: 0, deletions: 3 },
      fromHash: 'c0', // c0 不是 c2 的父提交 → 比较模式
      toHash: 'c2',
      isUncommitted: false
    }
    const got = titles(buildMenuItems(target, rec.ctx))
    expect(got).not.toContain('打开文件')
    expect(got).not.toContain('将文件重置到此版本…')
    expect(got).toContain('查看差异')
  })

  it('文件行菜单：详情模式的普通文件包含对比工作区与重置到此版本，路径复制齐全', () => {
    const rec = linearCtx()
    const target: GitMenuTarget = {
      kind: 'file',
      file: { oldFilePath: 'a.ts', newFilePath: 'a.ts', type: 'M', additions: 1, deletions: 2 },
      fromHash: 'c1', // c1 是 c2 的父提交 → 详情模式
      toHash: 'c2',
      isUncommitted: false
    }
    const items = buildMenuItems(target, rec.ctx)
    expect(titles(items)).toEqual([
      '查看差异',
      '与工作区文件对比',
      '打开文件',
      '将文件重置到此版本…',
      '复制文件绝对路径',
      '复制文件相对路径'
    ])
    click(items, '与工作区文件对比')
    expect(rec.diffs).toEqual([{ from: 'c2', to: UNCOMMITTED }])
    click(items, '复制文件绝对路径')
    expect(rec.copied).toEqual(['/repo/a.ts'])
  })
})

describe('groupMenuItems', () => {
  it('连续分隔符与首尾分隔符产生的空组全部丢弃', () => {
    const a: GitMenuItem = { title: 'a', onClick: () => {} }
    const b: GitMenuItem = { title: 'b', onClick: () => {} }
    expect(groupMenuItems(['divider', a, 'divider', 'divider', b, 'divider'])).toEqual([[a], [b]])
  })

  it('空输入返回空数组（整个菜单不弹出）', () => {
    expect(groupMenuItems([])).toEqual([])
  })
})

describe('matchIssues', () => {
  it('多处匹配各产出一条，URL 回填捕获组', () => {
    expect(matchIssues('fix-#1-and-#22', { issue: '#(\\d+)', url: 'https://x/$1' })).toEqual([
      { text: '#1', url: 'https://x/1' },
      { text: '#22', url: 'https://x/22' }
    ])
  })

  it('规则为 null 或正则非法时返回空列表', () => {
    expect(matchIssues('#1', null)).toEqual([])
    expect(matchIssues('#1', { issue: '([', url: 'x' })).toEqual([])
  })
})
