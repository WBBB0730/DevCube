import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import CodeMirror from '@uiw/react-codemirror'
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Folder,
  FolderOpen,
  LoaderCircle,
  Minus,
  Search,
  X
} from 'lucide-react'
import {
  pushRecentPath,
  type FilesDirEntry,
  type FilesReadResult,
  type FilesUiState
} from '@shared/files'
import { flattenFilesTree } from '@shared/files-tree-flatten'
import type { GitFileStatus } from '@shared/git'
import { normalizePath, remapPathPrefix } from '@shared/files-path'
import { mergeReloadedDirs, resolveOpenTextDiskSync } from '@shared/files-watch'
import { SHORTCUT } from '@shared/shortcut-label'
import { shortcutTitle } from '@renderer/lib/shortcut-label'
import { cn } from '@renderer/lib/utils'
import {
  FILES_BASIC_SETUP,
  filesEditorConfig,
  filesEditorTheme,
  filesGutters,
  filesHighlighting,
  languageExtensionForPath
} from '@renderer/lib/cm6-setup'
import { EditorView, keymap } from '@codemirror/view'
import { filesFindExtension, setFindQuery } from '@renderer/lib/cm6-find'
import { gitDiffGutter, type GitGutterHunkClickPayload } from '@renderer/lib/cm6-git-gutter'
import { FilesFindWidget } from './FilesFindWidget'
import {
  adjacentMediaPath,
  isMarkdownPath,
  isPreviewableSourcePath,
  isSvgPath
} from '@shared/files-kind'
import { FilesGutterHunkPopover } from './FilesGutterHunkPopover'
import { FilesMarkdownPreview } from './FilesMarkdownPreview'
import type { MediaFitMode } from '@renderer/lib/files-media-zoom'
import {
  FilesMediaPreview,
  FilesSvgPreview,
  MediaFitButtons,
  type MediaPreviewHandle
} from './FilesMediaPreview'
import { FilesEntryDialog, type FilesEntryDialogRequest } from './FilesEntryDialog'
import { FilesTreeMenu, type FilesTreeMenuTarget } from './FilesTreeMenu'
import { FilesPdfPreview } from './FilesPdfPreview'
import { FilesToolbar, TOOLBAR_BTN } from './FilesToolbar'
import { FilesContentMenu, type FilesContentMenuTarget } from './FilesContentMenu'
import { FilesTreeIcon } from './FilesTreeIcon'
import { arrowDirection, editableTarget, overlayOpen } from '@renderer/lib/files-key-guards'
import { filterFilesTreeByType, type FilesTypeCategory } from '@shared/files-type-filter'
import { FILES_ALL_TYPES, PreviewTypeFilterButton } from './PreviewTreeControls'
import { relPathUnderRoot, toSysPath } from '@renderer/lib/files-paths'
import { useFiles } from '@renderer/files-store'
import { useApp } from '@renderer/store'
import { FormDialogShell } from '@renderer/components/ui/form-dialog'
import { FILE_STATUS_COLOR, workingTreeStatusByPath } from '@renderer/components/git/git-details'

/** 内容搜索跳转请求（FilesPane → FilesTextEditor）：定位行与选中区间。 */
interface EditorJumpRequest {
  path: string
  line: number
  col?: number
  endCol?: number
  nonce: number
}

const IDLE_SAVE_MS = 2000
const FILTER_DEBOUNCE_MS = 200
const TREE_W = 280
/** 树行固定高（h-8）；虚拟滚动按此定位，改行高须同步 ROW。 */
const TREE_ROW_H = 32
/** 交互对齐左树（选中色 / hover / transition）；尺寸更紧凑（非左树 h-10/14px）。 */
const ROW =
  'flex h-8 w-full cursor-pointer items-center gap-1 rounded px-1.5 text-left text-[13px] text-foreground transition-colors'

type Loaded =
  | { kind: 'text'; path: string; content: string; mtimeMs: number; dirty: boolean }
  | {
      kind: 'image'
      path: string
      mediaUrl: string
      mime: string
      width?: number
      height?: number
      tiled?: boolean
    }
  | { kind: 'audio'; path: string; mediaUrl: string; mime: string }
  | { kind: 'video'; path: string; mediaUrl: string; mime: string }
  | { kind: 'pdf'; path: string; mediaUrl: string }
  | { kind: 'other'; path: string; size: number }
  | null

async function loadWorkingTreeStatus(rootPath: string): Promise<Map<string, GitFileStatus>> {
  try {
    const result = await window.api.gitDetails(rootPath, { kind: 'uncommitted' })
    return result.error || !result.uncommitted
      ? new Map()
      : workingTreeStatusByPath(result.uncommitted)
  } catch {
    return new Map()
  }
}

/**
 * 面板宿主（docs/prd/file-preview-window.md「同一个组件、两种宿主」）：
 * - project：主窗口 Files Tab——根即 Project 根，状态按项目落盘，树菜单含「在终端中打开」。
 * - preview：Preview Window——根可在树菜单「上一级」/「作为根目录」换、初始文件由宿主给、状态只在窗口内存，
 *   树顶栏多「按类型筛选」（集合由宿主持有以跨换根保留）；「添加为项目 / 转到项目」在窗口顶栏与树空白区菜单各一份。
 */
export type FilesPaneHost =
  | { kind: 'project' }
  | {
      kind: 'preview'
      /** 初始打开的文件（已删除等无文件时 null） */
      initialFile: string | null
      /** 「上一级」（树空白区右键菜单）；null = 已到文件系统根 */
      onAscend: (() => void) | null
      /** 「添加为项目」/「转到项目」（树空白区右键菜单；窗口顶栏另有一份） */
      onAddProject: () => void
      projectRegistered: boolean
      /** 当前打开文件变化（宿主上翻根时据此保留打开的文件） */
      onOpenPathChange: (path: string | null) => void
      /** 把某目录设为树的根（树菜单「作为根目录」） */
      onSetRoot: (dir: string) => void
      /** 树顶类型筛选（勾选类别集合；全选即未筛选） */
      typeFilter: ReadonlySet<FilesTypeCategory>
      onTypeFilterChange: (next: ReadonlySet<FilesTypeCategory>) => void
    }

const PROJECT_HOST: FilesPaneHost = { kind: 'project' }

export function FilesPane({
  rootPath,
  visible,
  host = PROJECT_HOST
}: {
  /** 树的根（项目根或预览窗口当前根） */
  rootPath: string
  visible: boolean
  host?: FilesPaneHost
}): React.JSX.Element {
  const rootLogical = normalizePath(rootPath)
  /** 只有项目宿主落盘（上次打开 / 展开 / 最近）；预览窗口是临时的 */
  const persist = host.kind === 'project'
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [childrenByDir, setChildrenByDir] = useState<Record<string, FilesDirEntry[]>>({})
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Loaded>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ disk: string; mtimeMs: number } | null>(null)
  /** 相对项目根路径 → 工作区 Git 状态（与提交面板文件树上色同源） */
  const [statusByRel, setStatusByRel] = useState<Map<string, GitFileStatus>>(() => new Map())
  /** 当前打开文本文件在 HEAD 的基线（gutter diff 条纹）；无基线为 null */
  const [headText, setHeadText] = useState<{ path: string; content: string } | null>(null)
  const [recentPaths, setRecentPaths] = useState<string[]>([])

  const loadedRef = useRef(loaded)
  const recentPathsRef = useRef(recentPaths)
  const expandedRef = useRef(expanded)
  const childrenByDirRef = useRef(childrenByDir)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const treeScrollRef = useRef<HTMLDivElement>(null)
  /** 看图相机：工具栏「适应」钮组驱动 */
  const imageRef = useRef<MediaPreviewHandle>(null)
  /** 仅「打开文件 / 显式定位」时滚入；点目录改 expanded 不滚。 */
  const prevSelectedPath = useRef<string | null>(null)
  const pendingScrollPath = useRef<string | null>(null)
  /** 看图当前所处的档；null = 自由倍率，四颗钮都不亮。 */
  const [imageFit, setImageFit] = useState<MediaFitMode | null>(null)
  /** 同路径再次「在文件树中显示」时强制重跑滚动。 */
  const [revealTick, setRevealTick] = useState(0)
  /** 右侧文件树可见性；不持久化，重挂载默认展开。 */
  const [treeVisible, setTreeVisible] = useState(true)
  /** Markdown / SVG 编辑 ↔ 预览两态；会话内保持，不持久化，默认编辑。 */
  const [sourcePreview, setSourcePreview] = useState(false)
  /** PDF 缩略图侧栏可见性；会话内保持，不持久化，默认显示。 */
  const [pdfThumbnails, setPdfThumbnails] = useState(true)
  /** 文件树右键菜单目标与条目操作弹窗（新建 / 重命名 / 删除）。 */
  const [treeMenu, setTreeMenu] = useState<FilesTreeMenuTarget | null>(null)
  /** 正文区（看图 / SVG 预览）右键菜单：复制图片 / 在文件夹中显示 / 在其他应用中打开 */
  const [contentMenu, setContentMenu] = useState<FilesContentMenuTarget | null>(null)
  const [entryDialog, setEntryDialog] = useState<FilesEntryDialogRequest | null>(null)
  /** gutter diff 弹窗（点击标记行号格子；文档一变即关，见 onChange / openFile）。 */
  const [hunkPopup, setHunkPopup] = useState<GitGutterHunkClickPayload | null>(null)
  /** 内容搜索跳转：打开文件后选中命中区间并滚到行（nonce 支持同位置重跳）。 */
  const [editorJump, setEditorJump] = useState<EditorJumpRequest | null>(null)
  const editorJumpNonce = useRef(0)
  const [ready, setReady] = useState(false)
  /** 看图：上一张/下一张普通位图的 dc-media URL，供提前解码；超大位图改为提前生成预览与金字塔。 */
  const [prefetch, setPrefetch] = useState<string[]>([])
  /** 忽略过期的 openFile / git status / 全部展开 / 过滤扫盘 响应。 */
  const openSeqRef = useRef(0)
  const gitStatusSeqRef = useRef(0)
  const expandAllSeqRef = useRef(0)
  const filterSeqRef = useRef(0)

  const [filterQuery, setFilterQuery] = useState('')
  const [filterScanning, setFilterScanning] = useState(false)
  /** 树顶类型筛选：仅预览宿主有（由宿主持有）；项目宿主恒为全选 */
  const typeFilter = host.kind === 'preview' ? host.typeFilter : FILES_ALL_TYPES
  const [filterView, setFilterView] = useState<{
    childrenByDir: Record<string, FilesDirEntry[]>
    expanded: Set<string>
  } | null>(null)
  const filterInputRef = useRef<HTMLInputElement>(null)
  const consumedFilterFocusNonce = useRef(0)
  const filterFocusNonce = useFiles((s) => s.filterFocusNonceByProject[rootPath] ?? 0)
  const filterViewRef = useRef(filterView)

  useLayoutEffect(() => {
    loadedRef.current = loaded
    recentPathsRef.current = recentPaths
    expandedRef.current = expanded
    childrenByDirRef.current = childrenByDir
    filterViewRef.current = filterView
  }, [loaded, recentPaths, expanded, childrenByDir, filterView])

  // 隐藏时丢弃临时过滤与 gutter 弹窗；其它 Files 状态继续常驻。
  const [filterVisible, setFilterVisible] = useState(visible)
  if (filterVisible !== visible) {
    setFilterVisible(visible)
    if (!visible) {
      setFilterQuery('')
      setFilterScanning(false)
      setFilterView(null)
      setHunkPopup(null)
    }
  }

  useLayoutEffect(() => {
    if (!visible) {
      filterSeqRef.current++
      filterViewRef.current = null
    }
  }, [visible])

  const filtering = filterQuery.trim().length > 0
  const displayChildren = useMemo(
    () =>
      filterFilesTreeByType(
        filtering ? (filterView?.childrenByDir ?? { [rootLogical]: [] }) : childrenByDir,
        typeFilter
      ),
    [childrenByDir, filterView, filtering, rootLogical, typeFilter]
  )
  const displayExpanded = useMemo(
    () => (filtering ? (filterView?.expanded ?? new Set([rootLogical])) : expanded),
    [expanded, filterView, filtering, rootLogical]
  )
  const filterEmpty =
    filtering &&
    !filterScanning &&
    filterView !== null &&
    (filterView.childrenByDir[rootLogical] ?? []).length === 0

  // 首查扫描提示（冷索引才等得到）：延迟 120ms 出现，防索引已热时闪烁（同 diff 加载骨架）
  const filterLoading = filtering && filterScanning && filterView === null
  const [showFilterLoading, setShowFilterLoading] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShowFilterLoading(filterLoading), filterLoading ? 120 : 0)
    return () => clearTimeout(timer)
  }, [filterLoading])

  // 树行虚拟化：按展开态拍平成行数组，仅渲染视口内行（命中再多渲染成本恒定）
  const flatRows = useMemo(
    () => flattenFilesTree(rootLogical, displayChildren, displayExpanded),
    [rootLogical, displayChildren, displayExpanded]
  )
  // eslint-disable-next-line react-hooks/incompatible-library -- tanstack virtual 实例天然可变，React Compiler 跳过本组件 memo 是预期行为
  const rowVirtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => treeScrollRef.current,
    estimateSize: () => TREE_ROW_H,
    overscan: 10,
    getItemKey: (i) => flatRows[i].path
  })

  const refreshGitStatus = useCallback(async () => {
    const seq = ++gitStatusSeqRef.current
    const status = await loadWorkingTreeStatus(rootPath)
    if (seq === gitStatusSeqRef.current) setStatusByRel(status)
  }, [rootPath])

  // Files 可见时拉未提交状态；仓库变动（含工作区 watcher）后刷新
  useEffect(() => {
    if (!visible) return
    const seq = ++gitStatusSeqRef.current
    void loadWorkingTreeStatus(rootPath).then((status) => {
      if (seq === gitStatusSeqRef.current) setStatusByRel(status)
    })
    const dispose = window.api.onGitChanged((p) => {
      if (p === rootPath) void refreshGitStatus()
    })
    return dispose
  }, [visible, rootPath, refreshGitStatus])

  // 打开文本文件时取 HEAD 基线（gutter diff）；提交 / 暂存等 git 变化后重取
  const openTextPath = loaded?.kind === 'text' ? loaded.path : null
  useEffect(() => {
    if (!visible || openTextPath === null) return
    let stale = false
    const load = (): void => {
      window.api
        .filesHeadText(rootPath, openTextPath)
        .then((content) => {
          if (stale) return
          setHeadText((prev) =>
            content === null
              ? null
              : prev && prev.path === openTextPath && prev.content === content
                ? prev
                : { path: openTextPath, content }
          )
        })
        .catch(() => {
          if (!stale) setHeadText(null)
        })
    }
    load()
    const dispose = window.api.onGitChanged((p) => {
      if (p === rootPath) load()
    })
    return () => {
      stale = true
      dispose()
    }
  }, [visible, openTextPath, rootPath])

  // 打开文件 / 显式定位后滚入视口；目标行尚未进树（目录加载中）时保持挂起重试
  useLayoutEffect(() => {
    if (selectedPath !== prevSelectedPath.current) {
      prevSelectedPath.current = selectedPath
      pendingScrollPath.current = selectedPath
    }
    if (!visible || !treeVisible || !pendingScrollPath.current) return
    const index = flatRows.findIndex((r) => r.path === pendingScrollPath.current)
    if (index < 0) return
    // 虚拟化后屏外行无 DOM，按下标滚动（align auto ≈ 原 scrollIntoView nearest）
    rowVirtualizer.scrollToIndex(index)
    pendingScrollPath.current = null
  }, [visible, treeVisible, selectedPath, flatRows, revealTick, rowVirtualizer])

  /** 落盘 UI 态（仅项目宿主）；预览窗口一律不写集中配置存储 */
  const setUi = useCallback(
    (patch: Partial<FilesUiState>) => {
      if (persist) void window.api.filesSetUi(rootPath, patch)
    },
    [persist, rootPath]
  )
  const persistUi = useCallback(
    (openPath: string | null, expandedPaths: string[]) => setUi({ openPath, expandedPaths }),
    [setUi]
  )

  const flushSave = useCallback(async (): Promise<boolean> => {
    const cur = loadedRef.current
    if (!cur || cur.kind !== 'text' || !cur.dirty) return true
    try {
      const { mtimeMs } = await window.api.filesWrite(rootPath, cur.path, cur.content)
      // 同步写 ref，避免保存触发的 files:changed 仍读到旧 dirty/mtime 而误报冲突
      const next = { ...cur, dirty: false, mtimeMs }
      loadedRef.current = next
      setLoaded((prev) => (prev && prev.kind === 'text' && prev.path === cur.path ? next : prev))
      setSaveError(null)
      void refreshGitStatus()
      return true
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
      return false
    }
  }, [rootPath, refreshGitStatus])

  const scheduleIdleSave = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => {
      void flushSave()
    }, IDLE_SAVE_MS)
  }, [flushSave])

  const openFile = useCallback(
    async (filePath: string, opts?: { force?: boolean }) => {
      setHunkPopup(null)
      if (idleTimer.current) {
        clearTimeout(idleTimer.current)
        idleTimer.current = null
      }
      const seq = ++openSeqRef.current
      const cur = loadedRef.current
      if (cur?.kind === 'text' && cur.dirty && cur.path !== filePath && !opts?.force) {
        const ok = await flushSave()
        if (!ok) return
        if (seq !== openSeqRef.current) return
      }
      try {
        const result: FilesReadResult = await window.api.filesRead(rootPath, filePath)
        if (seq !== openSeqRef.current) return
        if (result.kind === 'text') {
          setLoaded({
            kind: 'text',
            path: result.path,
            content: result.content,
            mtimeMs: result.mtimeMs,
            dirty: false
          })
        } else if (result.kind === 'image') {
          setLoaded({
            kind: 'image',
            path: result.path,
            mediaUrl: result.mediaUrl,
            mime: result.mime,
            width: result.width,
            height: result.height,
            tiled: result.tiled
          })
        } else if (result.kind === 'pdf') {
          setLoaded({ kind: 'pdf', path: result.path, mediaUrl: result.mediaUrl })
        } else if (result.kind === 'audio') {
          setLoaded({
            kind: 'audio',
            path: result.path,
            mediaUrl: result.mediaUrl,
            mime: result.mime
          })
        } else if (result.kind === 'video') {
          setLoaded({
            kind: 'video',
            path: result.path,
            mediaUrl: result.mediaUrl,
            mime: result.mime
          })
        } else {
          setLoaded({ kind: 'other', path: result.path, size: result.size })
        }
        setSelectedPath(filePath)
        setSaveError(null)
        const nextRecent = pushRecentPath(recentPathsRef.current, filePath)
        setRecentPaths(nextRecent)
        setUi({
          openPath: filePath,
          expandedPaths: [...expandedRef.current],
          recentPaths: nextRecent
        })
      } catch (e) {
        if (seq !== openSeqRef.current) return
        setSaveError(e instanceof Error ? e.message : String(e))
        setLoaded(null)
        setSelectedPath(null)
        persistUi(null, [...expandedRef.current])
      }
    },
    [flushSave, persistUi, setUi, rootPath]
  )

  const ensureDirLoaded = useCallback(
    async (dirPath: string): Promise<FilesDirEntry[]> => {
      const cached = childrenByDirRef.current[dirPath]
      if (cached) return cached
      const entries = await window.api.filesListDir(rootPath, dirPath)
      const raced = childrenByDirRef.current[dirPath]
      if (raced) return raced
      childrenByDirRef.current = { ...childrenByDirRef.current, [dirPath]: entries }
      setChildrenByDir((prev) => (prev[dirPath] ? prev : { ...prev, [dirPath]: entries }))
      return entries
    },
    [rootPath]
  )

  const toggleDir = useCallback(
    async (dirPath: string) => {
      const fv = filterViewRef.current
      if (filterQuery.trim() && fv) {
        const next = new Set(fv.expanded)
        if (next.has(dirPath)) next.delete(dirPath)
        else next.add(dirPath)
        const snap = { childrenByDir: fv.childrenByDir, expanded: next }
        filterViewRef.current = snap
        setFilterView(snap)
        return
      }
      const willOpen = !expandedRef.current.has(dirPath)
      // 手动收起时作废进行中的「全部展开」，否则后续 flush 会把目录再次打开
      if (!willOpen) expandAllSeqRef.current++
      if (willOpen) await ensureDirLoaded(dirPath)
      const next = new Set(expandedRef.current)
      if (willOpen) next.add(dirPath)
      else next.delete(dirPath)
      expandedRef.current = next
      setExpanded(next)
      persistUi(loadedRef.current?.path ?? null, [...next])
    },
    [ensureDirLoaded, filterQuery, persistUi]
  )

  const collapseAllDirs = useCallback(() => {
    const fv = filterViewRef.current
    if (filterQuery.trim() && fv) {
      const snap = { childrenByDir: fv.childrenByDir, expanded: new Set<string>() }
      filterViewRef.current = snap
      setFilterView(snap)
      return
    }
    expandAllSeqRef.current++
    const next = new Set<string>()
    expandedRef.current = next
    setExpanded(next)
    persistUi(loadedRef.current?.path ?? null, [])
  }, [filterQuery, persistUi])

  /**
   * 递归加载并展开全部目录。
   * - 分批刷 UI；单目录失败不中断
   * - seq 作废后不再写 expanded（避免收起后又被内层 flush 展开）
   * - 永不把内部可变 Set 交给 state/ref（只提交拷贝）
   * - 过滤态下只展开当前过滤树中的目录，不扫盘
   */
  const expandAllDirs = useCallback(async () => {
    const fv = filterViewRef.current
    if (filterQuery.trim() && fv) {
      const next = new Set(Object.keys(fv.childrenByDir))
      const snap = { childrenByDir: fv.childrenByDir, expanded: next }
      filterViewRef.current = snap
      setFilterView(snap)
      return
    }
    const seq = ++expandAllSeqRef.current
    const nextChildren: Record<string, FilesDirEntry[]> = { ...childrenByDirRef.current }
    const nextExpanded = new Set<string>()
    let listed = 0

    const stillActive = (): boolean => seq === expandAllSeqRef.current

    const flushChildren = (): void => {
      const snap = { ...nextChildren }
      childrenByDirRef.current = snap
      setChildrenByDir(snap)
    }

    const flushExpanded = (): void => {
      if (!stillActive()) return
      const snap = new Set(nextExpanded)
      if (!stillActive()) return
      expandedRef.current = snap
      setExpanded(snap)
    }

    const walk = async (dir: string): Promise<void> => {
      if (!stillActive()) return
      nextExpanded.add(dir)
      try {
        if (!nextChildren[dir]) {
          nextChildren[dir] = await window.api.filesListDir(rootPath, dir)
        }
      } catch {
        nextChildren[dir] = nextChildren[dir] ?? []
        return
      }
      if (!stillActive()) return
      listed++
      if (listed === 1 || listed % 15 === 0) {
        flushChildren()
        flushExpanded()
        await new Promise<void>((r) => setTimeout(r, 0))
        if (!stillActive()) return
      }
      for (const e of nextChildren[dir]) {
        if (!stillActive()) return
        if (e.isDirectory) await walk(e.path)
      }
    }

    try {
      await walk(rootLogical)
    } finally {
      if (stillActive()) {
        flushChildren()
        flushExpanded()
        persistUi(loadedRef.current?.path ?? null, [...expandedRef.current])
      }
    }
  }, [filterQuery, persistUi, rootPath, rootLogical])

  /** 展开到目标：文件只展开祖先；目录连自身一并展开。 */
  const expandToPath = useCallback(
    async (logical: string, isDirectory: boolean): Promise<Set<string>> => {
      const toAdd: string[] = [rootLogical]
      const rel = logical.startsWith(rootLogical + '/') ? logical.slice(rootLogical.length + 1) : ''
      if (rel) {
        const segs = rel.split('/')
        let prefix = rootLogical
        for (let i = 0; i < segs.length; i++) {
          prefix = normalizePath(prefix + '/' + segs[i])
          const last = i === segs.length - 1
          if (!last || isDirectory) {
            toAdd.push(prefix)
            await ensureDirLoaded(prefix).catch(() => undefined)
          }
        }
      }
      const next = new Set(expandedRef.current)
      for (const p of toAdd) next.add(p)
      expandedRef.current = next
      setExpanded(next)
      return next
    },
    [ensureDirLoaded, rootLogical]
  )

  const expandToFile = useCallback(
    async (logical: string): Promise<void> => {
      const next = await expandToPath(logical, false)
      persistUi(logical, [...next])
    },
    [expandToPath, persistUi]
  )

  /**
   * 上一个 / 下一个媒体（位图 / SVG / PDF / 音视频）按**树里当前可见的顺序**走——跨目录、跨类型，
   * 但只进已展开的目录（折叠的不自动钻），并尊重类型筛选；到头停下。
   * 当前正文是媒体才响应（看图 / SVG 预览态 / PDF / 音视频）。
   */
  const goAdjacentMedia = useCallback(
    async (dir: -1 | 1) => {
      const cur = loadedRef.current
      if (!cur) return
      const isMedia =
        cur.kind === 'image' ||
        cur.kind === 'pdf' ||
        cur.kind === 'audio' ||
        cur.kind === 'video' ||
        (cur.kind === 'text' && isSvgPath(cur.path))
      if (!isMedia) return
      const next = adjacentMediaPath(flatRows, cur.path, dir)
      if (next === null) return
      if (isSvgPath(next)) setSourcePreview(true)
      await openFile(next)
    },
    [flatRows, openFile]
  )
  const goPrevImage = useCallback(() => void goAdjacentMedia(-1), [goAdjacentMedia])
  const goNextImage = useCallback(() => void goAdjacentMedia(1), [goAdjacentMedia])

  // 音视频正文：四个方向键切上一个 / 下一个媒体（同看图；守卫同看图——不抢输入框与弹层）。
  // 焦点落在播放器上时也拦下，播放器自己的键盘进度 / 音量让位给切换，进度条仍可拖。
  const avOpen = loaded?.kind === 'audio' || loaded?.kind === 'video'
  useEffect(() => {
    if (!visible || !avOpen) return
    const onKey = (e: KeyboardEvent): void => {
      const dir = arrowDirection(e)
      if (dir === null) return
      if (editableTarget(e.target) || overlayOpen()) return
      const app = useApp.getState()
      if (app.contentSearchOpen || app.dialog.open) return
      e.preventDefault()
      e.stopPropagation()
      void goAdjacentMedia(dir)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [visible, avOpen, goAdjacentMedia])

  const viewingImagePath =
    loaded?.kind === 'image'
      ? loaded.path
      : loaded?.kind === 'text' && isSvgPath(loaded.path) && sourcePreview
        ? loaded.path
        : null

  useEffect(() => {
    if (!viewingImagePath) {
      setPrefetch([])
      return
    }
    let cancelled = false
    const current = viewingImagePath
    void (async () => {
      const urls: string[] = []
      for (const d of [-1, 1] as const) {
        const p = adjacentMediaPath(flatRows, current, d)
        if (!p || isSvgPath(p)) continue
        try {
          const result = await window.api.filesRead(rootPath, p)
          if (cancelled) return
          if (result.kind !== 'image') continue
          if (result.tiled) {
            // 超大位图：让主进程先把预览图与金字塔备好（命中缓存即返）
            window.api.filesImagePreview(rootPath, p).catch(() => {})
            window.api.filesImagePyramid(rootPath, p).catch(() => {})
          } else {
            urls.push(result.mediaUrl)
          }
        } catch {
          /* skip */
        }
      }
      if (!cancelled) setPrefetch(urls)
    })()
    return () => {
      cancelled = true
    }
  }, [viewingImagePath, flatRows, rootPath])

  /** 在右侧文件树展开并滚到目标（不打开/切换正文，除非本来就是该文件）。 */
  const revealInTree = useCallback(
    async (logical: string, isDirectory: boolean): Promise<void> => {
      setTreeVisible(true)
      const next = await expandToPath(logical, isDirectory)
      setSelectedPath(logical)
      pendingScrollPath.current = logical
      setRevealTick((n) => n + 1)
      const openPath = loadedRef.current?.path ?? null
      persistUi(openPath, [...next])
    },
    [expandToPath, persistUi]
  )

  const openFromRecent = useCallback(
    async (logical: string) => {
      await expandToFile(logical)
      await openFile(logical)
      // 已是当前文件时 selectedPath 不变，须强制挂起滚动（同「在文件树中显示」）
      pendingScrollPath.current = logical
      setRevealTick((n) => n + 1)
    },
    [expandToFile, openFile]
  )

  const updateFilterQuery = useCallback((query: string): void => {
    filterSeqRef.current++
    setFilterQuery(query)
    setFilterScanning(query.trim().length > 0)
    if (!query.trim()) {
      filterViewRef.current = null
      setFilterView(null)
    }
  }, [])

  const exitFilter = useCallback(async () => {
    updateFilterQuery('')
    const open = loadedRef.current?.path ?? selectedPath
    if (open) await expandToFile(open)
  }, [expandToFile, selectedPath, updateFilterQuery])

  // 防抖扫盘过滤
  useEffect(() => {
    const q = filterQuery.trim()
    if (!q || !visible) return
    const seq = ++filterSeqRef.current
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await window.api.filesFilterTree(rootPath, q)
          if (cancelled || seq !== filterSeqRef.current) return
          const snap = {
            childrenByDir: result.childrenByDir,
            expanded: new Set(result.expandedPaths)
          }
          filterViewRef.current = snap
          setFilterView(snap)
        } catch {
          if (cancelled || seq !== filterSeqRef.current) return
          const snap = {
            childrenByDir: { [rootLogical]: [] as FilesDirEntry[] },
            expanded: new Set([rootLogical])
          }
          filterViewRef.current = snap
          setFilterView(snap)
        } finally {
          if (!cancelled && seq === filterSeqRef.current) setFilterScanning(false)
        }
      })()
    }, FILTER_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [filterQuery, rootPath, rootLogical, visible])

  // 首次变为可见时：项目宿主恢复树展开与上次打开（pending 由下一 effect 统一消费，避免竞态）；
  // 预览宿主不读落盘态，展开到初始文件并打开（SVG 起手即图：被当图打开的就先看图）。
  const previewInitialFile = host.kind === 'preview' ? host.initialFile : null
  useEffect(() => {
    if (!visible || ready) return
    let cancelled = false
    void (async () => {
      await ensureDirLoaded(rootLogical)
      if (cancelled) return
      if (!persist) {
        if (previewInitialFile) {
          if (isSvgPath(previewInitialFile)) setSourcePreview(true)
          await expandToFile(previewInitialFile)
          if (cancelled) return
          await openFile(previewInitialFile, { force: true })
        }
        if (cancelled) return
        setReady(true)
        return
      }
      const ui = await window.api.filesGetUi(rootPath)
      if (cancelled) return
      const exp = new Set(ui.expandedPaths.length ? ui.expandedPaths : [])
      expandedRef.current = exp
      setExpanded(exp)
      setRecentPaths(ui.recentPaths)
      for (const d of exp) {
        await ensureDirLoaded(d).catch(() => undefined)
        if (cancelled) return
      }
      const hasPending = !!useFiles.getState().pendingOpenByProject[rootPath]
      if (!hasPending && ui.openPath) await openFile(ui.openPath, { force: true })
      if (cancelled) return
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [
    visible,
    ready,
    persist,
    previewInitialFile,
    ensureDirLoaded,
    expandToFile,
    openFile,
    rootPath,
    rootLogical
  ])

  // 预览宿主：把当前打开文件回报给窗口壳（上翻根时据此保留打开的文件、更新标题）
  const onOpenPathChange = host.kind === 'preview' ? host.onOpenPathChange : null
  const openPath = loaded?.path ?? null
  useEffect(() => {
    if (ready) onOpenPathChange?.(openPath)
  }, [ready, openPath, onOpenPathChange])

  // Git / 内容搜索等外部 pending open（ready 之后才消费）
  const pending = useFiles((s) => s.pendingOpenByProject[rootPath])
  useEffect(() => {
    if (!ready || !pending) return
    const req = useFiles.getState().consumePendingOpen(rootPath)
    if (!req) return
    // 不在 cleanup 里取消：consume 会立刻把 pending 置空并重跑 effect，取消会误杀本次打开。
    void (async () => {
      const logical = normalizePath(req.path)
      await expandToFile(logical)
      await openFile(logical)
      if (req.at) {
        // 定位落在编辑器上：Markdown / SVG 若停在预览态先切回编辑
        setSourcePreview(false)
        setEditorJump({ path: logical, ...req.at, nonce: ++editorJumpNonce.current })
      }
    })()
  }, [ready, pending, rootPath, expandToFile, openFile])

  // ⌥⌘F：切到本 Tab 后聚焦文件树筛选；树隐藏时先展开再等下一拍聚焦。
  useEffect(() => {
    if (!filterFocusNonce || filterFocusNonce === consumedFilterFocusNonce.current) return
    if (!visible) return
    if (!treeVisible) {
      // 外部 nonce 驱动：先展开树，下一拍再聚焦筛选框
      setTreeVisible(true)
      return
    }
    consumedFilterFocusNonce.current = filterFocusNonce
    const input = filterInputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [filterFocusNonce, visible, treeVisible])

  // 离开 Files Tab / 失焦 → 保存
  useEffect(() => {
    if (!visible) void flushSave()
  }, [visible, flushSave])

  useEffect(() => {
    const onBlur = (): void => {
      void flushSave()
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [flushSave])

  /**
   * 磁盘变更（ADR-0011）：重拉已缓存目录；过滤态重扫；同步当前打开文件。
   * 隐藏不卸载时也跟进，切回 Files Tab 时树与正文已是新态。
   */
  const refreshFromDisk = useCallback(async () => {
    const dirs = Object.keys(childrenByDirRef.current)
    if (dirs.length > 0) {
      const reloaded: Record<string, FilesDirEntry[] | null> = {}
      await Promise.all(
        dirs.map(async (dir) => {
          try {
            reloaded[dir] = await window.api.filesListDir(rootPath, dir)
          } catch {
            reloaded[dir] = null
          }
        })
      )
      const merged = mergeReloadedDirs(childrenByDirRef.current, reloaded)
      if (merged !== childrenByDirRef.current) {
        childrenByDirRef.current = merged
        setChildrenByDir(merged)
        const nextExp = new Set<string>()
        for (const d of expandedRef.current) {
          if (d in merged) nextExp.add(d)
        }
        if (nextExp.size !== expandedRef.current.size) {
          expandedRef.current = nextExp
          setExpanded(nextExp)
          persistUi(loadedRef.current?.path ?? null, [...nextExp])
        }
      }
    }

    const q = filterQuery.trim()
    if (q) {
      const seq = ++filterSeqRef.current
      setFilterScanning(true)
      try {
        const result = await window.api.filesFilterTree(rootPath, q)
        if (seq !== filterSeqRef.current) return
        const snap = {
          childrenByDir: result.childrenByDir,
          expanded: new Set(result.expandedPaths)
        }
        filterViewRef.current = snap
        setFilterView(snap)
      } catch {
        if (seq !== filterSeqRef.current) return
        const snap = {
          childrenByDir: { [rootLogical]: [] as FilesDirEntry[] },
          expanded: new Set([rootLogical])
        }
        filterViewRef.current = snap
        setFilterView(snap)
      } finally {
        if (seq === filterSeqRef.current) setFilterScanning(false)
      }
    }

    const cur = loadedRef.current
    if (!cur) return
    const path = cur.path
    let fresh: FilesReadResult | null = null
    try {
      fresh = await window.api.filesRead(rootPath, path)
    } catch {
      fresh = null
    }
    const still = loadedRef.current
    if (!still || still.path !== path) return

    const clearOpen = (): void => {
      setLoaded(null)
      setSelectedPath(null)
      setConflict(null)
      const nextRecent = recentPathsRef.current.filter((p) => p !== path)
      setRecentPaths(nextRecent)
      setUi({
        openPath: null,
        expandedPaths: [...expandedRef.current],
        recentPaths: nextRecent
      })
    }

    if (still.kind === 'text') {
      const decision = resolveOpenTextDiskSync(still, fresh)
      if (decision.action === 'noop') return
      if (decision.action === 'reload') {
        setLoaded({
          kind: 'text',
          path,
          content: decision.content,
          mtimeMs: decision.mtimeMs,
          dirty: false
        })
        return
      }
      if (decision.action === 'conflict') {
        setConflict({ disk: decision.disk, mtimeMs: decision.mtimeMs })
        return
      }
      if (decision.action === 'gone') {
        clearOpen()
        return
      }
      await openFile(path, { force: true })
      return
    }

    if (!fresh) {
      clearOpen()
      return
    }
    if (fresh.kind !== still.kind) await openFile(path, { force: true })
  }, [filterQuery, openFile, persistUi, setUi, rootPath, rootLogical])

  useEffect(() => {
    if (!ready) return
    return window.api.onFilesChanged((p) => {
      if (p !== rootPath) return
      void refreshFromDisk()
    })
  }, [ready, rootPath, refreshFromDisk])

  /** 树行 / 空白区右键 → 打开条目菜单。 */
  const openTreeMenu = useCallback((path: string, isDirectory: boolean, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setTreeMenu({ x: e.clientX, y: e.clientY, path, isDirectory })
  }, [])

  /**
   * 条目操作执行（弹窗确认后）：主进程落盘 → 本地状态联动 → 统一从磁盘刷新树。
   * 抛错交由弹窗就地展示（弹窗保持打开）。
   */
  const submitEntryDialog = useCallback(
    async (req: FilesEntryDialogRequest, name: string) => {
      if (req.kind === 'create-file' || req.kind === 'create-dir') {
        const entry = await window.api.filesCreate(
          rootPath,
          req.dir,
          name,
          req.kind === 'create-dir' ? 'directory' : 'file'
        )
        setEntryDialog(null)
        await refreshFromDisk()
        if (entry.isDirectory) {
          await revealInTree(entry.path, true)
        } else {
          await expandToFile(entry.path)
          await openFile(entry.path)
        }
        return
      }

      if (req.kind === 'rename') {
        // 先落未保存的编辑（旧路径此刻仍在），失败则不动文件
        const saved = await flushSave()
        if (!saved) throw new Error('有未保存的更改且写入失败，已取消重命名')
        const { path: newPath } = await window.api.filesRename(rootPath, req.path, name)
        setEntryDialog(null)
        if (newPath === req.path) return
        const remap = (p: string): string => remapPathPrefix(p, req.path, newPath)
        const nextExpanded = new Set([...expandedRef.current].map(remap))
        expandedRef.current = nextExpanded
        setExpanded(nextExpanded)
        setSelectedPath((prev) => (prev === null ? null : remap(prev)))
        const nextRecent = recentPathsRef.current.map(remap)
        setRecentPaths(nextRecent)
        const cur = loadedRef.current
        const openRemapped = cur === null ? null : remap(cur.path)
        setUi({
          openPath: openRemapped,
          expandedPaths: [...nextExpanded],
          recentPaths: nextRecent
        })
        // 先把打开文件切到新路径，refreshFromDisk 才不会把旧路径当「已消失」清掉
        if (cur !== null && openRemapped !== null && openRemapped !== cur.path) {
          await openFile(openRemapped, { force: true })
        }
        await refreshFromDisk()
        // 重命名子树下已展开的目录换了 key，补载新路径的目录列表
        for (const dir of nextExpanded) {
          if (dir === newPath || dir.startsWith(newPath + '/')) {
            await ensureDirLoaded(dir).catch(() => undefined)
          }
        }
        return
      }

      await window.api.filesTrash(rootPath, req.path)
      setEntryDialog(null)
      const gone = (p: string): boolean => p === req.path || p.startsWith(req.path + '/')
      const cur = loadedRef.current
      if (cur !== null && gone(cur.path)) {
        // 撤掉挂起的自动保存，避免把刚删除的文件写回来
        if (idleTimer.current) {
          clearTimeout(idleTimer.current)
          idleTimer.current = null
        }
        setLoaded(null)
        setConflict(null)
        const nextRecent = recentPathsRef.current.filter((p) => !gone(p))
        setRecentPaths(nextRecent)
        setUi({
          openPath: null,
          expandedPaths: [...expandedRef.current].filter((p) => !gone(p)),
          recentPaths: nextRecent
        })
      }
      setSelectedPath((prev) => (prev !== null && gone(prev) ? null : prev))
      await refreshFromDisk()
    },
    [
      rootPath,
      refreshFromDisk,
      revealInTree,
      expandToFile,
      openFile,
      flushSave,
      ensureDirLoaded,
      setUi
    ]
  )

  const filterHint = shortcutTitle('筛选文件', SHORTCUT.filesFilter)

  return (
    <div className="flex h-full min-h-0">
      <div
        className="relative min-h-0 min-w-0 flex-1 bg-deepest"
        onContextMenu={(e) => {
          // 任何已打开的条目都有正文菜单；空态没有。看图 / SVG 预览态另给「复制图片」取图源
          const cur = loaded
          if (!cur) return
          e.preventDefault()
          let imageSrc: (() => Promise<string>) | null = null
          if (cur.kind === 'image') {
            // 超大位图复制其预览图（长边 4096，缓存命中即返），整图塞剪贴板不现实
            imageSrc = cur.tiled
              ? () => window.api.filesImagePreview(rootPath, cur.path).then((p) => p.url)
              : () => Promise.resolve(cur.mediaUrl)
          } else if (cur.kind === 'text' && isSvgPath(cur.path) && sourcePreview) {
            const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cur.content)}`
            imageSrc = () => Promise.resolve(src)
          }
          setContentMenu({ x: e.clientX, y: e.clientY, path: cur.path, imageSrc })
        }}
      >
        {!loaded && (
          <div className="flex h-full min-h-0 flex-col">
            <FilesToolbar
              path={null}
              projectRoot={rootLogical}
              error={null}
              recentPaths={recentPaths}
              fileStatus={undefined}
              treeVisible={treeVisible}
              onShowTree={() => setTreeVisible(true)}
              onToggleTree={() => setTreeVisible((v) => !v)}
              onRevealInTree={revealInTree}
              onOpenRecent={openFromRecent}
            />
            <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
              在右侧选择文件
            </div>
          </div>
        )}
        {loaded?.kind === 'text' && (
          <FilesTextEditor
            path={loaded.path}
            content={loaded.content}
            baseline={headText !== null && headText.path === loaded.path ? headText.content : null}
            projectRoot={rootLogical}
            error={saveError}
            recentPaths={recentPaths}
            fileStatus={statusByRel.get(relPathUnderRoot(rootLogical, loaded.path))}
            treeVisible={treeVisible}
            sourcePreview={sourcePreview}
            onToggleSourcePreview={() => {
              const next = !sourcePreview
              // 切到预览前落盘，预览与磁盘一致；编辑器卸载，gutter 弹窗一并关闭
              if (next) void flushSave()
              setHunkPopup(null)
              setSourcePreview(next)
            }}
            onShowTree={() => setTreeVisible(true)}
            onToggleTree={() => setTreeVisible((v) => !v)}
            onRevealInTree={revealInTree}
            onOpenRecent={openFromRecent}
            jump={editorJump}
            onJumpDone={() => setEditorJump(null)}
            onHunkClick={setHunkPopup}
            onImagePrev={goPrevImage}
            onImageNext={goNextImage}
            imageNavActive={visible}
            imagePrefetch={prefetch}
            onChange={(v) => {
              // 文档一变，gutter 弹窗的 hunk 即过期，统一在此关闭（含弹窗内回滚）
              setHunkPopup(null)
              setLoaded((prev) =>
                prev && prev.kind === 'text' ? { ...prev, content: v, dirty: true } : prev
              )
              scheduleIdleSave()
            }}
          />
        )}
        {loaded?.kind === 'image' && (
          <div className="flex h-full min-h-0 flex-col">
            <FilesToolbar
              path={loaded.path}
              projectRoot={rootLogical}
              error={null}
              recentPaths={recentPaths}
              fileStatus={statusByRel.get(relPathUnderRoot(rootLogical, loaded.path))}
              treeVisible={treeVisible}
              onShowTree={() => setTreeVisible(true)}
              onToggleTree={() => setTreeVisible((v) => !v)}
              onRevealInTree={revealInTree}
              onOpenRecent={openFromRecent}
              extra={
                <MediaFitButtons active={imageFit} onFit={(axis) => imageRef.current?.fit(axis)} />
              }
            />
            <FilesMediaPreview
              ref={imageRef}
              onFitChange={setImageFit}
              src={loaded.mediaUrl}
              alt={loaded.path}
              width={loaded.width}
              height={loaded.height}
              tiled={loaded.tiled ? { projectPath: rootPath, path: loaded.path } : null}
              prefetch={prefetch}
              active={visible}
              onPrev={goPrevImage}
              onNext={goNextImage}
            />
          </div>
        )}
        {loaded?.kind === 'video' && (
          <div className="flex h-full min-h-0 flex-col">
            <FilesToolbar
              path={loaded.path}
              projectRoot={rootLogical}
              error={null}
              recentPaths={recentPaths}
              fileStatus={statusByRel.get(relPathUnderRoot(rootLogical, loaded.path))}
              treeVisible={treeVisible}
              onShowTree={() => setTreeVisible(true)}
              onToggleTree={() => setTreeVisible((v) => !v)}
              onRevealInTree={revealInTree}
              onOpenRecent={openFromRecent}
            />
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
              <video
                key={loaded.mediaUrl}
                controls
                preload="metadata"
                className="max-h-full max-w-full"
              >
                <source src={loaded.mediaUrl} type={loaded.mime} />
              </video>
            </div>
          </div>
        )}
        {loaded?.kind === 'audio' && (
          <div className="flex h-full min-h-0 flex-col">
            <FilesToolbar
              path={loaded.path}
              projectRoot={rootLogical}
              error={null}
              recentPaths={recentPaths}
              fileStatus={statusByRel.get(relPathUnderRoot(rootLogical, loaded.path))}
              treeVisible={treeVisible}
              onShowTree={() => setTreeVisible(true)}
              onToggleTree={() => setTreeVisible((v) => !v)}
              onRevealInTree={revealInTree}
              onOpenRecent={openFromRecent}
            />
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
              <audio key={loaded.mediaUrl} controls preload="metadata">
                <source src={loaded.mediaUrl} type={loaded.mime} />
              </audio>
            </div>
          </div>
        )}
        {loaded?.kind === 'pdf' && (
          <FilesPdfPreview
            src={loaded.mediaUrl}
            path={loaded.path}
            active={visible}
            thumbnails={pdfThumbnails}
            onToggleThumbnails={() => setPdfThumbnails((v) => !v)}
            onPrev={goPrevImage}
            onNext={goNextImage}
            toolbar={{
              projectRoot: rootLogical,
              recentPaths,
              fileStatus: statusByRel.get(relPathUnderRoot(rootLogical, loaded.path)),
              treeVisible,
              onShowTree: () => setTreeVisible(true),
              onToggleTree: () => setTreeVisible((v) => !v),
              onRevealInTree: revealInTree,
              onOpenRecent: openFromRecent
            }}
          />
        )}
        {loaded?.kind === 'other' && (
          <div className="flex h-full min-h-0 flex-col">
            <FilesToolbar
              path={loaded.path}
              projectRoot={rootLogical}
              error={null}
              recentPaths={recentPaths}
              fileStatus={statusByRel.get(relPathUnderRoot(rootLogical, loaded.path))}
              treeVisible={treeVisible}
              onShowTree={() => setTreeVisible(true)}
              onToggleTree={() => setTreeVisible((v) => !v)}
              onRevealInTree={revealInTree}
              onOpenRecent={openFromRecent}
            />
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-sm text-muted-foreground">
              <p>无法在此编辑此文件</p>
              <p className="text-xs">{formatSize(loaded.size)}</p>
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-[color:var(--fg-primary)] transition-colors hover:bg-[var(--bg-button-hover)]"
                onClick={() => void window.api.openPath(toSysPath(loaded.path))}
              >
                在其他应用中打开
              </button>
            </div>
          </div>
        )}
      </div>
      {treeVisible && (
        <div
          className="flex h-full shrink-0 flex-col border-l border-[var(--separator)] bg-panel"
          style={{ width: TREE_W }}
        >
          <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--separator)] px-1.5">
            <div
              title={filterHint}
              className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded px-1.5 transition-colors focus-within:bg-[var(--bg-row-hover)]"
            >
              <Search className="size-3.5 shrink-0 text-[color:var(--fg-disabled)]" />
              <input
                ref={filterInputRef}
                value={filterQuery}
                onChange={(e) => updateFilterQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    e.stopPropagation()
                    void exitFilter()
                  }
                }}
                placeholder={filterHint}
                className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-[color:var(--fg-disabled)]"
              />
              {filterQuery !== '' && (
                <button
                  type="button"
                  title="清空"
                  className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]"
                  onClick={() => void exitFilter()}
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {host.kind === 'preview' && (
                <PreviewTypeFilterButton
                  typeFilter={host.typeFilter}
                  onTypeFilterChange={host.onTypeFilterChange}
                />
              )}
              <button
                type="button"
                title="全部展开"
                className={TOOLBAR_BTN}
                onClick={() => void expandAllDirs()}
              >
                <ChevronsUpDown className="size-4" />
              </button>
              <button
                type="button"
                title="全部折叠"
                className={TOOLBAR_BTN}
                onClick={collapseAllDirs}
              >
                <ChevronsDownUp className="size-4" />
              </button>
              <button
                type="button"
                title="隐藏文件树"
                className={TOOLBAR_BTN}
                onClick={() => setTreeVisible(false)}
              >
                <Minus className="size-4" />
              </button>
            </div>
          </div>
          {host.kind === 'preview' && (
            // 当前根文件夹行：告诉你树的根在哪（上翻下钻后不迷路），右键即空白区那份根菜单——
            // 文件铺满时也永远点得到。固定在列表之上不随滚动走；它是全树的根，图标顶格（不占层级缩进位）。
            <div
              title={rootLogical}
              className={cn(
                'mx-1.5 mt-1 flex h-8 shrink-0 cursor-default items-center gap-1 rounded px-1.5 text-[13px] text-foreground transition-colors',
                treeMenu !== null && treeMenu.path === rootLogical
                  ? 'bg-[var(--bg-row-hover)]'
                  : 'hover:bg-[var(--bg-row-hover)]'
              )}
              onContextMenu={(e) => openTreeMenu(rootLogical, true, e)}
            >
              <FolderOpen className="size-3.5 shrink-0 text-[color:var(--fg-icon)]" />
              <span className="min-w-0 flex-1 truncate font-medium">
                {rootLogical.slice(rootLogical.lastIndexOf('/') + 1) || rootLogical}
              </span>
            </div>
          )}
          <div
            ref={treeScrollRef}
            tabIndex={0}
            className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5 pt-1 outline-none"
            onContextMenu={(e) => openTreeMenu(rootLogical, true, e)}
            onKeyDown={(e) => {
              if (e.target instanceof HTMLInputElement) return
              if (e.key === 'Escape') {
                if (filterQuery.trim()) {
                  e.preventDefault()
                  void exitFilter()
                }
                return
              }
              if (e.key === 'Backspace' && filterQuery) {
                e.preventDefault()
                updateFilterQuery(filterQuery.slice(0, -1))
                filterInputRef.current?.focus()
                return
              }
              if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault()
                updateFilterQuery(filterQuery + e.key)
                filterInputRef.current?.focus()
              }
            }}
          >
            {filterLoading && showFilterLoading ? (
              <div className="flex h-full min-h-full items-center justify-center gap-1.5 px-1.5 text-[13px] text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin" />
                正在扫描…
              </div>
            ) : filterEmpty ? (
              <div className="flex h-full min-h-full items-center justify-center px-1.5 text-[13px] text-muted-foreground">
                无匹配文件
              </div>
            ) : (
              <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
                {rowVirtualizer.getVirtualItems().map((vi) => {
                  const row = flatRows[vi.index]
                  // 空白区（根）目标的菜单不点亮任何行；行集合本就不含根
                  const menuActive = treeMenu !== null && treeMenu.path === row.path
                  return (
                    <div
                      key={vi.key}
                      className="absolute left-0 top-0 w-full"
                      style={{ transform: `translateY(${vi.start}px)` }}
                    >
                      {row.isDirectory ? (
                        <FileTreeDirRow
                          name={row.name}
                          depth={row.depth}
                          isExpanded={displayExpanded.has(row.path)}
                          selected={selectedPath === row.path}
                          menuActive={menuActive}
                          onToggle={() => toggleDir(row.path)}
                          onMenu={(e) => openTreeMenu(row.path, true, e)}
                        />
                      ) : (
                        <FileTreeFileRow
                          name={row.name}
                          depth={row.depth}
                          selected={selectedPath === row.path}
                          menuActive={menuActive}
                          status={statusByRel.get(relPathUnderRoot(rootLogical, row.path))}
                          onOpen={() => void openFile(row.path)}
                          onMenu={(e) => openTreeMenu(row.path, false, e)}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {hunkPopup !== null && loaded?.kind === 'text' && (
        <FilesGutterHunkPopover
          popup={hunkPopup}
          filePath={loaded.path}
          onUpdate={setHunkPopup}
          onClose={() => setHunkPopup(null)}
        />
      )}

      <FilesContentMenu menu={contentMenu} onClose={() => setContentMenu(null)} />
      <FilesTreeMenu
        projectPath={rootPath}
        terminal={host.kind === 'project'}
        {...(host.kind === 'preview'
          ? {
              onSetRoot: host.onSetRoot,
              onAscend: host.onAscend,
              onAddProject: host.onAddProject,
              projectRegistered: host.projectRegistered
            }
          : {})}
        projectRoot={rootLogical}
        menu={treeMenu}
        onClose={() => setTreeMenu(null)}
        onRequest={setEntryDialog}
      />
      {entryDialog !== null && (
        <FilesEntryDialog
          key={`${entryDialog.kind}:${'dir' in entryDialog ? entryDialog.dir : entryDialog.path}`}
          request={entryDialog}
          onClose={() => setEntryDialog(null)}
          onSubmit={(name) => submitEntryDialog(entryDialog, name)}
        />
      )}

      {conflict && (
        <FormDialogShell
          message={`文件 “${loaded !== null ? loaded.path.slice(loaded.path.lastIndexOf('/') + 1) : ''}” 已在磁盘上更改，当前还有未保存的编辑。要重载磁盘版本，还是保留编辑器内容？`}
          cancelLabel="保留编辑器内容"
          buttons={[
            {
              label: '重载',
              onClick: () => {
                setLoaded((prev) =>
                  prev && prev.kind === 'text'
                    ? {
                        ...prev,
                        content: conflict.disk,
                        mtimeMs: conflict.mtimeMs,
                        dirty: false
                      }
                    : prev
                )
                setConflict(null)
              }
            }
          ]}
          onCancel={() => {
            setLoaded((prev) =>
              prev && prev.kind === 'text' && conflict
                ? { ...prev, mtimeMs: conflict.mtimeMs }
                : prev
            )
            setConflict(null)
          }}
        />
      )}
    </div>
  )
}

function FilesTextEditor({
  path,
  content,
  baseline,
  projectRoot,
  error,
  recentPaths,
  fileStatus,
  treeVisible,
  sourcePreview,
  onToggleSourcePreview,
  onShowTree,
  onToggleTree,
  onRevealInTree,
  onOpenRecent,
  jump,
  onJumpDone,
  onHunkClick,
  onChange,
  onImagePrev,
  onImageNext,
  imageNavActive,
  imagePrefetch
}: {
  path: string
  content: string
  /** HEAD 基线文本；null = 不显示 gutter diff 条纹 */
  baseline: string | null
  projectRoot: string
  error: string | null
  recentPaths: string[]
  fileStatus: GitFileStatus | undefined
  treeVisible: boolean
  /** Markdown / SVG 两态：true = 预览正文；其它文件忽略 */
  sourcePreview: boolean
  onToggleSourcePreview: () => void
  onShowTree: () => void
  onToggleTree: () => void
  onRevealInTree: (logical: string, isDirectory: boolean) => void | Promise<void>
  onOpenRecent: (logical: string) => void | Promise<void>
  /** 内容搜索跳转：编辑器就绪后选中命中区间并滚到行；应用后回调清除 */
  jump: EditorJumpRequest | null
  onJumpDone: () => void
  /** 点击 gutter 标记行 → 打开 diff 弹窗 */
  onHunkClick: (payload: GitGutterHunkClickPayload) => void
  onChange: (value: string) => void
  onImagePrev: () => void
  onImageNext: () => void
  imageNavActive: boolean
  imagePrefetch?: readonly string[]
}): React.JSX.Element {
  const canPreview = isPreviewableSourcePath(path)
  const markdown = isMarkdownPath(path)
  const svg = isSvgPath(path)
  const theme = useApp((s) => s.theme)
  const viewRef = useRef<EditorView | null>(null)
  /** SVG 预览态的看图相机：工具栏「适应」钮组驱动 */
  const svgRef = useRef<MediaPreviewHandle>(null)
  const [svgFit, setSvgFit] = useState<MediaFitMode | null>(null)
  const [viewNonce, setViewNonce] = useState(0)

  // 编辑器内查找栏（Cmd+F）：keymap 闭包直接引用 findOpen，开关时 extensions 走一次
  // reconfigure（不重建编辑器状态，成本可忽略），换取无 ref 的直白数据流
  const [findOpen, setFindOpen] = useState(false)
  const [findFocusNonce, setFindFocusNonce] = useState(0)
  const openFind = useCallback(() => {
    setFindOpen(true)
    setFindFocusNonce((n) => n + 1)
  }, [])

  // 关闭查找（含切走预览态卸载编辑器前）统一在此清命中高亮
  useEffect(() => {
    if (findOpen) return
    const view = viewRef.current
    if (view && view.dom.isConnected) view.dispatch({ effects: setFindQuery.of(null) })
  }, [findOpen])

  // 跳转须等 CodeMirror 挂载（key=path 换文件重建）；viewNonce 驱动重试
  useEffect(() => {
    if (!jump || jump.path !== path) return
    const view = viewRef.current
    if (!view) return
    const doc = view.state.doc
    const line = doc.line(Math.min(Math.max(jump.line, 1), doc.lines))
    const anchor = Math.min(line.from + (jump.col ?? 0), line.to)
    const head = Math.min(line.from + (jump.endCol ?? jump.col ?? 0), line.to)
    view.dispatch({
      selection: { anchor, head },
      effects: EditorView.scrollIntoView(anchor, { y: 'center' })
    })
    view.focus()
    onJumpDone()
  }, [jump, path, viewNonce, onJumpDone])
  // 换 extensions 走的是 StateEffect.reconfigure，不重建 EditorState：文档 / 选区 / 滚动
  // 位置与撤销栈都在，切主题不打断编辑。
  const extensions = useMemo(
    () => [
      filesEditorTheme[theme],
      filesHighlighting[theme],
      filesEditorConfig,
      filesGutters,
      languageExtensionForPath(path),
      filesFindExtension,
      // Cmd+F 开自定义查找栏（默认面板已由 FILES_BASIC_SETUP 关掉）；Esc 查找开着时关之
      keymap.of([
        {
          key: 'Mod-f',
          run: () => {
            openFind()
            return true
          }
        },
        {
          key: 'Escape',
          run: () => {
            if (!findOpen) return false
            setFindOpen(false)
            return true
          }
        }
      ]),
      ...(baseline === null ? [] : [gitDiffGutter(baseline, onHunkClick)])
    ],
    [theme, path, baseline, onHunkClick, openFind, findOpen]
  )
  return (
    <div className="flex h-full min-h-0 flex-col">
      <FilesToolbar
        path={path}
        projectRoot={projectRoot}
        error={error}
        recentPaths={recentPaths}
        fileStatus={fileStatus}
        treeVisible={treeVisible}
        sourcePreview={canPreview ? sourcePreview : null}
        onToggleSourcePreview={onToggleSourcePreview}
        extra={
          svg && sourcePreview ? (
            <MediaFitButtons active={svgFit} onFit={(axis) => svgRef.current?.fit(axis)} />
          ) : undefined
        }
        onShowTree={onShowTree}
        onToggleTree={onToggleTree}
        onRevealInTree={onRevealInTree}
        onOpenRecent={onOpenRecent}
      />
      {markdown && sourcePreview ? (
        <FilesMarkdownPreview path={path} content={content} projectRoot={projectRoot} />
      ) : svg && sourcePreview ? (
        <FilesSvgPreview
          ref={svgRef}
          onFitChange={setSvgFit}
          path={path}
          content={content}
          prefetch={imagePrefetch}
          active={imageNavActive}
          onPrev={onImagePrev}
          onNext={onImageNext}
        />
      ) : (
        <>
          {findOpen && (
            <FilesFindWidget
              viewRef={viewRef}
              content={content}
              focusNonce={findFocusNonce}
              onClose={() => setFindOpen(false)}
            />
          )}
          <div className="files-codemirror min-h-0 flex-1 overflow-hidden bg-deepest">
            <CodeMirror
              key={path}
              value={content}
              height="100%"
              theme="none"
              extensions={extensions}
              basicSetup={FILES_BASIC_SETUP}
              onChange={onChange}
              onCreateEditor={(view) => {
                viewRef.current = view
                setViewNonce((n) => n + 1)
              }}
              className="h-full [&_.cm-editor]:h-full [&_.cm-editor]:outline-none"
            />
          </div>
        </>
      )}
    </div>
  )
}

/** 内容缩进：行背景全宽，仅左侧占位（对齐左树「背景不缩进」）。 */
function treeIndent(levels: number): React.JSX.Element | null {
  return levels > 0 ? <span className="shrink-0" style={{ width: levels * 12 }} /> : null
}

function FileTreeDirRow({
  name,
  depth,
  isExpanded,
  selected,
  menuActive,
  onToggle,
  onMenu
}: {
  name: string
  depth: number
  isExpanded: boolean
  selected: boolean
  /** 右键菜单打开中：保持 hover 行底（指针已移入菜单会丢 :hover） */
  menuActive: boolean
  onToggle: () => void
  onMenu: (e: React.MouseEvent) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        ROW,
        selected
          ? 'bg-[var(--selection-row)]'
          : menuActive
            ? 'bg-[var(--bg-row-hover)]'
            : 'hover:bg-[var(--bg-row-hover)]'
      )}
      onClick={onToggle}
      onContextMenu={onMenu}
    >
      {treeIndent(depth)}
      <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
        <ChevronRight className={cn('size-3.5 transition-transform', isExpanded && 'rotate-90')} />
      </span>
      <Folder className="size-3.5 shrink-0 text-[color:var(--fg-icon)]" />
      <span
        className="min-w-0 flex-1 truncate transition-colors"
        style={selected ? { color: 'var(--fg-primary)' } : undefined}
      >
        {name}
      </span>
    </button>
  )
}

function FileTreeFileRow({
  name,
  depth,
  selected,
  menuActive,
  status,
  onOpen,
  onMenu
}: {
  name: string
  depth: number
  selected: boolean
  /** 右键菜单打开中：保持 hover 行底（指针已移入菜单会丢 :hover） */
  menuActive: boolean
  status: GitFileStatus | undefined
  onOpen: () => void
  onMenu: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const colour = status ? FILE_STATUS_COLOR[status] : undefined
  return (
    <button
      type="button"
      className={cn(
        ROW,
        selected
          ? 'bg-[var(--selection-row)]'
          : menuActive
            ? 'bg-[var(--bg-row-hover)]'
            : 'hover:bg-[var(--bg-row-hover)]'
      )}
      onClick={onOpen}
      onContextMenu={onMenu}
    >
      {treeIndent(depth)}
      <span className="size-3.5 shrink-0" />
      <FilesTreeIcon
        name={name}
        className="size-3.5 shrink-0"
        style={{ color: colour ?? 'var(--fg-icon)' }}
      />
      <span
        className="min-w-0 flex-1 truncate transition-colors"
        style={{ color: selected ? 'var(--fg-primary)' : colour }}
      >
        {name}
      </span>
    </button>
  )
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
