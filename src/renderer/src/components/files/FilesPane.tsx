import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  File as FileIcon,
  FileClock,
  Folder,
  FolderOpen,
  ListTree,
  Minus,
  PanelRight,
  Search,
  SquareArrowOutUpRight,
  X
} from 'lucide-react'
import { pushRecentPath, type FilesDirEntry, type FilesReadResult } from '@shared/files'
import type { GitFileStatus } from '@shared/git'
import { normalizePath } from '@shared/files-path'
import { mergeReloadedDirs, resolveOpenTextDiskSync } from '@shared/files-watch'
import { SHORTCUT } from '@shared/shortcut-label'
import { shortcutTitle } from '@renderer/lib/shortcut-label'
import { cn } from '@renderer/lib/utils'
import {
  FILES_BASIC_SETUP,
  filesEditorConfig,
  filesEditorTheme,
  filesHighlighting,
  languageExtensionForPath
} from '@renderer/lib/cm6-setup'
import { useFiles } from '@renderer/files-store'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { FILE_STATUS_COLOR, workingTreeStatusByPath } from '@renderer/components/git/git-details'

const IDLE_SAVE_MS = 2000
const FILTER_DEBOUNCE_MS = 200
const TREE_W = 280
/** 交互对齐左树（选中色 / hover / transition）；尺寸更紧凑（非左树 h-10/14px）。 */
const ROW =
  'flex h-8 w-full cursor-pointer items-center gap-1 rounded px-1.5 text-left text-[13px] text-foreground transition-colors'

type Loaded =
  | { kind: 'text'; path: string; content: string; mtimeMs: number; dirty: boolean }
  | { kind: 'image'; path: string; dataUrl: string }
  | { kind: 'audio'; path: string; mediaUrl: string; mime: string }
  | { kind: 'video'; path: string; mediaUrl: string; mime: string }
  | { kind: 'other'; path: string; size: number }
  | null

async function loadWorkingTreeStatus(projectPath: string): Promise<Map<string, GitFileStatus>> {
  try {
    const result = await window.api.gitDetails(projectPath, { kind: 'uncommitted' })
    return result.error || !result.uncommitted
      ? new Map()
      : workingTreeStatusByPath(result.uncommitted)
  } catch {
    return new Map()
  }
}

export function FilesPane({
  projectPath,
  visible
}: {
  projectPath: string
  visible: boolean
}): React.JSX.Element {
  const rootLogical = normalizePath(projectPath)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [childrenByDir, setChildrenByDir] = useState<Record<string, FilesDirEntry[]>>({})
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Loaded>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ disk: string; mtimeMs: number } | null>(null)
  /** 相对项目根路径 → 工作区 Git 状态（与提交面板文件树上色同源） */
  const [statusByRel, setStatusByRel] = useState<Map<string, GitFileStatus>>(() => new Map())
  const [recentPaths, setRecentPaths] = useState<string[]>([])

  const loadedRef = useRef(loaded)
  const recentPathsRef = useRef(recentPaths)
  const expandedRef = useRef(expanded)
  const childrenByDirRef = useRef(childrenByDir)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const treeScrollRef = useRef<HTMLDivElement>(null)
  /** 仅「打开文件 / 显式定位」时滚入；点目录改 expanded 不滚。 */
  const prevSelectedPath = useRef<string | null>(null)
  const pendingScrollPath = useRef<string | null>(null)
  /** 同路径再次「在文件树中显示」时强制重跑滚动。 */
  const [revealTick, setRevealTick] = useState(0)
  /** 右侧文件树可见性；不持久化，重挂载默认展开。 */
  const [treeVisible, setTreeVisible] = useState(true)
  const [ready, setReady] = useState(false)
  /** 忽略过期的 openFile / git status / 全部展开 / 过滤扫盘 响应。 */
  const openSeqRef = useRef(0)
  const gitStatusSeqRef = useRef(0)
  const expandAllSeqRef = useRef(0)
  const filterSeqRef = useRef(0)

  const [filterQuery, setFilterQuery] = useState('')
  const [filterScanning, setFilterScanning] = useState(false)
  const [filterView, setFilterView] = useState<{
    childrenByDir: Record<string, FilesDirEntry[]>
    expanded: Set<string>
  } | null>(null)
  const filterInputRef = useRef<HTMLInputElement>(null)
  const consumedFilterFocusNonce = useRef(0)
  const filterFocusNonce = useFiles((s) => s.filterFocusNonceByProject[projectPath] ?? 0)
  const filterViewRef = useRef(filterView)

  useLayoutEffect(() => {
    loadedRef.current = loaded
    recentPathsRef.current = recentPaths
    expandedRef.current = expanded
    childrenByDirRef.current = childrenByDir
    filterViewRef.current = filterView
  }, [loaded, recentPaths, expanded, childrenByDir, filterView])

  // 隐藏时丢弃临时过滤；其它 Files 状态继续常驻。
  const [filterVisible, setFilterVisible] = useState(visible)
  if (filterVisible !== visible) {
    setFilterVisible(visible)
    if (!visible) {
      setFilterQuery('')
      setFilterScanning(false)
      setFilterView(null)
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
    () => (filtering ? (filterView?.childrenByDir ?? { [rootLogical]: [] }) : childrenByDir),
    [childrenByDir, filterView, filtering, rootLogical]
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

  const refreshGitStatus = useCallback(async () => {
    const seq = ++gitStatusSeqRef.current
    const status = await loadWorkingTreeStatus(projectPath)
    if (seq === gitStatusSeqRef.current) setStatusByRel(status)
  }, [projectPath])

  // Files 可见时拉未提交状态；仓库变动（含工作区 watcher）后刷新
  useEffect(() => {
    if (!visible) return
    const seq = ++gitStatusSeqRef.current
    void loadWorkingTreeStatus(projectPath).then((status) => {
      if (seq === gitStatusSeqRef.current) setStatusByRel(status)
    })
    const dispose = window.api.onGitChanged((p) => {
      if (p === projectPath) void refreshGitStatus()
    })
    return dispose
  }, [visible, projectPath, refreshGitStatus])

  // 打开文件 / 显式定位后滚入视口；展开目录等只在挂起未完成时重试
  useLayoutEffect(() => {
    if (selectedPath !== prevSelectedPath.current) {
      prevSelectedPath.current = selectedPath
      pendingScrollPath.current = selectedPath
    }
    if (!visible || !treeVisible || !pendingScrollPath.current) return
    const root = treeScrollRef.current
    if (!root) return
    const el = root.querySelector(
      `[data-files-path="${globalThis.CSS.escape(pendingScrollPath.current)}"]`
    )
    if (!el) return
    el.scrollIntoView({ block: 'nearest' })
    pendingScrollPath.current = null
  }, [visible, treeVisible, selectedPath, displayExpanded, displayChildren, revealTick])

  const persistUi = useCallback(
    (openPath: string | null, expandedPaths: string[]) => {
      void window.api.filesSetUi(projectPath, { openPath, expandedPaths })
    },
    [projectPath]
  )

  const flushSave = useCallback(async (): Promise<boolean> => {
    const cur = loadedRef.current
    if (!cur || cur.kind !== 'text' || !cur.dirty) return true
    try {
      const { mtimeMs } = await window.api.filesWrite(projectPath, cur.path, cur.content)
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
  }, [projectPath, refreshGitStatus])

  const scheduleIdleSave = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => {
      void flushSave()
    }, IDLE_SAVE_MS)
  }, [flushSave])

  const openFile = useCallback(
    async (filePath: string, opts?: { force?: boolean }) => {
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
        const result: FilesReadResult = await window.api.filesRead(projectPath, filePath)
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
          setLoaded({ kind: 'image', path: result.path, dataUrl: result.dataUrl })
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
        void window.api.filesSetUi(projectPath, {
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
    [flushSave, persistUi, projectPath]
  )

  const ensureDirLoaded = useCallback(
    async (dirPath: string) => {
      if (childrenByDirRef.current[dirPath]) return
      const entries = await window.api.filesListDir(projectPath, dirPath)
      setChildrenByDir((prev) => {
        if (prev[dirPath]) return prev
        return { ...prev, [dirPath]: entries }
      })
    },
    [projectPath]
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
          nextChildren[dir] = await window.api.filesListDir(projectPath, dir)
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
  }, [filterQuery, persistUi, projectPath, rootLogical])

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
          const result = await window.api.filesFilterTree(projectPath, q)
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
  }, [filterQuery, projectPath, rootLogical, visible])

  // 首次变为可见时：恢复树展开与上次打开（pending 由下一 effect 统一消费，避免竞态）
  useEffect(() => {
    if (!visible || ready) return
    let cancelled = false
    void (async () => {
      await ensureDirLoaded(rootLogical)
      if (cancelled) return
      const ui = await window.api.filesGetUi(projectPath)
      if (cancelled) return
      const exp = new Set(ui.expandedPaths.length ? ui.expandedPaths : [])
      expandedRef.current = exp
      setExpanded(exp)
      setRecentPaths(ui.recentPaths)
      for (const d of exp) {
        await ensureDirLoaded(d).catch(() => undefined)
        if (cancelled) return
      }
      const hasPending = !!useFiles.getState().pendingOpenByProject[projectPath]
      if (!hasPending && ui.openPath) await openFile(ui.openPath, { force: true })
      if (cancelled) return
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [visible, ready, ensureDirLoaded, openFile, projectPath, rootLogical])

  // Git / 外部 pending open（ready 之后才消费）
  const pending = useFiles((s) => s.pendingOpenByProject[projectPath])
  useEffect(() => {
    if (!ready || !pending) return
    const path = useFiles.getState().consumePendingOpen(projectPath)
    if (!path) return
    // 不在 cleanup 里取消：consume 会立刻把 pending 置空并重跑 effect，取消会误杀本次打开。
    void (async () => {
      const logical = normalizePath(path)
      await expandToFile(logical)
      await openFile(logical)
    })()
  }, [ready, pending, projectPath, expandToFile, openFile])

  // ⌥⌘F：切到本 Tab 后聚焦文件树筛选；树隐藏时先展开再等下一拍聚焦。
  useEffect(() => {
    if (!filterFocusNonce || filterFocusNonce === consumedFilterFocusNonce.current) return
    if (!visible) return
    if (!treeVisible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部 nonce 驱动：先展开树，下一拍再聚焦筛选框
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
            reloaded[dir] = await window.api.filesListDir(projectPath, dir)
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
        const result = await window.api.filesFilterTree(projectPath, q)
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
      fresh = await window.api.filesRead(projectPath, path)
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
      void window.api.filesSetUi(projectPath, {
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
  }, [filterQuery, openFile, persistUi, projectPath, rootLogical])

  useEffect(() => {
    if (!ready) return
    return window.api.onFilesChanged((p) => {
      if (p !== projectPath) return
      void refreshFromDisk()
    })
  }, [ready, projectPath, refreshFromDisk])

  return (
    <div className="flex h-full min-h-0">
      <div className="relative min-h-0 min-w-0 flex-1 bg-deepest">
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
            projectRoot={rootLogical}
            error={saveError}
            recentPaths={recentPaths}
            fileStatus={statusByRel.get(relPathUnderRoot(rootLogical, loaded.path))}
            treeVisible={treeVisible}
            onShowTree={() => setTreeVisible(true)}
            onToggleTree={() => setTreeVisible((v) => !v)}
            onRevealInTree={revealInTree}
            onOpenRecent={openFromRecent}
            onChange={(v) => {
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
            />
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
              <img
                src={loaded.dataUrl}
                alt={loaded.path}
                className="max-h-full max-w-full object-contain"
              />
            </div>
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
              title={shortcutTitle('筛选文件', SHORTCUT.filesFilter)}
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
                placeholder={filterScanning ? '筛选中…' : '筛选'}
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
          <div
            ref={treeScrollRef}
            tabIndex={0}
            className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5 pt-1 outline-none"
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
            {filterEmpty ? (
              <div className="flex h-full min-h-full items-center justify-center px-1.5 text-[13px] text-muted-foreground">
                无匹配文件
              </div>
            ) : (
              <FileTreeNode
                projectRoot={rootLogical}
                dirPath={rootLogical}
                depth={0}
                expanded={displayExpanded}
                childrenByDir={displayChildren}
                selectedPath={selectedPath}
                statusByRel={statusByRel}
                onToggle={toggleDir}
                onOpenFile={(p) => void openFile(p)}
              />
            )}
          </div>
        </div>
      )}

      {conflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[440px] rounded border border-[color:var(--border-input)] bg-panel p-4 shadow-xl">
            <h2 className="text-sm text-[color:var(--fg-dialog-title)]">文件已在磁盘上更改</h2>
            <p className="mt-2 text-[13px] text-muted-foreground">
              当前有未保存的编辑，磁盘内容也已变化。要重载磁盘版本还是保留编辑器内容？
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setLoaded((prev) =>
                    prev && prev.kind === 'text' && conflict
                      ? { ...prev, mtimeMs: conflict.mtimeMs }
                      : prev
                  )
                  setConflict(null)
                }}
              >
                保留编辑器内容
              </Button>
              <Button
                onClick={() => {
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
                }}
              >
                重载
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FilesTextEditor({
  path,
  content,
  projectRoot,
  error,
  recentPaths,
  fileStatus,
  treeVisible,
  onShowTree,
  onToggleTree,
  onRevealInTree,
  onOpenRecent,
  onChange
}: {
  path: string
  content: string
  projectRoot: string
  error: string | null
  recentPaths: string[]
  fileStatus: GitFileStatus | undefined
  treeVisible: boolean
  onShowTree: () => void
  onToggleTree: () => void
  onRevealInTree: (logical: string, isDirectory: boolean) => void | Promise<void>
  onOpenRecent: (logical: string) => void | Promise<void>
  onChange: (value: string) => void
}): React.JSX.Element {
  const extensions = useMemo(
    () => [filesEditorTheme, filesHighlighting, filesEditorConfig, languageExtensionForPath(path)],
    [path]
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
        onShowTree={onShowTree}
        onToggleTree={onToggleTree}
        onRevealInTree={onRevealInTree}
        onOpenRecent={onOpenRecent}
      />
      <div className="files-codemirror min-h-0 flex-1 overflow-hidden bg-[#1E1F22]">
        <CodeMirror
          key={path}
          value={content}
          height="100%"
          theme="none"
          extensions={extensions}
          basicSetup={FILES_BASIC_SETUP}
          onChange={onChange}
          className="h-full [&_.cm-editor]:h-full [&_.cm-editor]:outline-none"
        />
      </div>
    </div>
  )
}

/** 对齐 GitToolbar ICON_BTN：transition-colors + 钮组 gap-0.5 */
const TOOLBAR_BTN =
  'flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]'

function FilesToolbar({
  path,
  projectRoot,
  error,
  recentPaths,
  fileStatus,
  treeVisible,
  onShowTree,
  onToggleTree,
  onRevealInTree,
  onOpenRecent
}: {
  path: string | null
  projectRoot: string
  error: string | null
  recentPaths: string[]
  fileStatus: GitFileStatus | undefined
  treeVisible: boolean
  onShowTree: () => void
  onToggleTree: () => void
  onRevealInTree: (logical: string, isDirectory: boolean) => void | Promise<void>
  onOpenRecent: (logical: string) => void | Promise<void>
}): React.JSX.Element {
  const rel =
    path && path.startsWith(projectRoot + '/') ? path.slice(projectRoot.length + 1) : (path ?? '')
  const parts = rel.split('/').filter((p) => p.length > 0)
  const fileColour = fileStatus ? FILE_STATUS_COLOR[fileStatus] : undefined
  return (
    <div
      className="flex h-10 shrink-0 cursor-default items-center gap-2 border-b border-[var(--separator)] bg-panel px-2 text-[13px] select-none"
      onDoubleClick={onToggleTree}
    >
      <div className="flex min-w-0 flex-1 items-center overflow-hidden" title={path ?? undefined}>
        {path && (
          <div className="flex min-w-0 items-center gap-0.5 overflow-hidden">
            {parts.map((part, i) => {
              const last = i === parts.length - 1
              const segmentPath = normalizePath(projectRoot + '/' + parts.slice(0, i + 1).join('/'))
              return (
                <span key={`${i}:${part}`} className="flex min-w-0 items-center gap-0.5">
                  {i > 0 && <ChevronRight className="size-3 shrink-0 text-muted-foreground" />}
                  <button
                    type="button"
                    title={segmentPath}
                    className={cn(
                      'max-w-full cursor-pointer truncate transition-colors hover:text-[color:var(--fg-primary)]',
                      last ? 'text-[color:var(--files-crumb-file)]' : 'text-muted-foreground'
                    )}
                    style={
                      last
                        ? ({
                            '--files-crumb-file': fileColour ?? 'var(--fg-primary)'
                          } as React.CSSProperties)
                        : undefined
                    }
                    onClick={() => void onRevealInTree(segmentPath, !last)}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    {part}
                  </button>
                </span>
              )
            })}
          </div>
        )}
      </div>
      {error && <span className="shrink-0 text-xs text-[var(--status-failed)]">{error}</span>}
      <div
        className="flex shrink-0 items-center gap-0.5"
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger title="最近打开文件" className={TOOLBAR_BTN}>
            <FileClock className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-2xl">
            {recentPaths.length === 0 ? (
              <div className="px-2 py-1.5 text-[13px] text-muted-foreground">暂无最近打开文件</div>
            ) : (
              recentPaths.map((p) => {
                const rel = relPathUnderRoot(projectRoot, p) || p
                const slash = rel.lastIndexOf('/')
                const name = slash >= 0 ? rel.slice(slash + 1) : rel
                const dir = slash >= 0 ? rel.slice(0, slash) : ''
                return (
                  <DropdownMenuItem
                    key={p}
                    className="min-w-0 gap-1.5"
                    onClick={() => void onOpenRecent(p)}
                  >
                    <span className="shrink-0" title={p}>
                      {name}
                    </span>
                    {dir && (
                      <span className="min-w-0 truncate text-muted-foreground" title={p}>
                        {dir}
                      </span>
                    )}
                  </DropdownMenuItem>
                )
              })
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {path && (
          <>
            <button
              type="button"
              title="在文件树中显示"
              className={TOOLBAR_BTN}
              onClick={() => void onRevealInTree(path, false)}
            >
              <ListTree className="size-4" />
            </button>
            <button
              type="button"
              title="在文件夹中显示"
              className={TOOLBAR_BTN}
              onClick={() => void window.api.revealInFolder(toSysPath(path))}
            >
              <FolderOpen className="size-4" />
            </button>
            <button
              type="button"
              title="在其他应用中打开"
              className={TOOLBAR_BTN}
              onClick={() => void window.api.openPath(toSysPath(path))}
            >
              <SquareArrowOutUpRight className="size-4" />
            </button>
          </>
        )}
        {!treeVisible && (
          <>
            <div className="mx-0.5 h-3 w-px shrink-0 bg-[var(--border-input)]" role="separator" />
            <button type="button" title="显示文件树" className={TOOLBAR_BTN} onClick={onShowTree}>
              <PanelRight className="size-4" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function relPathUnderRoot(projectRoot: string, absolute: string): string {
  if (absolute === projectRoot) return ''
  if (absolute.startsWith(projectRoot + '/')) return absolute.slice(projectRoot.length + 1)
  return absolute
}

function FileTreeNode({
  projectRoot,
  dirPath,
  depth,
  expanded,
  childrenByDir,
  selectedPath,
  statusByRel,
  onToggle,
  onOpenFile
}: {
  projectRoot: string
  dirPath: string
  depth: number
  expanded: Set<string>
  childrenByDir: Record<string, FilesDirEntry[]>
  selectedPath: string | null
  statusByRel: Map<string, GitFileStatus>
  onToggle: (dir: string) => void
  onOpenFile: (path: string) => void
}): React.JSX.Element {
  const entries = childrenByDir[dirPath] ?? []
  const isRoot = dirPath === projectRoot
  /** 内容缩进：行背景全宽，仅左侧占位（对齐左树「背景不缩进」）。 */
  const indent = (levels: number): React.JSX.Element | null =>
    levels > 0 ? <span className="shrink-0" style={{ width: levels * 12 }} /> : null

  return (
    <div>
      {!isRoot && (
        <button
          type="button"
          data-files-path={dirPath}
          className={cn(
            ROW,
            selectedPath === dirPath
              ? 'bg-[var(--selection-row)]'
              : 'hover:bg-[var(--bg-row-hover)]'
          )}
          onClick={() => onToggle(dirPath)}
        >
          {indent(depth)}
          <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
            <ChevronRight
              className={cn('size-3.5 transition-transform', expanded.has(dirPath) && 'rotate-90')}
            />
          </span>
          <Folder className="size-3.5 shrink-0 text-[color:var(--fg-icon)]" />
          <span
            className="min-w-0 flex-1 truncate"
            style={selectedPath === dirPath ? { color: 'var(--fg-primary)' } : undefined}
          >
            {dirPath.split('/').pop()}
          </span>
        </button>
      )}
      {(isRoot || expanded.has(dirPath)) &&
        entries.map((e) =>
          e.isDirectory ? (
            <FileTreeNode
              key={e.path}
              projectRoot={projectRoot}
              dirPath={e.path}
              depth={isRoot ? depth : depth + 1}
              expanded={expanded}
              childrenByDir={childrenByDir}
              selectedPath={selectedPath}
              statusByRel={statusByRel}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
            />
          ) : (
            <FileTreeFileRow
              key={e.path}
              entry={e}
              depth={isRoot ? depth : depth + 1}
              selected={selectedPath === e.path}
              status={statusByRel.get(relPathUnderRoot(projectRoot, e.path))}
              indent={indent}
              onOpen={() => onOpenFile(e.path)}
            />
          )
        )}
    </div>
  )
}

function FileTreeFileRow({
  entry,
  depth,
  selected,
  status,
  indent,
  onOpen
}: {
  entry: FilesDirEntry
  depth: number
  selected: boolean
  status: GitFileStatus | undefined
  indent: (levels: number) => React.JSX.Element | null
  onOpen: () => void
}): React.JSX.Element {
  const colour = status ? FILE_STATUS_COLOR[status] : undefined
  return (
    <button
      type="button"
      data-files-path={entry.path}
      className={cn(ROW, selected ? 'bg-[var(--selection-row)]' : 'hover:bg-[var(--bg-row-hover)]')}
      onClick={onOpen}
    >
      {indent(depth)}
      <span className="size-3.5 shrink-0" />
      <FileIcon className="size-3.5 shrink-0" style={{ color: colour ?? 'var(--fg-icon)' }} />
      <span
        className="min-w-0 flex-1 truncate"
        style={{ color: selected ? 'var(--fg-primary)' : colour }}
      >
        {entry.name}
      </span>
    </button>
  )
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** 逻辑路径转系统路径（macOS/Linux 上通常相同）。 */
function toSysPath(logical: string): string {
  return logical
}
