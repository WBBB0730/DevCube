// Files Tab · 表格预览（Excel / CSV）：react-xlsx（@extend-ai/react-xlsx）只读画表格，工作表标签、查找、缩放、
// 键盘是 DevCube 的壳（ADR-0034）。Excel 经 dc-media 一次取回；CSV / TSV 按原文转成工作簿再交库（lib/files-sheet）。
// - 用库的 DOM 渲染而非默认的画布渲染（画布不画溢出到邻格的长文字）；在页面线程解析而非后台线程（线程里没有
//   DOMParser，条件格式 / 表格样式等靠 XML 的结构会丢），所以 Excel 设了大小上限。WebAssembly 经 dc-media 读取。
// - 表格保持库的浅色（同 PDF / PPT 页面白底），不随应用深色主题翻转。
// - 工作表标签在底部（只有一张表时不出）；隐藏的工作表不列。
// - 查找只查当前工作表：格子的显示文字含查询即命中，命中格叠黄、当前命中叠橙（getCellStyle），并选中当前命中、
//   滚入视口（选中后滚动是补丁给库加的 reveal 选项，同方向键移动选中格，见 patches/ 与 ADR-0034）。
// - 缩放：Cmd/Ctrl+滚轮与捏合按光标、Cmd/Ctrl +/- 按视口中心逐档、Cmd/Ctrl+0 回工作表自带倍率，快捷键与 PDF / PPT
//   共用（lib/files-paged-preview）；库在 DOM 渲染下不接滚轮缩放，这里自接，锚点换算见 lib/files-sheet。
// - 方向键归格子（移动选中格），不切上一个 / 下一个文件；选中与复制用库的。
// - 链接：库以 window.open 开外链，交主进程开窗守卫转系统浏览器（web-contents-guard）；表内跳转库自处理。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  initWasm,
  setWasmSource,
  useXlsxViewerController,
  XlsxViewer,
  type XlsxCellAddress,
  type XlsxCellStyleContext,
  type XlsxScrollerRenderProps
} from '@extend-ai/react-xlsx'
import { buildFilesAssetUrl, FILES_ASSET_XLSX, FILES_XLSX_WASM } from '@shared/files'
import { cn } from '@renderer/lib/utils'
import { useCtrlWheelZoom, usePagedPreviewKeys } from '@renderer/lib/files-paged-preview'
import {
  csvToXlsxBytes,
  sheetFindMatches,
  sheetFirstMatchFrom,
  sheetScrollAfterZoom,
  sheetStepZoom,
  sheetWheelZoom,
  XLSX_PREVIEW_MAX_BYTES,
  type SheetCellText
} from '@renderer/lib/files-sheet'
import { FilesPreviewError } from './FilesPreviewError'
import { FindBar } from './FindBar'

setWasmSource(buildFilesAssetUrl(FILES_ASSET_XLSX, FILES_XLSX_WASM))

/** 查找命中的底色：叠在格子原有底色之上的半透明层，命中黄 / 当前橙同 PDF / PPT */
const FIND_MATCH_LAYER = 'linear-gradient(rgb(252 212 126 / 0.55), rgb(252 212 126 / 0.55))'
const FIND_CURRENT_LAYER = 'linear-gradient(rgb(196 114 51 / 0.55), rgb(196 114 51 / 0.55))'

/** Excel 给 dc-media 地址与文件大小（超上限不取）；CSV / TSV 给编辑器里的文字（按扩展名分辨 TSV） */
export type FilesSheetSource =
  { kind: 'xlsx'; src: string; size: number } | { kind: 'csv'; content: string }

const cellKey = (cell: XlsxCellAddress): string => `${cell.row}:${cell.col}`

export function FilesSheetPreview({
  source,
  path,
  active
}: {
  source: FilesSheetSource
  path: string
  /** Files Tab 可见时才响应键盘 */
  active: boolean
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  /** 库的滚动视口（经 renderScroller 取得）：缩放锚点换算用 */
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [file, setFile] = useState<ArrayBuffer | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findFocusNonce, setFindFocusNonce] = useState(0)
  const [findQuery, setFindQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  /** 这次查找从哪一格起（打开查找 / 改查询时的活动格），首个命中取它及之后的第一个，同 PDF / PPT 从当前页起 */
  const [findFrom, setFindFrom] = useState<XlsxCellAddress | null>(null)
  /** 上一个 / 下一个选中的命中下标；null = 取 `findFrom` 起的首个 */
  const [activeMatch, setActiveMatch] = useState<number | null>(null)

  const tooLarge = source.kind === 'xlsx' && source.size > XLSX_PREVIEW_MAX_BYTES
  const kind = source.kind
  const data = source.kind === 'xlsx' ? source.src : source.content
  const tsv = source.kind === 'csv' && path.toLowerCase().endsWith('.tsv')

  // 取文件 / 转换；CSV 改了内容重转时先留着旧表，转好再换，不闪空白
  useEffect(() => {
    if (tooLarge) return
    let dead = false
    void (async () => {
      try {
        let bytes: ArrayBuffer
        if (kind === 'xlsx') {
          const res = await fetch(data)
          if (!res.ok) throw new Error(`读取失败（${res.status}）`)
          bytes = await res.arrayBuffer()
        } else {
          await initWasm()
          bytes = csvToXlsxBytes(data, tsv).slice().buffer
        }
        if (dead) return
        setFile(bytes)
        setLoadError(null)
      } catch (e) {
        if (!dead) setLoadError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      dead = true
    }
  }, [kind, data, tsv, tooLarge])

  const controller = useXlsxViewerController({
    file: file ?? undefined,
    fileName: path.slice(path.lastIndexOf('/') + 1),
    readOnly: true,
    useWorker: false
  })
  const {
    activeCell,
    activeSheet,
    activeTabIndex,
    getCellDisplayValue,
    maxZoomScale,
    minZoomScale,
    resetZoom,
    selectCell,
    setActiveTabIndex,
    setZoomScale,
    tabs,
    workbook,
    zoomScale
  } = controller
  const error = loadError ?? controller.error?.message ?? null
  const loading = !error && (!file || controller.isLoading)

  // 表格就绪时把焦点交给表格：Cmd+F、缩放与方向键立即可用（同 PDF / PPT 打开即聚焦正文）；CSV 重转不再抢焦点
  const focusedOnce = useRef(false)
  useEffect(() => {
    if (!workbook || focusedOnce.current) return
    focusedOnce.current = true
    scrollerRef.current?.focus({ preventScroll: true })
  }, [workbook])

  // —— 缩放 ——
  /**
   * 最近一次请求的倍率（连续值）：连续滚轮在提交前多次换倍率时以它为基准（同 PPT）；
   * 库只收整数百分比，在这里累积、提交时取整，小幅捏合才不会原地打转
   */
  const requestedZoomRef = useRef(zoomScale)
  /** 已提交给表格的倍率：待落锚点的换算起点 */
  const committedZoomRef = useRef(zoomScale)
  /** 待落的锚点：新倍率提交后按它换算滚动位置（库自己只会按左上角换算） */
  const pendingZoom = useRef<{
    scroll: { left: number; top: number }
    anchor: { x: number; y: number }
    from: number
  } | null>(null)

  /** 换到 `target` 倍率，让 `anchor`（滚动视口内坐标）下的内容留在原处 */
  const applyZoom = useCallback(
    (target: number, anchor: { x: number; y: number }) => {
      const scroller = scrollerRef.current
      if (!scroller) return
      const next = Math.round(target)
      pendingZoom.current =
        next === committedZoomRef.current
          ? null
          : {
              scroll: { left: scroller.scrollLeft, top: scroller.scrollTop },
              anchor,
              from: committedZoomRef.current
            }
      setZoomScale(next)
    },
    [setZoomScale]
  )

  // 新倍率的表格尺寸已提交（库的布局副作用先于这里执行），这时再按锚点落滚动位置
  useLayoutEffect(() => {
    const pending = pendingZoom.current
    const scroller = scrollerRef.current
    pendingZoom.current = null
    committedZoomRef.current = zoomScale
    if (!pending || !scroller) {
      // 换工作表 / 回工作表自带倍率：从新倍率接着算
      requestedZoomRef.current = zoomScale
      return
    }
    const target = sheetScrollAfterZoom(pending.scroll, pending.anchor, pending.from, zoomScale)
    scroller.scrollLeft = target.left
    scroller.scrollTop = target.top
  }, [zoomScale])

  // Cmd/Ctrl+滚轮 / 捏合：按光标缩放（坐标换成滚动视口内的）
  const onWheelZoom = useCallback(
    (factor: number, origin: { x: number; y: number }) => {
      const wrap = wrapRef.current
      const scroller = scrollerRef.current
      if (!wrap || !scroller || !workbook) return
      const offset = wrap.getBoundingClientRect()
      const view = scroller.getBoundingClientRect()
      requestedZoomRef.current = sheetWheelZoom(
        requestedZoomRef.current,
        factor,
        minZoomScale,
        maxZoomScale
      )
      applyZoom(requestedZoomRef.current, {
        x: origin.x + offset.left - view.left,
        y: origin.y + offset.top - view.top
      })
    },
    [applyZoom, maxZoomScale, minZoomScale, workbook]
  )
  useCtrlWheelZoom(wrapRef, onWheelZoom)

  /** 键盘逐档缩放：按视口中心锚定（同看图 / PDF / PPT） */
  const stepZoom = useCallback(
    (steps: 1 | -1) => {
      const scroller = scrollerRef.current
      if (!scroller || !workbook) return
      requestedZoomRef.current = sheetStepZoom(
        requestedZoomRef.current,
        steps,
        minZoomScale,
        maxZoomScale
      )
      applyZoom(requestedZoomRef.current, {
        x: scroller.clientWidth / 2,
        y: scroller.clientHeight / 2
      })
    },
    [applyZoom, maxZoomScale, minZoomScale, workbook]
  )

  // —— 查找 ——
  /** 当前工作表里有内容的格子及显示文字（行优先），打开查找时建一次，之后每次输入只在其中搜 */
  const cellTexts = useMemo<SheetCellText[]>(() => {
    if (!findOpen || !activeSheet) return []
    const hiddenRows = new Set(activeSheet.hiddenRows)
    const hiddenCols = new Set(activeSheet.hiddenCols)
    const cells: SheetCellText[] = []
    for (let row = activeSheet.minUsedRow; row <= activeSheet.maxUsedRow; row++) {
      if (hiddenRows.has(row)) continue
      for (let col = activeSheet.minUsedCol; col <= activeSheet.maxUsedCol; col++) {
        if (hiddenCols.has(col)) continue
        const text = getCellDisplayValue({ row, col })
        if (text !== '') cells.push({ row, col, text })
      }
    }
    return cells
  }, [findOpen, activeSheet, getCellDisplayValue])
  const matches = useMemo(
    () => sheetFindMatches(cellTexts, findQuery, { caseSensitive, wholeWord }),
    [cellTexts, findQuery, caseSensitive, wholeWord]
  )
  const current =
    activeMatch !== null && activeMatch < matches.length
      ? activeMatch
      : sheetFirstMatchFrom(matches, findFrom)
  const currentMatch = current >= 0 ? matches[current] : null

  // 当前命中一变就选中并滚入视口（缩放等重渲染不再动选区与滚动）
  const selectedFor = useRef<SheetCellText | null>(null)
  useEffect(() => {
    if (selectedFor.current === currentMatch) return
    selectedFor.current = currentMatch
    if (currentMatch) selectCell({ row: currentMatch.row, col: currentMatch.col }, { reveal: true })
  }, [currentMatch, selectCell])

  const getCellStyle = useMemo(() => {
    if (!findOpen || matches.length === 0) return undefined
    const all = new Set(matches.map(cellKey))
    const currentKey = currentMatch ? cellKey(currentMatch) : null
    return ({ cell, resolvedStyle }: XlsxCellStyleContext): React.CSSProperties | undefined => {
      const key = cellKey(cell)
      if (!all.has(key)) return undefined
      const layer = key === currentKey ? FIND_CURRENT_LAYER : FIND_MATCH_LAYER
      // 叠在格子自身的渐变填充之上（有的话），不盖掉
      return {
        backgroundImage: resolvedStyle.backgroundImage
          ? `${layer}, ${resolvedStyle.backgroundImage}`
          : layer
      }
    }
  }, [findOpen, matches, currentMatch])

  /** 新一轮查找（打开 / 改查询 / 改选项）：从活动格起找 */
  const restartFind = (): void => {
    setActiveMatch(null)
    setFindFrom(activeCell)
  }

  const openFind = useCallback(() => {
    setFindOpen(true)
    setFindFocusNonce((n) => n + 1)
    setActiveMatch(null)
    setFindFrom(activeCell)
  }, [activeCell])

  const closeFind = useCallback(() => {
    setFindOpen(false)
    scrollerRef.current?.focus({ preventScroll: true })
  }, [])

  /** 换工作表：查找改在新表里从头找 */
  const selectTab = (index: number): void => {
    setActiveTabIndex(index)
    setActiveMatch(null)
    setFindFrom(null)
  }

  usePagedPreviewKeys({
    active,
    rootRef,
    findOpen,
    openFind,
    closeFind,
    resetZoom,
    stepZoom
  })

  // 自带滚动视口（与库默认的写法相同、同样按工作表重挂），只为拿到元素做缩放锚点换算
  const renderScroller = useCallback(
    ({ children, viewportProps }: XlsxScrollerRenderProps) => (
      <div
        key={activeTabIndex}
        {...viewportProps}
        ref={(el) => {
          scrollerRef.current = el
          const { ref } = viewportProps
          if (typeof ref === 'function') ref(el)
          else if (ref) ref.current = el
        }}
      >
        {children}
      </div>
    ),
    [activeTabIndex]
  )

  const countLabel =
    !findOpen || findQuery === ''
      ? null
      : matches.length === 0
        ? '无结果'
        : `${current + 1}/${matches.length}`

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      {findOpen && (
        <FindBar
          query={findQuery}
          onQueryChange={(q) => {
            setFindQuery(q)
            restartFind()
          }}
          focusNonce={findFocusNonce}
          countLabel={countLabel}
          caseSensitive={caseSensitive}
          onToggleCaseSensitive={() => {
            setCaseSensitive((v) => !v)
            restartFind()
          }}
          wholeWord={wholeWord}
          onToggleWholeWord={() => {
            setWholeWord((v) => !v)
            restartFind()
          }}
          canNavigate={matches.length > 0}
          onNavigate={(dir) => setActiveMatch((current + dir + matches.length) % matches.length)}
          onClose={closeFind}
        />
      )}
      <div ref={wrapRef} className="relative flex min-h-0 flex-1 flex-col bg-deepest">
        {file && !tooLarge && (
          <XlsxViewer
            controller={controller}
            experimentalCanvas={false}
            enableGestureZoom={false}
            showDefaultToolbar={false}
            rounded={false}
            height="100%"
            getCellStyle={getCellStyle}
            renderScroller={renderScroller}
            loadingState={null}
            errorState={null}
          />
        )}
        {tooLarge ? (
          <FilesPreviewError title="文件较大" message="超过 10 MB 的表格不在此预览" path={path} />
        ) : error ? (
          <FilesPreviewError title="无法预览此表格" message={error} path={path} />
        ) : (
          loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-deepest text-sm text-muted-foreground">
              正在加载…
            </div>
          )
        )}
      </div>
      {tabs.length > 1 && !error && (
        <div className="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-t border-[var(--separator)] bg-panel px-2">
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              type="button"
              title={tab.name}
              className={cn(
                'h-6 max-w-48 shrink-0 truncate rounded px-2 text-[13px] transition-colors',
                index === activeTabIndex
                  ? 'bg-[var(--selection-row)] text-foreground'
                  : 'text-muted-foreground hover:bg-[var(--bg-row-hover)] hover:text-foreground'
              )}
              onClick={() => selectTab(index)}
            >
              {tab.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
