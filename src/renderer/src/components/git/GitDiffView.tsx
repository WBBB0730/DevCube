// Git 单文件 diff 面板（details-diff §10）：读 git-store 的 diffView，绝对定位覆盖图谱表格区
// （集成者挂载于内层 relative 容器内，不盖吊底详情）。diff 正文由 @git-diff-view/react 渲染，
// 按官方 git mode 用法构造 DiffFile 实例（initRaw）交给 DiffView：统一（unified）/ 左右对比
// （split）经 diffViewMode 切换、偏好跨会话记忆（viewPrefs.diffSplitView）、语法高亮与词级 diff
// 由库内置；配色在 main.css 覆盖库的 CSS 主题变量对齐 Darcula。
// 二进制 / 空 diff / 延迟加载骨架 / 错误 四态兜底。Esc 关闭由 GitPane 统一处理。
// 头部导航对齐 WebStorm：↑↓ 切文件内改动块（F7/⇧F7）、打开文件、←→ 按文件树顺序切文件（⌥←/⌥→）。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  AlignJustify,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns2,
  FolderSymlink,
  LoaderCircle,
  X
} from 'lucide-react'
import { DiffFile, DiffModeEnum, DiffView } from '@git-diff-view/react'
import {
  GIT_INDEX,
  UNCOMMITTED,
  imageMimeOf,
  type GitFileChange,
  type GitFileStatus,
  type GitImageResult
} from '@shared/git'
import { gitState, useGit } from '@renderer/git-store'
import { useFiles } from '@renderer/files-store'
import { shortcutTitle } from '@renderer/lib/shortcut-label'
import { abbrevHash } from './git-format'
import {
  FILE_STATUS_COLOR,
  FILE_STATUS_LABEL,
  canOpenWorkingTreeFile,
  changeBlockStarts,
  currentBlockIndex,
  diffNavIndex,
  diffNavSequence
} from './git-details'

/** 头部图标按钮（与查找组件同款禁用态）。 */
const HEADER_BTN =
  'flex size-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--bg-button-hover)] disabled:pointer-events-none disabled:opacity-50'

/** 改动块跳转的视口锚比例：目标块顶对齐到视口约 1/3 处（同 WebStorm 落点观感）。 */
const BLOCK_ANCHOR = 1 / 3

/**
 * 修订说明文案（§10.2 的描述规则）：单提交场景（from === to）按状态区分添加/删除/区间，
 * 工作区端（to === '*'）显示「工作区」。提交面板的 index 端点两分支必须放最前——
 * index→'*' 若先命中 to==='*' 分支会得到「::index → 工作区」的原文字样。
 */
function revLabel(fromHash: string, toHash: string, type: GitFileStatus): string {
  // 提交面板：未暂存段（index → 工作区，未跟踪行 from 亦为 index 同得此文案）
  if (fromHash === GIT_INDEX) return '未暂存'
  // 提交面板：已暂存段（HEAD → index）
  if (toHash === GIT_INDEX) return '已暂存'
  if (toHash === UNCOMMITTED) {
    return fromHash === 'HEAD' ? '未提交' : `${abbrevHash(fromHash)} → 工作区`
  }
  if (fromHash === toHash) {
    if (type === 'A' || type === 'U') return `于 ${abbrevHash(toHash)} 添加`
    if (type === 'D') return `于 ${abbrevHash(toHash)} 删除`
    return `${abbrevHash(fromHash)}^ → ${abbrevHash(toHash)}`
  }
  return `${abbrevHash(fromHash)} → ${abbrevHash(toHash)}`
}

export function GitDiffView({ projectPath }: { projectPath: string }): React.JSX.Element | null {
  const diffView = useGit((s) => gitState(s, projectPath).diffView)
  const closeDiff = useGit((s) => s.closeDiff)
  const splitView = useGit((s) => s.viewPrefs.diffSplitView)
  const setViewPrefs = useGit((s) => s.setViewPrefs)
  const expanded = useGit((s) => gitState(s, projectPath).expanded)
  const commits = useGit((s) => gitState(s, projectPath).commits)
  /** 加载骨架延迟 120ms 出现（防快速响应时闪烁，§10.2） */
  const [showLoading, setShowLoading] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrollPos = useRef({ key: '', top: 0, left: 0 })

  // 文件身份：端点 + 新路径（换文件时重置加载骨架的计时）。
  const fileKey = diffView
    ? `${diffView.fromHash}|${diffView.toHash}|${diffView.file.newFilePath}`
    : ''

  const loading = diffView?.loading ?? false
  useEffect(() => {
    // setState 只发生在定时回调里（骨架延迟出现 / 结束后异步收回），避免 effect 内同步级联渲染
    const timer = setTimeout(() => setShowLoading(loading), loading ? 120 : 0)
    return () => clearTimeout(timer)
  }, [loading, fileKey])

  // 官方 git mode 用法：new DiffFile(旧名, '', 新名, '', [git diff 原文]) → initRaw()。
  // 空串 content = 无全文（语法高亮由库按文件名推断语言、逐行处理）；主题由
  // diffViewTheme prop 落进实例，无需手动 initTheme。
  const srcFile = diffView?.file
  const srcData = diffView?.data ?? null
  const raw = srcData !== null && !srcData.binary ? srcData.raw : null
  const diffFile = useMemo(() => {
    if (srcFile === undefined || raw === null) return null
    // 无 hunk（纯重命名 / 模式变更 / 空文件新增）：没有内容可渲染，走空态文案
    if (!/^@@ -/m.test(raw)) return null
    const instance = new DiffFile(srcFile.oldFilePath, '', srcFile.newFilePath, '', [raw])
    instance.initRaw()
    return instance
  }, [srcFile, raw])

  // —— 头部导航：左右切文件（序列从展开态派生，与文件树完整顺序一致） ——
  const navSequence = useMemo(() => {
    const commitIndex = new Map(commits.map((c, i) => [c.hash, i]))
    return diffNavSequence(expanded, (hash) => commitIndex.get(hash) ?? -1)
  }, [expanded, commits])
  const navIndex = diffView === null ? -1 : diffNavIndex(navSequence, diffView)

  const goFile = useCallback(
    (delta: -1 | 1): void => {
      if (navIndex === -1) return
      const entry = navSequence[navIndex + delta]
      if (entry === undefined) return
      void useGit.getState().openDiff(projectPath, entry.file, entry.fromHash, entry.toHash)
    },
    [navIndex, navSequence, projectPath]
  )

  // —— 头部导航：上下切文件内改动块（块 = 连续 data-state="diff" 行，DOM 量位、纯函数选块）。
  // 「当前块」用显式下标：按钮跳转 ±1（首末块精确禁用），手动滚动按视口锚重推。 ——
  const [blockNav, setBlockNav] = useState({ prev: false, next: false })
  /** 当前改动块下标（-1 = 尚在首块之前） */
  const currentBlock = useRef(-1)
  /** 按钮跳转写入的目标 scrollTop：其触发的 scroll 事件（split 双容器各一发）跳过重推 */
  const jumpTarget = useRef<number | null>(null)

  /** 第一个滚动容器里各改动块的内容 top（split 两容器行高一致，量第一个即可）。 */
  const measureBlocks = useCallback((): { container: HTMLElement; tops: number[] } | null => {
    const container =
      bodyRef.current?.querySelector<HTMLElement>('.diff-table-scroll-container') ?? null
    if (container === null) return null
    const rows = [...container.querySelectorAll<HTMLElement>('tr.diff-line')]
    const starts = changeBlockStarts(rows.map((r) => r.dataset.state === 'diff'))
    const base = container.getBoundingClientRect().top - container.scrollTop
    return { container, tops: starts.map((i) => rows[i].getBoundingClientRect().top - base) }
  }, [])

  const syncBlockNav = useCallback((idx: number, count: number): void => {
    currentBlock.current = idx
    const prev = idx > 0
    const next = idx < count - 1
    setBlockNav((cur) => (cur.prev === prev && cur.next === next ? cur : { prev, next }))
  }, [])

  /** 从当前视口锚重推当前块（手动滚动 / 换文件 / 正文渲染变化后）。 */
  const deriveBlockNav = useCallback((): void => {
    const m = measureBlocks()
    if (m === null) {
      syncBlockNav(-1, 0)
      return
    }
    const anchor = m.container.scrollTop + m.container.clientHeight * BLOCK_ANCHOR
    syncBlockNav(currentBlockIndex(m.tops, anchor), m.tops.length)
  }, [measureBlocks, syncBlockNav])

  const goBlock = useCallback(
    (dir: 'prev' | 'next'): void => {
      const m = measureBlocks()
      if (m === null) return
      const idx = currentBlock.current + (dir === 'next' ? 1 : -1)
      if (idx < 0 || idx >= m.tops.length) return // 快捷键不经按钮禁用态，越界在此兜住
      const target = Math.max(0, m.tops[idx] - m.container.clientHeight * BLOCK_ANCHOR)
      jumpTarget.current = target
      // split 两个滚动容器：与滚动恢复同款，全部对齐
      const nodes = bodyRef.current?.querySelectorAll<HTMLElement>('.diff-table-scroll-container')
      for (const el of nodes ?? []) el.scrollTop = target
      syncBlockNav(idx, m.tops.length)
    },
    [measureBlocks, syncBlockNav]
  )

  // 快捷键（对齐 WebStorm）：F7/⇧F7 上下改动块，⌥←/⌥→ 左右文件。仅 diff 打开时监听，
  // capture 对齐 GitPane 的全局键盘；输入控件聚焦时让位；Esc 仍由 GitPane 统一处理。
  const hasDiff = diffView !== null
  useEffect(() => {
    if (!hasDiff) return
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      const editable =
        !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (editable || e.metaKey || e.ctrlKey) return
      if (e.key === 'F7' && !e.altKey) {
        goBlock(e.shiftKey ? 'prev' : 'next')
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.altKey && !e.shiftKey) {
        goFile(e.key === 'ArrowLeft' ? -1 : 1)
      } else {
        return
      }
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [hasDiff, goBlock, goFile])

  // 同文件重拉时尽量保住滚动；换文件 / 换端点则从头看。上下箭头的当前块随滚动重推；
  // 正文行是库异步渲染的（先量宽再出内容），用 MutationObserver 在行落地 / hunk 展开后重推。
  useLayoutEffect(() => {
    const root = bodyRef.current
    if (root === null) return
    const nodes = [...root.querySelectorAll<HTMLElement>('.diff-table-scroll-container')]
    const prev = scrollPos.current
    if (prev.key === fileKey) {
      for (const el of nodes) {
        el.scrollTop = prev.top
        el.scrollLeft = prev.left
      }
    }
    jumpTarget.current = null // 上个文件残留的跳转目标作废
    deriveBlockNav()
    const observer = new MutationObserver(() => deriveBlockNav())
    observer.observe(root, { childList: true, subtree: true })
    const onScroll = (e: Event): void => {
      const el = e.currentTarget as HTMLElement
      scrollPos.current = { key: fileKey, top: el.scrollTop, left: el.scrollLeft }
      // 按钮跳转自身触发的滚动：保住显式块下标不被视口重推冲掉
      if (jumpTarget.current !== null && Math.abs(el.scrollTop - jumpTarget.current) <= 1) return
      jumpTarget.current = null
      deriveBlockNav()
    }
    for (const el of nodes) el.addEventListener('scroll', onScroll)
    return () => {
      observer.disconnect()
      for (const el of nodes) el.removeEventListener('scroll', onScroll)
    }
  }, [raw, fileKey, splitView, deriveBlockNav])

  if (diffView === null) return null
  const { file, data, error } = diffView
  // 上下箭头仅在文本 diff 正文可用。非文本正文（错误 / 冲突 / 目录 / 二进制 / 加载中）没有
  // 量位容器，effect 提前返回后 blockNav 可能残留上个文件的值，在渲染层据此一并禁用。
  const hasTextBody =
    diffFile !== null && error === null && file.type !== '!' && file.isDir !== true

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-deepest">
      {/* 头部：状态徽标 + 文件路径（R 显示 旧 → 新）+ 行数统计 + 修订说明
          + 按钮组（↑↓ 改动块 | ←→ 文件 | 打开文件 视图切换 关闭） */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[color:var(--border-input)] px-3 text-[13px]">
        <span
          title={FILE_STATUS_LABEL[file.type]}
          className="shrink-0 font-mono font-bold"
          style={{ color: FILE_STATUS_COLOR[file.type] }}
        >
          {file.type}
        </span>
        <span
          className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
          title={file.type === 'R' ? `${file.oldFilePath} → ${file.newFilePath}` : file.newFilePath}
        >
          {file.type === 'R' ? `${file.oldFilePath} → ${file.newFilePath}` : file.newFilePath}
        </span>
        {file.additions !== null && file.deletions !== null && (
          <span className="shrink-0 text-[12px]">
            <span className="text-status-success" title={`${file.additions} 处添加`}>
              +{file.additions}
            </span>
            <span className="ml-1 text-status-failed" title={`${file.deletions} 处删除`}>
              -{file.deletions}
            </span>
          </span>
        )}
        <span className="shrink-0 text-[12px] text-muted-foreground">
          {revLabel(diffView.fromHash, diffView.toHash, file.type)}
        </span>
        {/* 按钮区：组内间距对齐工具栏（gap-0.5），组间以 1px 竖线分隔 */}
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            title={shortcutTitle('上一处改动', { shift: true, key: 'F7' })}
            disabled={!hasTextBody || !blockNav.prev}
            onClick={() => goBlock('prev')}
            className={HEADER_BTN}
          >
            <ChevronUp className="size-3.5 text-[color:var(--fg-icon)]" />
          </button>
          <button
            type="button"
            title={shortcutTitle('下一处改动', { key: 'F7' })}
            disabled={!hasTextBody || !blockNav.next}
            onClick={() => goBlock('next')}
            className={HEADER_BTN}
          >
            <ChevronDown className="size-3.5 text-[color:var(--fg-icon)]" />
          </button>
          <div className="mx-0.5 h-3 w-px shrink-0 bg-[var(--border-input)]" role="separator" />
          <button
            type="button"
            title={shortcutTitle('上一个文件', { alt: true, key: 'ArrowLeft' })}
            disabled={navIndex <= 0}
            onClick={() => goFile(-1)}
            className={HEADER_BTN}
          >
            <ChevronLeft className="size-3.5 text-[color:var(--fg-icon)]" />
          </button>
          <button
            type="button"
            title={shortcutTitle('下一个文件', { alt: true, key: 'ArrowRight' })}
            disabled={navIndex === -1 || navIndex >= navSequence.length - 1}
            onClick={() => goFile(1)}
            className={HEADER_BTN}
          >
            <ChevronRight className="size-3.5 text-[color:var(--fg-icon)]" />
          </button>
          <div className="mx-0.5 h-3 w-px shrink-0 bg-[var(--border-input)]" role="separator" />
          <button
            type="button"
            title="打开文件"
            disabled={!canOpenWorkingTreeFile(file)}
            onClick={() =>
              useFiles.getState().openInFiles(projectPath, `${projectPath}/${file.newFilePath}`)
            }
            className={HEADER_BTN}
          >
            <FolderSymlink className="size-3.5 text-[color:var(--fg-icon)]" />
          </button>
          <button
            type="button"
            title={splitView ? '统一视图' : '左右对比'}
            onClick={() => void setViewPrefs({ diffSplitView: !splitView })}
            className={HEADER_BTN}
          >
            {splitView ? (
              <AlignJustify className="size-3.5 text-[color:var(--fg-icon)]" />
            ) : (
              <Columns2 className="size-3.5 text-[color:var(--fg-icon)]" />
            )}
          </button>
          <button
            type="button"
            title="关闭"
            onClick={() => closeDiff(projectPath)}
            className={HEADER_BTN}
          >
            <X className="size-3.5 text-[color:var(--fg-icon)]" />
          </button>
        </div>
      </div>
      {error !== null ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6">
          <div className="text-sm text-muted-foreground">无法查看差异</div>
          <div className="max-w-[560px] select-text whitespace-pre-wrap break-all text-center font-mono text-[12px] text-muted-foreground">
            {error}
          </div>
        </div>
      ) : file.isDir === true ? (
        // 未跟踪目录整体条目：无单文件 diff（store 已跳过取数），给一句说明占位
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          这是一个未跟踪目录，没有差异可查看
        </div>
      ) : file.type === '!' ? (
        // 冲突文件：git diff 对 unmerged 输出 combined diff（diff --cc，hunk 头 @@@）或
        // 「* Unmerged path」，实测 DiffFile.initRaw 均吃不下（Invalid hunk header format），
        // 按二进制同款兜底一句说明，不等数据返回
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          文件处于冲突状态，请在编辑器中解决后暂存
        </div>
      ) : data !== null && data.binary ? (
        // key=文件身份：换文件即重建组件（images 状态自然归零），不在 effect 里手动重置
        <BinaryBody
          key={fileKey}
          projectPath={projectPath}
          file={file}
          fromHash={diffView.fromHash}
          toHash={diffView.toHash}
        />
      ) : data === null ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-1.5 text-sm text-muted-foreground">
          {showLoading && (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              <span>正在加载差异…</span>
            </>
          )}
        </div>
      ) : diffFile === null ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          没有差异内容
        </div>
      ) : (
        // 滚动收进库的容器内（main.css 高度链），此层只圈定高度不再自滚
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-hidden">
          <DiffView
            diffFile={diffFile}
            diffViewMode={splitView ? DiffModeEnum.Split : DiffModeEnum.Unified}
            diffViewHighlight
            diffViewTheme="dark"
            diffViewFontSize={13}
          />
        </div>
      )}
    </div>
  )
}

/**
 * 二进制文件正文：图片给新旧预览（object-contain + 边距，M 双栏对照 / A·U·D 单栏），
 * 其余二进制保持一句说明。图片数据经 gitFileImage 按需取（data URL），换文件时丢弃过期响应。
 */
function BinaryBody({
  projectPath,
  file,
  fromHash,
  toHash
}: {
  projectPath: string
  file: GitFileChange
  fromHash: string
  toHash: string
}): React.JSX.Element {
  const isImage = imageMimeOf(file.newFilePath) !== null || imageMimeOf(file.oldFilePath) !== null
  const [images, setImages] = useState<GitImageResult | null>(null)
  useEffect(() => {
    if (!isImage) return
    let stale = false
    void window.api
      .gitFileImage(projectPath, {
        fromHash,
        toHash,
        oldFilePath: file.oldFilePath,
        newFilePath: file.newFilePath,
        type: file.type
      })
      .then((result) => {
        if (!stale) setImages(result)
      })
    return () => {
      stale = true
    }
  }, [projectPath, file, fromHash, toHash, isImage])

  if (!isImage || (images !== null && images.oldDataUrl === null && images.newDataUrl === null)) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
        二进制文件不支持对比
      </div>
    )
  }
  if (images === null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
      </div>
    )
  }
  const sides = [
    { label: '旧', url: images.oldDataUrl },
    { label: '新', url: images.newDataUrl }
  ].filter((side): side is { label: string; url: string } => side.url !== null)
  return (
    <div className="flex min-h-0 flex-1 gap-4 p-6">
      {sides.map((side) => (
        <div key={side.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
          <span className="shrink-0 text-[12px] text-muted-foreground">{side.label}</span>
          <div className="flex min-h-0 w-full flex-1 items-center justify-center rounded-lg bg-panel p-4">
            <img src={side.url} alt={side.label} className="max-h-full max-w-full object-contain" />
          </div>
        </div>
      ))}
    </div>
  )
}
