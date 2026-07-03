// Git 提交详情面板（CDV，details-diff 规格）：读 git-store 的 expanded，渲染于 GitPane 底部。
// 与参考实现的差异（v1 取舍，已录 PRD）：采用 docked-bottom 吊底而非 inline 嵌入表格行 ——
// React 表格行内嵌套 + 图谱 expandY 联动实现复杂，吊底与表格零耦合。
// 组件自管高度（普通详情默认 250px、提交面板默认 320px，顶边拖拽，钳 [100, 600]，
// 不持久化）；左右分栏比例与文件夹开合同为组件内 state（换展开目标即重置）。
// 未提交普通模式即提交面板（ADR-0006）：左栏 CommitForm、右栏 UncommittedFileSections。
// Esc 关闭由 GitPane 统一处理。
import { useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  LoaderCircle,
  X
} from 'lucide-react'
import { UNCOMMITTED, type GitFileChange } from '@shared/git'
import { gitState, useGit } from '@renderer/git-store'
import { cn } from '@renderer/lib/utils'
import { abbrevHash, formatDateTime } from './git-format'
import {
  FILE_STATUS_COLOR,
  buildFileTree,
  diffPossible,
  fileRowTitle,
  flattenFileTree,
  normalizeCompare,
  resolveDiffEndpoints,
  tokenizeBody
} from './git-details'
import { CommitForm, UncommittedFileSections } from './GitCommitPanel'
import type { GitExpandedState } from './git-view-types'

const MIN_HEIGHT = 100
const MAX_HEIGHT = 600
const DEFAULT_HEIGHT = 250
/** 提交面板（未提交普通模式）的默认高：需要装下提交表单，比普通详情高一档。 */
const COMMIT_PANEL_HEIGHT = 320

/** 字段名列（左栏摘要的 grid 第一列）。 */
const FIELD = 'whitespace-nowrap text-muted-foreground'
/** 内部/外部链接统一观感（主蓝 + hover 下划线）。 */
const LINK = 'cursor-pointer text-[color:var(--primary)] hover:underline'

/** hash 的标题短文案：未提交行显示中文而非 '*'。 */
function hashLabel(hash: string): string {
  return hash === UNCOMMITTED ? '未提交更改' : abbrevHash(hash)
}

export function GitCommitDetails({
  projectPath
}: {
  projectPath: string
}): React.JSX.Element | null {
  const exp = useGit((s) => gitState(s, projectPath).expanded)
  const commits = useGit((s) => gitState(s, projectPath).commits)
  const closeDetails = useGit((s) => s.closeDetails)

  /** null = 未拖拽过（按展开目标取默认高）；拖拽后记具体数值，行为与既有一致 */
  const [height, setHeight] = useState<number | null>(null)
  /** 左栏宽度比例（cdvDivider），拖拽范围 [0.2, 0.8]。 */
  const [ratio, setRatio] = useState(0.5)
  const [dragKind, setDragKind] = useState<'height' | 'divider' | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const commitIndex = useMemo(() => new Map(commits.map((c, i) => [c.hash, i])), [commits])

  if (exp === null) return null

  const rowIndexOf = (hash: string): number => commitIndex.get(hash) ?? -1

  /**
   * 把图谱中某提交行滚进视口（已可见则不动，block:'nearest'）。限定在本 Pane 内查——
   * 详情面板与表格同属该 Pane 容器，parentElement 即含表格的 flex-col 容器，
   * 避免命中隐藏 Pane 的同 hash 行（与 GitFindWidget 同法）。
   */
  const scrollGraphToHash = (hash: string): void => {
    const scope = rootRef.current?.parentElement ?? document
    scope.querySelector(`[data-hash="${CSS.escape(hash)}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  /** 未提交普通模式 = 提交面板（ADR-0006）：左提交表单、右两段文件树。 */
  const isCommitPanel = exp.hash === UNCOMMITTED && exp.compareWith === null
  const effectiveHeight = height ?? (isCommitPanel ? COMMIT_PANEL_HEIGHT : DEFAULT_HEIGHT)

  const title =
    exp.compareWith !== null
      ? (() => {
          const { fromHash, toHash } = normalizeCompare(exp.hash, exp.compareWith, rowIndexOf)
          return `比较 ${hashLabel(fromHash)} ↔ ${hashLabel(toHash)}`
        })()
      : exp.hash === UNCOMMITTED
        ? '未提交的更改'
        : `提交 ${abbrevHash(exp.hash)}`
  const loadingText =
    exp.compareWith !== null
      ? '正在加载提交比较…'
      : exp.hash === UNCOMMITTED
        ? '正在加载未提交更改…'
        : '正在加载提交详情…'
  const errorTitle = exp.compareWith !== null ? '无法加载提交比较' : '无法加载提交详情'
  /** 右栏数据源：比较模式在 fileChanges，其余在 details.fileChanges（§6.2）。 */
  const files = exp.compareWith !== null ? exp.fileChanges : (exp.details?.fileChanges ?? null)

  // 高度拖拽（docked：向上拖增高）。mouseup 自行摘除监听；拖拽中挂全屏遮罩保持光标。
  const startHeightDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startY = e.pageY
    const startH = effectiveHeight
    setDragKind('height')
    const onMove = (ev: MouseEvent): void => {
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startH + (startY - ev.pageY))))
    }
    const onUp = (): void => {
      setDragKind(null)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const startDividerDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    setDragKind('divider')
    const onMove = (ev: MouseEvent): void => {
      const rect = contentRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0) return
      setRatio(Math.min(0.8, Math.max(0.2, (ev.pageX - rect.left) / rect.width)))
    }
    const onUp = (): void => {
      setDragKind(null)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      ref={rootRef}
      className="relative flex shrink-0 flex-col border-t border-[color:var(--border-input)] bg-deepest"
      style={{ height: effectiveHeight }}
    >
      {/* 顶边高度拖拽把手：6px 热区骑在上边框上 */}
      <div
        className="absolute -top-[3px] left-0 right-0 z-20 h-[6px] cursor-row-resize"
        onMouseDown={startHeightDrag}
      />
      {/* 拖拽期间的全屏遮罩：保持光标形态并防止误触其它元素 */}
      {dragKind !== null && (
        <div
          className={cn(
            'fixed inset-0 z-50',
            dragKind === 'height' ? 'cursor-row-resize' : 'cursor-col-resize'
          )}
        />
      )}
      {/* 头部小工具条：标题 + 关闭 */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[color:var(--separator)] px-3">
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-foreground">
          {title}
        </span>
        <button
          type="button"
          title="关闭"
          onClick={() => closeDetails(projectPath)}
          className="flex size-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--bg-button-hover)]"
        >
          <X className="size-3.5 text-[color:var(--fg-icon)]" />
        </button>
      </div>
      {exp.loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-1.5 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          <span>{loadingText}</span>
        </div>
      ) : exp.error !== null ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6">
          <div className="text-sm text-muted-foreground">{errorTitle}</div>
          <div className="max-w-[560px] select-text whitespace-pre-wrap break-all text-center font-mono text-[12px] text-muted-foreground">
            {exp.error}
          </div>
        </div>
      ) : (
        <div ref={contentRef} className="flex min-h-0 flex-1">
          {/* 左栏：摘要（整栏可选中复制）；提交面板模式换成提交表单 */}
          <div
            className="min-w-0 select-text overflow-auto px-3 py-2"
            style={{ width: `${ratio * 100}%` }}
          >
            {isCommitPanel ? (
              <CommitForm projectPath={projectPath} />
            ) : (
              <SummaryPane
                projectPath={projectPath}
                exp={exp}
                rowIndexOf={rowIndexOf}
                scrollGraphToHash={scrollGraphToHash}
              />
            )}
          </div>
          {/* 分栏拖拽条 */}
          <div
            className="w-[5px] shrink-0 cursor-col-resize border-l border-[color:var(--separator)]"
            onMouseDown={startDividerDrag}
          />
          {/* 右栏：文件树。key 绑定展开目标：切换提交即重置开合状态，同目标刷新则保留；
              提交面板模式换成两段文件树（目标恒为 '*'，开合状态在组件内自然保留） */}
          <div className="min-w-0 flex-1 overflow-auto py-1">
            {isCommitPanel ? (
              <UncommittedFileSections projectPath={projectPath} />
            ) : (
              <FileTreePane
                key={`${exp.hash}|${exp.compareWith ?? ''}`}
                projectPath={projectPath}
                exp={exp}
                files={files ?? []}
                rowIndexOf={rowIndexOf}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** 左栏摘要：比较模式为一句话，普通提交与 stash 为字段区 + 正文（details-diff §5）；未提交普通模式的左栏由 CommitForm 接管，不走这里。 */
function SummaryPane({
  projectPath,
  exp,
  rowIndexOf,
  scrollGraphToHash
}: {
  projectPath: string
  exp: GitExpandedState
  rowIndexOf: (hash: string) => number
  scrollGraphToHash: (hash: string) => void
}): React.JSX.Element {
  if (exp.compareWith !== null) {
    const { fromHash, toHash } = normalizeCompare(exp.hash, exp.compareWith, rowIndexOf)
    return (
      <div className="text-[13px]">
        正在显示从{' '}
        <span className="font-mono" title={fromHash}>
          {hashLabel(fromHash)}
        </span>{' '}
        到 <HashOrUncommitted hash={toHash} /> 的所有更改。
      </div>
    )
  }
  const d = exp.details
  if (d === null) return <div className="text-[13px] text-muted-foreground">没有详情数据</div>
  const sameDates = d.authorDate === d.committerDate

  /** 父提交跳转：目标在已加载列表中才可点（§5.1），点击换开该提交的详情并把图谱滚到它那一行。 */
  const openParent = (hash: string): void => {
    const store = useGit.getState()
    const commit = gitState(store, projectPath).commits.find((c) => c.hash === hash)
    void store.openDetails(projectPath, hash, commit?.stash ?? null)
    // 父提交若不在视口内则滚动到它（block:'nearest' 天然只在越界时滚）
    scrollGraphToHash(hash)
  }

  return (
    <>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
        {exp.stash !== null && (
          <>
            <span className={FIELD}>贮藏</span>
            <span className="break-all font-mono">{exp.stash.selector.substring(5)}</span>
          </>
        )}
        <span className={FIELD}>提交</span>
        <span className="break-all font-mono">{d.hash}</span>
        <span className={FIELD}>父提交</span>
        <span className="min-w-0">
          {d.parents.length === 0
            ? '无'
            : d.parents.map((p, i) => (
                <span key={p}>
                  {i > 0 && ', '}
                  {rowIndexOf(p) >= 0 ? (
                    <a className={cn(LINK, 'font-mono')} title={p} onClick={() => openParent(p)}>
                      {abbrevHash(p)}
                    </a>
                  ) : (
                    <span className="font-mono" title={p}>
                      {abbrevHash(p)}
                    </span>
                  )}
                </span>
              ))}
        </span>
        <span className={FIELD}>作者</span>
        <PersonLine name={d.author} email={d.authorEmail} />
        {!sameDates && (
          <>
            <span className={FIELD}>作者日期</span>
            <span>{formatDateTime(d.authorDate)}</span>
          </>
        )}
        <span className={FIELD}>提交者</span>
        <PersonLine name={d.committer} email={d.committerEmail} />
        <span className={FIELD}>{sameDates ? '日期' : '提交日期'}</span>
        <span>{formatDateTime(d.committerDate)}</span>
      </div>
      {d.body !== '' && (
        <div className="mt-2 whitespace-pre-wrap break-words text-[13px]">
          {tokenizeBody(d.body).map((t, i) =>
            t.kind === 'text' ? (
              <span key={i}>{t.text}</span>
            ) : (
              <a
                key={i}
                className={LINK}
                title={t.url}
                onClick={(e) => {
                  e.preventDefault()
                  void window.api.openExternal(t.url)
                }}
              >
                {t.text}
              </a>
            )
          )}
        </div>
      )}
    </>
  )
}

/** 比较摘要里的一端：未提交端显示中文，其余显示 8 位短哈希（title 带全 hash）。 */
function HashOrUncommitted({ hash }: { hash: string }): React.JSX.Element {
  if (hash === UNCOMMITTED) return <span>未提交更改</span>
  return (
    <span className="font-mono" title={hash}>
      {abbrevHash(hash)}
    </span>
  )
}

/** 「姓名 <邮箱>」行，邮箱为 mailto 链接（经 openExternal 打开，§5.1）。 */
function PersonLine({ name, email }: { name: string; email: string }): React.JSX.Element {
  return (
    <span className="min-w-0 break-all">
      {name}{' '}
      {email !== '' && (
        <a
          className={LINK}
          href={`mailto:${email}`}
          onClick={(e) => {
            // 阻止 Electron 窗口内导航；mailto 交给 openExternal（主进程放行策略见集成）
            e.preventDefault()
            void window.api.openExternal(`mailto:${email}`)
          }}
        >
          {`<${email}>`}
        </a>
      )}
    </span>
  )
}

/** 右栏文件树：单链压缩 + 排序 + 开合记忆（details-diff §7）；单击开 diff、右键出文件菜单。 */
function FileTreePane({
  projectPath,
  exp,
  files,
  rowIndexOf
}: {
  projectPath: string
  exp: GitExpandedState
  files: GitFileChange[]
  rowIndexOf: (hash: string) => number
}): React.JSX.Element {
  /** 收起的文件夹路径集合（默认全展开；换展开目标由父级 key 重置） */
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const tree = useMemo(() => buildFileTree(files), [files])
  const rows = useMemo(() => flattenFileTree(tree, closed), [tree, closed])
  // 当前打开 diff 的文件身份（端点 + 路径）：据此高亮被选中的文件行
  const selectedKey = useGit((s) => {
    const d = gitState(s, projectPath).diffView
    return d !== null ? `${d.fromHash}|${d.toHash}|${d.file.newFilePath}` : null
  })

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
        没有文件变更
      </div>
    )
  }

  const toggle = (folderPath: string): void => {
    setClosed((prev) => {
      const next = new Set(prev)
      if (next.has(folderPath)) next.delete(folderPath)
      else next.add(folderPath)
      return next
    })
  }

  const openFileDiff = (file: GitFileChange): void => {
    const { fromHash, toHash } = resolveDiffEndpoints(file, exp, rowIndexOf)
    void useGit.getState().openDiff(projectPath, file, fromHash, toHash)
  }

  const onFileMenu = (e: React.MouseEvent, file: GitFileChange): void => {
    e.preventDefault()
    e.stopPropagation()
    const { fromHash, toHash } = resolveDiffEndpoints(file, exp, rowIndexOf)
    useGit.getState().openContextMenu(projectPath, {
      x: e.clientX,
      y: e.clientY,
      target: { kind: 'file', file, fromHash, toHash, isUncommitted: toHash === UNCOMMITTED }
    })
  }

  return (
    <div>
      {rows.map((row) => {
        if (row.kind === 'folder') {
          return (
            <div
              key={`d-${row.folderPath}`}
              className="flex h-[22px] cursor-pointer items-center gap-1 pr-2 text-[13px] transition-colors hover:bg-[var(--bg-row-hover)]"
              style={{ paddingLeft: 8 + row.depth * 16 }}
              onClick={() => toggle(row.folderPath)}
            >
              {row.open ? (
                <ChevronDown className="size-3.5 shrink-0 text-[color:var(--fg-icon)]" />
              ) : (
                <ChevronRight className="size-3.5 shrink-0 text-[color:var(--fg-icon)]" />
              )}
              {row.open ? (
                <FolderOpen className="size-3.5 shrink-0 text-[color:var(--fg-icon)]" />
              ) : (
                <Folder className="size-3.5 shrink-0 text-[color:var(--fg-icon)]" />
              )}
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                {row.name}
              </span>
            </div>
          )
        }
        const file = files[row.index]
        const clickable = diffPossible(file)
        const colour = FILE_STATUS_COLOR[file.type]
        const { fromHash: dFrom, toHash: dTo } = resolveDiffEndpoints(file, exp, rowIndexOf)
        const isSelected = selectedKey === `${dFrom}|${dTo}|${file.newFilePath}`
        return (
          <div
            key={`f-${row.index}`}
            title={fileRowTitle(file)}
            className={cn(
              'flex h-[22px] items-center gap-1.5 pr-2 text-[13px] transition-colors',
              clickable ? 'cursor-pointer' : 'cursor-default',
              // 当前打开 diff 的文件行高亮（选中蓝底，hover 用更亮的选中蓝）
              isSelected
                ? 'bg-[var(--selection-row)] hover:bg-[var(--selection-row-hover)]'
                : 'hover:bg-[var(--bg-row-hover)]'
            )}
            // 额外 +18px 缩进：与文件夹行的 chevron 区对齐
            style={{ paddingLeft: 8 + row.depth * 16 + 18 }}
            onClick={() => clickable && openFileDiff(file)}
            onContextMenu={(e) => onFileMenu(e, file)}
          >
            <FileIcon className="size-3.5 shrink-0" style={{ color: colour }} />
            <span
              className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
              // 选中行文字变白（#DFE1E5），压过状态色以在蓝底上清晰
              style={{ color: isSelected ? 'var(--fg-primary)' : colour }}
            >
              {row.name}
            </span>
            {(file.type === 'M' || file.type === 'R') &&
              file.additions !== null &&
              file.deletions !== null && (
                <span className="shrink-0 text-[12px]">
                  <span className="text-status-success" title={`${file.additions} 处添加`}>
                    +{file.additions}
                  </span>
                  <span className="ml-1 text-status-failed" title={`${file.deletions} 处删除`}>
                    -{file.deletions}
                  </span>
                </span>
              )}
          </div>
        )
      })}
    </div>
  )
}
