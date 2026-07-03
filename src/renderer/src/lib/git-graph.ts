// Git 图谱布局引擎：忠实移植 vscode-git-graph（web/graph.ts）的 Vertex / Branch /
// determinePath / getAvailableColour 布局算法，剥离全部 DOM/SVG 操作，只输出纯数据。
// 消费方：GitCommitTable 渲染图谱层，右键菜单 / 键盘导航使用底部的图查询函数。
// 注意：此处用相对路径而非 @shared 别名 —— vitest.config.ts 未配置别名解析，
// 纯函数模块保持无别名依赖才能被单测直接加载（与 src/main 模块的做法一致）。
import { UNCOMMITTED, type GitCommit } from '../../../shared/git'

// —— 冻结 API 类型（foundation.md §C） ——

/** 图谱网格：x/y 为列宽/行高，offsetX/offsetY 为首列/首行中心偏移，expandY 为详情面板默认撑开高度。 */
export interface GraphGrid {
  x: number
  y: number
  offsetX: number
  offsetY: number
  expandY: number
}

/** 参考实现 config.grid 的默认值（y / offsetY 运行时会被表格实测行高覆盖，见 graph-table.md §1.5）。 */
export const DEFAULT_GRID: GraphGrid = { x: 16, y: 24, offsetX: 16, offsetY: 12, expandY: 250 }

/** 网格坐标点：x = 列号，y = 行号（提交在列表中的下标）。 */
export interface GraphPoint {
  x: number
  y: number
}

/** 布局后的一个提交节点。 */
export interface GraphVertexOut {
  /** 行号（提交下标） */
  id: number
  /** 所在列号 */
  x: number
  /** 调色板下标（0..11，已对调色板长度取模）；未提交行的灰色由调用方特判，不占调色板 */
  colourIdx: number
  /** false = 未提交更改行（灰色虚线渲染） */
  isCommitted: boolean
  /** HEAD 命中行（空心圆样式；恒用 OpenCircleAtTheCheckedOutCommit 语义） */
  isCurrent: boolean
  isStash: boolean
}

/** 布局后的一条分支线束。lockedFirst = 线段锁定首点（拉伸时转弯保持原位），否则锁定末点。 */
export interface GraphBranchOut {
  colourIdx: number
  lines: { p1: GraphPoint; p2: GraphPoint; lockedFirst: boolean; isCommitted: boolean }[]
}

/** 一次完整布局的结果。 */
export interface GitGraphLayout {
  vertices: GraphVertexOut[]
  branches: GraphBranchOut[]
  /** 最大列数（图谱内容宽 = 2*offsetX + (maxColumns-1)*x） */
  maxColumns: number
  /** 每行的下一可用列号（nextX），「分支标签对齐图谱」的行宽联动用 */
  vertexColumns: number[]
}

// —— 内部结构（照抄 graph.ts 的 Branch / Vertex，仅剥离渲染） ——

/** 「父提交不在图内」的哨兵节点 id（graph.ts 的 NULL_VERTEX_ID）。 */
const NULL_VERTEX_ID = -1

/** 调色板长度（main.css 的 --git-graph-color0..11），颜色下标对其取模。 */
const PALETTE_SIZE = 12

interface InternalLine {
  p1: GraphPoint
  p2: GraphPoint
  lockedFirst: boolean
}

/** 某行某列已被占用的连接点：连向哪个节点、属于哪条分支（merge 寻点用）。 */
interface UnavailablePoint {
  connectsTo: Vertex | null
  onBranch: Branch
}

/** 一条布局分支：颜色 + 线段集。 */
class Branch {
  readonly colour: number
  private readonly lines: InternalLine[] = []
  private numUncommitted = 0

  constructor(colour: number) {
    this.colour = colour
  }

  addLine(p1: GraphPoint, p2: GraphPoint, isCommitted: boolean, lockedFirst: boolean): void {
    this.lines.push({ p1, p2, lockedFirst })
    if (isCommitted) {
      // 已提交线段回到第 0 列且行号小于未提交计数时收缩未提交前缀（graph.ts 原逻辑照抄）
      if (p2.x === 0 && p2.y < this.numUncommitted) this.numUncommitted = p2.y
    } else {
      this.numUncommitted++
    }
  }

  /** 导出为冻结 API 的线束：第 i 条线已提交 = i >= numUncommitted（同 Branch.draw）。 */
  toOutput(): GraphBranchOut {
    return {
      colourIdx: this.colour % PALETTE_SIZE,
      lines: this.lines.map((line, i) => ({
        p1: line.p1,
        p2: line.p2,
        lockedFirst: line.lockedFirst,
        isCommitted: i >= this.numUncommitted
      }))
    }
  }
}

/** 一个提交节点，字段语义与 graph.ts Vertex 一一对应。 */
class Vertex {
  readonly id: number
  readonly isStash: boolean
  /** 所在列号（addToBranch 时确定） */
  x = 0
  isCommitted = true
  isCurrent = false

  private readonly children: Vertex[] = []
  private readonly parents: Vertex[] = []
  private nextParent = 0
  private onBranch: Branch | null = null
  /** 本行下一个可用列号 */
  private nextX = 0
  private readonly connections: UnavailablePoint[] = []

  constructor(id: number, isStash: boolean) {
    this.id = id
    this.isStash = isStash
  }

  addChild(vertex: Vertex): void {
    this.children.push(vertex)
  }

  getChildren(): readonly Vertex[] {
    return this.children
  }

  addParent(vertex: Vertex): void {
    this.parents.push(vertex)
  }

  getParents(): readonly Vertex[] {
    return this.parents
  }

  hasParents(): boolean {
    return this.parents.length > 0
  }

  /** 下一个尚未铺设路径的父节点；全部处理完则为 null。 */
  getNextParent(): Vertex | null {
    if (this.nextParent < this.parents.length) return this.parents[this.nextParent]
    return null
  }

  registerParentProcessed(): void {
    this.nextParent++
  }

  isMerge(): boolean {
    return this.parents.length > 1
  }

  /** 只在首次上分支时生效（列号随之固定）。 */
  addToBranch(branch: Branch, x: number): void {
    if (this.onBranch === null) {
      this.onBranch = branch
      this.x = x
    }
  }

  isNotOnBranch(): boolean {
    return this.onBranch === null
  }

  isOnThisBranch(branch: Branch): boolean {
    return this.onBranch === branch
  }

  getBranch(): Branch | null {
    return this.onBranch
  }

  getPoint(): GraphPoint {
    return { x: this.x, y: this.id }
  }

  getNextPoint(): GraphPoint {
    return { x: this.nextX, y: this.id }
  }

  /** 本行是否已有一个连向 vertex（沿 onBranch）的点 —— merge 线合入已有分支的寻点。 */
  getPointConnectingTo(vertex: Vertex | null, onBranch: Branch): GraphPoint | null {
    for (let i = 0; i < this.connections.length; i++) {
      if (this.connections[i].connectsTo === vertex && this.connections[i].onBranch === onBranch) {
        return { x: i, y: this.id }
      }
    }
    return null
  }

  /** 占用本行第 x 列（只在 x 恰为下一可用列时推进，与原实现一致）。 */
  registerUnavailablePoint(x: number, connectsToVertex: Vertex | null, onBranch: Branch): void {
    if (x === this.nextX) {
      this.nextX = x + 1
      this.connections[x] = { connectsTo: connectsToVertex, onBranch }
    }
  }

  getColour(): number {
    return this.onBranch !== null ? this.onBranch.colour : 0
  }
}

// —— 图构建（graph.ts loadCommits + determinePath + getAvailableColour 移植） ——

interface InternalGraph {
  vertices: Vertex[]
  branches: Branch[]
  lookup: Record<string, number>
}

/** 取一个可用颜色：某分支在 startAt 之前已结束则复用其颜色，否则扩展调色板计数。 */
function getAvailableColour(availableColours: number[], startAt: number): number {
  for (let i = 0; i < availableColours.length; i++) {
    if (startAt > availableColours[i]) {
      return i
    }
  }
  availableColours.push(0)
  return availableColours.length - 1
}

/** 从第 startAt 行的下一个未处理父提交出发铺设一条路径（graph.ts determinePath 原样移植）。 */
function determinePath(
  vertices: Vertex[],
  branches: Branch[],
  availableColours: number[],
  startAt: number
): void {
  let i = startAt
  let vertex = vertices[i]
  let parentVertex = vertices[i].getNextParent()
  let lastPoint = vertex.isNotOnBranch() ? vertex.getNextPoint() : vertex.getPoint()

  if (
    parentVertex !== null &&
    parentVertex.id !== NULL_VERTEX_ID &&
    vertex.isMerge() &&
    !vertex.isNotOnBranch() &&
    !parentVertex.isNotOnBranch()
  ) {
    // 合并线：两端都已在分支上 —— 向下逐行寻找已连向父节点的点，途经行占用下一可用列
    let foundPointToParent = false
    const parentBranch = parentVertex.getBranch()!
    for (i = startAt + 1; i < vertices.length; i++) {
      const curVertex = vertices[i]
      let curPoint = curVertex.getPointConnectingTo(parentVertex, parentBranch)
      if (curPoint !== null) {
        foundPointToParent = true
      } else {
        curPoint = curVertex.getNextPoint()
      }
      parentBranch.addLine(
        lastPoint,
        curPoint,
        vertex.isCommitted,
        !foundPointToParent && curVertex !== parentVertex ? lastPoint.x < curPoint.x : true
      )
      curVertex.registerUnavailablePoint(curPoint.x, parentVertex, parentBranch)
      lastPoint = curPoint

      if (foundPointToParent) {
        vertex.registerParentProcessed()
        break
      }
    }
  } else {
    // 普通分支：新建 Branch（颜色可复用），沿第一父链向下延伸
    const branch = new Branch(getAvailableColour(availableColours, startAt))
    vertex.addToBranch(branch, lastPoint.x)
    vertex.registerUnavailablePoint(lastPoint.x, vertex, branch)
    for (i = startAt + 1; i < vertices.length; i++) {
      const curVertex = vertices[i]
      const curPoint =
        parentVertex === curVertex && !parentVertex.isNotOnBranch()
          ? curVertex.getPoint()
          : curVertex.getNextPoint()
      branch.addLine(lastPoint, curPoint, vertex.isCommitted, lastPoint.x < curPoint.x)
      curVertex.registerUnavailablePoint(curPoint.x, parentVertex, branch)
      lastPoint = curPoint

      if (parentVertex === curVertex) {
        // 走到了父提交：推进 vertex / parentVertex，继续沿链向下延伸
        vertex.registerParentProcessed()
        const parentVertexOnBranch = !parentVertex.isNotOnBranch()
        parentVertex.addToBranch(branch, curPoint.x)
        vertex = parentVertex
        parentVertex = vertex.getNextParent()
        if (parentVertex === null || parentVertexOnBranch) {
          // 没有更多父节点，或父节点原本已在其他分支上
          break
        }
      }
    }
    if (i === vertices.length && parentVertex !== null && parentVertex.id === NULL_VERTEX_ID) {
      // 已到图底仍未遇到父提交（父在图外）：视为已处理，线延伸出图
      vertex.registerParentProcessed()
    }
    branches.push(branch)
    availableColours[branch.colour] = i
  }
}

/** 建图 + 布局（graph.ts loadCommits 移植）；查询函数与 computeGraphLayout 共用。 */
function buildGraph(
  commits: GitCommit[],
  headHash: string | null,
  onlyFollowFirstParent: boolean
): InternalGraph {
  const vertices: Vertex[] = []
  const branches: Branch[] = []
  const availableColours: number[] = []
  const lookup: Record<string, number> = {}
  for (let i = 0; i < commits.length; i++) lookup[commits[i].hash] = i
  if (commits.length === 0) return { vertices, branches, lookup }

  const nullVertex = new Vertex(NULL_VERTEX_ID, false)
  for (let i = 0; i < commits.length; i++) {
    vertices.push(new Vertex(i, commits[i].stash !== null))
  }
  for (let i = 0; i < commits.length; i++) {
    for (let j = 0; j < commits[i].parents.length; j++) {
      const parentHash = commits[i].parents[j]
      if (typeof lookup[parentHash] === 'number') {
        vertices[i].addParent(vertices[lookup[parentHash]])
        vertices[lookup[parentHash]].addChild(vertices[i])
      } else if (!onlyFollowFirstParent || j === 0) {
        // 父提交不在图内（未加载 / 被筛掉）：挂哨兵节点，线会一直画到图底；
        // onlyFollowFirstParent 时非首父的缺父直接忽略（与参考实现一致）
        vertices[i].addParent(nullVertex)
      }
    }
  }

  if (commits[0].hash === UNCOMMITTED) {
    vertices[0].isCommitted = false
  }
  // isCurrent 恒用 OpenCircleAtTheCheckedOutCommit 语义：空心圆标在 HEAD 命中行
  if (headHash !== null && typeof lookup[headHash] === 'number') {
    vertices[lookup[headHash]].isCurrent = true
  }

  let i = 0
  while (i < vertices.length) {
    // 同一行会被反复处理直到所有父路径铺完且自身已上分支（merge 有多条父路径）
    if (vertices[i].getNextParent() !== null || vertices[i].isNotOnBranch()) {
      determinePath(vertices, branches, availableColours, i)
    } else {
      i++
    }
  }
  return { vertices, branches, lookup }
}

// —— 冻结 API：布局 ——

/**
 * 计算整幅图谱的布局（列分配、分支线段、颜色）。
 * onlyFollowFirstParent 为可选扩展参数：数据层以 --first-parent 拉取时传 true，
 * 使缺失的非首父不再画通向图底的悬空线（默认 false，与冻结签名调用兼容）。
 */
export function computeGraphLayout(
  commits: GitCommit[],
  headHash: string | null,
  onlyFollowFirstParent = false
): GitGraphLayout {
  const { vertices, branches } = buildGraph(commits, headHash, onlyFollowFirstParent)
  const vertexColumns = vertices.map((v) => v.getNextPoint().x)
  let maxColumns = 0
  for (const columns of vertexColumns) {
    if (columns > maxColumns) maxColumns = columns
  }
  return {
    vertices: vertices.map((v) => ({
      id: v.id,
      x: v.x,
      colourIdx: v.getColour() % PALETTE_SIZE,
      isCommitted: v.isCommitted,
      isCurrent: v.isCurrent,
      isStash: v.isStash
    })),
    branches: branches.map((b) => b.toOutput()),
    maxColumns,
    vertexColumns
  }
}

// —— 冻结 API：像素化（Branch.draw / Vertex.draw 的坐标逻辑，剥离 DOM） ——

interface PlacedLine {
  p1: { x: number; y: number }
  p2: { x: number; y: number }
  isCommitted: boolean
  lockedFirst: boolean
}

/**
 * 把一条分支线束转成 SVG path d 串（rounded 贝塞尔风格）。
 * expandAt = 展开详情面板的行号（-1 = 无展开），expandY = 面板实际高度（拉伸量）。
 * 同一线束内已提交 / 未提交切换会拆成多个 path（着色不同）。
 */
export function buildBranchPaths(
  branch: GraphBranchOut,
  grid: GraphGrid,
  expandAt: number,
  expandY: number
): { d: string; isCommitted: boolean }[] {
  const placed: PlacedLine[] = []

  // 1. 网格坐标 → 像素坐标，处理详情面板撑开（expandAt 行之后整体下移 expandY）
  for (let i = 0; i < branch.lines.length; i++) {
    const line = branch.lines[i]
    const x1 = line.p1.x * grid.x + grid.offsetX
    let y1 = line.p1.y * grid.y + grid.offsetY
    const x2 = line.p2.x * grid.x + grid.offsetX
    let y2 = line.p2.y * grid.y + grid.offsetY

    if (expandAt > -1) {
      if (line.p1.y > expandAt) {
        // 整条线在展开行之后：整体下移
        y1 += expandY
        y2 += expandY
      } else if (line.p2.y > expandAt) {
        if (x1 === x2) {
          // 垂直线跨过展开区：终点顺延
          y2 += expandY
        } else if (line.lockedFirst) {
          // 锁定首点：转弯保持原位，再从转弯终点向下补一段跨过展开区的直线
          placed.push({
            p1: { x: x1, y: y1 },
            p2: { x: x2, y: y2 },
            isCommitted: line.isCommitted,
            lockedFirst: line.lockedFirst
          })
          placed.push({
            p1: { x: x2, y: y1 + grid.y },
            p2: { x: x2, y: y2 + expandY },
            isCommitted: line.isCommitted,
            lockedFirst: line.lockedFirst
          })
          continue
        } else {
          // 锁定末点：先补一段跨过展开区的直线，转弯移到展开区之后
          placed.push({
            p1: { x: x1, y: y1 },
            p2: { x: x1, y: y2 - grid.y + expandY },
            isCommitted: line.isCommitted,
            lockedFirst: line.lockedFirst
          })
          y1 += expandY
          y2 += expandY
        }
      }
    }
    placed.push({
      p1: { x: x1, y: y1 },
      p2: { x: x2, y: y2 },
      isCommitted: line.isCommitted,
      lockedFirst: line.lockedFirst
    })
  }

  // 2. 合并连续的同列直线段（去掉中间点）
  let i = 0
  while (i < placed.length - 1) {
    const line = placed[i]
    const nextLine = placed[i + 1]
    if (
      line.p1.x === line.p2.x &&
      line.p2.x === nextLine.p1.x &&
      nextLine.p1.x === nextLine.p2.x &&
      line.p2.y === nextLine.p1.y &&
      line.isCommitted === nextLine.isCommitted
    ) {
      line.p2.y = nextLine.p2.y
      placed.splice(i + 1, 1)
    } else {
      i++
    }
  }

  // 3. 组装 d 串（坐标格式照抄参考实现：x 取整、y 保留一位小数；转弯用三次贝塞尔）
  const paths: { d: string; isCommitted: boolean }[] = []
  const d = grid.y * 0.8
  let curPath = ''
  for (let j = 0; j < placed.length; j++) {
    const line = placed[j]
    const x1 = line.p1.x
    const y1 = line.p1.y
    const x2 = line.p2.x
    const y2 = line.p2.y

    // 已提交 / 未提交切换：结束当前 path，拆开着色
    if (curPath !== '' && j > 0 && line.isCommitted !== placed[j - 1].isCommitted) {
      paths.push({ d: curPath, isCommitted: placed[j - 1].isCommitted })
      curPath = ''
    }
    // path 尚未开始，或与上一段不相接：移动到 p1
    if (curPath === '' || (j > 0 && (x1 !== placed[j - 1].p2.x || y1 !== placed[j - 1].p2.y))) {
      curPath += 'M' + x1.toFixed(0) + ',' + y1.toFixed(1)
    }
    if (x1 === x2) {
      curPath += 'L' + x2.toFixed(0) + ',' + y2.toFixed(1)
    } else {
      curPath +=
        'C' +
        x1.toFixed(0) +
        ',' +
        (y1 + d).toFixed(1) +
        ' ' +
        x2.toFixed(0) +
        ',' +
        (y2 - d).toFixed(1) +
        ' ' +
        x2.toFixed(0) +
        ',' +
        y2.toFixed(1)
    }
  }
  if (curPath !== '') {
    paths.push({ d: curPath, isCommitted: placed[placed.length - 1].isCommitted })
  }
  return paths
}

/** 计算节点圆心像素坐标；展开行之后的节点整体下移 expandY（expandAt=-1 无展开）。 */
export function vertexPixel(
  v: GraphVertexOut,
  grid: GraphGrid,
  expandAt: number,
  expandY: number
): { cx: number; cy: number } {
  return {
    cx: v.x * grid.x + grid.offsetX,
    cy: v.id * grid.y + grid.offsetY + (expandAt > -1 && v.id > expandAt ? expandY : 0)
  }
}

// —— 冻结 API：图查询（graph.ts 同名方法语义；每次调用重建内部图，量级 ≤ 数百提交可忽略） ——

/**
 * 判断第 index 行的提交能否被 drop：沿其子链向上必须是单链（无合并、无分叉）且终点是 HEAD。
 */
export function dropCommitPossible(
  commits: GitCommit[],
  headHash: string | null,
  index: number,
  onlyFollowFirstParent = false
): boolean {
  const { vertices } = buildGraph(commits, headHash, onlyFollowFirstParent)
  if (!vertices[index].hasParents()) {
    return false // 无父提交（根提交）不能 drop
  }

  // TRUE = 链上找到 HEAD；FALSE = 链到头未见 HEAD；NULL = 拓扑不满足（合并/分叉）
  const isPossible = (v: Vertex): boolean | null => {
    if (v.isMerge()) {
      return null
    }
    const children = v.getChildren()
    if (children.length > 1) {
      return null
    } else if (children.length === 1) {
      const recursivelyPossible = isPossible(children[0])
      if (recursivelyPossible !== false) {
        return recursivelyPossible
      }
    }
    return commits[v.id].hash === headHash
  }

  return isPossible(vertices[index]) || false
}

/**
 * 计算每行是否弱化显示。headHash 传「当前行」hash（有未提交行时为 UNCOMMITTED，否则 HEAD）。
 * 规则 1（muteMerge）：合并提交且非 stash；规则 2（muteNotAncestors）：不是当前行祖先的提交，
 * stash 行以其 baseHash 是否为祖先豁免。
 */
export function getMutedCommits(
  commits: GitCommit[],
  headHash: string | null,
  muteMerge: boolean,
  muteNotAncestors: boolean,
  onlyFollowFirstParent = false
): boolean[] {
  const { vertices, lookup } = buildGraph(commits, headHash, onlyFollowFirstParent)
  const muted: boolean[] = []
  for (let i = 0; i < commits.length; i++) {
    muted[i] = false
  }

  if (muteMerge) {
    for (let i = 0; i < commits.length; i++) {
      if (vertices[i].isMerge() && commits[i].stash === null) {
        muted[i] = true
      }
    }
  }

  if (muteNotAncestors && headHash !== null && typeof lookup[headHash] === 'number') {
    const ancestor: boolean[] = []
    for (let i = 0; i < commits.length; i++) {
      ancestor[i] = false
    }
    // 从当前行沿 parents 递归标记祖先集（含自身）
    const rec = (vertex: Vertex): void => {
      if (vertex.id === NULL_VERTEX_ID || ancestor[vertex.id]) return
      ancestor[vertex.id] = true
      const parents = vertex.getParents()
      for (let i = 0; i < parents.length; i++) rec(parents[i])
    }
    rec(vertices[lookup[headHash]])

    for (let i = 0; i < commits.length; i++) {
      const stash = commits[i].stash
      if (
        !ancestor[i] &&
        (stash === null ||
          typeof lookup[stash.baseHash] !== 'number' ||
          !ancestor[lookup[stash.baseHash]])
      ) {
        muted[i] = true
      }
    }
  }
  return muted
}

/** 第一父提交的行号；无父（或父在图外）为 -1。 */
export function getFirstParentIndex(
  commits: GitCommit[],
  index: number,
  onlyFollowFirstParent = false
): number {
  const { vertices } = buildGraph(commits, null, onlyFollowFirstParent)
  const parents = vertices[index].getParents()
  return parents.length > 0 ? parents[0].id : -1
}

/** 备选父提交的行号：合并提交取第二父，否则退回第一父；无父为 -1。 */
export function getAlternativeParentIndex(
  commits: GitCommit[],
  index: number,
  onlyFollowFirstParent = false
): number {
  const { vertices } = buildGraph(commits, null, onlyFollowFirstParent)
  const parents = vertices[index].getParents()
  return parents.length > 1 ? parents[1].id : parents.length === 1 ? parents[0].id : -1
}

/** 第一子提交的行号：多子时优先同分支的子，否则取行号最大者；无子为 -1。 */
export function getFirstChildIndex(
  commits: GitCommit[],
  index: number,
  onlyFollowFirstParent = false
): number {
  const { vertices } = buildGraph(commits, null, onlyFollowFirstParent)
  const children = vertices[index].getChildren()
  if (children.length > 1) {
    const branch = vertices[index].getBranch()
    let childOnSameBranch: Vertex | undefined
    if (
      branch !== null &&
      (childOnSameBranch = children.find((child) => child.isOnThisBranch(branch)))
    ) {
      return childOnSameBranch.id
    } else {
      return Math.max(...children.map((child) => child.id))
    }
  } else if (children.length === 1) {
    return children[0].id
  } else {
    return -1
  }
}

/** 备选子提交的行号：多子时取「第一子」之外行号最大者；单子取该子；无子为 -1。 */
export function getAlternativeChildIndex(
  commits: GitCommit[],
  index: number,
  onlyFollowFirstParent = false
): number {
  const { vertices } = buildGraph(commits, null, onlyFollowFirstParent)
  const children = vertices[index].getChildren()
  if (children.length > 1) {
    const branch = vertices[index].getBranch()
    let childOnSameBranch: Vertex | undefined
    if (
      branch !== null &&
      (childOnSameBranch = children.find((child) => child.isOnThisBranch(branch)))
    ) {
      return Math.max(
        ...children.filter((child) => child !== childOnSameBranch).map((child) => child.id)
      )
    } else {
      // 照抄参考实现：默认 sort（字典序）后取倒数第二个
      const childIndexes = children.map((child) => child.id).sort()
      return childIndexes[childIndexes.length - 2]
    }
  } else if (children.length === 1) {
    return children[0].id
  } else {
    return -1
  }
}
