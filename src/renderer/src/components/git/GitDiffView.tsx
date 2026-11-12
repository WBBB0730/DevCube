// Git 单文件 diff 面板（details-diff §10）：读 git-store 的 diffView，绝对定位覆盖图谱表格区
// （集成者挂载于内层 relative 容器内，不盖吊底详情）。diff 正文由 @pierre/diffs 的 CodeView 渲染（ADR-0062）：
// git 原始 diff 经 parsePatchFiles 解析成文件段交给它，只渲染视口附近的行，大 diff 不卡；统一 / 左右对比经
// diffStyle 切换，长行自动换行另有开关（两种视图共用），两项偏好都跨会话记忆（viewPrefs）；语法高亮与词级 diff
// 由库内置。观感对齐 Files 编辑器：代码配色为编辑器同一方案的 TextMate 主题（cm6-setup），字排与 diff 底色
// 见 main.css `.git-diff-body`。二进制 / 空 diff / 延迟加载骨架 / 错误 四态兜底。Esc 关闭由 GitPane 统一处理。
// 头部导航对齐 WebStorm：↑↓ 切文件内改动块（F7/⇧F7）、打开文件、←→ 按文件树顺序切文件（⌥←/⌥→）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlignJustify,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns2,
  FolderSymlink,
  WrapText,
  X
} from 'lucide-react'
import {
  parsePatchFiles,
  registerCustomLanguage,
  registerCustomTheme,
  type CodeView as CodeViewInstance,
  type CodeViewDiffItem
} from '@pierre/diffs'
import { CodeView, type CodeViewHandle, type CodeViewReactOptions } from '@pierre/diffs/react'
import {
  GIT_INDEX,
  UNCOMMITTED,
  imageMimeOf,
  type GitFileChange,
  type GitFileStatus,
  type GitImageResult
} from '@shared/git'
import { SHORTCUT } from '@shared/shortcut-label'
import { gitState, openInProjectFiles, repoFilePath, useGit } from '@renderer/git-store'
import { useApp } from '@renderer/store'
import {
  filesLineNumberColor,
  filesTextMateLanguages,
  filesTextMateTheme
} from '@renderer/lib/cm6-setup'
import { shortcutTitle } from '@renderer/lib/shortcut-label'
import { cn } from '@renderer/lib/utils'
import { CenteredHint, LoadingHint } from '@renderer/components/ui/centered-hint'
import { isDialogOpen } from '@renderer/components/ui/dialog'
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

/** 正文行高（px）：同 Files 编辑器 13px × 1.7；库按它预估未渲染行的位置，须与 main.css `--diffs-line-height` 一致。 */
const DIFF_LINE_HEIGHT = 22

/**
 * 改动行底色用应用的 diff token 原色：库把 `--diffs-bg-*-override` 当基色、再与正文底按固定比例混合（行 80% /
 * 行号格 85%），比例是库在 shadow DOM 里给行元素设的变量，宿主上的变量改不到，经库的 unsafeCSS 注入归零
 * （库把它排在自身样式之后的层里，稳定压过；其余样式都走 main.css `.git-diff-body` 的变量）。
 */
const DIFF_UNSAFE_CSS =
  '[data-line],[data-no-newline],[data-gutter-buffer],[data-column-number]{--mix-light:0%;--mix-dark:0%}'

// 正文代码配色：编辑器同一方案的 TextMate 主题，按名向库注册一次（明暗两套，随 themeType 择一）。
const DIFF_THEMES = { dark: filesTextMateTheme.dark.name, light: filesTextMateTheme.light.name }
for (const theme of Object.values(filesTextMateTheme)) {
  registerCustomTheme(theme.name, () => Promise.resolve(theme))
}
// 语法着色的文法同编辑器语言（cm6-setup），连同扩展名映射一并注册；库内置的全量文法已经补丁去掉，未注册的按纯文本
for (const [lang, { load, keys }] of Object.entries(filesTextMateLanguages)) {
  registerCustomLanguage(lang, load, keys)
}

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

export function GitDiffView({ repoPath }: { repoPath: string }): React.JSX.Element | null {
  const diffView = useGit((s) => gitState(s, repoPath).diffView)
  const closeDiff = useGit((s) => s.closeDiff)
  const splitView = useGit((s) => s.viewPrefs.diffSplitView)
  const wrapLines = useGit((s) => s.viewPrefs.diffWrapLines)
  const setViewPrefs = useGit((s) => s.setViewPrefs)
  const expanded = useGit((s) => gitState(s, repoPath).expanded)
  const commits = useGit((s) => gitState(s, repoPath).commits)
  const theme = useApp((s) => s.theme)
  const codeViewRef = useRef<CodeViewHandle<undefined, undefined>>(null)
  const scrollPos = useRef({ key: '', top: 0 })

  // 文件身份：端点 + 新路径（换文件时重建加载骨架、重新计时）。
  const fileKey = diffView
    ? `${diffView.fromHash}|${diffView.toHash}|${diffView.file.newFilePath}`
    : ''

  // 原文 → 文件段：通常一段；文件与符号链接互换时 git 输出两段（删掉旧类型、新增新类型，ADR-0059），
  // 各成 CodeView 的一个条目上下排列。全无 hunk（纯重命名 / 模式变更 / 空文件新增）走空态文案。
  const srcData = diffView?.data ?? null
  const raw = srcData !== null && !srcData.binary ? srcData.raw : null
  const sections = useMemo(
    () => (raw === null ? [] : parsePatchFiles(raw).flatMap((patch) => patch.files)),
    [raw]
  )
  const hasHunks = sections.some((section) => section.hunks.length > 0)
  const blocks = useMemo(() => changeBlockStarts(sections), [sections])
  // 文本 diff 正文（CodeView）显示着：错误 / 冲突 / 二进制 / 加载中 / 无 hunk 都没有正文。上下箭头只在此时可用
  // ——没有正文时 blockNav 可能残留上个文件的值，渲染层据此一并禁用。
  const hasTextBody =
    diffView !== null && hasHunks && diffView.error === null && diffView.file.type !== '!'

  // CodeView 条目（id = 段下标）：同 id 换内容须递增 version，库按 version 判定是否重建；段换了即递增。
  const [itemsVersion, setItemsVersion] = useState({ sections, version: 0 })
  if (itemsVersion.sections !== sections) {
    setItemsVersion({ sections, version: itemsVersion.version + 1 })
  }
  const items = useMemo(
    (): CodeViewDiffItem[] =>
      sections.map((fileDiff, i) => ({
        id: String(i),
        type: 'diff',
        fileDiff,
        version: itemsVersion.version
      })),
    [sections, itemsVersion.version]
  )

  // 不显示库的文件头（面板头部已有）；hunk 间以 hunk 头（@@ …）分隔——库默认的分隔条文案是英文且无全文时不能展开；
  // 行高同 DIFF_LINE_HEIGHT；改动行底色见 DIFF_UNSAFE_CSS
  const options = useMemo(
    (): CodeViewReactOptions<undefined, undefined> => ({
      theme: DIFF_THEMES,
      themeType: theme,
      diffStyle: splitView ? 'split' : 'unified',
      overflow: wrapLines ? 'wrap' : 'scroll',
      disableFileHeader: true,
      hunkSeparators: 'metadata',
      itemMetrics: { lineHeight: DIFF_LINE_HEIGHT },
      unsafeCSS: DIFF_UNSAFE_CSS
    }),
    [splitView, wrapLines, theme]
  )

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
      void useGit.getState().openDiff(repoPath, entry.file, entry.fromHash, entry.toHash)
    },
    [navIndex, navSequence, repoPath]
  )

  // —— 头部导航：上下切文件内改动块（块取自解析结果，位置由库按布局算，纯函数选块）。
  // 「当前块」用显式下标：按钮跳转 ±1（首末块精确禁用），其余时候按视口锚重推。 ——
  const [blockNav, setBlockNav] = useState({ prev: false, next: false })
  /** 当前改动块下标（-1 = 尚在首块之前） */
  const currentBlock = useRef(-1)
  /**
   * 按钮跳转的落点：'pending' = 已发起、库还没滚到；数值 = 库实际停下的 scrollTop（已夹在滚动范围内，到底时
   * 停不到锚位）。停在落点时不按视口重推。
   */
  const jumpLanding = useRef<number | 'pending' | null>(null)

  const syncBlockNav = useCallback((idx: number, count: number): void => {
    currentBlock.current = idx
    const prev = idx > 0
    const next = idx < count - 1
    setBlockNav((cur) => (cur.prev === prev && cur.next === next ? cur : { prev, next }))
  }, [])

  /**
   * 按视口锚重推当前块。块首行的 top 由库按布局模型现算（与它按行滚动同一算法，条目不必已渲染）；块与条目
   * 同出一份解析结果，位置必在。
   */
  const deriveBlockNav = useCallback(
    (view: CodeViewInstance): void => {
      const topOf = (index: number): number => {
        const { section, lineNumber, side } = blocks[index]
        return view.getTopForLine(String(section), lineNumber, side)!
      }
      const anchor = view.getScrollTop() + view.getHeight() * BLOCK_ANCHOR
      syncBlockNav(currentBlockIndex(blocks.length, topOf, anchor), blocks.length)
    },
    [blocks, syncBlockNav]
  )

  // 跳转交给库按行滚动：块首行对齐到视口锚，位置与滚动范围的夹紧都由库算
  const goBlock = useCallback(
    (dir: 'prev' | 'next'): void => {
      const view = codeViewRef.current?.getInstance()
      if (view === undefined) return
      const idx = currentBlock.current + (dir === 'next' ? 1 : -1)
      if (idx < 0 || idx >= blocks.length) return // 快捷键不经按钮禁用态，越界在此兜住
      const { section, lineNumber, side } = blocks[idx]
      jumpLanding.current = 'pending'
      view.scrollTo({
        type: 'line',
        id: String(section),
        lineNumber,
        side,
        align: 'start',
        offset: view.getHeight() * BLOCK_ANCHOR,
        behavior: 'instant'
      })
      syncBlockNav(idx, blocks.length)
    },
    [blocks, syncBlockNav]
  )

  // 快捷键（对齐 WebStorm）：F7/⇧F7 上下改动块，⌥←/⌥→ 左右文件。仅 diff 打开时监听，
  // capture 对齐 GitPane 的全局键盘；有弹窗显示着、输入控件聚焦时让位；Esc 仍由 GitPane 统一处理。
  const hasDiff = diffView !== null
  useEffect(() => {
    if (!hasDiff) return
    const onKey = (e: KeyboardEvent): void => {
      if (isDialogOpen()) return
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

  // 横向滚动条放在正文下方（pierre 补丁提供的接口，见 patches/@pierre__diffs@1.6.4.patch）：每个代码列一条、
  // 与代码列双向同步，内容长短都贴着面板底部。CodeView 实例在其根节点挂上时建好，先于这里的 ref。
  const attachHorizontalScrollbar = useCallback((bar: HTMLDivElement | null): void => {
    codeViewRef.current?.getInstance()?.attachHorizontalScrollbar(bar ?? undefined)
  }, [])

  // 正文挂上 / 换文件：同文件（重拉后重新挂上、关了再开）回到上次的位置，换文件从头看。换视图、切换换行与同文件
  // 内容刷新时正文不重挂，库按行锚定，停在原来看的那一行，此处不插手。
  useEffect(() => {
    if (!hasTextBody) return
    const prev = scrollPos.current
    codeViewRef.current?.scrollTo({
      type: 'position',
      position: prev.key === fileKey ? prev.top : 0,
      behavior: 'instant'
    })
  }, [hasTextBody, fileKey])

  // 当前块由滚动位置、视口高与各块位置决定，三者都在库的一轮渲染里落定（滚动、视口尺寸变化、换视图 / 换行、
  // 行高实测都会触发渲染）：正文挂上或块变了时推一次，之后每轮渲染收尾重推（补丁接口）。按钮跳转是即时滚动，
  // 发起后的第一轮渲染即落定，记下落点；停在落点时不重推，保住显式块下标，离开落点即恢复。
  useEffect(() => {
    const view = codeViewRef.current?.getInstance()
    if (!hasTextBody || view === undefined) return
    jumpLanding.current = null // 正文刚挂上或块变了：上次跳转的显式下标作废
    const follow = (): void => {
      const scrollTop = view.getScrollTop()
      if (jumpLanding.current === 'pending') jumpLanding.current = scrollTop
      if (jumpLanding.current !== null && Math.abs(scrollTop - jumpLanding.current) <= 1) return
      jumpLanding.current = null
      deriveBlockNav(view)
    }
    follow()
    return view.subscribeToRender(follow)
  }, [hasTextBody, deriveBlockNav])

  // 记下滚动位置，同文件重新挂上时回到这里
  const onScroll = useCallback(
    (scrollTop: number): void => {
      scrollPos.current = { key: fileKey, top: scrollTop }
    },
    [fileKey]
  )

  if (diffView === null) return null
  const { file, data, error } = diffView

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-deepest">
      {/* 头部：状态徽标 + 文件路径（R 显示 旧 → 新）+ 行数统计 + 修订说明
          + 按钮组（↑↓ 改动块 | ←→ 文件 | 打开文件 自动换行 视图切换 关闭） */}
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
            title={shortcutTitle('上一处改动', SHORTCUT.diffPrevBlock)}
            disabled={!hasTextBody || !blockNav.prev}
            onClick={() => goBlock('prev')}
            className={HEADER_BTN}
          >
            <ChevronUp className="size-3.5 text-[color:var(--fg-icon)]" />
          </button>
          <button
            type="button"
            title={shortcutTitle('下一处改动', SHORTCUT.diffNextBlock)}
            disabled={!hasTextBody || !blockNav.next}
            onClick={() => goBlock('next')}
            className={HEADER_BTN}
          >
            <ChevronDown className="size-3.5 text-[color:var(--fg-icon)]" />
          </button>
          <div className="mx-0.5 h-3 w-px shrink-0 bg-[var(--border-input)]" role="separator" />
          <button
            type="button"
            title={shortcutTitle('上一个文件', SHORTCUT.diffPrevFile)}
            disabled={navIndex <= 0}
            onClick={() => goFile(-1)}
            className={HEADER_BTN}
          >
            <ChevronLeft className="size-3.5 text-[color:var(--fg-icon)]" />
          </button>
          <button
            type="button"
            title={shortcutTitle('下一个文件', SHORTCUT.diffNextFile)}
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
            onClick={() => openInProjectFiles(repoPath, repoFilePath(repoPath, file.newFilePath))}
            className={HEADER_BTN}
          >
            <FolderSymlink className="size-3.5 text-[color:var(--fg-icon)]" />
          </button>
          {/* 开关：开着时点亮（同 Files 的缩略图开关：`--selection-row` 底 + 正文色，hover 不变色） */}
          <button
            type="button"
            title="自动换行"
            aria-pressed={wrapLines}
            onClick={() => void setViewPrefs({ diffWrapLines: !wrapLines })}
            className={cn(
              HEADER_BTN,
              wrapLines && 'bg-[var(--selection-row)] hover:bg-[var(--selection-row)]'
            )}
          >
            <WrapText
              className={cn(
                'size-3.5',
                wrapLines ? 'text-foreground' : 'text-[color:var(--fg-icon)]'
              )}
            />
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
            onClick={() => closeDiff(repoPath)}
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
      ) : file.type === '!' ? (
        // 冲突文件：git diff 对 unmerged 输出 combined diff（diff --cc，hunk 头 @@@）或「* Unmerged path」，
        // 不是普通的 unified diff，按二进制同款给一句说明，不等数据返回
        <CenteredHint>文件处于冲突状态，请在编辑器中解决后暂存</CenteredHint>
      ) : data !== null && data.symlinkDir === true ? (
        // 未跟踪的文件夹符号链接：git 对比不了（ADR-0059），给一句说明
        <CenteredHint>这是一个指向目录的未跟踪符号链接，没有差异可查看</CenteredHint>
      ) : data !== null && data.binary ? (
        // key=文件身份：换文件即重建组件（images 状态自然归零），不在 effect 里手动重置
        <BinaryBody
          key={fileKey}
          repoPath={repoPath}
          file={file}
          fromHash={diffView.fromHash}
          toHash={diffView.toHash}
        />
      ) : data === null ? (
        // 加载中延迟出现，快的时候不闪（§10.2）；key=文件身份：换文件即重新计时
        diffView.loading ? (
          <LoadingHint key={fileKey} label="正在加载差异…" />
        ) : null
      ) : !hasHunks ? (
        <CenteredHint>没有差异内容</CenteredHint>
      ) : (
        // 正文：CodeView 即纵向滚动容器，其下是横向滚动条（见 attachHorizontalScrollbar）；代码可选中复制。
        // 字排与 diff 底色见 main.css `.git-diff-body`，行号色取编辑器方案（JS 常量，CSS 变量传入库的 shadow DOM）
        <>
          <CodeView
            ref={codeViewRef}
            items={items}
            options={options}
            onScroll={onScroll}
            className="git-diff-body min-h-0 flex-1 select-text overflow-auto outline-none"
            style={
              { '--diffs-fg-number-override': filesLineNumberColor[theme] } as React.CSSProperties
            }
          />
          <div ref={attachHorizontalScrollbar} className="shrink-0" />
        </>
      )}
    </div>
  )
}

/**
 * 二进制文件（含 LFS 文件）正文：图片给新旧预览（object-contain + 边距，M 双栏对照 / A·U·D 单栏），
 * 其余二进制保持一句说明。图片数据经 gitFileImage 按需取（data URL），换文件时丢弃过期响应。
 */
function BinaryBody({
  repoPath,
  file,
  fromHash,
  toHash
}: {
  repoPath: string
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
      .gitFileImage(repoPath, {
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
  }, [repoPath, file, fromHash, toHash, isImage])

  if (!isImage) return <CenteredHint>二进制文件不支持对比</CenteredHint>
  if (images === null) return <LoadingHint delay={0} />
  // 两侧都读不到（超限、LFS 图片下载失败等）；用词同 Files 的图片预览失败
  if (images.oldDataUrl === null && images.newDataUrl === null) {
    return <CenteredHint error>无法预览此图片</CenteredHint>
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
