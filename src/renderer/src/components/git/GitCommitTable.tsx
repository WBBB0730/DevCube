// Git 提交表格 + 图谱 SVG 层（graph-table 规格）：行渲染、refs 标签、交互分发到 git-store。
// 图谱由布局引擎（@renderer/lib/git-graph，API 冻结）输出纯数据后一次性画成 SVG，
// 绝对定位盖在表格上并以 pointer-events:none 穿透（仅节点圆可 hover，与行高亮联动）；
// 渲染后用实测行高回填 grid（graph-table §1.5，坑 1），避免字体/缩放误差让线与行错位。
// 已知取舍（v1）：只做自动布局（无列宽拖拽与列显隐持久化）、refs 标签固定 Normal 对齐、
// 消息列不做 emoji / issue 链接 / 行内 markdown（TextFormatter 后续补）、无 vertex refs tooltip。
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Archive, GitBranch, Tag } from 'lucide-react'
import { UNCOMMITTED, type GitCommit, type GitCommitRemote } from '@shared/git'
import {
  DEFAULT_GRID,
  buildBranchPaths,
  computeGraphLayout,
  getMutedCommits,
  vertexPixel,
  type GraphGrid
} from '@renderer/lib/git-graph'
import { gitState, useGit } from '@renderer/git-store'
import { cn } from '@renderer/lib/utils'
import { abbrevHash, formatDateTime, formatRelativeTime } from './git-format'
import type { GitMenuTarget } from './git-view-types'

/** 调色板 CSS 变量引用（下标即 --git-graph-colorN，共 12 色循环）。 */
const PALETTE = Array.from({ length: 12 }, (_, i) => `var(--git-graph-color${i})`)

/** 行级 data-color → --git-graph-color 的映射规则（graph-table §2.1 机制），组件内注入一次。 */
const DATA_COLOR_CSS = Array.from(
  { length: 12 },
  (_, i) => `[data-color='${i}']{--git-graph-color:var(--git-graph-color${i})}`
).join('')

// 表头 30px（18 行高 + 6px 上下 padding）+ 1px 下边框；数据行 24px（leading-6，无纵向 padding），
// 与 grid.y 的默认 24 对齐（此后仍以实测回填校准）。
const TH =
  'overflow-hidden whitespace-nowrap border-b border-[color:var(--border-input)] px-3 py-1.5 text-left text-[12px] font-normal leading-[18px] text-muted-foreground'
const TD = 'overflow-hidden text-ellipsis whitespace-nowrap px-1 text-[13px] leading-6'
// refs 标签外壳：18px 高、圆角 4px、图标块反白挖空（graph-table §10 映射到 DevCube token）
const REF =
  'mr-[5px] inline-flex h-[18px] shrink-0 cursor-default items-center overflow-hidden rounded border border-[color:var(--border-input)] bg-panel text-[12px] leading-[18px]'
const REF_ICON = 'flex h-full w-[18px] shrink-0 items-center justify-center'
const REF_NAME = 'px-[5px]'

/** 合并型分支标签：本地分支名 + 并入的远程名徽标。 */
interface BranchLabel {
  name: string
  remotes: string[]
}

/**
 * 本地/远程分支标签合并（graph-table §2.2，combine 恒开）：remote ref 去掉远程前缀后
 * 与本地分支同名则并入其徽标，否则保留为独立远程标签；所属远程未知（remote=null）的恒独立。
 */
function getBranchLabels(
  heads: string[],
  remotes: GitCommitRemote[]
): { branchLabels: BranchLabel[]; remoteLabels: GitCommitRemote[] } {
  const branchLabels = heads.map((name) => ({ name, remotes: [] as string[] }))
  const byName = new Map(branchLabels.map((l) => [l.name, l]))
  const remoteLabels: GitCommitRemote[] = []
  for (const r of remotes) {
    if (r.remote !== null) {
      const local = byName.get(r.name.substring(r.remote.length + 1))
      if (local) {
        local.remotes.push(r.remote)
        continue
      }
    }
    remoteLabels.push(r)
  }
  return { branchLabels, remoteLabels }
}

/** 行事件处理集（父组件 useMemo 一份稳定引用，供 memo 行组件共用）。 */
interface RowActions {
  rowClick: (e: React.MouseEvent, commit: GitCommit) => void
  rowContextMenu: (e: React.MouseEvent, commit: GitCommit) => void
  refClick: (e: React.MouseEvent) => void
  branchDoubleClick: (e: React.MouseEvent, name: string) => void
  remoteDoubleClick: (e: React.MouseEvent, fullRef: string, remote: string | null) => void
  refContextMenu: (e: React.MouseEvent, target: GitMenuTarget) => void
}

/** 提交表格（含图谱 SVG 与「加载更多」页脚）；数据与打开态全部读 git-store。 */
export function GitCommitTable({ projectPath }: { projectPath: string }): React.JSX.Element {
  const commits = useGit((s) => gitState(s, projectPath).commits)
  const headHash = useGit((s) => gitState(s, projectPath).headHash)
  const currentBranch = useGit((s) => gitState(s, projectPath).currentBranch)
  const moreCommitsAvailable = useGit((s) => gitState(s, projectPath).moreCommitsAvailable)
  const expandedHash = useGit((s) => gitState(s, projectPath).expanded?.hash ?? null)
  const compareWith = useGit((s) => gitState(s, projectPath).expanded?.compareWith ?? null)
  // 右键菜单目标行（contextMenuActive 高亮）：有 hash 的目标取 hash，未提交目标取 '*'
  const menuHash = useGit((s) => {
    const t = gitState(s, projectPath).contextMenu?.target
    if (!t) return null
    if ('hash' in t) return t.hash
    return t.kind === 'uncommitted' ? UNCOMMITTED : null
  })
  const find = useGit((s) => gitState(s, projectPath).find)
  const loadMore = useGit((s) => s.loadMore)

  const viewRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const [grid, setGrid] = useState<GraphGrid>(DEFAULT_GRID)
  const [viewWidth, setViewWidth] = useState(0)
  /** vertex hover 联动的行号；-1 = 无 */
  const [hoveredIdx, setHoveredIdx] = useState(-1)

  // grid 实测回填（坑 1）：表头高取首个数据行的 offsetTop（精确含边框），行高取剩余高度均分。
  // 每次渲染后都量（读两个 clientHeight，代价可忽略），setGrid 带相等守卫不会循环。
  const measure = (): void => {
    const table = tableRef.current
    if (!table || table.clientHeight === 0) return
    const firstRow = table.tBodies[0]?.rows[0]
    if (!firstRow) return
    const rows = table.tBodies[0].rows.length
    const headerHeight = firstRow.offsetTop
    const y = (table.clientHeight - headerHeight) / rows
    if (y <= 0) return
    setGrid((prev) => {
      const offsetY = headerHeight + y / 2
      if (Math.abs(prev.y - y) < 0.01 && Math.abs(prev.offsetY - offsetY) < 0.01) return prev
      return { ...prev, y, offsetY }
    })
  }
  const measureRef = useRef(measure)
  useLayoutEffect(() => {
    measureRef.current = measure
    measure()
  })

  // 容器尺寸变化（含 display:none → 可见）：更新视图宽（图谱 1/3 上限）并重测 grid。
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === 0) return // 隐藏中无尺寸，保持上次测量
      setViewWidth(el.clientWidth)
      measureRef.current()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const layout = useMemo(() => computeGraphLayout(commits, headHash), [commits, headHash])
  // 「当前行」基准（graph-table §0）：有未提交行时是未提交行，否则 HEAD 行 —— 与 HEAD 圆点基准不同
  const currentHash = commits.length > 0 && commits[0].hash === UNCOMMITTED ? UNCOMMITTED : headHash
  const muted = useMemo(
    () => getMutedCommits(commits, currentHash, true, false),
    [commits, currentHash]
  )
  // 空心圆位置（§6 默认配置）：有未提交行画在未提交行，否则画在 HEAD 行
  const hasUncommitted = commits.length > 0 && commits[0].hash === UNCOMMITTED
  const headIdx = headHash !== null ? commits.findIndex((c) => c.hash === headHash) : -1
  const openCircleIdx = hasUncommitted ? 0 : headIdx

  // 图谱列宽与内容同步 + 视图 1/3 上限（§1.3 自动布局）：超限时 SVG 右缘 12px 渐隐
  const contentWidth =
    layout.maxColumns > 0 ? 2 * grid.offsetX + (layout.maxColumns - 1) * grid.x : 0
  const maxGraphWidth = viewWidth > 0 ? Math.round(viewWidth / 3) : 0
  const limited = maxGraphWidth > 0 && contentWidth > maxGraphWidth
  const visibleGraphWidth = limited ? maxGraphWidth : contentWidth
  const graphColWidth = Math.max(visibleGraphWidth, 64)
  const svgHeight =
    commits.length > 0 ? grid.offsetY + (commits.length - 1) * grid.y + grid.y / 2 : 0

  const branchPaths = useMemo(
    () =>
      layout.branches.map((b) => ({
        colourIdx: b.colourIdx,
        paths: buildBranchPaths(b, grid, -1, grid.expandY) // 详情面板吊底不撑行，恒无展开
      })),
    [layout, grid]
  )
  // useId 含冒号，url(#…) 引用前去掉
  const maskId = `git-graph-fade-${useId().replace(/:/g, '')}`
  const fadeStart = visibleGraphWidth > 12 ? (visibleGraphWidth - 12) / visibleGraphWidth : 0

  // 查找高亮：匹配集由查找组件写回 store，表格据此上色。无独立查找 token，
  // 复用 diff 添加色系（绿）—— 与终端搜索高亮同色相，且不动 main.css（归集成者）。
  const findMatches = useMemo(
    () => (find?.open && find.query !== '' ? new Set(find.matches) : null),
    [find]
  )
  const findActiveHash =
    find?.open && find.activeIdx >= 0 ? (find.matches[find.activeIdx] ?? null) : null

  const actions = useMemo<RowActions>(
    () => ({
      // 单击行开详情 / 再点收起；Ctrl/Cmd+点进入比较（graph-table §7）。标签内点击已 stopPropagation。
      rowClick: (e, commit) => {
        const store = useGit.getState()
        const exp = gitState(store, projectPath).expanded
        if ((e.metaKey || e.ctrlKey) && exp) {
          if (commit.hash === exp.hash) store.closeDetails(projectPath)
          else if (commit.hash === exp.compareWith)
            void store.openDetails(projectPath, exp.hash, exp.stash) // 退出比较回基准详情
          else void store.openCompare(projectPath, exp.hash, commit.hash)
        } else if (exp && exp.hash === commit.hash && exp.compareWith === null) {
          store.closeDetails(projectPath)
        } else {
          void store.openDetails(projectPath, commit.hash, commit.stash)
        }
      },
      rowContextMenu: (e, commit) => {
        e.preventDefault()
        const target: GitMenuTarget =
          commit.hash === UNCOMMITTED
            ? { kind: 'uncommitted' }
            : commit.stash !== null
              ? { kind: 'stash', hash: commit.hash, stash: commit.stash }
              : { kind: 'commit', hash: commit.hash }
        useGit.getState().openContextMenu(projectPath, { x: e.clientX, y: e.clientY, target })
      },
      // 单击标签只关已开的菜单，不打开详情（防误触，§7）
      refClick: (e) => {
        e.stopPropagation()
        useGit.getState().closeContextMenu(projectPath)
      },
      branchDoubleClick: (e, name) => {
        e.stopPropagation()
        void useGit
          .getState()
          .runAction(
            projectPath,
            { kind: 'checkout-branch', branch: name, remoteBranch: null },
            `正在检出分支 "${name}"`
          )
      },
      remoteDoubleClick: (e, fullRef, remote) => {
        e.stopPropagation()
        useGit
          .getState()
          .openDialog(projectPath, { kind: 'checkout-remote-branch', remoteRef: fullRef, remote })
      },
      refContextMenu: (e, target) => {
        e.preventDefault()
        e.stopPropagation()
        useGit.getState().openContextMenu(projectPath, { x: e.clientX, y: e.clientY, target })
      }
    }),
    [projectPath]
  )

  // 距底 25px 自动加载（§8）；loadMore 自身带 ready 校验与在途防重入
  const onScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    if (!moreCommitsAvailable) return
    if (el.scrollTop > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 25) {
      void loadMore(projectPath)
    }
  }

  return (
    <div ref={viewRef} className="h-full overflow-auto" onScroll={onScroll}>
      <style>{DATA_COLOR_CSS}</style>
      <div className="relative">
        <table ref={tableRef} className="w-full border-collapse">
          <thead>
            <tr
              onContextMenu={(e) => {
                e.preventDefault()
                useGit.getState().openContextMenu(projectPath, {
                  x: e.clientX,
                  y: e.clientY,
                  target: { kind: 'header' }
                })
              }}
            >
              <th className={TH} style={{ width: graphColWidth }}>
                图谱
              </th>
              {/* width:100% + max-width:0：Description 吃掉全部剩余宽（§1.3 自动布局） */}
              <th className={cn(TH, 'w-full max-w-0')}>描述</th>
              <th className={TH}>日期</th>
              <th className={TH}>作者</th>
              <th className={TH}>提交</th>
            </tr>
          </thead>
          <tbody>
            {commits.map((c, i) => (
              <CommitRow
                key={c.hash}
                commit={c}
                colourIdx={c.hash === UNCOMMITTED ? -1 : (layout.vertices[i]?.colourIdx ?? 0)}
                current={currentHash !== null && c.hash === currentHash}
                muted={muted[i] ?? false}
                headDot={headHash !== null && c.hash === headHash}
                currentBranch={currentBranch}
                detailsOpen={c.hash === expandedHash || c.hash === compareWith}
                rowActive={hoveredIdx === i || menuHash === c.hash}
                findMatch={findMatches?.has(c.hash) ?? false}
                findActive={c.hash === findActiveHash}
                actions={actions}
              />
            ))}
          </tbody>
        </table>
        {commits.length > 0 && visibleGraphWidth > 0 && (
          <svg
            className="pointer-events-none absolute left-0 top-0"
            width={visibleGraphWidth}
            height={svgHeight}
          >
            {limited && (
              <defs>
                <linearGradient id={`${maskId}-grad`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#ffffff" />
                  <stop offset={fadeStart} stopColor="#ffffff" />
                  <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
                </linearGradient>
                <mask id={maskId}>
                  <rect
                    x="0"
                    y="0"
                    width={visibleGraphWidth}
                    height={svgHeight}
                    fill={`url(#${maskId}-grad)`}
                  />
                </mask>
              </defs>
            )}
            <g mask={limited ? `url(#${maskId})` : undefined}>
              {branchPaths.map((b, bi) =>
                b.paths.map((p, pi) => (
                  <g key={`${bi}-${pi}`}>
                    {/* 底衬 shadow 线：背景色宽 4，压住交叉处抗混叠（§10.1） */}
                    <path
                      d={p.d}
                      fill="none"
                      stroke="var(--bg-deepest)"
                      strokeWidth={4}
                      opacity={0.75}
                    />
                    <path
                      d={p.d}
                      fill="none"
                      stroke={p.isCommitted ? PALETTE[b.colourIdx] : 'var(--git-uncommitted)'}
                      strokeWidth={2}
                    />
                  </g>
                ))
              )}
              {layout.vertices.map((v) => {
                const { cx, cy } = vertexPixel(v, grid, -1, grid.expandY)
                const colour = v.isCommitted ? PALETTE[v.colourIdx] : 'var(--git-uncommitted)'
                const hovered = hoveredIdx === v.id
                const hoverProps = {
                  style: { pointerEvents: 'all' } as React.CSSProperties,
                  onMouseEnter: () => setHoveredIdx(v.id),
                  onMouseLeave: () => setHoveredIdx(-1)
                }
                if (v.isStash) {
                  return (
                    <g key={v.id}>
                      <circle
                        cx={cx}
                        cy={cy}
                        r={hovered ? 5.5 : 4.5}
                        fill={colour}
                        {...hoverProps}
                      />
                      <circle cx={cx} cy={cy} r={2} fill="var(--bg-deepest)" />
                    </g>
                  )
                }
                if (v.id === openCircleIdx) {
                  // 空心圆：填充背景色、描边分支色（未提交行时分支色即灰）
                  return (
                    <circle
                      key={v.id}
                      cx={cx}
                      cy={cy}
                      r={hovered ? 5 : 4}
                      fill="var(--bg-deepest)"
                      stroke={colour}
                      strokeWidth={2}
                      {...hoverProps}
                    />
                  )
                }
                return (
                  <circle
                    key={v.id}
                    cx={cx}
                    cy={cy}
                    r={hovered ? 5 : 4}
                    fill={colour}
                    stroke="var(--bg-deepest)"
                    strokeWidth={1}
                    strokeOpacity={0.75}
                    {...hoverProps}
                  />
                )
              })}
            </g>
          </svg>
        )}
      </div>
      {moreCommitsAvailable && (
        <div className="flex justify-center py-2.5">
          <button
            type="button"
            onClick={() => void loadMore(projectPath)}
            className="h-7 w-[180px] rounded-lg border border-[color:var(--border-input)] bg-panel text-[13px] text-foreground transition-colors hover:bg-[var(--bg-row-hover)]"
          >
            加载更多提交
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * 一行提交。memo + key=hash：软刷新数据未变时 store 复用 commits 数组引用，React 层零重渲染
 * （watch-refresh §6 的短路等价物）。
 */
const CommitRow = memo(function CommitRow({
  commit,
  colourIdx,
  current,
  muted,
  headDot,
  currentBranch,
  detailsOpen,
  rowActive,
  findMatch,
  findActive,
  actions
}: {
  commit: GitCommit
  /** 调色板下标；-1 = 未提交行（恒灰，不进调色板） */
  colourIdx: number
  /** 「当前行」（消息加粗）；基准见 graph-table §0，与 headDot 不同 */
  current: boolean
  muted: boolean
  /** HEAD 圆点（恒在 HEAD 提交行，即使未提交行才是「当前行」） */
  headDot: boolean
  currentBranch: string | null
  detailsOpen: boolean
  /** vertex hover 联动 / 右键菜单激活的行高亮 */
  rowActive: boolean
  findMatch: boolean
  findActive: boolean
  actions: RowActions
}): React.JSX.Element {
  const isUncommitted = commit.hash === UNCOMMITTED
  // 详情打开或查找命中当前行时还原透明度（graph-table §5.2 反例外）
  const dimmed = muted && !detailsOpen && !findActive
  const { branchLabels, remoteLabels } = getBranchLabels(commit.heads, commit.remotes)
  // active（当前检出）分支标签插到最前（§2.2）
  const activeIdx =
    currentBranch !== null ? branchLabels.findIndex((l) => l.name === currentBranch) : -1
  const orderedBranchLabels =
    activeIdx > 0
      ? [branchLabels[activeIdx], ...branchLabels.filter((_, i) => i !== activeIdx)]
      : branchLabels
  const headDotTip =
    currentBranch !== null && commit.heads.includes(currentBranch)
      ? `分支 "${currentBranch}" 当前检出于此提交。`
      : '此提交当前已检出（detached HEAD）。'

  return (
    <tr
      data-hash={commit.hash}
      data-color={colourIdx >= 0 ? colourIdx : undefined}
      style={
        colourIdx < 0
          ? ({ '--git-graph-color': 'var(--git-uncommitted)' } as React.CSSProperties)
          : undefined
      }
      className={cn(
        'cursor-pointer transition-colors',
        detailsOpen
          ? 'bg-[var(--selection-row)]'
          : cn(
              findActive
                ? 'bg-[var(--find-match-active-bg)]'
                : findMatch && 'bg-[var(--find-match-bg)]',
              rowActive && 'bg-[var(--bg-row-hover)]',
              'hover:bg-[var(--bg-row-hover)]'
            )
      )}
      onClick={(e) => actions.rowClick(e, commit)}
      onContextMenu={(e) => actions.rowContextMenu(e, commit)}
    >
      {/* Graph 列：Normal 对齐模式下恒空，图谱 SVG 盖在其上 */}
      <td className={TD} />
      <td className={cn(TD, 'w-full max-w-0')}>
        <span className="flex items-center">
          {headDot && (
            <span
              title={headDotTip}
              className="mr-[5px] size-2.5 shrink-0 cursor-help rounded-full border-2"
              style={{ borderColor: 'var(--git-graph-color)' }}
            />
          )}
          {commit.stash !== null && (
            <RefLabel
              icon="stash"
              name={commit.stash.selector.substring(5)}
              target={{ kind: 'stash', hash: commit.hash, stash: commit.stash }}
              actions={actions}
            />
          )}
          {orderedBranchLabels.map((label) => (
            <span
              key={label.name}
              className={REF}
              style={
                label.name === currentBranch ? { borderColor: 'var(--git-graph-color)' } : undefined
              }
              onClick={actions.refClick}
              onDoubleClick={(e) => actions.branchDoubleClick(e, label.name)}
              onContextMenu={(e) =>
                actions.refContextMenu(e, {
                  kind: 'branch',
                  name: label.name,
                  hash: commit.hash
                })
              }
            >
              <span className={REF_ICON} style={{ background: 'var(--git-graph-color)' }}>
                <GitBranch className="size-3.5 text-[color:var(--bg-deepest)]" />
              </span>
              <span className={cn(REF_NAME, label.name === currentBranch && 'font-bold')}>
                {label.name}
              </span>
              {/* 合并进来的远程徽标：双击/右键的目标是远程分支而非本地（坑 3） */}
              {label.remotes.map((remote) => (
                <span
                  key={remote}
                  className="border-l border-[color:var(--border-input)] px-[5px] italic"
                  onDoubleClick={(e) =>
                    actions.remoteDoubleClick(e, `${remote}/${label.name}`, remote)
                  }
                  onContextMenu={(e) =>
                    actions.refContextMenu(e, {
                      kind: 'remote-branch',
                      fullRef: `${remote}/${label.name}`,
                      remote,
                      hash: commit.hash
                    })
                  }
                >
                  {remote}
                </span>
              ))}
            </span>
          ))}
          {remoteLabels.map((r) => (
            <span
              key={r.name}
              className={REF}
              onClick={actions.refClick}
              onDoubleClick={(e) => actions.remoteDoubleClick(e, r.name, r.remote)}
              onContextMenu={(e) =>
                actions.refContextMenu(e, {
                  kind: 'remote-branch',
                  fullRef: r.name,
                  remote: r.remote,
                  hash: commit.hash
                })
              }
            >
              <span className={REF_ICON} style={{ background: 'var(--git-graph-color)' }}>
                <GitBranch className="size-3.5 text-[color:var(--bg-deepest)]" />
              </span>
              <span className={REF_NAME}>{r.name}</span>
            </span>
          ))}
          {commit.tags.map((t) => (
            <RefLabel
              key={t.name}
              icon="tag"
              name={t.name}
              target={{ kind: 'tag', name: t.name, annotated: t.annotated, hash: commit.hash }}
              actions={actions}
            />
          ))}
          <span
            className={cn(
              'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap',
              current && 'font-bold',
              dimmed && 'opacity-50'
            )}
          >
            {commit.message}
          </span>
        </span>
      </td>
      <td
        className={cn(TD, dimmed && 'opacity-50')}
        title={isUncommitted ? undefined : formatDateTime(commit.date)}
      >
        {/* 未提交行没有真实提交时间：显示 * 而非合成的「最后刷新时刻」相对时间 */}
        {isUncommitted ? UNCOMMITTED : formatRelativeTime(commit.date)}
      </td>
      <td className={cn(TD, dimmed && 'opacity-50')} title={`${commit.author} <${commit.email}>`}>
        {commit.author}
      </td>
      <td className={cn(TD, 'font-mono', dimmed && 'opacity-50')} title={commit.hash}>
        {isUncommitted ? UNCOMMITTED : abbrevHash(commit.hash)}
      </td>
    </tr>
  )
})

/** tag / stash 标签（无双击行为，单击关菜单、右键出对应菜单）。 */
function RefLabel({
  icon,
  name,
  target,
  actions
}: {
  icon: 'tag' | 'stash'
  name: string
  target: GitMenuTarget
  actions: RowActions
}): React.JSX.Element {
  const Icon = icon === 'tag' ? Tag : Archive
  return (
    <span
      className={REF}
      onClick={actions.refClick}
      onContextMenu={(e) => actions.refContextMenu(e, target)}
    >
      <span className={REF_ICON} style={{ background: 'var(--git-graph-color)' }}>
        <Icon className="size-3.5 text-[color:var(--bg-deepest)]" />
      </span>
      <span className={REF_NAME}>{name}</span>
    </span>
  )
}
