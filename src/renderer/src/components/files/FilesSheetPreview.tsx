// Files Tab · 表格预览（Excel / CSV）：react-xlsx（@extend-ai/react-xlsx）只读画表格，工作表标签、查找、缩放、
// 键盘是 DevCube 的壳（ADR-0034）。Excel 经 dc-media 一次取回；CSV / TSV 按原文转成工作簿再交库（lib/files-sheet）。
// - 用库的 DOM 渲染而非默认的画布渲染（画布不画溢出到邻格的长文字）；在页面线程解析而非后台线程（线程里没有
//   DOMParser，条件格式 / 表格样式等靠 XML 的结构会丢），所以 Excel 设了大小上限。WebAssembly 经 dc-media 读取。
// - 表格保持库的浅色（同 PDF / PPT 页面白底），不随应用深色主题翻转。
// - 工作表标签在底部（只有一张表时不出，ui/sheet-tabs）；隐藏的工作表不列。
// - 查找只查当前工作表（useSheetFind，换工作表即从头找）：格子的显示文字含查询即命中，命中格叠黄、当前命中叠橙
//   （getCellStyle），并选中当前命中、滚入视口（选中后滚动是补丁给库加的 reveal 选项，同方向键移动选中格，见 patches/
//   与 ADR-0034）。查找会话按文件记（FilesPane 给）；CSV 与编辑态共用一份（切换不关、不清空），多一个正则开关。
// - 缩放：Cmd/Ctrl+滚轮与捏合按光标、Cmd/Ctrl +/- 按视口中心逐档、Cmd/Ctrl+0 回工作表自带倍率，快捷键与 PDF / PPT
//   共用（lib/files-paged-preview）；库在 DOM 渲染下不接滚轮缩放，这里自接，锚点换算见 lib/files-sheet。
// - 方向键归格子（移动选中格），不切上一个 / 下一个文件；选中与复制用库的。
// - 阅读位置记工作表、倍率与视口左上角的格（docs/prd/files-tab.md「阅读位置」）；CSV 的纵向折成源码行、与编辑态共用，
//   两态切换按行对上。格子在表格里的位置只有库知道，读与滚经补丁给控制器加的接口（见 patches/ 与 ADR-0034）。
// - 链接：库以 window.open 开外链，交主进程开窗守卫转系统浏览器（web-contents-guard）；表内跳转库自处理。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  initWasm,
  setWasmSource,
  useXlsxViewerController,
  XlsxViewer,
  type XlsxCellStyleContext,
  type XlsxScrollerRenderProps
} from '@extend-ai/react-xlsx'
import {
  buildFilesAssetUrl,
  FILES_ASSET_XLSX,
  FILES_XLSX_PREVIEW_MAX_BYTES,
  FILES_XLSX_WASM
} from '@shared/files'
import { LoadingHint } from '@renderer/components/ui/centered-hint'
import { SheetTabs } from '@renderer/components/ui/sheet-tabs'
import { useCtrlWheelZoom, usePagedPreviewKeys } from '@renderer/lib/files-paged-preview'
import {
  csvLinePoints,
  csvToXlsxBytes,
  sheetScrollAfterZoom,
  sheetStepZoom,
  sheetWheelZoom,
  type SheetCellText
} from '@renderer/lib/files-sheet'
import { lineAtPos, posAtLine, type FilesViewState } from '@renderer/lib/files-view-state'
import type { FindSession } from '@renderer/lib/use-find-session'
import { useSheetFind } from '@renderer/lib/use-sheet-find'
import { FilesPreviewError } from './FilesPreviewError'
import { FindBar } from './FindBar'

setWasmSource(buildFilesAssetUrl(FILES_ASSET_XLSX, FILES_XLSX_WASM))

/** Excel 给 dc-media 地址与文件大小（超上限不取）；CSV / TSV 给编辑器里的文字（按扩展名分辨 TSV） */
export type FilesSheetSource =
  { kind: 'xlsx'; src: string; size: number } | { kind: 'csv'; content: string }

export function FilesSheetPreview({
  source,
  path,
  active,
  find,
  viewState
}: {
  source: FilesSheetSource
  path: string
  /** Files Tab 可见时才响应键盘 */
  active: boolean
  /** 这个文件的查找会话 */
  find: FindSession
  /** 这个文件的阅读位置：CSV 与编辑态共用源码行 */
  viewState: FilesViewState
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  /** 库的滚动视口（经 renderScroller 取得）：缩放锚点换算用 */
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [file, setFile] = useState<ArrayBuffer | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const tooLarge = source.kind === 'xlsx' && source.size > FILES_XLSX_PREVIEW_MAX_BYTES
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
    getTopLeft,
    maxZoomScale,
    minZoomScale,
    resetZoom,
    scrollToTopLeft,
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

  // —— 阅读位置 ——
  /** CSV：源码行与表格行号的对应点（纵向位置记在源码行上，与编辑态共用） */
  const csvPoints = useMemo(
    () => (kind === 'csv' ? csvLinePoints(data, tsv) : null),
    [kind, data, tsv]
  )
  /** 挂载时要恢复到的位置：工作表、倍率与视口左上角的格（带格内进度）；没看过为 null */
  const [restore] = useState(() => {
    const saved = viewState.get('sheet')
    // CSV 的纵向从源码行折算（与编辑态共用），Excel 的记在表格那一格
    let row = saved?.row
    if (csvPoints) {
      const line = viewState.get('line')
      row = line === undefined ? undefined : posAtLine(csvPoints, line)
    }
    if (!saved && row === undefined) return null
    return { tab: saved?.tab ?? 0, zoom: saved?.zoom, row: row ?? 0, col: saved?.col ?? 0 }
  })
  /**
   * 恢复走到哪一步：表格就绪后先换表（倍率按表各自记，换好才能设），再一并设倍率、把那一格滚回左上角
   *（库把滚动排在换倍率的重算之后，同一次提交不互相覆盖）；恢复完为 null，此前不往回记
   */
  const restoreStep = useRef<'tab' | 'place' | null>(restore && 'tab')
  useEffect(() => {
    if (!workbook || !restore) return
    if (restoreStep.current === 'tab') {
      restoreStep.current = 'place'
      if (restore.tab !== activeTabIndex && restore.tab < tabs.length) {
        setActiveTabIndex(restore.tab)
        return
      }
    }
    if (restoreStep.current !== 'place') return
    restoreStep.current = null
    if (restore.zoom !== undefined) setZoomScale(restore.zoom)
    const row = Math.floor(restore.row)
    const col = Math.floor(restore.col)
    scrollToTopLeft({ row, rowOffset: restore.row - row, col, colOffset: restore.col - col })
  }, [
    workbook,
    restore,
    activeTabIndex,
    tabs.length,
    setActiveTabIndex,
    setZoomScale,
    scrollToTopLeft
  ])

  /** 把当前位置记进阅读位置：CSV 的纵向折成源码行（与编辑态共用），Excel 记在表格那一格 */
  const rememberPosition = useCallback(() => {
    const at = restoreStep.current === null ? getTopLeft() : null
    if (!at) return
    const row = at.row + at.rowOffset
    if (csvPoints) viewState.set('line', lineAtPos(csvPoints, row))
    viewState.set('sheet', {
      tab: activeTabIndex,
      zoom: zoomScale,
      col: at.col + at.colOffset,
      row: csvPoints ? undefined : row
    })
  }, [getTopLeft, csvPoints, viewState, activeTabIndex, zoomScale])
  // 换表、换倍率时滚动位置未必变（没有滚动事件），也要记下
  useEffect(() => {
    if (workbook) rememberPosition()
  }, [workbook, rememberPosition])

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
  /** 当前工作表里有内容的格子及显示文字（行优先） */
  const buildCells = useCallback((): SheetCellText[] => {
    if (!activeSheet) return []
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
  }, [activeSheet, getCellDisplayValue])
  /** 选中命中的那一格并滚入视口 */
  const revealCell = useCallback(
    (cell: { row: number; col: number }) =>
      selectCell({ row: cell.row, col: cell.col }, { reveal: true }),
    [selectCell]
  )
  /** 关查找后焦点回表格 */
  const focusSheet = useCallback(() => scrollerRef.current?.focus({ preventScroll: true }), [])
  // 起点为活动格，同 PDF / PPT 从当前页起
  const sheetFind = useSheetFind({
    buildCells,
    origin: activeCell,
    reveal: revealCell,
    scope: activeTabIndex,
    onClose: focusSheet,
    find,
    regexpToggle: source.kind === 'csv'
  })
  const { layerOf } = sheetFind

  const getCellStyle = useMemo(() => {
    if (layerOf === null) return undefined
    return ({ cell, resolvedStyle }: XlsxCellStyleContext): React.CSSProperties | undefined => {
      const layer = layerOf(cell.row, cell.col)
      if (layer === undefined) return undefined
      // 叠在格子自身的渐变填充之上（有的话），不盖掉
      return {
        backgroundImage: resolvedStyle.backgroundImage
          ? `${layer}, ${resolvedStyle.backgroundImage}`
          : layer
      }
    }
  }, [layerOf])

  usePagedPreviewKeys({
    active,
    rootRef,
    findOpen: sheetFind.open,
    openFind: sheetFind.openFind,
    closeFind: sheetFind.closeFind,
    resetZoom,
    stepZoom
  })

  // 自带滚动视口（与库默认的写法相同、同样按工作表重挂）：拿到元素做缩放锚点换算，滚动时记下阅读位置
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
        onScroll={(e) => {
          viewportProps.onScroll?.(e)
          rememberPosition()
        }}
      >
        {children}
      </div>
    ),
    [activeTabIndex, rememberPosition]
  )

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      {sheetFind.open && <FindBar {...sheetFind.bar} />}
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
          loading && <LoadingHint delay={0} className="absolute inset-0 bg-deepest" />
        )}
      </div>
      {tabs.length > 1 && !error && (
        <SheetTabs
          className="h-8 shrink-0 overflow-x-auto border-t border-[var(--separator)] bg-panel px-2"
          items={tabs.map((tab) => ({ value: tab.id, label: tab.name }))}
          value={tabs[activeTabIndex]?.id ?? ''}
          onValueChange={(id) => setActiveTabIndex(tabs.findIndex((tab) => tab.id === id))}
        />
      )}
    </div>
  )
}
