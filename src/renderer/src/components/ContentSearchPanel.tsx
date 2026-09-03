// 内容搜索面板（Content Search，⌘⇧F / Ctrl+Shift+F）：居中浮层，形态对齐 WebStorm
// Find in Files——顶部查询 + 大小写/全词/正则开关 + 文件掩码；中部虚拟化结果列表
// （文件汇总行 + 命中行；行号 / 计数等附属信息统一 --fg-info 灰）；底部只读预览
// （活动行高亮 + 滚到命中行）。引擎为主进程 rg --json 流式推送，按 seq 收敛；
// 回车 / 双击 → Files Tab 打开并选中命中区间。搜索词与开关按项目会话内记忆（不落盘）。
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import {
  CaseSensitive,
  ChevronRight,
  File as FileIcon,
  ListTree,
  LoaderCircle,
  Regex,
  Search,
  WholeWord,
  X
} from 'lucide-react'
import {
  CONTENT_SEARCH_MAX_MATCHES,
  DEFAULT_CONTENT_SEARCH_OPTIONS,
  type ContentSearchMatch,
  type ContentSearchOptions
} from '@shared/content-search'
import { DialogMask, DialogPanel } from '@renderer/components/ui/form-dialog'
import {
  filesEditorTheme,
  filesHighlighting,
  languageExtensionForPath
} from '@renderer/lib/cm6-setup'
import { highlightLineSegments, type HighlightedSeg } from '@renderer/lib/cm6-highlight-line'
import type { ThemeMode } from '@shared/theme'
import { useApp } from '@renderer/store'
import { useFiles } from '@renderer/files-store'
import { cn } from '@renderer/lib/utils'

const SEARCH_DEBOUNCE_MS = 200
const ROW_H = 24

// 方形开关钮（24×24，lucide 等宽图标 16px；激活态样式同 Git 查找部件）
const TOGGLE_BTN = 'flex size-6 shrink-0 items-center justify-center rounded transition-colors'

type ResultRow =
  | { kind: 'file'; rel: string; count: number }
  | { kind: 'match'; match: ContentSearchMatch; matchIndex: number }

/** 会话内记忆（按项目：面板重开恢复同项目的搜索词、开关与分组视图；不跨项目、不跨重启）。 */
const lastSessionByProject = new Map<
  string,
  { query: string; options: ContentSearchOptions; groupByFile: boolean }
>()

/** 从连续语法片段裁出 [from, to) 的着色节点。 */
function sliceSegs(segs: HighlightedSeg[], from: number, to: number): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let pos = 0
  for (const seg of segs) {
    const start = pos
    pos += seg.text.length
    if (pos <= from) continue
    if (start >= to) break
    const piece = seg.text.slice(Math.max(start, from) - start, Math.min(pos, to) - start)
    out.push(
      seg.className ? (
        <span key={start} className={seg.className}>
          {piece}
        </span>
      ) : (
        <Fragment key={start}>{piece}</Fragment>
      )
    )
  }
  return out
}

/**
 * 结果行文本：整行按语言语法着色（单行 Lezer 解析，按行 memo）+ 命中区间盖
 * SearchMatch 胶囊——胶囊内强制深字、不透语法色（对齐平台 STYLE_SEARCH_MATCH 画法）。
 */
function MatchLineText({
  match,
  theme
}: {
  match: ContentSearchMatch
  theme: ThemeMode
}): React.JSX.Element {
  const nodes = useMemo(() => {
    const segs = highlightLineSegments(match.text, match.rel, theme)
    const parts: React.ReactNode[] = []
    let pos = 0
    match.ranges.forEach(([s, e], i) => {
      if (s > pos) parts.push(<Fragment key={`g${i}`}>{sliceSegs(segs, pos, s)}</Fragment>)
      parts.push(
        <span
          key={`m${i}`}
          className="rounded-[2.5px] bg-[var(--search-match-bg)] text-[color:var(--search-match-fg)]"
        >
          {match.text.slice(s, e)}
        </span>
      )
      pos = e
    })
    if (pos < match.text.length) {
      parts.push(<Fragment key="tail">{sliceSegs(segs, pos, match.text.length)}</Fragment>)
    }
    return parts
  }, [match, theme])
  return <>{nodes}</>
}

export function ContentSearchPanel({
  projectPath,
  onClose
}: {
  projectPath: string
  onClose: () => void
}): React.JSX.Element {
  const theme = useApp((s) => s.theme)
  const [query, setQuery] = useState(() => lastSessionByProject.get(projectPath)?.query ?? '')
  const [options, setOptions] = useState<ContentSearchOptions>(
    () => lastSessionByProject.get(projectPath)?.options ?? DEFAULT_CONTENT_SEARCH_OPTIONS
  )
  /** 按文件聚合视图：开 = 文件汇总行 + 命中行；关 = 弹窗式平铺（行尾「文件名 行号」） */
  const [groupByFile, setGroupByFile] = useState(
    () => lastSessionByProject.get(projectPath)?.groupByFile ?? true
  )
  const [matches, setMatches] = useState<ContentSearchMatch[]>([])
  const [searching, setSearching] = useState(false)
  const [limitHit, setLimitHit] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 选中的匹配（matches 下标；-1 = 无） */
  const [selected, setSelected] = useState(-1)
  /** 收起的文件（分组视图；新一轮搜索重置为全展开） */
  const [collapsedRels, setCollapsedRels] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<{ rel: string; content: string | null } | null>(null)

  /** 预览区占比：五五开默认，可拖 [0.2, 0.8]；面板每次打开重置、不持久化 */
  const [previewRatio, setPreviewRatio] = useState(0.5)
  const [previewDragging, setPreviewDragging] = useState(false)
  const splitRef = useRef<HTMLDivElement>(null)

  const seqRef = useRef(0)
  /** 当前 matches 状态对应的搜索 seq（新搜索首批结果到达时整体替换） */
  const resultsSeqRef = useRef(0)
  const previewSeqRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const previewViewRef = useRef<EditorView | null>(null)
  const [previewViewNonce, setPreviewViewNonce] = useState(0)

  const close = (): void => {
    void window.api.contentSearchStop()
    onClose()
  }

  // 会话记忆在卸载时落存（统一覆盖「关闭面板」与「面板开着切项目」两条卸载路径）
  const sessionRef = useRef({ query, options, groupByFile })
  sessionRef.current = { query, options, groupByFile }
  useEffect(() => {
    return () => {
      lastSessionByProject.set(projectPath, sessionRef.current)
    }
  }, [projectPath])

  // 面板键盘交互统一走 window 捕获监听：React onKeyDown 只在焦点位于面板内时收得到
  // 事件，点过状态行 / 滚动条等不可聚焦区域后焦点落到 body 就会失灵；window 层与焦点
  // 位置无关（Esc / ↑↓ / Enter 一套规则），capture + preventDefault 也统一压住预览
  // CodeMirror 的光标移动等默认行为。处理函数经 ref 取每次渲染的最新闭包
  // （赋值在 moveSelection / openSelected 定义之后，见下文）。
  const onGlobalKeyRef = useRef<(e: KeyboardEvent) => void>(() => {})

  // 打开即聚焦查询框；键盘监听随面板存在期注册
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
    const onKey = (e: KeyboardEvent): void => onGlobalKeyRef.current(e)
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [])

  // 结果流订阅：按 seq 收敛（旧搜索的迟到事件丢弃）；卸载时终止搜索
  useEffect(() => {
    const off = window.api.onContentSearchEvent((e) => {
      if (e.seq !== seqRef.current) return
      const fresh = resultsSeqRef.current !== e.seq
      if (fresh) resultsSeqRef.current = e.seq
      if (e.kind === 'matches') {
        setMatches((prev) => (fresh ? e.matches : prev.concat(e.matches)))
        if (fresh) {
          setSelected(0)
          setCollapsedRels(new Set())
        }
      } else {
        if (fresh) {
          setMatches([])
          setSelected(-1)
          setCollapsedRels(new Set())
        }
        setSearching(false)
        setLimitHit(e.limitHit)
        setError(e.error)
      }
    })
    return () => {
      off()
      void window.api.contentSearchStop()
    }
  }, [])

  // 防抖重搜：查询 / 开关变化即换代（旧结果保留展示到新结果到达，避免打字闪空）
  useEffect(() => {
    seqRef.current++
    setError(null)
    if (query === '') {
      resultsSeqRef.current = seqRef.current
      setMatches([])
      setSelected(-1)
      setCollapsedRels(new Set())
      setSearching(false)
      setLimitHit(false)
      void window.api.contentSearchStop()
      return
    }
    setSearching(true)
    const seq = seqRef.current
    const timer = setTimeout(() => {
      window.api.contentSearchStart(projectPath, query, options, seq).catch((err: unknown) => {
        // 启动失败（主进程抛错等）不会有 done 事件，须就地收尾，防止转圈永不结束
        if (seq !== seqRef.current) return
        setSearching(false)
        setError(err instanceof Error ? err.message : '搜索无法启动')
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, options, projectPath])

  // 结果行：分组开 = 文件汇总行 + 命中行（rg 按文件连续输出）；关 = 平铺命中行。
  // matchRowIndex 供选中滚动定位
  const { rows, matchRowIndex, fileCount } = useMemo(() => {
    const countByRel = new Map<string, number>()
    for (const m of matches) countByRel.set(m.rel, (countByRel.get(m.rel) ?? 0) + 1)
    if (!groupByFile) {
      const rows: ResultRow[] = matches.map((match, matchIndex) => ({
        kind: 'match',
        match,
        matchIndex
      }))
      return { rows, matchRowIndex: matches.map((_, i) => i), fileCount: countByRel.size }
    }
    const rows: ResultRow[] = []
    const matchRowIndex: number[] = []
    let curRel: string | null = null
    matches.forEach((m, i) => {
      if (m.rel !== curRel) {
        curRel = m.rel
        rows.push({ kind: 'file', rel: m.rel, count: countByRel.get(m.rel) ?? 0 })
      }
      // 收起文件的命中不产行；matchRowIndex 记 -1（选择导航据此跳过）
      if (collapsedRels.has(m.rel)) {
        matchRowIndex.push(-1)
        return
      }
      matchRowIndex.push(rows.length)
      rows.push({ kind: 'match', match: m, matchIndex: i })
    })
    return { rows, matchRowIndex, fileCount: countByRel.size }
  }, [matches, groupByFile, collapsedRels])

  // eslint-disable-next-line react-hooks/incompatible-library -- tanstack virtual 实例天然可变，React Compiler 跳过本组件 memo 是预期行为
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_H,
    overscan: 10
  })

  const selectedMatch = selected >= 0 && selected < matches.length ? matches[selected] : null

  const moveSelection = (dir: 1 | -1): void => {
    if (matches.length === 0) return
    // 沿方向找下一条可见命中（跳过收起文件的 -1）；到边界找不到则不动
    let next = selected < 0 ? (dir === 1 ? 0 : matches.length - 1) : selected + dir
    while (next >= 0 && next < matches.length && matchRowIndex[next] === -1) next += dir
    if (next < 0 || next >= matches.length) return
    setSelected(next)
    rowVirtualizer.scrollToIndex(matchRowIndex[next] ?? 0)
  }

  const toggleFileCollapsed = (rel: string): void => {
    setCollapsedRels((prev) => {
      const next = new Set(prev)
      if (next.has(rel)) next.delete(rel)
      else next.add(rel)
      return next
    })
  }

  const openSelected = (m: ContentSearchMatch | null = selectedMatch): void => {
    if (!m) return
    useFiles.getState().openInFiles(projectPath, `${projectPath}/${m.rel}`, {
      line: m.line,
      col: m.col,
      endCol: m.endCol
    })
    close()
  }

  // 预览：选中换文件时重读全文；非文本（二进制 / 超限 / 媒体）出占位
  const selectedRel = selectedMatch?.rel ?? null
  useEffect(() => {
    if (selectedRel === null) {
      previewSeqRef.current++
      setPreview(null)
      return
    }
    const seq = ++previewSeqRef.current
    void window.api
      .filesRead(projectPath, `${projectPath}/${selectedRel}`)
      .then((r) => {
        if (seq !== previewSeqRef.current) return
        setPreview({ rel: selectedRel, content: r.kind === 'text' ? r.content : null })
      })
      .catch(() => {
        if (seq === previewSeqRef.current) setPreview({ rel: selectedRel, content: null })
      })
  }, [selectedRel, projectPath])

  // 预览定位：光标落到命中行（活动行高亮）并滚到中部；同文件换行复用既有 view
  useEffect(() => {
    const view = previewViewRef.current
    if (!view || !selectedMatch || preview?.rel !== selectedMatch.rel) return
    const doc = view.state.doc
    const line = doc.line(Math.min(Math.max(selectedMatch.line, 1), doc.lines))
    const anchor = Math.min(line.from + selectedMatch.col, line.to)
    view.dispatch({
      selection: { anchor },
      effects: EditorView.scrollIntoView(anchor, { y: 'center' })
    })
  }, [selectedMatch, preview, previewViewNonce])

  const previewExtensions = useMemo(
    () =>
      preview
        ? [
            filesEditorTheme[theme],
            filesHighlighting[theme],
            languageExtensionForPath(preview.rel),
            EditorView.editable.of(false)
          ]
        : [],
    [theme, preview]
  )

  onGlobalKeyRef.current = (e) => {
    if (e.isComposing) return
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      moveSelection(e.key === 'ArrowDown' ? 1 : -1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      openSelected()
    }
  }

  // 分隔线拖拽（同 Git 详情面板写法：全局监听、mouseup 摘除、拖中全屏遮罩保光标）
  const startPreviewDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    setPreviewDragging(true)
    const onMove = (ev: MouseEvent): void => {
      const rect = splitRef.current?.getBoundingClientRect()
      if (!rect || rect.height === 0) return
      setPreviewRatio(Math.min(0.8, Math.max(0.2, 1 - (ev.clientY - rect.top) / rect.height)))
    }
    const onUp = (): void => {
      setPreviewDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const toggle = (key: 'caseSensitive' | 'wholeWord' | 'regex'): void => {
    setOptions((o) => ({ ...o, [key]: !o[key] }))
  }
  const toggleCls = (active: boolean): string =>
    cn(
      TOGGLE_BTN,
      active
        ? 'bg-[var(--selection-row)] text-foreground'
        : 'text-muted-foreground hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]'
    )

  const statusText =
    query === ''
      ? '输入以在当前项目中搜索'
      : searching
        ? '搜索中…'
        : matches.length === 0
          ? '无匹配结果'
          : `${matches.length} 处匹配 · ${fileCount} 个文件` +
            (limitHit ? `（已达 ${CONTENT_SEARCH_MAX_MATCHES} 条上限，请细化搜索）` : '')

  return (
    <DialogMask onClick={close}>
      <DialogPanel className="flex h-[80vh] max-h-[960px] w-[760px] max-w-[90vw] flex-col overflow-hidden">
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--separator)] px-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="在当前项目中搜索"
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-[color:var(--fg-disabled)]"
          />
          <button
            type="button"
            title="区分大小写"
            onClick={() => toggle('caseSensitive')}
            className={toggleCls(options.caseSensitive)}
          >
            <CaseSensitive className="size-4" />
          </button>
          <button
            type="button"
            title="全词匹配"
            onClick={() => toggle('wholeWord')}
            className={toggleCls(options.wholeWord)}
          >
            <WholeWord className="size-4" />
          </button>
          <button
            type="button"
            title="使用正则表达式"
            onClick={() => toggle('regex')}
            className={toggleCls(options.regex)}
          >
            <Regex className="size-4" />
          </button>
          <span className="mx-1 h-4 w-px shrink-0 bg-[var(--border-input)]" />
          <input
            value={options.fileMask}
            onChange={(e) => setOptions((o) => ({ ...o, fileMask: e.target.value }))}
            placeholder="文件掩码"
            title="按 glob 收窄文件（如 *.ts；逗号分隔多个）"
            className="h-6 w-28 shrink-0 rounded bg-transparent px-1 text-[12px] text-foreground outline-none transition-colors placeholder:text-[color:var(--fg-disabled)] focus:bg-[var(--bg-row-hover)]"
          />
          <button
            type="button"
            title="关闭 (Esc)"
            onClick={close}
            className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]"
          >
            <X className="size-4" />
          </button>
        </div>

        <div ref={splitRef} className="flex min-h-0 flex-1 flex-col">
          {/* 上半区 = 汇总状态行 + 列表（与下半区「标题栏 + 预览」对称，五五开按整块算） */}
          <div
            className="flex min-h-0 flex-col"
            style={{
              height:
                selectedMatch !== null && preview !== null ? `${(1 - previewRatio) * 100}%` : '100%'
            }}
          >
            <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-[var(--separator)] px-3 text-[12px]">
              {searching && <LoaderCircle className="size-3 animate-spin text-muted-foreground" />}
              {error !== null ? (
                <span className="min-w-0 flex-1 select-text truncate text-[color:var(--status-failed)]">
                  {error}
                </span>
              ) : (
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{statusText}</span>
              )}
              <button
                type="button"
                title="按文件分组"
                onClick={() => setGroupByFile((v) => !v)}
                className={toggleCls(groupByFile)}
              >
                <ListTree className="size-3.5" />
              </button>
            </div>
            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
              <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
                {rowVirtualizer.getVirtualItems().map((vi) => {
                  const row = rows[vi.index]
                  return (
                    <div
                      key={vi.key}
                      className="absolute left-0 top-0 w-full"
                      style={{ transform: `translateY(${vi.start}px)` }}
                    >
                      {row.kind === 'file' ? (
                        <div
                          className="flex h-6 cursor-pointer items-center gap-1.5 px-3 transition-colors hover:bg-[var(--bg-row-hover)]"
                          title={row.rel}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => toggleFileCollapsed(row.rel)}
                        >
                          <FileIcon className="size-3.5 shrink-0 text-[color:var(--fg-icon)]" />
                          <span className="shrink-0 text-[13px] text-foreground">
                            {row.rel.split('/').pop()}
                          </span>
                          {/* 目录为空（项目根下文件）时不渲染，避免空节点白占一个 gap */}
                          {row.rel.includes('/') && (
                            <span className="min-w-0 truncate text-[12px] text-[color:var(--fg-info)]">
                              {row.rel.slice(0, row.rel.lastIndexOf('/'))}
                            </span>
                          )}
                          {/* 计数徽标跟随在后（VS Code 搜索侧栏的视觉语言），不与行尾行号同槽 */}
                          <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-[var(--bg-button-hover)] px-1.5 text-[11px] text-[color:var(--fg-dialog-title)]">
                            {row.count}
                          </span>
                          {/* 开合箭头置最右，树式朝向（展开 ∨ / 收起 ▶，同 VS Code 侧栏分组头的方向逻辑） */}
                          <span className="ml-auto flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
                            <ChevronRight
                              className={cn(
                                'size-3.5 transition-transform',
                                !collapsedRels.has(row.rel) && 'rotate-90'
                              )}
                            />
                          </span>
                        </div>
                      ) : (
                        <div
                          className={cn(
                            'flex h-6 cursor-pointer items-center gap-3 px-3 transition-colors',
                            groupByFile && 'pl-8',
                            row.matchIndex === selected
                              ? 'bg-[var(--selection-row)]'
                              : 'hover:bg-[var(--bg-row-hover)]'
                          )}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => setSelected(row.matchIndex)}
                          onDoubleClick={() => openSelected(row.match)}
                        >
                          <span className="code-line-text min-w-0 flex-1 truncate text-[color:var(--fg-code)]">
                            <MatchLineText match={row.match} theme={theme} />
                          </span>
                          {groupByFile ? (
                            <span className="shrink-0 text-[12px] text-[color:var(--fg-info)]">
                              {row.match.line}
                            </span>
                          ) : (
                            // 平铺态对齐弹窗：行尾「文件名 行号」；连续同文件仅文件名淡化表从属
                            <span
                              title={row.match.rel}
                              className="max-w-[45%] shrink-0 truncate text-[12px] text-[color:var(--fg-info)]"
                            >
                              <span
                                className={
                                  row.matchIndex > 0 &&
                                  matches[row.matchIndex - 1].rel === row.match.rel
                                    ? 'opacity-50'
                                    : undefined
                                }
                              >
                                {row.match.rel.split('/').pop()}
                              </span>{' '}
                              {row.match.line}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {selectedMatch !== null && preview !== null && (
            <div className="relative flex min-h-0 flex-1 flex-col border-t border-[var(--separator)]">
              {/* 分隔线拖拽把手：6px 热区骑在上边框上（OnePixelSplitter 的等价物） */}
              <div
                className="absolute -top-[3px] left-0 right-0 z-20 h-[6px] cursor-row-resize"
                onMouseDown={startPreviewDrag}
              />
              {/* 预览标题栏（对齐 WebStorm 弹窗：文件名 + 灰路径） */}
              <div
                className="flex h-7 shrink-0 items-center gap-1.5 border-b border-[var(--separator)] px-3"
                title={selectedMatch.rel}
              >
                <span className="shrink-0 text-[13px] text-foreground">
                  {selectedMatch.rel.split('/').pop()}
                </span>
                <span className="min-w-0 truncate text-[12px] text-[color:var(--fg-info)]">
                  {selectedMatch.rel.includes('/')
                    ? selectedMatch.rel.slice(0, selectedMatch.rel.lastIndexOf('/'))
                    : ''}
                </span>
              </div>
              <div className="files-codemirror min-h-0 flex-1 overflow-hidden bg-deepest">
                {preview.content === null ? (
                  <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
                    无法预览此文件
                  </div>
                ) : (
                  <CodeMirror
                    key={preview.rel}
                    value={preview.content}
                    height="100%"
                    theme="none"
                    extensions={previewExtensions}
                    basicSetup={{
                      lineNumbers: true,
                      foldGutter: false,
                      highlightActiveLine: true,
                      highlightActiveLineGutter: true,
                      syntaxHighlighting: false
                    }}
                    editable={false}
                    onCreateEditor={(view) => {
                      previewViewRef.current = view
                      setPreviewViewNonce((n) => n + 1)
                    }}
                    className="h-full [&_.cm-editor]:h-full [&_.cm-editor]:outline-none"
                  />
                )}
              </div>
            </div>
          )}
        </div>
        {/* 拖拽期间的全屏遮罩：保持光标形态并防止误触其它元素 */}
        {previewDragging && <div className="fixed inset-0 z-50 cursor-row-resize" />}
      </DialogPanel>
    </DialogMask>
  )
}
