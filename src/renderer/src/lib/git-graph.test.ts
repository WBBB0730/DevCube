import { describe, expect, it } from 'vitest'
import { UNCOMMITTED, type GitCommit } from '../../../shared/git'
import {
  DEFAULT_GRID,
  buildBranchPaths,
  computeGraphLayout,
  dropCommitPossible,
  getAlternativeChildIndex,
  getAlternativeParentIndex,
  getFirstChildIndex,
  getFirstParentIndex,
  getMutedCommits,
  vertexPixel,
  type GraphBranchOut
} from './git-graph'

/** 构造一条测试提交（新到旧顺序放入列表，行号即下标）。 */
function commit(hash: string, parents: string[], patch: Partial<GitCommit> = {}): GitCommit {
  return {
    hash,
    parents,
    author: '张三',
    email: 'zhang@example.com',
    date: 1751500000,
    message: `提交 ${hash}`,
    heads: [],
    tags: [],
    remotes: [],
    stash: null,
    ...patch
  }
}

/** stash 伪提交行的 stash 字段样本。 */
function stashInfo(baseHash: string): GitCommit['stash'] {
  return { selector: 'refs/stash@{0}', baseHash, untrackedFilesHash: null }
}

// 常用提交集
const linear = [commit('c0', ['c1']), commit('c1', ['c2']), commit('c2', [])]
const fork = [commit('c0', ['c2']), commit('c1', ['c2']), commit('c2', [])]
// 合并已被加载的独立分支（第二父 c2 在合并时尚未上分支 → 新建分支）
const mergeNewBranch = [
  commit('m0', ['c1', 'c2']),
  commit('c1', ['c3']),
  commit('c2', ['c3']),
  commit('c3', [])
]
// 合并到已有分支（第二父 c3 已在第一父链的分支上 → 走寻点逻辑，不新建分支）
const mergeIntoExisting = [
  commit('m0', ['c1', 'c3']),
  commit('c1', ['c2']),
  commit('c2', ['c3']),
  commit('c3', [])
]

describe('computeGraphLayout', () => {
  it('空提交列表返回全空布局', () => {
    expect(computeGraphLayout([], null)).toEqual({
      vertices: [],
      branches: [],
      maxColumns: 0,
      vertexColumns: []
    })
  })

  it('单个根提交占第 0 列，分支无线段', () => {
    const layout = computeGraphLayout([commit('c0', [])], 'c0')
    expect(layout.vertices).toEqual([
      { id: 0, x: 0, colourIdx: 0, isCommitted: true, isCurrent: true, isStash: false }
    ])
    expect(layout.branches).toHaveLength(1)
    expect(layout.branches[0].lines).toEqual([])
    expect(layout.maxColumns).toBe(1)
    expect(layout.vertexColumns).toEqual([1])
  })

  it('线性历史全部落在第 0 列，一条分支两段线', () => {
    const layout = computeGraphLayout(linear, 'c0')
    expect(layout.vertices.map((v) => v.x)).toEqual([0, 0, 0])
    expect(layout.vertices.map((v) => v.colourIdx)).toEqual([0, 0, 0])
    expect(layout.branches).toHaveLength(1)
    expect(layout.branches[0].lines).toEqual([
      { p1: { x: 0, y: 0 }, p2: { x: 0, y: 1 }, lockedFirst: false, isCommitted: true },
      { p1: { x: 0, y: 1 }, p2: { x: 0, y: 2 }, lockedFirst: false, isCommitted: true }
    ])
    expect(layout.maxColumns).toBe(1)
    expect(layout.vertexColumns).toEqual([1, 1, 1])
  })

  it('HEAD 命中的行标记 isCurrent', () => {
    const layout = computeGraphLayout(linear, 'c1')
    expect(layout.vertices.map((v) => v.isCurrent)).toEqual([false, true, false])
  })

  it('单分叉：第二条链占第 1 列并用第 1 号颜色，斜线汇入共同父提交', () => {
    const layout = computeGraphLayout(fork, 'c1')
    expect(layout.vertices.map((v) => v.x)).toEqual([0, 1, 0])
    expect(layout.vertices.map((v) => v.colourIdx)).toEqual([0, 1, 0])
    expect(layout.branches).toHaveLength(2)
    expect(layout.branches[1].colourIdx).toBe(1)
    expect(layout.branches[1].lines).toEqual([
      { p1: { x: 1, y: 1 }, p2: { x: 0, y: 2 }, lockedFirst: false, isCommitted: true }
    ])
    expect(layout.maxColumns).toBe(2)
    expect(layout.vertexColumns).toEqual([1, 2, 1])
  })

  it('合并未上分支的第二父：新建分支绕经第 1 列再汇回', () => {
    const layout = computeGraphLayout(mergeNewBranch, 'm0')
    expect(layout.vertices.map((v) => v.x)).toEqual([0, 0, 1, 0])
    expect(layout.vertices.map((v) => v.colourIdx)).toEqual([0, 0, 1, 0])
    expect(layout.branches).toHaveLength(2)
    expect(layout.branches[1].lines).toEqual([
      { p1: { x: 0, y: 0 }, p2: { x: 1, y: 1 }, lockedFirst: true, isCommitted: true },
      { p1: { x: 1, y: 1 }, p2: { x: 1, y: 2 }, lockedFirst: false, isCommitted: true },
      { p1: { x: 1, y: 2 }, p2: { x: 0, y: 3 }, lockedFirst: false, isCommitted: true }
    ])
  })

  it('合并到已有分支：寻点汇入原分支，不新建分支，合并线并入其线束', () => {
    const layout = computeGraphLayout(mergeIntoExisting, 'm0')
    expect(layout.branches).toHaveLength(1)
    expect(layout.vertices.map((v) => v.x)).toEqual([0, 0, 0, 0])
    // 合并线经第 1 列绕行：起段锁定首点，汇入已注册点的末段也锁定首点
    expect(layout.branches[0].lines[3]).toEqual({
      p1: { x: 0, y: 0 },
      p2: { x: 1, y: 1 },
      lockedFirst: true,
      isCommitted: true
    })
    expect(layout.branches[0].lines[5]).toEqual({
      p1: { x: 1, y: 2 },
      p2: { x: 0, y: 3 },
      lockedFirst: true,
      isCommitted: true
    })
    expect(layout.vertexColumns).toEqual([1, 2, 2, 1])
    expect(layout.maxColumns).toBe(2)
  })

  it('未提交更改行 isCommitted=false 且不标 isCurrent，HEAD 行标 isCurrent', () => {
    const commits = [commit(UNCOMMITTED, ['c1']), commit('c1', ['c2']), commit('c2', [])]
    const layout = computeGraphLayout(commits, 'c1')
    expect(layout.vertices[0].isCommitted).toBe(false)
    expect(layout.vertices[0].isCurrent).toBe(false)
    expect(layout.vertices[1].isCurrent).toBe(true)
  })

  it('未提交行到 HEAD 的线段 isCommitted=false，其后的线段恢复 true', () => {
    const commits = [commit(UNCOMMITTED, ['c1']), commit('c1', ['c2']), commit('c2', [])]
    const layout = computeGraphLayout(commits, 'c1')
    expect(layout.branches[0].lines.map((l) => l.isCommitted)).toEqual([false, true])
  })

  it('stash 伪提交行标记 isStash 并按普通节点布局', () => {
    const commits = [
      commit('c0', ['c2']),
      commit('s1', ['c2'], { stash: stashInfo('c2') }),
      commit('c2', [])
    ]
    const layout = computeGraphLayout(commits, 'c0')
    expect(layout.vertices[1].isStash).toBe(true)
    expect(layout.vertices.map((v) => v.x)).toEqual([0, 1, 0])
  })

  it('父提交不在列表中时画通向图底的悬空线（独占一条分支）', () => {
    const commits = [commit('m0', ['c1', 'gone']), commit('c1', [])]
    const layout = computeGraphLayout(commits, 'm0')
    expect(layout.branches).toHaveLength(2)
    expect(layout.branches[1].lines).toEqual([
      { p1: { x: 0, y: 0 }, p2: { x: 1, y: 1 }, lockedFirst: true, isCommitted: true }
    ])
  })

  it('onlyFollowFirstParent 时缺失的非首父被忽略，不再画悬空线', () => {
    const commits = [commit('m0', ['c1', 'gone']), commit('c1', [])]
    const layout = computeGraphLayout(commits, 'm0', true)
    expect(layout.branches).toHaveLength(1)
    expect(layout.maxColumns).toBe(1)
  })

  it('分支结束后其颜色与列可被之后的独立链复用', () => {
    const twoChains = [
      commit('a0', ['a1']),
      commit('a1', []),
      commit('b0', ['b1']),
      commit('b1', [])
    ]
    const layout = computeGraphLayout(twoChains, 'a0')
    expect(layout.vertices.map((v) => v.x)).toEqual([0, 0, 0, 0])
    expect(layout.vertices.map((v) => v.colourIdx)).toEqual([0, 0, 0, 0])
    expect(layout.branches).toHaveLength(2)
    expect(layout.branches[1].colourIdx).toBe(0)
    expect(layout.maxColumns).toBe(1)
  })
})

describe('buildBranchPaths', () => {
  it('连续的同列直线段合并为一条 L 路径', () => {
    const layout = computeGraphLayout(linear, 'c0')
    const paths = buildBranchPaths(layout.branches[0], DEFAULT_GRID, -1, DEFAULT_GRID.expandY)
    expect(paths).toEqual([{ d: 'M16,12.0L16,60.0', isCommitted: true }])
  })

  it('斜线段生成三次贝塞尔转弯（控制点偏移 grid.y*0.8，x 取整 y 一位小数）', () => {
    const layout = computeGraphLayout(fork, 'c1')
    const paths = buildBranchPaths(layout.branches[1], DEFAULT_GRID, -1, DEFAULT_GRID.expandY)
    expect(paths).toEqual([{ d: 'M32,36.0C32,55.2 16,40.8 16,60.0', isCommitted: true }])
  })

  it('合并到已有分支的线束：主干合并成直线，合并线不相接处补 M 起笔', () => {
    const layout = computeGraphLayout(mergeIntoExisting, 'm0')
    const paths = buildBranchPaths(layout.branches[0], DEFAULT_GRID, -1, DEFAULT_GRID.expandY)
    expect(paths).toEqual([
      {
        d: 'M16,12.0L16,84.0M16,12.0C16,31.2 32,16.8 32,36.0L32,60.0C32,79.2 16,64.8 16,84.0',
        isCommitted: true
      }
    ])
  })

  it('已提交与未提交线段切换处拆成两个 path', () => {
    const commits = [commit(UNCOMMITTED, ['c1']), commit('c1', ['c2']), commit('c2', [])]
    const layout = computeGraphLayout(commits, 'c1')
    const paths = buildBranchPaths(layout.branches[0], DEFAULT_GRID, -1, DEFAULT_GRID.expandY)
    expect(paths).toEqual([
      { d: 'M16,12.0L16,36.0', isCommitted: false },
      { d: 'M16,36.0L16,60.0', isCommitted: true }
    ])
  })

  it('展开拉伸：跨过展开行的垂直线终点顺延，之后的线整体下移', () => {
    const branch: GraphBranchOut = {
      colourIdx: 0,
      lines: [
        { p1: { x: 0, y: 0 }, p2: { x: 0, y: 1 }, lockedFirst: false, isCommitted: true },
        { p1: { x: 0, y: 1 }, p2: { x: 0, y: 2 }, lockedFirst: false, isCommitted: true }
      ]
    }
    const paths = buildBranchPaths(branch, DEFAULT_GRID, 0, 100)
    expect(paths).toEqual([{ d: 'M16,12.0L16,160.0', isCommitted: true }])
  })

  it('展开拉伸：锁定首点的斜线保持转弯原位，再补一段跨越展开区的直线', () => {
    const branch: GraphBranchOut = {
      colourIdx: 0,
      lines: [{ p1: { x: 0, y: 0 }, p2: { x: 1, y: 1 }, lockedFirst: true, isCommitted: true }]
    }
    const paths = buildBranchPaths(branch, DEFAULT_GRID, 0, 100)
    expect(paths).toEqual([{ d: 'M16,12.0C16,31.2 32,16.8 32,36.0L32,136.0', isCommitted: true }])
  })

  it('展开拉伸：锁定末点的斜线先直线跨越展开区，转弯移到展开区之后', () => {
    const branch: GraphBranchOut = {
      colourIdx: 0,
      lines: [{ p1: { x: 0, y: 0 }, p2: { x: 1, y: 1 }, lockedFirst: false, isCommitted: true }]
    }
    const paths = buildBranchPaths(branch, DEFAULT_GRID, 0, 100)
    expect(paths).toEqual([
      { d: 'M16,12.0L16,112.0C16,131.2 32,116.8 32,136.0', isCommitted: true }
    ])
  })
})

describe('vertexPixel', () => {
  const vertex = { id: 2, x: 1, colourIdx: 0, isCommitted: true, isCurrent: false, isStash: false }

  it('无展开时按网格换算圆心坐标', () => {
    expect(vertexPixel(vertex, DEFAULT_GRID, -1, DEFAULT_GRID.expandY)).toEqual({ cx: 32, cy: 60 })
  })

  it('位于展开行之后的节点整体下移 expandY', () => {
    expect(vertexPixel(vertex, DEFAULT_GRID, 1, 250)).toEqual({ cx: 32, cy: 310 })
  })

  it('展开行自身及之前的节点不下移', () => {
    expect(vertexPixel(vertex, DEFAULT_GRID, 2, 250)).toEqual({ cx: 32, cy: 60 })
  })
})

describe('dropCommitPossible', () => {
  it('单链且子链终点是 HEAD 的提交可以 drop', () => {
    expect(dropCommitPossible(linear, 'c0', 1)).toBe(true)
  })

  it('HEAD 不在其子链上的提交不能 drop', () => {
    expect(dropCommitPossible(linear, 'c2', 1)).toBe(false)
  })

  it('根提交（无父）不能 drop', () => {
    expect(dropCommitPossible(linear, 'c0', 2)).toBe(false)
  })

  it('子链上存在合并提交时不能 drop', () => {
    expect(dropCommitPossible(mergeNewBranch, 'm0', 1)).toBe(false)
  })

  it('有多个子提交（分叉点）不能 drop', () => {
    expect(dropCommitPossible(fork, 'c0', 2)).toBe(false)
  })
})

describe('getMutedCommits', () => {
  it('muteMerge 弱化合并提交，非合并行不受影响', () => {
    expect(getMutedCommits(mergeNewBranch, 'm0', true, false)).toEqual([true, false, false, false])
  })

  it('stash 行即使有多个父也不按合并弱化', () => {
    const commits = [
      commit('s0', ['c1', 'c2'], { stash: stashInfo('c1') }),
      commit('c1', []),
      commit('c2', [])
    ]
    expect(getMutedCommits(commits, 'c1', true, false)).toEqual([false, false, false])
  })

  it('muteNotAncestors 弱化不是当前行祖先的提交', () => {
    expect(getMutedCommits(fork, 'c0', false, true)).toEqual([false, true, false])
  })

  it('stash 行的 baseHash 是祖先时豁免弱化', () => {
    const commits = [
      commit('c0', ['c2']),
      commit('s1', ['c2'], { stash: stashInfo('c2') }),
      commit('c2', [])
    ]
    expect(getMutedCommits(commits, 'c0', false, true)).toEqual([false, false, false])
  })

  it('传入未提交行 hash 时以未提交行为基准计算祖先', () => {
    const commits = [commit(UNCOMMITTED, ['c1']), commit('c1', ['c2']), commit('c2', [])]
    expect(getMutedCommits(commits, UNCOMMITTED, false, true)).toEqual([false, false, false])
  })

  it('headHash 为 null 或不在列表中时祖先规则不生效', () => {
    expect(getMutedCommits(fork, null, false, true)).toEqual([false, false, false])
    expect(getMutedCommits(fork, 'gone', false, true)).toEqual([false, false, false])
  })

  it('两个开关都关闭时全部不弱化', () => {
    expect(getMutedCommits(mergeNewBranch, 'm0', false, false)).toEqual([
      false,
      false,
      false,
      false
    ])
  })
})

describe('getFirstParentIndex', () => {
  it('返回第一父提交的行号，根提交返回 -1', () => {
    expect(getFirstParentIndex(linear, 0)).toBe(1)
    expect(getFirstParentIndex(linear, 2)).toBe(-1)
  })

  it('第一父不在列表中时返回 -1（哨兵节点 id）', () => {
    expect(getFirstParentIndex([commit('c0', ['gone'])], 0)).toBe(-1)
  })
})

describe('getAlternativeParentIndex', () => {
  it('合并提交返回第二父的行号', () => {
    expect(getAlternativeParentIndex(mergeNewBranch, 0)).toBe(2)
  })

  it('单父提交退回第一父，根提交返回 -1', () => {
    expect(getAlternativeParentIndex(linear, 0)).toBe(1)
    expect(getAlternativeParentIndex(linear, 2)).toBe(-1)
  })

  it('onlyFollowFirstParent 时缺失的第二父被忽略，退回第一父', () => {
    const commits = [commit('m0', ['c1', 'gone']), commit('c1', [])]
    expect(getAlternativeParentIndex(commits, 0)).toBe(-1)
    expect(getAlternativeParentIndex(commits, 0, true)).toBe(1)
  })
})

describe('getFirstChildIndex', () => {
  it('多个子提交时优先返回同分支的子提交', () => {
    expect(getFirstChildIndex(fork, 2)).toBe(0)
  })

  it('单个子提交直接返回其行号，无子返回 -1', () => {
    expect(getFirstChildIndex(linear, 2)).toBe(1)
    expect(getFirstChildIndex(linear, 0)).toBe(-1)
  })
})

describe('getAlternativeChildIndex', () => {
  it('多个子提交时返回同分支子之外行号最大者', () => {
    expect(getAlternativeChildIndex(fork, 2)).toBe(1)
  })

  it('单个子提交直接返回其行号，无子返回 -1', () => {
    expect(getAlternativeChildIndex(linear, 2)).toBe(1)
    expect(getAlternativeChildIndex(linear, 0)).toBe(-1)
  })
})
