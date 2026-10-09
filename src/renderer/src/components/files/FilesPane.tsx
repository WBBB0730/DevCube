import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { ChevronsDownUp, ChevronsUpDown, Folder, FolderOpen, Minus, Search } from 'lucide-react'
import {
  FILES_TEXT_MAX_BYTES,
  pushRecentPath,
  type FilesDirEntry,
  type FilesUiState
} from '@shared/files'
import { flattenFilesTree, type FilesTreeRow } from '@shared/files-tree-flatten'
import type { GitFileStatus } from '@shared/git'
import {
  childPathPrefix,
  joinLogicalPath,
  logicalParentPath,
  normalizePath,
  remapPathPrefix
} from '@shared/files-path'
import { mergeReloadedDirs, resolveOpenTextDiskSync } from '@shared/files-watch'
import {
  resolveRemoteInput,
  sameServerFileVersion,
  uploadTargetDir,
  type ServerFileVersion,
  type ServerFilesReadProgress
} from '@shared/server-files'
import { SHORTCUT } from '@shared/shortcut-label'
import { createKeyedSubscription } from '@renderer/lib/keyed-subscription'
import { useRememberedPanel } from '@renderer/lib/remembered-panel'
import { isPrimaryModifierEvent, shortcutTitle } from '@renderer/lib/shortcut-label'
import {
  FILES_BASIC_SETUP,
  filesEditorConfig,
  filesEditorTheme,
  filesGutters,
  filesHighlighting,
  languageExtensionForPath
} from '@renderer/lib/cm6-setup'
import { EditorView } from '@codemirror/view'
import { useEditorFind } from '@renderer/lib/use-editor-find'
import { gitDiffGutter, type GitGutterHunkClickPayload } from '@renderer/lib/cm6-git-gutter'
import { FilesFindWidget } from './FilesFindWidget'
import {
  adjacentMediaPath,
  isCsvPath,
  isMarkdownPath,
  isMediaPreviewPath,
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
import {
  FilesTreeMenu,
  type FilesTreeMenuTarget,
  type FilesTreeServerActions
} from './FilesTreeMenu'
import { FilesPdfPreview } from './FilesPdfPreview'
import { FilesPptxPreview } from './FilesPptxPreview'
import { FilesSheetPreview } from './FilesSheetPreview'
import { SqliteFileView } from '@renderer/components/database/SqliteFileView'
import { FilesToolbar } from './FilesToolbar'
import { FilesContentMenu, type FilesContentMenuTarget } from './FilesContentMenu'
import { FilesTreeIcon } from './FilesTreeIcon'
import { arrowDirection, editableTarget, overlayOpen } from '@renderer/lib/files-key-guards'
import { filterFilesTreeByType, type FilesTypeCategory } from '@shared/files-type-filter'
import { FILES_ALL_TYPES, PreviewTypeFilterButton } from './PreviewTreeControls'
import { relPathUnderRoot, toSysPath } from '@renderer/lib/files-paths'
import {
  localFilesBackend,
  serverFilesBackend,
  type FilesOpenResult
} from '@renderer/lib/files-backend'
import { ipcErrorMessage } from '@renderer/lib/ipc-error'
import { typeToInput } from '@renderer/lib/type-to-input'
import { useTreeVirtualReveal } from '@renderer/lib/use-tree-virtual-reveal'
import { useFiles } from '@renderer/files-store'
import { useApp } from '@renderer/store'
import { BAR_INPUT_ICON, BarInput } from '@renderer/components/ui/bar-input'
import { Button } from '@renderer/components/ui/button'
import { CenteredHint } from '@renderer/components/ui/centered-hint'
import { ConfirmDialog } from '@renderer/components/ui/form-dialog'
import { RefreshButton, TOOLBAR_BTN } from '@renderer/components/ui/toolbar'
import {
  TREE_ICON,
  TREE_ROW_H,
  TreeHint,
  TreeNoticeRow,
  TreeRow
} from '@renderer/components/ui/tree'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@renderer/components/ui/resizable'
import {
  TREE_SCROLL,
  TreePanel,
  TreePanelBar,
  TreeRootRow
} from '@renderer/components/ui/tree-panel'
import { FILE_STATUS_COLOR, workingTreeStatusByPath } from '@renderer/components/git/git-details'
import { FilesDownloadContext, FilesLocalContext } from './files-local-context'
import {
  ServerFilePlaceholder,
  ServerOpenProgress,
  ServerSaveBar,
  type ServerSaveState
} from './ServerFileViews'

/** 编辑器跳转请求（FilesPane → FilesTextEditor）：内容搜索带行与选中区间；不带行只聚焦（最近打开选取后）。 */
interface EditorJumpRequest {
  path: string
  line?: number
  col?: number
  endCol?: number
  nonce: number
}

// 每个项目的 Files 面板常驻，共用一个工作区变化监听、按项目路径分发（项目数没有上限）。
const subscribeFilesChanged = createKeyedSubscription(
  (cb: (projectPath: string) => void) => window.api.onFilesChanged(cb),
  (projectPath) => projectPath
)

// 服务器的 Files 面板同样常驻：上传完成的刷新与打开时的下载进度按服务器 id 分发。
const subscribeServerEntriesChanged = createKeyedSubscription(
  (cb: (serverId: string) => void) => window.api.onServerFilesEntriesChanged(cb),
  (serverId) => serverId
)
const subscribeServerReadProgress = createKeyedSubscription(
  (cb: (progress: ServerFilesReadProgress) => void) => window.api.onServerFilesReadProgress(cb),
  (progress) => progress.serverId
)

const IDLE_SAVE_MS = 2000
const FILTER_DEBOUNCE_MS = 200

/** 文件树的行在定位里认的键：路径；提示行不能被定位 */
const filesRowKey = (row: FilesTreeRow): string | undefined => (row.notice ? undefined : row.path)

type Loaded =
  | ((
      | {
          kind: 'text'
          path: string
          content: string
          /** 载入 / 上次保存时文件的修改时间与大小：判断文件是否被别处改过 */
          mtimeMs: number
          size: number
          dirty: boolean
        }
      | {
          kind: 'image'
          path: string
          mediaUrl: string
          mime: string
          width?: number
          height?: number
          tiled?: boolean
          /** 经主进程出图用的本机文件（服务器上的图即下载的缓存） */
          decode: { root: string; path: string }
        }
      | { kind: 'audio'; path: string; mediaUrl: string; mime: string }
      | { kind: 'video'; path: string; mediaUrl: string; mime: string }
      | { kind: 'pdf'; path: string; mediaUrl: string }
      | { kind: 'pptx'; path: string; mediaUrl: string }
      | { kind: 'xlsx'; path: string; mediaUrl: string; size: number }
      | { kind: 'sqlite'; path: string }
      | { kind: 'other'; path: string; size: number }
      /** 服务器上较大的文件：占位，canForce 时可「仍然打开」 */
      | { kind: 'too-large'; path: string; size: number; canForce: boolean }
    ) & {
      /** 服务器上的非文本文件载入时的版本（见 FilesOpenResult） */
      version?: ServerFileVersion
    })
  | null

/** 未保存的编辑与别处的改动撞上 */
type FilesConflict =
  /** 别处改过：disk 为别处的当前内容（服务器上的超过文本上限时为 null），修改时间与大小为它的 */
  | { kind: 'changed'; disk: string | null; mtimeMs: number; size: number }
  /** 服务器上的文件已被删除（本地自动保存，碰不到） */
  | { kind: 'gone' }

/** 打开结果 → 正文状态（被取消的打开不改正文，调用方先挡掉）。 */
function loadedFrom(result: Exclude<FilesOpenResult, { kind: 'canceled' }>): NonNullable<Loaded> {
  return result.kind === 'text' ? { ...result, dirty: false } : result
}

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
 * 面板宿主（docs/prd/file-preview-window.md「同一个组件、两种宿主」，docs/prd/server-files.md「面板宿主」）：
 * - project：主窗口 Files Tab——根即 Project 根，状态按项目落盘，树菜单含「在终端中打开」。
 * - preview：Preview Window——根可在树菜单「上一级」/「作为根目录」换、初始文件由宿主给、状态只在窗口内存，
 *   树顶栏多「按类型筛选」（集合由宿主持有以跨换根保留）；「添加为项目 / 转到项目」在窗口顶栏与树空白区菜单各一份。
 * - server：Server 的 Files Tab——根恒为服务器的 `/`，读写经 SFTP（lib/files-backend）；树顶是「前往路径」
 *   而不是筛选，没有 Git 标记与本机专属入口；不随服务器上的变化自动跟进，切回来 / 窗口回到前台时刷新一次。
 */
export type FilesPaneHost =
  | { kind: 'project' }
  | {
      kind: 'server'
      serverId: string
      /** 条目键 `server:<id>`：⌥⌘F / ⌘E 按它分发 */
      entryKey: string
      /** 家目录：首次打开展开到这里，「前往路径」的 `~` 也指它 */
      home: string
      /** 连接可用；意外断开时面板保留，读写暂停，连回来后刷新并补存未保存的编辑 */
      connected: boolean
      /** 「断开连接」（面板先落未保存的编辑再调它） */
      onDisconnect: () => void
      /** 「在 SSH 终端中打开」 */
      onOpenInSshTerminal: (dir: string) => void
    }
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
  /** 预览窗口是临时的、不落盘；项目与服务器按条目记住上次打开 / 展开 / 最近 */
  const persist = host.kind !== 'preview'
  /** 服务器上的文件（经 SFTP）：没有 Git 标记、筛选与本机专属入口，靠事件刷新 */
  const remote = host.kind === 'server'
  const serverId = host.kind === 'server' ? host.serverId : null
  const connected = host.kind !== 'server' || host.connected
  const backend = useMemo(
    () => (serverId !== null ? serverFilesBackend(serverId) : localFilesBackend(rootPath, persist)),
    [serverId, rootPath, persist]
  )
  /** 外部请求（⌥⌘F、⌘E、Git「打开文件」等）的分发键：项目与预览窗口为根路径，服务器为条目键 */
  const storeKey = host.kind === 'server' ? host.entryKey : rootPath
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [childrenByDir, setChildrenByDir] = useState<Record<string, FilesDirEntry[]>>({})
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Loaded>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<FilesConflict | null>(null)
  /** 相对项目根路径 → 工作区 Git 状态（与提交面板文件树上色同源） */
  const [statusByRel, setStatusByRel] = useState<Map<string, GitFileStatus>>(() => new Map())
  /** 当前打开文本文件在 HEAD 的基线（gutter diff 条纹）；无基线为 null */
  const [headText, setHeadText] = useState<{ path: string; content: string } | null>(null)
  const [recentPaths, setRecentPaths] = useState<string[]>([])
  /** 工具栏「最近打开文件」下拉开合（受控，供 ⌘E 打开） */
  const [recentMenuOpen, setRecentMenuOpen] = useState(false)
  /** 展开后读不出来的目录 → 原因（如「没有权限」），树里在它的子级位置显示提示行 */
  const [dirNotices, setDirNotices] = useState<Record<string, string>>({})
  /**
   * 正在打开的服务器文件：正文区盖上「正在加载…」，开始下载后换成进度（可取消）；progress 为下载进度，
   * 开始下载才有（用副本、只给占位的没有）
   */
  const [opening, setOpening] = useState<{
    path: string
    progress: { doneBytes: number; totalBytes: number } | null
  } | null>(null)
  const openingRef = useRef(opening)
  const dirNoticesRef = useRef(dirNotices)
  /** 服务器：树顶「前往路径」的输入与出错原因 */
  const [goQuery, setGoQuery] = useState('')
  const [goError, setGoError] = useState<string | null>(null)
  /** 服务器：从本机拖进来时的目标目录（高亮该目录行） */
  const [dropDir, setDropDir] = useState<string | null>(null)

  const loadedRef = useRef(loaded)
  const recentPathsRef = useRef(recentPaths)
  const expandedRef = useRef(expanded)
  const childrenByDirRef = useRef(childrenByDir)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 看图相机：工具栏「适应」钮组驱动 */
  const imageRef = useRef<MediaPreviewHandle>(null)
  /** 看图当前所处的档；null = 自由倍率，四颗钮都不亮。 */
  const [imageFit, setImageFit] = useState<MediaFitMode | null>(null)
  /** 右侧文件树可见性；不持久化，重挂载默认展开。 */
  const [treeVisible, setTreeVisible] = useState(true)
  /** Markdown / SVG / CSV 编辑 ↔ 预览两态；会话内保持，不持久化，默认预览（新建文件时切回编辑）。 */
  const [sourcePreview, setSourcePreview] = useState(true)
  /** PDF / PPT 缩略图侧栏可见性（两者共用一个开关）；会话内保持，不持久化，默认显示。 */
  const [pageThumbnails, setPageThumbnails] = useState(true)
  /** 文件树右键菜单目标与条目操作弹窗（新建 / 重命名 / 删除）。 */
  const [treeMenu, setTreeMenu] = useState<FilesTreeMenuTarget | null>(null)
  /** 正文区（看图 / SVG 预览）右键菜单：复制图片 / 在文件夹中显示 / 在其他应用中打开 */
  const [contentMenu, setContentMenu] = useState<FilesContentMenuTarget | null>(null)
  const [entryDialog, setEntryDialog] = useState<FilesEntryDialogRequest | null>(null)
  /** gutter diff 弹窗（点击标记行号格子；文档一变即关，见 onChange / openFile）。 */
  const [hunkPopup, setHunkPopup] = useState<GitGutterHunkClickPayload | null>(null)
  /** 编辑器跳转：内容搜索选中命中区间并滚到行、最近打开只聚焦（nonce 支持同位置重跳）。 */
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
  // 外部请求只认挂载之后的：服务器面板连上才挂，没连上时按的、断开前按过的都不补
  const filterFocusNonce = useFiles((s) => s.filterFocusNonceByKey[storeKey] ?? 0)
  const recentMenuNonce = useFiles((s) => s.recentMenuNonceByKey[storeKey] ?? 0)
  const filterViewRef = useRef(filterView)

  useLayoutEffect(() => {
    loadedRef.current = loaded
    recentPathsRef.current = recentPaths
    expandedRef.current = expanded
    childrenByDirRef.current = childrenByDir
    filterViewRef.current = filterView
    openingRef.current = opening
    dirNoticesRef.current = dirNotices
  }, [loaded, recentPaths, expanded, childrenByDir, filterView, opening, dirNotices])

  // 隐藏时丢弃临时过滤（服务器为「前往路径」的输入）、gutter 弹窗与最近打开下拉；其它 Files 状态继续常驻。
  const [filterVisible, setFilterVisible] = useState(visible)
  if (filterVisible !== visible) {
    setFilterVisible(visible)
    if (!visible) {
      setFilterQuery('')
      setFilterScanning(false)
      setFilterView(null)
      setGoQuery('')
      setGoError(null)
      setHunkPopup(null)
      setRecentMenuOpen(false)
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

  // 首查扫描提示（冷索引才等得到）：TreeHint 延迟出现，防索引已热时闪烁（同 diff 加载骨架）
  const filterLoading = filtering && filterScanning && filterView === null

  // 树行虚拟化：按展开态拍平成行数组，仅渲染视口内行（命中再多渲染成本恒定）
  const flatRows = useMemo(
    () => flattenFilesTree(rootLogical, displayChildren, displayExpanded, dirNotices),
    [rootLogical, displayChildren, displayExpanded, dirNotices]
  )
  // 选中项一变即定位（打开文件、显式定位；点目录只改展开，不滚）；面板切走或树隐藏时先挂着，目标行尚未进树
  // （目录加载中）时也挂着，出现即滚到
  const {
    scrollRef: treeScrollRef,
    virtualizer: rowVirtualizer,
    scrollToRow
  } = useTreeVirtualReveal({
    rows: flatRows,
    rowHeight: TREE_ROW_H,
    rowKey: filesRowKey,
    getItemKey: (i) => flatRows[i].path,
    enabled: visible && treeVisible,
    follow: selectedPath
  })

  const refreshGitStatus = useCallback(async () => {
    const seq = ++gitStatusSeqRef.current
    const status = await loadWorkingTreeStatus(rootPath)
    if (seq === gitStatusSeqRef.current) setStatusByRel(status)
  }, [rootPath])

  // Files 可见时拉未提交状态；仓库变动（含工作区 watcher）后刷新（服务器上的文件没有 Git 标记）
  useEffect(() => {
    if (!visible || remote) return
    const seq = ++gitStatusSeqRef.current
    void loadWorkingTreeStatus(rootPath).then((status) => {
      if (seq === gitStatusSeqRef.current) setStatusByRel(status)
    })
    const dispose = window.api.onGitChanged((p) => {
      if (p === rootPath) void refreshGitStatus()
    })
    return dispose
  }, [visible, remote, rootPath, refreshGitStatus])

  // 打开文本文件时取 HEAD 基线（gutter diff）；提交 / 暂存等 git 变化后重取
  const openTextPath = loaded?.kind === 'text' ? loaded.path : null
  useEffect(() => {
    if (!visible || remote || openTextPath === null) return
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
  }, [visible, remote, openTextPath, rootPath])

  /** 落盘 UI 态（项目与服务器）；预览窗口一律不写集中配置存储（由 backend 决定） */
  const setUi = useCallback((patch: Partial<FilesUiState>) => backend.setUi(patch), [backend])
  const persistUi = useCallback(
    (openPath: string | null, expandedPaths: string[]) => setUi({ openPath, expandedPaths }),
    [setUi]
  )

  /** 从「最近打开」里去掉已不在的文件 */
  const dropRecent = useCallback(
    (path: string): void => {
      const next = recentPathsRef.current.filter((p) => p !== path)
      recentPathsRef.current = next
      setRecentPaths(next)
      setUi({ recentPaths: next })
    },
    [setUi]
  )

  /** 服务器上的文件正在保存（保存栏转圈） */
  const [saving, setSaving] = useState(false)

  /**
   * 写入当前文本。服务器上的文件在编辑期间被别处改过时不写，转为冲突（本地弹框，服务器在保存栏里处理）。
   * 保存期间又键入的内容不算已保存：写完只更新基准，内容变过就仍是未保存。
   */
  const flushSave = useCallback(async (): Promise<boolean> => {
    const cur = loadedRef.current
    if (!cur || cur.kind !== 'text' || !cur.dirty) return true
    setSaving(true)
    try {
      const result = await backend.write(cur.path, cur.content, {
        mtimeMs: cur.mtimeMs,
        size: cur.size
      })
      if ('conflict' in result) {
        const { content, mtimeMs, size } = result.conflict
        setConflict({ kind: 'changed', disk: content, mtimeMs, size })
        return false
      }
      // 同步写 ref，避免保存触发的 files:changed 仍读到旧 dirty/mtime 而误报冲突
      const settle = (prev: Loaded): Loaded =>
        prev && prev.kind === 'text' && prev.path === cur.path
          ? {
              ...prev,
              mtimeMs: result.mtimeMs,
              size: result.size,
              dirty: prev.content !== cur.content
            }
          : prev
      loadedRef.current = settle(loadedRef.current)
      setLoaded(settle)
      setSaveError(null)
      // 写成了即不再冲突（服务器上已删除的，保存即重新创建）
      setConflict(null)
      if (!remote) void refreshGitStatus()
      return true
    } catch (e) {
      setSaveError(ipcErrorMessage(e))
      return false
    } finally {
      setSaving(false)
    }
  }, [backend, remote, refreshGitStatus])

  const scheduleIdleSave = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => {
      void flushSave()
    }, IDLE_SAVE_MS)
  }, [flushSave])

  /**
   * 打开条目。force：不先处理当前文件的未保存编辑（调用方已处理，或本就要丢掉）；openLarge：服务器上的大文件「仍然打开」。
   * 换到别的文件前：本地先自动保存；服务器上的文件手动保存，先问「保存 / 不保存 / 取消」。
   * 正在编辑的文件再点一次不重读，免得冲掉未保存的修改。
   * 服务器上的文件先下载，期间正文区盖上进度，「取消」即回到原来的正文；意外断开期间不打开（正文不动）。
   */
  const openFile = useCallback(
    async (filePath: string, opts?: { force?: boolean; openLarge?: boolean }) => {
      if (!connected) return
      setHunkPopup(null)
      if (idleTimer.current) {
        clearTimeout(idleTimer.current)
        idleTimer.current = null
      }
      const seq = ++openSeqRef.current
      const cur = loadedRef.current
      if (cur?.kind === 'text' && cur.dirty && !opts?.force) {
        if (cur.path === filePath) return
        if (remote) {
          const choice = await useApp.getState().askUnsaved(baseName(cur.path))
          if (choice === 'cancel' || (choice === 'save' && !(await flushSave()))) return
        } else if (!(await flushSave())) {
          return
        }
        if (seq !== openSeqRef.current) return
      }
      // 树上的选中先切过去，不等读完（服务器上的文件要下载一会儿）；被取消时退回正文所在的那个
      setSelectedPath(filePath)
      if (remote) setOpening({ path: filePath, progress: null })
      try {
        const result = await backend.read(filePath, opts?.openLarge)
        if (seq !== openSeqRef.current) return
        if (result.kind === 'canceled') {
          setSelectedPath(loadedRef.current?.path ?? null)
          return
        }
        setLoaded(loadedFrom(result))
        setConflict(null)
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
        setSaveError(ipcErrorMessage(e))
        setLoaded(null)
        setSelectedPath(null)
        persistUi(null, [...expandedRef.current])
        // 服务器上已经不在的从「最近打开」里去掉（本地的在启动时剔除）
        if (serverId !== null) {
          void window.api.serverFilesStat(serverId, filePath).then(
            (st) => {
              if (st === null) dropRecent(filePath)
            },
            () => undefined
          )
        }
      } finally {
        if (seq === openSeqRef.current) setOpening(null)
      }
    },
    [connected, backend, remote, serverId, flushSave, persistUi, setUi, dropRecent]
  )

  // 服务器：打开时的下载进度
  useEffect(() => {
    if (serverId === null) return
    return subscribeServerReadProgress(serverId, (p) =>
      setOpening((prev) =>
        prev !== null && prev.path === p.path
          ? { ...prev, progress: { doneBytes: p.doneBytes, totalBytes: p.totalBytes } }
          : prev
      )
    )
  }, [serverId])

  /**
   * 读目录并缓存。读不出来（没有权限等）时记下原因、按空目录缓存：树里在它的子级位置显示提示行，
   * 收起时丢掉缓存（见 toggleDir），再展开会重读。
   */
  const ensureDirLoaded = useCallback(
    async (dirPath: string): Promise<FilesDirEntry[]> => {
      const cached = childrenByDirRef.current[dirPath]
      if (cached) return cached
      let entries: FilesDirEntry[] = []
      let notice: string | null = null
      try {
        entries = await backend.listDir(dirPath)
      } catch (e) {
        notice = ipcErrorMessage(e)
      }
      const raced = childrenByDirRef.current[dirPath]
      if (raced) return raced
      childrenByDirRef.current = { ...childrenByDirRef.current, [dirPath]: entries }
      setChildrenByDir((prev) => (prev[dirPath] ? prev : { ...prev, [dirPath]: entries }))
      if (notice !== null) {
        const message = notice
        setDirNotices((prev) => ({ ...prev, [dirPath]: message }))
      }
      return entries
    },
    [backend]
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
      // 意外断开期间读不了：没读过的目录不展开，读过的照常开合
      if (willOpen && !connected && !(dirPath in childrenByDirRef.current)) return
      // 手动收起时作废进行中的「全部展开」，否则后续 flush 会把目录再次打开
      if (!willOpen) expandAllSeqRef.current++
      // 读不出来的目录收起时丢掉缓存与提示，再展开会重读
      if (!willOpen && dirPath in dirNoticesRef.current) {
        const nextChildren = { ...childrenByDirRef.current }
        delete nextChildren[dirPath]
        childrenByDirRef.current = nextChildren
        setChildrenByDir(nextChildren)
        setDirNotices((prev) => {
          const next = { ...prev }
          delete next[dirPath]
          return next
        })
      }
      if (willOpen) await ensureDirLoaded(dirPath)
      const next = new Set(expandedRef.current)
      if (willOpen) next.add(dirPath)
      else next.delete(dirPath)
      expandedRef.current = next
      setExpanded(next)
      persistUi(loadedRef.current?.path ?? null, [...next])
    },
    [connected, ensureDirLoaded, filterQuery, persistUi]
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
          nextChildren[dir] = await backend.listDir(dir)
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
  }, [filterQuery, persistUi, backend, rootLogical])

  /** 展开到目标：文件只展开祖先；目录连自身一并展开。 */
  const expandToPath = useCallback(
    async (logical: string, isDirectory: boolean): Promise<Set<string>> => {
      // 意外断开期间读不了目录：不展开（免得留下「未连接到服务器」的提示行）
      if (!connected) return expandedRef.current
      const toAdd: string[] = [rootLogical]
      const under = childPathPrefix(rootLogical)
      const rel = logical.startsWith(under) ? logical.slice(under.length) : ''
      if (rel) {
        const segs = rel.split('/')
        let prefix = rootLogical
        for (let i = 0; i < segs.length; i++) {
          prefix = joinLogicalPath(prefix, segs[i]!)
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
    [connected, ensureDirLoaded, rootLogical]
  )

  const expandToFile = useCallback(
    async (logical: string): Promise<void> => {
      const next = await expandToPath(logical, false)
      persistUi(logical, [...next])
    },
    [expandToPath, persistUi]
  )

  /**
   * 上一个 / 下一个媒体（位图 / SVG / PDF / PPT / 音视频）按**树里当前可见的顺序**走——跨目录、跨类型，
   * 但只进已展开的目录（折叠的不自动钻），并尊重类型筛选；到头停下。
   * 当前正文是媒体才响应（看图 / SVG 预览态 / PDF / PPT / 音视频，及服务器上超过预览上限的媒体占位）。
   * 服务器上的还在下载时，从正在打开的那个往下数：连按即连跳，不会反复重开同一个。
   */
  const goAdjacentMedia = useCallback(
    async (dir: -1 | 1) => {
      const cur = loadedRef.current
      if (!cur) return
      const isMedia =
        cur.kind === 'image' ||
        cur.kind === 'pdf' ||
        cur.kind === 'pptx' ||
        cur.kind === 'audio' ||
        cur.kind === 'video' ||
        (cur.kind === 'text' && isSvgPath(cur.path)) ||
        (cur.kind === 'too-large' && isMediaPreviewPath(cur.path))
      if (!isMedia) return
      const next = adjacentMediaPath(flatRows, openingRef.current?.path ?? cur.path, dir)
      if (next === null) return
      if (isSvgPath(next)) setSourcePreview(true)
      await openFile(next)
    },
    [flatRows, openFile]
  )
  const goPrevImage = useCallback(() => void goAdjacentMedia(-1), [goAdjacentMedia])
  const goNextImage = useCallback(() => void goAdjacentMedia(1), [goAdjacentMedia])

  // 音视频正文与服务器上的大媒体占位（没有自己的键盘处理）：四个方向键切上一个 / 下一个媒体
  // （同看图；守卫同看图——不抢输入框与弹层）。焦点落在播放器上时也拦下，播放器自己的键盘进度 / 音量让位给切换，进度条仍可拖。
  const avOpen = loaded?.kind === 'audio' || loaded?.kind === 'video'
  const arrowKeysHere = avOpen || (loaded?.kind === 'too-large' && isMediaPreviewPath(loaded.path))
  useEffect(() => {
    if (!visible || !arrowKeysHere) return
    const onKey = (e: KeyboardEvent): void => {
      const dir = arrowDirection(e)
      if (dir === null) return
      if (editableTarget(e.target) || overlayOpen()) return
      e.preventDefault()
      e.stopPropagation()
      void goAdjacentMedia(dir)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [visible, arrowKeysHere, goAdjacentMedia])

  /** 分页文档预览：PDF 用 PDF.js，PPT 用 pptx-renderer，外壳与参数相同 */
  const PagedPreview = loaded?.kind === 'pptx' ? FilesPptxPreview : FilesPdfPreview

  const viewingImagePath =
    loaded?.kind === 'image'
      ? loaded.path
      : loaded?.kind === 'text' && isSvgPath(loaded.path) && sourcePreview
        ? loaded.path
        : null

  // 服务器上的图要先下载，不预取相邻的。进出预取时都清空：渲染期比对上一次是否在预取（React「渲染中调整 state」模式，
  // 非 effect）；不预取期间旧预取晚到写进来的列表没人用，下次进入预取时在这里清掉
  const prefetching = !!viewingImagePath && !remote
  const [seenPrefetching, setSeenPrefetching] = useState(prefetching)
  if (prefetching !== seenPrefetching) {
    setSeenPrefetching(prefetching)
    setPrefetch([])
  }
  useEffect(() => {
    if (!viewingImagePath || remote) return
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
  }, [viewingImagePath, remote, flatRows, rootPath])

  /** 在右侧文件树展开并滚到目标（不打开/切换正文，除非本来就是该文件）。 */
  const revealInTree = useCallback(
    async (logical: string, isDirectory: boolean): Promise<void> => {
      setTreeVisible(true)
      const next = await expandToPath(logical, isDirectory)
      setSelectedPath(logical)
      // 已是选中项时不会跟随定位，显式再滚一次
      scrollToRow(logical)
      const openPath = loadedRef.current?.path ?? null
      persistUi(openPath, [...next])
    },
    [expandToPath, persistUi, scrollToRow]
  )

  const openFromRecent = useCallback(
    async (logical: string) => {
      await expandToFile(logical)
      await openFile(logical)
      // 已是当前文件时 selectedPath 不变、不会跟随定位，须显式再滚一次（同「在文件树中显示」）
      scrollToRow(logical)
      // 焦点进正文：文本进编辑器直接可键入（非文本不渲染编辑器，请求自然落空）
      setEditorJump({ path: logical, nonce: ++editorJumpNonce.current })
    },
    [expandToFile, openFile, scrollToRow]
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

  // 首次变为可见时：项目与服务器宿主恢复树展开与上次打开（pending 由下一 effect 统一消费，避免竞态），
  // 服务器头一回打开（没有记住的展开）时展开到家目录；
  // 预览宿主不读落盘态，展开到初始文件并打开（可预览的源文件按默认的预览态打开，SVG 起手即图）。
  const previewInitialFile = host.kind === 'preview' ? host.initialFile : null
  const serverHome = host.kind === 'server' ? host.home : null
  useEffect(() => {
    if (!visible || ready) return
    let cancelled = false
    void (async () => {
      await ensureDirLoaded(rootLogical)
      if (cancelled) return
      if (!persist) {
        if (previewInitialFile) {
          await expandToFile(previewInitialFile)
          if (cancelled) return
          await openFile(previewInitialFile, { force: true })
        }
        if (cancelled) return
        setReady(true)
        return
      }
      const ui = await backend.getUi()
      if (cancelled) return
      const exp = new Set(ui.expandedPaths)
      expandedRef.current = exp
      setExpanded(exp)
      setRecentPaths(ui.recentPaths)
      await Promise.all([...exp].map((d) => ensureDirLoaded(d)))
      if (cancelled) return
      if (serverHome !== null && exp.size === 0) await revealInTree(serverHome, true)
      if (cancelled) return
      const hasPending = !!useFiles.getState().pendingOpenByProject[storeKey]
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
    serverHome,
    backend,
    storeKey,
    ensureDirLoaded,
    expandToFile,
    revealInTree,
    openFile,
    rootLogical
  ])

  // 预览宿主：把当前打开文件回报给窗口壳（上翻根时据此保留打开的文件、更新标题）
  const onOpenPathChange = host.kind === 'preview' ? host.onOpenPathChange : null
  const openPath = loaded?.path ?? null
  useEffect(() => {
    if (ready) onOpenPathChange?.(openPath)
  }, [ready, openPath, onOpenPathChange])

  // Git / 内容搜索等外部 pending open（ready 之后才消费）
  const pending = useFiles((s) => s.pendingOpenByProject[storeKey])
  useEffect(() => {
    if (!ready || !pending) return
    const req = useFiles.getState().consumePendingOpen(storeKey)
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
  }, [ready, pending, storeKey, expandToFile, openFile])

  // ⌥⌘F：切到本 Tab 后聚焦文件树筛选，树隐藏时先展开。可见即接下请求：渲染期比对处理过的 nonce（React「渲染中调整
  // state」模式，非 effect）；聚焦要等树挂上，在 effect 里做
  const [handledFilterFocusNonce, setHandledFilterFocusNonce] = useState(filterFocusNonce)
  if (visible && filterFocusNonce !== handledFilterFocusNonce) {
    setHandledFilterFocusNonce(filterFocusNonce)
    setTreeVisible(true)
  }
  /** 已聚焦过的请求（挂载时的算聚焦过） */
  const focusedFilterNonce = useRef(handledFilterFocusNonce)
  useEffect(() => {
    if (handledFilterFocusNonce === focusedFilterNonce.current) return
    focusedFilterNonce.current = handledFilterFocusNonce
    const input = filterInputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [handledFilterFocusNonce])

  // ⌘E：切到本 Tab 后弹出「最近打开文件」下拉；等首次恢复完成再弹，免得先出空列表。
  // 渲染期比对处理过的 nonce（React「渲染中调整 state」模式，非 effect）
  const [handledRecentMenuNonce, setHandledRecentMenuNonce] = useState(recentMenuNonce)
  if (visible && ready && recentMenuNonce !== handledRecentMenuNonce) {
    setHandledRecentMenuNonce(recentMenuNonce)
    setRecentMenuOpen(true)
  }

  // 离开 Files Tab / 失焦 → 保存（仅本地；服务器上的文件手动保存，见 docs/prd/server-files.md）
  useEffect(() => {
    if (!visible && !remote) void flushSave()
  }, [visible, remote, flushSave])

  useEffect(() => {
    if (remote) return
    const onBlur = (): void => {
      void flushSave()
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [remote, flushSave])

  /**
   * 磁盘变更（ADR-0011）：重拉已缓存目录；过滤态重扫；同步当前打开文件。
   * 隐藏不卸载时也跟进，切回 Files Tab 时树与正文已是新态。
   * 服务器：只重读已展开的目录与根（其余缓存丢掉，再展开时现读）；打开的文件先看修改时间与大小，
   * 变了才处理——文本重读，预览与占位重新打开；意外断开期间不刷新——读失败会被当成目录已删、把树收起。
   */
  const syncFromDisk = useCallback(async () => {
    if (!connected) return
    const failed = dirNoticesRef.current
    let dirs = Object.keys(childrenByDirRef.current).filter((d) => !(d in failed))
    if (remote) {
      const keep = new Set([rootLogical, ...expandedRef.current])
      const cached = Object.entries(childrenByDirRef.current)
      if (cached.some(([d]) => !keep.has(d) && !(d in failed))) {
        const pruned = Object.fromEntries(cached.filter(([d]) => keep.has(d) || d in failed))
        childrenByDirRef.current = pruned
        setChildrenByDir(pruned)
      }
      dirs = dirs.filter((d) => keep.has(d))
    }
    if (dirs.length > 0) {
      const reloaded: Record<string, FilesDirEntry[] | null> = {}
      await Promise.all(
        dirs.map(async (dir) => {
          try {
            reloaded[dir] = await backend.listDir(dir)
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

    if (serverId !== null) {
      // 正在打开别的文件时不动（查完再看一次）：同一台服务器同一时刻只能有一个打开，这里再读会把那个取消掉
      if (openingRef.current !== null) return
      const st = await window.api.serverFilesStat(serverId, path).catch(() => undefined)
      const still = loadedRef.current
      if (st === undefined || !still || still.path !== path || openingRef.current !== null) return
      // 有未保存的修改时不关、不重开（手动保存，修改可能放了很久）：已删除、长过文本上限都转为冲突，在保存栏里处理
      const dirty = still.kind === 'text' && still.dirty
      if (st === null) {
        if (dirty) setConflict({ kind: 'gone' })
        else clearOpen()
        return
      }
      // 文本比对载入 / 上次保存时的版本，其余比对载入时的；预览与占位变了就重新打开
      const base = still.kind === 'text' ? still : still.version
      if (base === undefined || sameServerFileVersion(st, base)) return
      if (still.kind !== 'text' || st.size > FILES_TEXT_MAX_BYTES) {
        if (dirty) setConflict({ kind: 'changed', disk: null, mtimeMs: st.mtimeMs, size: st.size })
        else await openFile(path, { force: true })
        return
      }
    }

    let fresh: FilesOpenResult | null = null
    try {
      fresh = await backend.read(path)
    } catch {
      fresh = null
    }
    const still = loadedRef.current
    if (!still || still.path !== path || fresh?.kind === 'canceled') return
    // 服务器上查完到读之间又变了（被删、长过上限）：有未保存的修改先不动，下次刷新按上面处理
    const unreadable = fresh === null || fresh.kind === 'too-large'
    if (remote && unreadable && still.kind === 'text' && still.dirty) return
    // 服务器上的文本长过了上限：重开即落到占位
    if (fresh?.kind === 'too-large') {
      await openFile(path, { force: true })
      return
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
          size: decision.size,
          dirty: false
        })
        return
      }
      if (decision.action === 'conflict') {
        const { disk, mtimeMs, size } = decision
        setConflict({ kind: 'changed', disk, mtimeMs, size })
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
  }, [
    connected,
    remote,
    serverId,
    backend,
    filterQuery,
    openFile,
    persistUi,
    setUi,
    rootPath,
    rootLogical
  ])

  /**
   * 服务器上的刷新要一会儿：进行中「刷新」钮的图标转圈、钮置灰，自动触发的也算；
   * 结束后图标转回原位才恢复（RefreshButton）
   */
  const [refreshing, setRefreshing] = useState(0)
  const refreshFromDisk = useCallback(async () => {
    if (!remote) return syncFromDisk()
    setRefreshing((n) => n + 1)
    try {
      await syncFromDisk()
    } finally {
      setRefreshing((n) => n - 1)
    }
  }, [remote, syncFromDisk])

  useEffect(() => {
    if (!ready) return
    return serverId !== null
      ? subscribeServerEntriesChanged(serverId, () => void refreshFromDisk())
      : subscribeFilesChanged(rootPath, () => void refreshFromDisk())
  }, [ready, serverId, rootPath, refreshFromDisk])

  // 服务器上的变化没人通知：切回这个 Tab、窗口回到前台、断线后连回来时各刷新一次（首次就绪时刚读过，跳过）。
  const refreshRef = useRef(refreshFromDisk)
  const flushSaveRef = useRef(flushSave)
  useLayoutEffect(() => {
    refreshRef.current = refreshFromDisk
    flushSaveRef.current = flushSave
  })
  const refreshArmed = useRef(false)
  useEffect(() => {
    if (!ready || !remote || !visible || !connected) return
    if (refreshArmed.current) void refreshRef.current()
    refreshArmed.current = true
    const onFocus = (): void => void refreshRef.current()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [ready, remote, visible, connected])

  // 服务器上的文件有未保存的修改时登记到全局：断开、编辑或移除服务器、退出前据此先问（见 store）
  const unsavedName =
    serverId !== null && loaded?.kind === 'text' && loaded.dirty ? baseName(loaded.path) : null
  useEffect(() => {
    if (serverId === null) return
    useApp
      .getState()
      .setUnsavedServerFile(
        serverId,
        unsavedName === null ? null : { name: unsavedName, save: () => flushSaveRef.current() }
      )
  }, [serverId, unsavedName])
  useEffect(() => {
    if (serverId === null) return
    return () => useApp.getState().setUnsavedServerFile(serverId, null)
  }, [serverId])

  // ⌘S / Ctrl+S：保存服务器上的文件（编辑态与预览态都行；有弹层时让位）
  const savable = remote && visible && connected && loaded?.kind === 'text'
  useEffect(() => {
    if (!savable) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() !== 's' || e.altKey || e.shiftKey || !isPrimaryModifierEvent(e))
        return
      if (overlayOpen()) return
      e.preventDefault()
      void flushSaveRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [savable])

  /** 树行 / 空白区右键 → 打开条目菜单（服务器意外断开期间不给：菜单里全是要连接才能做的事）。 */
  const openTreeMenu = useCallback(
    (path: string, isDirectory: boolean, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!connected) return
      setTreeMenu({ x: e.clientX, y: e.clientY, path, isDirectory })
    },
    [connected]
  )

  // —— 服务器宿主：上传 / 下载 / 在 SSH 终端中打开 / 前往路径 / 断开 ——

  // 选完文件时连接若已断开，传输照样列进传输栏、以失败收口（见主进程 enqueueTransfer）
  const serverActions = useMemo<FilesTreeServerActions | undefined>(
    () =>
      host.kind !== 'server'
        ? undefined
        : {
            onUpload: (dir, kind) =>
              void window.api.serverFilesUploadPick(host.serverId, dir, kind),
            onDownload: (path, isDirectory) =>
              void window.api.serverFilesDownload(host.serverId, path, isDirectory),
            onOpenInSshTerminal: host.onOpenInSshTerminal
          },
    [host]
  )

  /** 改「前往路径」的输入：出错原因随之撤掉。 */
  const changeGoQuery = useCallback((query: string): void => {
    setGoQuery(query)
    setGoError(null)
  }, [])

  /**
   * 「前往路径」：目录即展开并定位，文件即打开；输入不对或路径不存在时就地提示（焦点留在输入框）。
   * 前往成功后焦点离开输入框、落到目标上：先交给文件树（目标行已选中并滚到），文本文件打开后再进编辑器。
   */
  const goToPath = useCallback(async () => {
    if (serverId === null || serverHome === null) return
    const target = resolveRemoteInput(goQuery, serverHome)
    if (target === null) {
      setGoError('请输入以 / 或 ~ 开头的路径')
      return
    }
    try {
      const st = await window.api.serverFilesStat(serverId, target)
      if (st === null) {
        setGoError('路径不存在')
        return
      }
      changeGoQuery('')
      treeScrollRef.current?.focus({ preventScroll: true })
      if (st.isDirectory) await revealInTree(target, true)
      else await openFromRecent(target)
    } catch (e) {
      setGoError(ipcErrorMessage(e))
    }
  }, [serverId, serverHome, goQuery, changeGoQuery, treeScrollRef, revealInTree, openFromRecent])

  /** 「断开连接」：有未保存的修改先问「保存 / 不保存 / 取消」，存不上（冲突 / 出错）就不断开。 */
  const disconnect = useCallback(async () => {
    if (host.kind !== 'server') return
    if (await useApp.getState().resolveServerUnsaved(host.serverId)) host.onDisconnect()
  }, [host])

  /** 从本机拖进来：落点即行上标的目录（目录行即自身，文件行即所在目录，根行即根）；空白处不接受。 */
  const dropDirOf = (e: React.DragEvent): string | null =>
    (e.target as HTMLElement).closest<HTMLElement>('[data-drop-dir]')?.dataset.dropDir ?? null
  const acceptsDrop = (e: React.DragEvent): boolean =>
    remote && connected && e.dataTransfer.types.includes('Files')
  const onTreeDragOver = (e: React.DragEvent): void => {
    if (!acceptsDrop(e)) return
    const dir = dropDirOf(e)
    setDropDir(dir)
    if (dir === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onTreeDragLeave = (e: React.DragEvent): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropDir(null)
  }
  const onTreeDrop = (e: React.DragEvent): void => {
    setDropDir(null)
    if (serverId === null || !acceptsDrop(e)) return
    const dir = dropDirOf(e)
    if (dir === null) return
    e.preventDefault()
    const paths = [...e.dataTransfer.files].map((f) => window.drop.getPathForFile(f))
    void window.api.serverFilesUpload(serverId, dir, paths.filter(Boolean)).catch(reportError)
  }

  /**
   * 条目操作执行（弹窗确认后）：主进程落盘 → 本地状态联动 → 统一从磁盘刷新树。
   * 抛错交由弹窗就地展示（弹窗保持打开）。
   */
  const submitEntryDialog = useCallback(
    async (req: FilesEntryDialogRequest, name: string) => {
      if (req.kind === 'create-file' || req.kind === 'create-dir') {
        const entry = await backend.create(
          req.dir,
          name,
          req.kind === 'create-dir' ? 'directory' : 'file'
        )
        setEntryDialog(null)
        await refreshFromDisk()
        if (entry.isDirectory) {
          await revealInTree(entry.path, true)
        } else {
          // 新建的是空文件，可预览的类型也先落在编辑态
          setSourcePreview(false)
          await expandToFile(entry.path)
          await openFile(entry.path)
        }
        return
      }

      if (req.kind === 'rename') {
        // 本地先落未保存的编辑（旧路径此刻仍在），失败则不动文件；服务器上的文件手动保存，编辑留在编辑器里跟着改名
        if (!remote && !(await flushSave())) {
          throw new Error('有未保存的更改且写入失败，已取消重命名')
        }
        const { path: newPath } = await backend.rename(req.path, name)
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
        // 先把打开文件切到新路径，refreshFromDisk 才不会把旧路径当「已消失」清掉。
        // 服务器上的就地换路径：不重新下载，未保存的编辑也还在（改名不改内容与修改时间）
        if (cur !== null && openRemapped !== null && openRemapped !== cur.path) {
          if (remote) {
            const moved = { ...cur, path: openRemapped }
            loadedRef.current = moved
            setLoaded(moved)
          } else {
            await openFile(openRemapped, { force: true })
          }
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

      // 本机移到回收站，服务器上直接删除
      await backend.remove(req.path)
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
      backend,
      remote,
      refreshFromDisk,
      revealInTree,
      expandToFile,
      openFile,
      flushSave,
      ensureDirLoaded,
      setUi
    ]
  )

  /** 冲突时换成别处的版本（服务器上的已删除或新版本超过文本上限时重开，落到出错或占位） */
  const reloadFromConflict = (): void => {
    if (conflict === null) return
    setConflict(null)
    if (conflict.kind === 'gone' || conflict.disk === null) {
      if (loaded !== null) void openFile(loaded.path, { force: true })
      return
    }
    const { disk, mtimeMs, size } = conflict
    setLoaded((prev) =>
      prev && prev.kind === 'text' ? { ...prev, content: disk, mtimeMs, size, dirty: false } : prev
    )
  }
  /** 冲突时保留编辑器内容：以别处的版本为基准，下次保存即覆盖它（服务器上已删除的，下次保存即重新创建） */
  const keepEditorContent = (): void => {
    if (conflict === null) return
    setConflict(null)
    if (conflict.kind === 'gone') return
    const { mtimeMs, size } = conflict
    const rebase = (prev: Loaded): Loaded =>
      prev && prev.kind === 'text' ? { ...prev, mtimeMs, size } : prev
    loadedRef.current = rebase(loadedRef.current)
    setLoaded(rebase)
  }

  // 服务器上的文本文件手动保存：保存栏（常驻在面包屑工具栏之下），冲突也在这里处理
  const textDirty = loaded?.kind === 'text' && loaded.dirty
  const saveState: ServerSaveState =
    conflict !== null
      ? { kind: 'conflict', gone: conflict.kind === 'gone' }
      : saving
        ? { kind: 'saving' }
        : !connected
          ? { kind: 'offline', dirty: textDirty }
          : saveError !== null && textDirty
            ? { kind: 'failed', message: saveError }
            : textDirty
              ? { kind: 'dirty' }
              : { kind: 'clean' }
  const saveBar =
    remote && loaded?.kind === 'text' ? (
      <ServerSaveBar
        state={saveState}
        onSave={() => void flushSave()}
        // 放弃修改：重新读服务器上的版本
        onDiscard={() => void openFile(loaded.path, { force: true })}
        onReload={reloadFromConflict}
        onOverwrite={() => {
          keepEditorContent()
          void flushSave()
        }}
      />
    ) : undefined

  const filterHint = shortcutTitle('筛选文件', SHORTCUT.filesFilter)
  const goHint = shortcutTitle('前往路径…', SHORTCUT.filesFilter)
  /** 服务器上某个文件的「下载」与「在 SSH 终端中打开」（占位与正文菜单用） */
  const downloadFile = (path: string): void => serverActions?.onDownload(path, false)
  /** 预览出错的占位里的「下载」：服务器上打开的文件没有「在其他应用中打开」，给它一个出口；断开时不给 */
  const downloadOpenFile =
    remote && connected && loaded !== null ? () => downloadFile(loaded.path) : null

  const treePanel = useRememberedPanel('treePanel')

  return (
    <FilesLocalContext.Provider value={!remote}>
      <FilesDownloadContext.Provider value={downloadOpenFile}>
        <ResizablePanelGroup {...treePanel.groupProps}>
          <ResizablePanel
            className="relative bg-deepest"
            onContextMenu={(e) => {
              // 任何已打开的条目都有正文菜单；空态没有。看图 / SVG 预览态另给「复制图片」取图源
              const cur = loaded
              if (!cur) return
              e.preventDefault()
              let imageSrc: (() => Promise<string>) | null = null
              if (cur.kind === 'image') {
                // 复制屏上正显示的那张：超大位图与浏览器解不了、改由主进程出图的都是预览图（长边 4096），
                // 整图塞剪贴板不现实；加载中 / 打不开时不给复制
                const shown = imageRef.current?.displayedSrc() ?? null
                if (shown) imageSrc = () => Promise.resolve(shown)
              } else if (cur.kind === 'text' && isSvgPath(cur.path) && sourcePreview) {
                const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cur.content)}`
                imageSrc = () => Promise.resolve(src)
              }
              setContentMenu({ x: e.clientX, y: e.clientY, path: cur.path, imageSrc })
            }}
          >
            {/* 不按文件重挂：盖上之后换打开别的文件也一直盖着，旧文件不会在两次打开之间露出来 */}
            {opening !== null && serverId !== null && (
              <ServerOpenProgress
                path={opening.path}
                progress={opening.progress}
                onCancel={() => void window.api.serverFilesCancelRead(serverId)}
              />
            )}
            {!loaded && (
              <div className="flex h-full min-h-0 flex-col">
                {/* 打开失败（如没有权限）会回到空态：原因留在这里 */}
                <FilesToolbar
                  path={null}
                  projectRoot={rootLogical}
                  error={saveError}
                  recentPaths={recentPaths}
                  recentMenuOpen={recentMenuOpen}
                  onRecentMenuOpenChange={setRecentMenuOpen}
                  fileStatus={undefined}
                  treeVisible={treeVisible}
                  onShowTree={() => setTreeVisible(true)}
                  onToggleTree={() => setTreeVisible((v) => !v)}
                  onRevealInTree={revealInTree}
                  onOpenRecent={openFromRecent}
                />
                <CenteredHint>在右侧选择文件</CenteredHint>
              </div>
            )}
            {loaded?.kind === 'text' && (
              <FilesTextEditor
                path={loaded.path}
                content={loaded.content}
                baseline={
                  headText !== null && headText.path === loaded.path ? headText.content : null
                }
                projectRoot={rootLogical}
                // 服务器上的文件保存出错写在保存栏里
                error={remote ? null : saveError}
                saveBar={saveBar}
                recentPaths={recentPaths}
                recentMenuOpen={recentMenuOpen}
                onRecentMenuOpenChange={setRecentMenuOpen}
                fileStatus={statusByRel.get(relPathUnderRoot(rootLogical, loaded.path))}
                treeVisible={treeVisible}
                sourcePreview={sourcePreview}
                onToggleSourcePreview={() => {
                  const next = !sourcePreview
                  // 本地切到预览前落盘，预览与磁盘一致（服务器上的预览看的是编辑器里的内容）；
                  // 编辑器卸载，gutter 弹窗一并关闭
                  if (next && !remote) void flushSave()
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
                active={visible}
                imagePrefetch={prefetch}
                onChange={(v) => {
                  // 文档一变，gutter 弹窗的 hunk 即过期，统一在此关闭（含弹窗内回滚）
                  setHunkPopup(null)
                  setLoaded((prev) =>
                    prev && prev.kind === 'text' ? { ...prev, content: v, dirty: true } : prev
                  )
                  // 服务器上的文件手动保存，不自动写回
                  if (!remote) scheduleIdleSave()
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
                  recentMenuOpen={recentMenuOpen}
                  onRecentMenuOpenChange={setRecentMenuOpen}
                  fileStatus={statusByRel.get(relPathUnderRoot(rootLogical, loaded.path))}
                  treeVisible={treeVisible}
                  onShowTree={() => setTreeVisible(true)}
                  onToggleTree={() => setTreeVisible((v) => !v)}
                  onRevealInTree={revealInTree}
                  onOpenRecent={openFromRecent}
                  extra={
                    <MediaFitButtons
                      active={imageFit}
                      onFit={(axis) => imageRef.current?.fit(axis)}
                    />
                  }
                />
                <FilesMediaPreview
                  // 服务器上的图是在进度遮罩后面换的：沿用旧图过渡会在遮罩撤掉时闪出上一张，按文件重挂
                  key={remote ? loaded.path : undefined}
                  ref={imageRef}
                  onFitChange={setImageFit}
                  src={loaded.mediaUrl}
                  path={loaded.decode.path}
                  projectPath={loaded.decode.root}
                  width={loaded.width}
                  height={loaded.height}
                  tiled={loaded.tiled === true}
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
                  recentMenuOpen={recentMenuOpen}
                  onRecentMenuOpenChange={setRecentMenuOpen}
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
                  recentMenuOpen={recentMenuOpen}
                  onRecentMenuOpenChange={setRecentMenuOpen}
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
            {(loaded?.kind === 'pdf' || loaded?.kind === 'pptx') && (
              // PDF 与 PPT 同一套分页预览外壳，参数一致；换类型时组件随之换掉
              <PagedPreview
                // 同上：服务器上的文档按文件重挂，不在遮罩撤掉时露出上一份
                key={remote ? loaded.path : undefined}
                src={loaded.mediaUrl}
                path={loaded.path}
                active={visible}
                thumbnails={pageThumbnails}
                onToggleThumbnails={() => setPageThumbnails((v) => !v)}
                onPrev={goPrevImage}
                onNext={goNextImage}
                toolbar={{
                  projectRoot: rootLogical,
                  recentPaths,
                  recentMenuOpen,
                  onRecentMenuOpenChange: setRecentMenuOpen,
                  fileStatus: statusByRel.get(relPathUnderRoot(rootLogical, loaded.path)),
                  treeVisible,
                  onShowTree: () => setTreeVisible(true),
                  onToggleTree: () => setTreeVisible((v) => !v),
                  onRevealInTree: revealInTree,
                  onOpenRecent: openFromRecent
                }}
              />
            )}
            {loaded?.kind === 'xlsx' && (
              <div className="flex h-full min-h-0 flex-col">
                <FilesToolbar
                  path={loaded.path}
                  projectRoot={rootLogical}
                  error={null}
                  recentPaths={recentPaths}
                  recentMenuOpen={recentMenuOpen}
                  onRecentMenuOpenChange={setRecentMenuOpen}
                  fileStatus={statusByRel.get(relPathUnderRoot(rootLogical, loaded.path))}
                  treeVisible={treeVisible}
                  onShowTree={() => setTreeVisible(true)}
                  onToggleTree={() => setTreeVisible((v) => !v)}
                  onRevealInTree={revealInTree}
                  onOpenRecent={openFromRecent}
                />
                <FilesSheetPreview
                  key={loaded.path}
                  source={{ kind: 'xlsx', src: loaded.mediaUrl, size: loaded.size }}
                  path={loaded.path}
                  active={visible}
                />
              </div>
            )}
            {loaded?.kind === 'sqlite' && (
              <div className="flex h-full min-h-0 flex-col">
                <FilesToolbar
                  path={loaded.path}
                  projectRoot={rootLogical}
                  error={null}
                  recentPaths={recentPaths}
                  recentMenuOpen={recentMenuOpen}
                  onRecentMenuOpenChange={setRecentMenuOpen}
                  fileStatus={statusByRel.get(relPathUnderRoot(rootLogical, loaded.path))}
                  treeVisible={treeVisible}
                  onShowTree={() => setTreeVisible(true)}
                  onToggleTree={() => setTreeVisible((v) => !v)}
                  onRevealInTree={revealInTree}
                  onOpenRecent={openFromRecent}
                />
                {/* 打不开时的占位（FilesPreviewError）盖满这一格 */}
                <div className="relative min-h-0 flex-1">
                  <SqliteFileView key={loaded.path} rootPath={rootPath} filePath={loaded.path} />
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
                  recentMenuOpen={recentMenuOpen}
                  onRecentMenuOpenChange={setRecentMenuOpen}
                  fileStatus={statusByRel.get(relPathUnderRoot(rootLogical, loaded.path))}
                  treeVisible={treeVisible}
                  onShowTree={() => setTreeVisible(true)}
                  onToggleTree={() => setTreeVisible((v) => !v)}
                  onRevealInTree={revealInTree}
                  onOpenRecent={openFromRecent}
                />
                {host.kind === 'server' ? (
                  <ServerFilePlaceholder
                    reason="unsupported"
                    size={loaded.size}
                    connected={connected}
                    onOpenAnyway={null}
                    onDownload={() => downloadFile(loaded.path)}
                    onOpenInSshTerminal={() =>
                      host.onOpenInSshTerminal(logicalParentPath(loaded.path))
                    }
                  />
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-sm text-muted-foreground">
                    <p>无法在此编辑此文件</p>
                    <p className="text-xs">{formatSize(loaded.size)}</p>
                    <Button
                      variant="secondary"
                      onClick={() => void window.api.openPath(toSysPath(loaded.path))}
                    >
                      在其他应用中打开
                    </Button>
                  </div>
                )}
              </div>
            )}
            {loaded?.kind === 'too-large' && host.kind === 'server' && (
              <div className="flex h-full min-h-0 flex-col">
                <FilesToolbar
                  path={loaded.path}
                  projectRoot={rootLogical}
                  error={null}
                  recentPaths={recentPaths}
                  recentMenuOpen={recentMenuOpen}
                  onRecentMenuOpenChange={setRecentMenuOpen}
                  fileStatus={undefined}
                  treeVisible={treeVisible}
                  onShowTree={() => setTreeVisible(true)}
                  onToggleTree={() => setTreeVisible((v) => !v)}
                  onRevealInTree={revealInTree}
                  onOpenRecent={openFromRecent}
                />
                <ServerFilePlaceholder
                  reason="too-large"
                  size={loaded.size}
                  connected={connected}
                  onOpenAnyway={
                    loaded.canForce ? () => void openFile(loaded.path, { openLarge: true }) : null
                  }
                  onDownload={() => downloadFile(loaded.path)}
                  onOpenInSshTerminal={() =>
                    host.onOpenInSshTerminal(logicalParentPath(loaded.path))
                  }
                />
              </div>
            )}
          </ResizablePanel>
          {treeVisible && <ResizableHandle {...treePanel.handleProps} />}
          {treeVisible && (
            <TreePanel
              {...treePanel.panelProps}
              onDragOver={onTreeDragOver}
              onDragLeave={onTreeDragLeave}
              onDrop={onTreeDrop}
            >
              <TreePanelBar>
                {remote ? (
                  // 服务器：「前往路径」（绝对路径或 ~ 开头），回车即前往；没有文件索引，不做筛选
                  <BarInput
                    ref={filterInputRef}
                    value={goQuery}
                    onChange={changeGoQuery}
                    onSubmit={() => void goToPath()}
                    escapeFocusRef={treeScrollRef}
                    disabled={!connected}
                    title={goHint}
                    placeholder={goHint}
                  />
                ) : (
                  <BarInput
                    ref={filterInputRef}
                    value={filterQuery}
                    onChange={updateFilterQuery}
                    onClear={() => void exitFilter()}
                    escapeFocusRef={treeScrollRef}
                    leading={<Search className={BAR_INPUT_ICON} />}
                    title={filterHint}
                    placeholder={filterHint}
                  />
                )}
                <div className="flex shrink-0 items-center gap-0.5">
                  {host.kind === 'preview' && (
                    <PreviewTypeFilterButton
                      typeFilter={host.typeFilter}
                      onTypeFilterChange={host.onTypeFilterChange}
                    />
                  )}
                  {remote ? (
                    // 服务器上不给「全部展开」：从 / 递归展开等于把整台服务器扫一遍
                    <RefreshButton
                      refreshing={refreshing > 0}
                      title="刷新"
                      disabled={!connected}
                      onClick={() => void refreshFromDisk()}
                    />
                  ) : (
                    <button
                      type="button"
                      title="全部展开"
                      className={TOOLBAR_BTN}
                      onClick={() => void expandAllDirs()}
                    >
                      <ChevronsUpDown className="size-4" />
                    </button>
                  )}
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
              </TreePanelBar>
              {goError !== null && (
                <div className="shrink-0 px-3 pt-1.5 text-xs text-[var(--status-failed)]">
                  {goError}
                </div>
              )}
              {/* 当前根文件夹行：告诉你树的根在哪（预览窗口上翻下钻后不迷路），右键即空白区那份根菜单——
              文件铺满时也永远点得到。固定在列表之上不随滚动走；它是全树的根，图标顶格（不占层级缩进位）。 */}
              <TreeRootRow
                title={rootLogical}
                data-drop-dir={remote ? rootLogical : undefined}
                icon={<FolderOpen className={TREE_ICON} />}
                name={rootLogical.slice(rootLogical.lastIndexOf('/') + 1) || rootLogical}
                dropTarget={dropDir === rootLogical}
                menuActive={treeMenu !== null && treeMenu.path === rootLogical}
                onContextMenu={(e) => openTreeMenu(rootLogical, true, e)}
                onDisconnect={remote ? () => void disconnect() : undefined}
              />
              <div
                ref={treeScrollRef}
                tabIndex={0}
                className={TREE_SCROLL}
                onContextMenu={(e) => openTreeMenu(rootLogical, true, e)}
                onKeyDown={(e) => {
                  // 焦点在树上打字转进树顶输入（项目为筛选，服务器为「前往路径」；没连上时输入停用）
                  if (remote && !connected) return
                  typeToInput(e, {
                    query: remote ? goQuery : filterQuery,
                    inputRef: filterInputRef,
                    onChange: remote ? changeGoQuery : updateFilterQuery,
                    onClear: remote ? () => changeGoQuery('') : () => void exitFilter()
                  })
                }}
              >
                {filterLoading ? (
                  <TreeHint loading>正在扫描…</TreeHint>
                ) : filterEmpty ? (
                  <TreeHint>无匹配文件</TreeHint>
                ) : (
                  <div
                    className="relative w-full"
                    style={{ height: rowVirtualizer.getTotalSize() }}
                  >
                    {rowVirtualizer.getVirtualItems().map((vi) => {
                      const row = flatRows[vi.index]
                      // 空白区（根）目标的菜单不点亮任何行；行集合本就不含根
                      const menuActive = treeMenu !== null && treeMenu.path === row.path
                      return (
                        <div
                          key={vi.key}
                          className="absolute left-0 top-0 w-full"
                          style={{ transform: `translateY(${vi.start}px)` }}
                          data-drop-dir={remote && !row.notice ? uploadTargetDir(row) : undefined}
                        >
                          {row.notice ? (
                            <TreeNoticeRow depth={row.depth} message={row.name} />
                          ) : row.isDirectory ? (
                            <TreeRow
                              depth={row.depth}
                              expanded={displayExpanded.has(row.path)}
                              icon={<Folder className={TREE_ICON} />}
                              name={row.name}
                              selected={selectedPath === row.path}
                              menuActive={menuActive}
                              dropTarget={dropDir === row.path}
                              onClick={() => toggleDir(row.path)}
                              onContextMenu={(e) => openTreeMenu(row.path, true, e)}
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
            </TreePanel>
          )}

          {hunkPopup !== null && loaded?.kind === 'text' && (
            <FilesGutterHunkPopover
              popup={hunkPopup}
              filePath={loaded.path}
              onUpdate={setHunkPopup}
              onClose={() => setHunkPopup(null)}
            />
          )}

          <FilesContentMenu
            menu={contentMenu}
            onDownload={remote && connected ? downloadFile : undefined}
            onClose={() => setContentMenu(null)}
          />
          <FilesTreeMenu
            projectPath={rootPath}
            terminal={host.kind === 'project'}
            server={serverActions}
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

          {conflict?.kind === 'changed' && !remote && (
            <ConfirmDialog
              title={`重载 “${loaded !== null ? baseName(loaded.path) : ''}”？`}
              message="文件已在磁盘上更改，当前还有未保存的编辑。重载会换成磁盘上的版本，丢掉这些编辑。"
              cancelLabel="保留编辑器内容"
              buttons={[{ label: '重载', onClick: reloadFromConflict }]}
              onCancel={keepEditorContent}
            />
          )}
        </ResizablePanelGroup>
      </FilesDownloadContext.Provider>
    </FilesLocalContext.Provider>
  )
}

function FilesTextEditor({
  path,
  content,
  baseline,
  projectRoot,
  error,
  saveBar,
  recentPaths,
  recentMenuOpen,
  onRecentMenuOpenChange,
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
  active,
  imagePrefetch
}: {
  path: string
  content: string
  /** HEAD 基线文本；null = 不显示 gutter diff 条纹 */
  baseline: string | null
  projectRoot: string
  error: string | null
  /** 工具栏之下的保存栏（服务器上的文件手动保存才有） */
  saveBar?: React.ReactNode
  recentPaths: string[]
  recentMenuOpen: boolean
  onRecentMenuOpenChange: (open: boolean) => void
  fileStatus: GitFileStatus | undefined
  treeVisible: boolean
  /** Markdown / SVG / CSV 两态：true = 预览正文；其它文件忽略 */
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
  /** Files Tab 可见：预览态（SVG 看图 / CSV 表格）的键盘只在可见时响应 */
  active: boolean
  imagePrefetch?: readonly string[]
}): React.JSX.Element {
  const canPreview = isPreviewableSourcePath(path)
  const markdown = isMarkdownPath(path)
  const svg = isSvgPath(path)
  const csv = isCsvPath(path)
  const theme = useApp((s) => s.theme)
  const viewRef = useRef<EditorView | null>(null)
  /** SVG 预览态的看图相机：工具栏「适应」钮组驱动 */
  const svgRef = useRef<MediaPreviewHandle>(null)
  const [svgFit, setSvgFit] = useState<MediaFitMode | null>(null)
  const [viewNonce, setViewNonce] = useState(0)
  // 工具栏下拉关掉后焦点回编辑器；预览态编辑器未挂载（viewRef 可能是旧实例）则不动
  const focusEditor = useCallback(() => {
    const view = viewRef.current
    if (view?.dom.isConnected) view.focus()
  }, [])

  // 编辑器内查找栏（Cmd+F）
  const find = useEditorFind(viewRef)

  // 跳转须等 CodeMirror 挂载（key=path 换文件重建）；viewNonce 驱动重试。
  // 预览态（Markdown / SVG / CSV）编辑器未挂载，viewRef 可能仍是上个文件的旧实例：留待切回编辑再应用。
  useEffect(() => {
    if (!jump || jump.path !== path) return
    const view = viewRef.current
    if (!view || !view.dom.isConnected) return
    if (jump.line !== undefined) {
      const doc = view.state.doc
      const line = doc.line(Math.min(Math.max(jump.line, 1), doc.lines))
      const anchor = Math.min(line.from + (jump.col ?? 0), line.to)
      const head = Math.min(line.from + (jump.endCol ?? jump.col ?? 0), line.to)
      view.dispatch({
        selection: { anchor, head },
        effects: EditorView.scrollIntoView(anchor, { y: 'center' })
      })
    }
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
      find.extension,
      ...(baseline === null ? [] : [gitDiffGutter(baseline, onHunkClick)])
    ],
    [theme, path, baseline, onHunkClick, find.extension]
  )
  return (
    <div className="flex h-full min-h-0 flex-col">
      <FilesToolbar
        path={path}
        projectRoot={projectRoot}
        error={error}
        recentPaths={recentPaths}
        recentMenuOpen={recentMenuOpen}
        onRecentMenuOpenChange={onRecentMenuOpenChange}
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
        onFocusContent={focusEditor}
      />
      {saveBar}
      {markdown && sourcePreview ? (
        <FilesMarkdownPreview path={path} content={content} projectRoot={projectRoot} />
      ) : svg && sourcePreview ? (
        <FilesSvgPreview
          ref={svgRef}
          onFitChange={setSvgFit}
          path={path}
          content={content}
          prefetch={imagePrefetch}
          active={active}
          onPrev={onImagePrev}
          onNext={onImageNext}
        />
      ) : csv && sourcePreview ? (
        <FilesSheetPreview
          key={path}
          source={{ kind: 'csv', content }}
          path={path}
          active={active}
        />
      ) : (
        <>
          {find.open && (
            <FilesFindWidget
              viewRef={viewRef}
              content={content}
              focusNonce={find.focusNonce}
              onClose={find.close}
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

/** 文件行：文件名与图标按工作区 Git 状态上色（无状态时图标 `--fg-icon`、名正文色）。 */
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
    <TreeRow
      depth={depth}
      icon={
        <FilesTreeIcon
          name={name}
          className="size-3.5 shrink-0"
          style={{ color: colour ?? 'var(--fg-icon)' }}
        />
      }
      name={name}
      nameColor={colour}
      selected={selected}
      menuActive={menuActive}
      onClick={onOpen}
      onContextMenu={onMenu}
    />
  )
}

/** 路径的最后一段（提示文案用） */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
