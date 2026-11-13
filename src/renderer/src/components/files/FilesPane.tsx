import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  ArrowUpRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Folder,
  FolderOpen,
  Link2Off,
  Minus,
  Search
} from 'lucide-react'
import pLimit from 'p-limit'
import {
  FILES_TEXT_MAX_BYTES,
  pushRecentPath,
  type FilesDirEntry,
  type FilesEntryRef,
  symlinkJumpTarget,
  type FilesSymlink,
  type FilesUiState
} from '@shared/files'
import {
  EMPTY_EDITOR_LAYOUT,
  activeEditorPath,
  activeEditorPaths,
  adjacentEditorPath,
  closeAllEditors,
  closeEditor,
  closeEditorsToLeft,
  closeEditorsToRight,
  closeOtherEditors,
  currentEditorPane,
  dropEditorPaths,
  editorLayoutPaths,
  editorLayoutsEqual,
  editorPaneOf,
  editorTabLimit,
  focusEditorPane,
  leavingEditorPaths,
  moveEditor,
  normalizeEditorLayout,
  openEditor,
  pinEditor,
  remapEditorPaths,
  splitEditor,
  type EditorLayout,
  type EditorPane
} from '@shared/files-editor-tabs'
import { flattenFilesTree, type FilesTreeRow } from '@shared/files-tree-flatten'
import { wslDistroOf } from '@shared/wsl-path'
import { innermostRepo, type GitFileStatus, type GitRepo } from '@shared/git'
import {
  childPathPrefix,
  joinLogicalPath,
  lastPathSegment,
  logicalParentPath,
  normalizePath,
  remapPathPrefix
} from '@shared/files-path'
import {
  allUnderRoot,
  copyDropAllowed,
  moveDropAllowed,
  topLevelPaths
} from '@shared/files-tree-ops'
import { mergeReloadedDirs, resolveOpenTextDiskSync } from '@shared/files-watch'
import {
  createConflictPolicy,
  resolveRemoteInput,
  sameServerFileVersion,
  uploadTargetDir,
  type ConflictAnswer,
  type ServerFileVersion,
  type ServerFilesReadProgress
} from '@shared/server-files'
import { deleteEntryShortcut, SHORTCUT } from '@shared/shortcut-label'
import { createKeyedSubscription } from '@renderer/lib/keyed-subscription'
import { useDoubleClick } from '@renderer/lib/double-click'
import { useRememberedPanel } from '@renderer/lib/remembered-panel'
import { isPrimaryModifierEvent, shortcutTitle } from '@renderer/lib/shortcut-label'
import { EditorDocSync } from '@renderer/lib/cm6-doc-sync'
import { useFindSession, type FindMemory, type FindSession } from '@renderer/lib/use-find-session'
import {
  dropScopedKeys,
  paneScopeKey,
  remapScopedKeys,
  seedPaneScope,
  viewStateOf,
  type FilesViewMemory
} from '@renderer/lib/files-view-state'
import type { GitGutterHunkClickPayload } from '@renderer/lib/cm6-git-gutter'
import { adjacentMediaPath, isMediaPreviewPath, isSvgPath } from '@shared/files-kind'
import { FilesGutterHunkPopover } from './FilesGutterHunkPopover'
import type { MediaFitMode } from '@renderer/lib/files-media-zoom'
import { FilesMediaPreview, MediaFitButtons, type MediaPreviewHandle } from './FilesMediaPreview'
import { FilesEntryDialog } from './FilesEntryDialog'
import { removalRequest, type FilesEntryDialogRequest } from './files-entry-request'
import {
  FilesTreeMenu,
  type FilesTreeClipboardActions,
  type FilesTreeMenuTarget,
  type FilesTreeServerActions
} from './FilesTreeMenu'
import { SameNameDialog } from '@renderer/components/TransferConflictDialog'
import { useFilesCut } from '@renderer/lib/files-cut'
import {
  EMPTY_SELECTION,
  dropHidden,
  remapSelection,
  selectAll,
  selectedInOrder,
  selectOnly,
  selectPaths,
  selectRange,
  selectionAfterRemoval,
  toggleSelected,
  treeArrowAction,
  type TreeKeyRow,
  type TreeSelection
} from '@renderer/lib/files-tree-selection'
import { FilesPdfPreview } from './FilesPdfPreview'
import { FilesPptxPreview } from './FilesPptxPreview'
import { FilesSheetPreview } from './FilesSheetPreview'
import { SqliteFileView } from '@renderer/components/database/SqliteFileView'
import { FilesToolbar } from './FilesToolbar'
import { FilesContentMenu, type FilesContentMenuTarget } from './FilesContentMenu'
import { FilesTreeIcon } from './FilesTreeIcon'
import { EditorTabsDnd, FilesEditorTabs, type EditorTabsActions } from './FilesEditorTabs'
import { FilesTextEditor, type EditorJumpRequest, type FilesPaneToolbar } from './FilesTextEditor'
import {
  arrowDirection,
  editableTarget,
  filesTreeTarget,
  overlayOpen
} from '@renderer/lib/files-key-guards'
import { filterFilesTreeByType, type FilesTypeCategory } from '@shared/files-type-filter'
import { FILES_ALL_TYPES, PreviewTypeFilterButton } from './PreviewTreeControls'
import { relPathUnderRoot } from '@renderer/lib/files-paths'
import {
  localFilesBackend,
  serverFilesBackend,
  type FilesOpenResult
} from '@renderer/lib/files-backend'
import { ipcErrorMessage } from '@renderer/lib/ipc-error'
import { typeToInput } from '@renderer/lib/type-to-input'
import { useTreeVirtualReveal } from '@renderer/lib/use-tree-virtual-reveal'
import { useFiles, type FilesEditorCommand, type PendingFilesOpen } from '@renderer/files-store'
import { useApp } from '@renderer/store'
import { BAR_INPUT_ICON, BarInput } from '@renderer/components/ui/bar-input'
import { Button } from '@renderer/components/ui/button'
import { CenteredHint } from '@renderer/components/ui/centered-hint'
import { ConfirmDialog, ErrorDialog } from '@renderer/components/ui/form-dialog'
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
/** 拖动悬停在收起的文件夹上多久自动展开 */
const DRAG_EXPAND_MS = 600
/** 拖动靠近树的上下边缘多近开始滚、每次滚多少 */
const DRAG_SCROLL_EDGE = 24
const DRAG_SCROLL_STEP = 12
/** 服务器的树内拖动携带的条目路径（JSON）；服务器上的文件不在本机，不走系统文件拖拽 */
const SERVER_TREE_DRAG = 'application/x-devcube-server-paths'

/** 文件树的行在定位里认的键：路径；提示行不能被定位 */
const filesRowKey = (row: FilesTreeRow): string | undefined => (row.notice ? undefined : row.path)

/** 一个打开的文件在正文里的样子（按打开分流的类型） */
type FilesLoaded = (
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
}

/** 未保存的编辑与别处的改动撞上 */
type FilesConflict =
  /** 别处改过：disk 为别处的当前内容（服务器上的超过文本上限时为 null），修改时间与大小为它的 */
  | { kind: 'changed'; disk: string | null; mtimeMs: number; size: number }
  /** 服务器上的文件已被删除（本地自动保存，碰不到） */
  | { kind: 'gone' }

/**
 * 一个打开的文件：按路径一份，两栏开同一个文件时共用（docs/prd/files-editor-tabs.md「同一文件两栏」）。
 * 只留某栏正显示着的，和服务器上没保存的（手动保存）；本地文件切走即自动保存并放掉，切回来重读。
 */
interface FilesDoc {
  loaded: FilesLoaded
  conflict: FilesConflict | null
  /** 保存出错（本地写在工具栏，服务器写在保存栏） */
  saveError: string | null
  /** 服务器上的文件正在保存（保存栏转圈） */
  saving: boolean
}

/**
 * 按栏的视图开关（会话内保持，不持久化）：Markdown / SVG / CSV 编辑 ↔ 预览（默认预览）、
 * 预览正文左侧栏（PDF / PPT 缩略图与 Markdown 目录共用，默认开）
 */
type PaneView = { sourcePreview: boolean; previewSidebar: boolean }
const DEFAULT_PANE_VIEW: PaneView = { sourcePreview: true, previewSidebar: true }

const NO_PREFETCH: readonly string[] = []

/** 打开结果 → 一份打开的文件（被取消的打开不改正文，调用方先挡掉）。 */
function docFrom(result: Exclude<FilesOpenResult, { kind: 'canceled' }>): FilesDoc {
  const loaded: FilesLoaded = result.kind === 'text' ? { ...result, dirty: false } : result
  return { loaded, conflict: null, saveError: null, saving: false }
}

function isDirtyDoc(doc: FilesDoc | undefined): boolean {
  return doc?.loaded.kind === 'text' && doc.loaded.dirty
}

/** 给一栏的当前文件建查找会话（hook 要在组件里调）：按「栏 + 文件」各记一份 */
function PaneFindScope({
  scope,
  memory,
  children
}: {
  scope: string | null
  memory: FindMemory
  children: (find: FindSession) => React.ReactNode
}): React.JSX.Element {
  const find = useFindSession(scope, memory)
  return <>{children(find)}</>
}

/**
 * 树根下各仓库的工作区状态，键为相对树根的路径（docs/prd/git-nested-repos.md）：仓库给的路径相对仓库根，
 * 换算后落在树根外的（项目是仓库的子目录时）丢掉；嵌套仓库里的文件按它自己的仓库（外层本就不报它们）。
 */
async function loadWorkingTreeStatus(
  rootPath: string
): Promise<{ repos: GitRepo[]; status: Map<string, GitFileStatus> }> {
  const rootLogical = normalizePath(rootPath)
  const status = new Map<string, GitFileStatus>()
  try {
    const repos = await window.api.gitRepos(rootPath)
    const results = await Promise.all(
      repos.map((repo) =>
        window.api.gitDetails(repo.path, { kind: 'uncommitted' }).catch(() => null)
      )
    )
    results.forEach((result, i) => {
      if (result === null || result.error || !result.uncommitted) return
      const repoRoot = normalizePath(repos[i].root)
      for (const [rel, fileStatus] of workingTreeStatusByPath(result.uncommitted)) {
        const path = normalizePath(`${repoRoot}/${rel}`)
        const underRoot = relPathUnderRoot(rootLogical, path)
        if (underRoot !== path) status.set(underRoot, fileStatus)
      }
    })
    return { repos, status }
  } catch {
    return { repos: [], status }
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
      /** 初始打开的文件（Editor Tab 与分栏）；换根重挂时，宿主带着留在新根里的那些 */
      initialLayout: EditorLayout
      /** 「上一级」（树空白区右键菜单）；null = 已到文件系统根 */
      onAscend: (() => void) | null
      /** 「添加为项目」/「转到项目」（树空白区右键菜单；窗口顶栏另有一份） */
      onAddProject: () => void
      projectRegistered: boolean
      /** 打开的文件变了（宿主据此更新标题、换根时带过去） */
      onLayoutChange: (layout: EditorLayout) => void
      /** 把某目录设为树的根（树菜单「作为根目录」） */
      onSetRoot: (dir: string) => void
      /** 树顶类型筛选（勾选类别集合；全选即未筛选） */
      typeFilter: ReadonlySet<FilesTypeCategory>
      onTypeFilterChange: (next: ReadonlySet<FilesTypeCategory>) => void
      /** 关窗：⌘W 关掉最后一个 Editor Tab、或本来就没有打开的文件时（docs/prd/files-editor-tabs.md「键位」） */
      onCloseWindow: () => void
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
  /**
   * 文件树的选中（可多选）与焦点行（docs/prd/files-tree-move-copy.md「选中」）：独立于正文打开的文件，
   * 打开文件时换成它；树上只有这一种高亮
   */
  const [selection, setSelection] = useState<TreeSelection>(EMPTY_SELECTION)
  /** 偏好「启用编辑器标签页」→ Tab 上限（docs/prd/files-editor-tabs.md、ADR-0061） */
  const tabsEnabled = useApp((s) => s.filesEditorTabs)
  const limit = editorTabLimit(tabsEnabled)
  /** 打开的 Editor Tab 与分栏；一切变化经 transitionLayout */
  const [layout, setLayout] = useState<EditorLayout>(EMPTY_EDITOR_LAYOUT)
  /** 打开的文件，按路径一份（见 FilesDoc） */
  const [docs, setDocs] = useState<Record<string, FilesDoc>>({})
  /** 打开失败的原因，按栏：留在那一栏的工具栏上，下一次在那栏打开成功即清掉 */
  const [paneNotices, setPaneNotices] = useState<Record<string, string>>({})
  /** 按栏的视图开关（见 PaneView） */
  const [paneViews, setPaneViews] = useState<Record<string, PaneView>>({})
  /** 相对项目根路径 → 工作区 Git 状态（与提交面板文件树上色同源） */
  const [statusByRel, setStatusByRel] = useState<Map<string, GitFileStatus>>(() => new Map())
  /** 正显示着的文本文件在 HEAD 的基线（gutter diff 条纹），按路径；没有基线的不在里面 */
  const [baselines, setBaselines] = useState<Record<string, string>>({})
  const [recentPaths, setRecentPaths] = useState<string[]>([])
  /** 当前栏工具栏的「最近打开文件」下拉开合（受控，供 ⌘E 打开） */
  const [recentMenuOpen, setRecentMenuOpen] = useState(false)
  /** 展开后读不出来的目录 → 原因（如「没有权限」），树里在它的子级位置显示提示行 */
  const [dirNotices, setDirNotices] = useState<Record<string, string>>({})
  /**
   * 正在打开的服务器文件：它要开进的那一栏盖上「正在加载…」，开始下载后换成进度（可取消）；progress 为下载进度，
   * 开始下载才有（用副本、只给占位的没有）。同一台服务器同一时刻只打开一个
   */
  const [opening, setOpening] = useState<{
    path: string
    paneId: string
    progress: { doneBytes: number; totalBytes: number } | null
  } | null>(null)
  const openingRef = useRef(opening)
  const dirNoticesRef = useRef(dirNotices)
  /** 服务器：树顶「前往路径」的输入与出错原因 */
  const [goQuery, setGoQuery] = useState('')
  const [goError, setGoError] = useState<string | null>(null)
  /** 拖进来（树内拖动、从 Finder 拖入）时的目标目录（高亮该目录行） */
  const [dropDir, setDropDir] = useState<string | null>(null)
  /** 移动 / 复制遇到同名：等用户选「替换 / 跳过」 */
  const [sameName, setSameName] = useState<{
    message: string
    batch: boolean
    answer: (answer: ConflictAnswer) => void
  } | null>(null)
  /** 移动、复制、粘贴、删除多项等没有自己弹窗的操作出错 */
  const [opError, setOpError] = useState<string | null>(null)

  const layoutRef = useRef(layout)
  const docsRef = useRef(docs)
  const selectionRef = useRef(selection)
  const recentPathsRef = useRef(recentPaths)
  const expandedRef = useRef(expanded)
  const childrenByDirRef = useRef(childrenByDir)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 看图相机，按栏：工具栏「适应」钮组驱动 */
  const imageHandles = useRef(new Map<string, MediaPreviewHandle>())
  /** 看图当前所处的档，按栏；null = 自由倍率，四颗钮都不亮。 */
  const [imageFits, setImageFits] = useState<Record<string, MediaFitMode | null>>({})
  /** 右侧文件树可见性；不持久化，重挂载默认展开。 */
  const [treeVisible, setTreeVisible] = useState(true)
  /**
   * 查找（Cmd+F）跟着文件走，按「栏 + 文件」各记一份（开关、查询与选项），切走再切回来原样恢复；编辑与预览共用一份。
   * 会话内保持，不持久化；改名 / 删除时跟着改。
   */
  const [findMemory] = useState<FindMemory>(() => new Map())
  /**
   * 阅读位置跟着文件走（docs/prd/files-tab.md「阅读位置」），按「栏 + 文件」各记一份交给正文视图。
   * 会话内保持，不持久化；改名 / 删除时跟着改。渲染时取用即建（同一个键恒为同一份），不影响渲染结果
   */
  const [viewMemory] = useState<FilesViewMemory>(() => new Map())
  /** 同一文件两栏的编辑器互相转发改动 */
  const [docSync] = useState(() => new EditorDocSync())
  /** 文件树右键菜单目标与条目操作弹窗（新建 / 重命名 / 删除）。 */
  const [treeMenu, setTreeMenu] = useState<FilesTreeMenuTarget | null>(null)
  /** 正文区（看图 / SVG 预览）右键菜单：复制图片 / 在文件夹中显示 / 在其他应用中打开 */
  const [contentMenu, setContentMenu] = useState<FilesContentMenuTarget | null>(null)
  const [entryDialog, setEntryDialog] = useState<FilesEntryDialogRequest | null>(null)
  /** gutter diff 弹窗（点击标记行号格子；文档一变即关）：哪一栏的哪个文件 */
  const [hunkPopup, setHunkPopup] = useState<{
    path: string
    payload: GitGutterHunkClickPayload
  } | null>(null)
  /** 编辑器跳转：内容搜索选中命中区间并滚到行、最近打开只聚焦（nonce 支持同位置重跳）；作用于哪一栏 */
  const [editorJump, setEditorJump] = useState<(EditorJumpRequest & { paneId: string }) | null>(
    null
  )
  const editorJumpNonce = useRef(0)
  const [ready, setReady] = useState(false)
  /** 看图：当前栏上一张/下一张普通位图的 dc-media URL，供提前解码；超大位图改为提前生成预览与金字塔。 */
  const [prefetch, setPrefetch] = useState<string[]>([])
  /** 忽略过期的 openFile / git status / 全部展开 / 过滤扫盘 响应。 */
  const openSeqRef = useRef(0)
  /** 按需读取进行中的文件；用户在进度上点了「取消」的那个（见 loadShown） */
  const loadingRef = useRef(new Set<string>())
  const userCanceledRef = useRef<string | null>(null)
  const gitStatusSeqRef = useRef(0)
  /** 树根下的仓库（随 Git 标记一起取）：按它判断 git:changed 是不是这棵树的、写文件后作废哪个仓库 */
  const gitReposRef = useRef<GitRepo[]>([])
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
    layoutRef.current = layout
    docsRef.current = docs
    selectionRef.current = selection
    recentPathsRef.current = recentPaths
    expandedRef.current = expanded
    childrenByDirRef.current = childrenByDir
    filterViewRef.current = filterView
    openingRef.current = opening
    dirNoticesRef.current = dirNotices
  }, [
    layout,
    docs,
    selection,
    recentPaths,
    expanded,
    childrenByDir,
    filterView,
    opening,
    dirNotices
  ])

  /** 当前栏与它正显示的文件 */
  const currentPane = currentEditorPane(layout)
  const currentDoc = currentPane.active === null ? undefined : docs[currentPane.active]
  const currentLoaded = currentDoc?.loaded ?? null
  /** 改一栏的视图开关 */
  const setPaneView = useCallback((paneId: string, patch: Partial<PaneView>): void => {
    setPaneViews((prev) => ({
      ...prev,
      [paneId]: { ...(prev[paneId] ?? DEFAULT_PANE_VIEW), ...patch }
    }))
  }, [])

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
  /** 树上能选中、能用键盘走到的行（不含提示行），自上而下；带着符号链接的指向，菜单与删除确认要用 */
  const keyRows = useMemo<(TreeKeyRow & Pick<FilesTreeRow, 'symlink'>)[]>(
    () =>
      flatRows
        .filter((r) => !r.notice)
        .map((r) => ({
          path: r.path,
          isDirectory: r.isDirectory,
          expanded: r.isDirectory && displayExpanded.has(r.path),
          ...(r.symlink !== undefined ? { symlink: r.symlink } : {})
        })),
    [flatRows, displayExpanded]
  )
  const navPaths = useMemo(() => keyRows.map((r) => r.path), [keyRows])
  const keyRowByPath = useMemo(() => new Map(keyRows.map((r) => [r.path, r])), [keyRows])
  // 原本看得见、现在看不见的（父文件夹被收起、被筛掉、已删除）移出选中：渲染期比对上一次看得见的行（React
  // 「渲染中调整 state」模式，非 effect）。筛选结果还没到时树是空的，不算
  const visiblePaths = useMemo(() => new Set(navPaths), [navPaths])
  const rowsSettled = !(filtering && filterView === null)
  const [seenVisible, setSeenVisible] = useState(visiblePaths)
  if (rowsSettled && seenVisible !== visiblePaths) {
    setSeenVisible(visiblePaths)
    setSelection((prev) => dropHidden(prev, seenVisible, visiblePaths))
  }
  /** 被剪切、等着粘贴的条目：图标与名称半透明 */
  const cutPaths = useFilesCut()

  // 焦点行一变即定位（打开文件、显式定位、键盘移动；点目录只改展开，行本就在视口里不滚）；面板切走或树隐藏时先挂着，
  // 目标行尚未进树（目录加载中）时也挂着，出现即滚到
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
    follow: selection.focus
  })

  const refreshGitStatus = useCallback(async () => {
    const seq = ++gitStatusSeqRef.current
    const { repos, status } = await loadWorkingTreeStatus(rootPath)
    if (seq !== gitStatusSeqRef.current) return
    gitReposRef.current = repos
    setStatusByRel(status)
  }, [rootPath])

  /** 作废树根下各仓库的工作区快照（主动刷新）；只给 path 时只作废它所在的仓库（自己刚写的文件）。 */
  const invalidateGitStatus = useCallback((path?: string): Promise<unknown> => {
    const repos =
      path === undefined ? gitReposRef.current : [innermostRepo(gitReposRef.current, path)]
    return Promise.all(
      repos.flatMap((repo) =>
        repo === null ? [] : [window.api.gitInvalidateWorkingTree(repo.path)]
      )
    )
  }, [])

  // Files 可见时拉未提交状态；树根下的仓库有变动（含工作区 watcher）、仓库清单变了后刷新
  // （服务器上的文件没有 Git 标记）
  useEffect(() => {
    if (!visible || remote) return
    void refreshGitStatus()
    const offGit = window.api.onGitChanged((p) => {
      if (gitReposRef.current.some((repo) => repo.path === p)) void refreshGitStatus()
    })
    const offRepos = window.api.onGitReposChanged((p) => {
      if (p === rootPath) void refreshGitStatus()
    })
    return () => {
      offGit()
      offRepos()
    }
  }, [visible, remote, rootPath, refreshGitStatus])

  // 正显示着的本地文本文件取 HEAD 基线（gutter diff）；文件所在的仓库有变动（提交、暂存等）后重取
  const shownTextKey = remote
    ? ''
    : [...activeEditorPaths(layout)].filter((p) => docs[p]?.loaded.kind === 'text').join('\n')
  useEffect(() => {
    if (!visible || shownTextKey === '') return
    const paths = shownTextKey.split('\n')
    let stale = false
    const drop = (path: string): void =>
      setBaselines((prev) => {
        if (!(path in prev)) return prev
        const next = { ...prev }
        delete next[path]
        return next
      })
    const load = (path: string): void => {
      window.api
        .filesHeadText(rootPath, path)
        .then((content) => {
          if (stale) return
          if (content === null) drop(path)
          else
            setBaselines((prev) => (prev[path] === content ? prev : { ...prev, [path]: content }))
        })
        .catch(() => {
          if (!stale) drop(path)
        })
    }
    paths.forEach(load)
    // 对比的是文件所在的仓库：它有变动才重取
    const dispose = window.api.onGitChanged((p) => {
      for (const path of paths) if (innermostRepo(gitReposRef.current, path)?.path === p) load(path)
    })
    return () => {
      stale = true
      dispose()
    }
  }, [visible, shownTextKey, rootPath])

  /** 落盘 UI 态（项目与服务器）；预览窗口一律不写集中配置存储（由 backend 决定） */
  const setUi = useCallback((patch: Partial<FilesUiState>) => backend.setUi(patch), [backend])
  /** 落盘打开的文件与树展开（取 ref 里的现值） */
  const persistUi = useCallback(
    () => setUi({ editors: layoutRef.current, expandedPaths: [...expandedRef.current] }),
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

  /** 记一次打开（「最近打开」按打开与切换的先后排，⌘E 据此回到上一个文件） */
  const pushRecent = useCallback(
    (path: string): void => {
      const next = pushRecentPath(recentPathsRef.current, path)
      recentPathsRef.current = next
      setRecentPaths(next)
      setUi({ recentPaths: next })
    },
    [setUi]
  )

  /** 换掉打开的文件（同步写 ref，免得紧接着的读到旧值，如保存触发的 files:changed 误报冲突） */
  const replaceDocs = useCallback((next: Record<string, FilesDoc>): void => {
    docsRef.current = next
    setDocs(next)
  }, [])
  /** 改一份打开的文件；它已被放掉就不动 */
  const updateDoc = useCallback(
    (path: string, update: (doc: FilesDoc) => FilesDoc): void => {
      const doc = docsRef.current[path]
      if (doc !== undefined) replaceDocs({ ...docsRef.current, [path]: update(doc) })
    },
    [replaceDocs]
  )
  /** 放掉不再要的文件：只留某栏正显示着的，和服务器上没保存的（见 FilesDoc） */
  const pruneDocs = useCallback((): void => {
    const shown = activeEditorPaths(layoutRef.current)
    const open = editorLayoutPaths(layoutRef.current)
    const cur = docsRef.current
    const kept = Object.entries(cur).filter(
      ([p, doc]) => shown.has(p) || (open.has(p) && isDirtyDoc(doc))
    )
    if (kept.length !== Object.keys(cur).length) replaceDocs(Object.fromEntries(kept))
  }, [replaceDocs])

  /**
   * 写入一个文件。服务器上的文件在编辑期间被别处改过时不写，转为冲突（本地弹框，服务器在保存栏里处理）。
   * 保存期间又键入的内容不算已保存：写完只更新基准，内容变过就仍是未保存。
   */
  const flushSave = useCallback(
    async (path: string): Promise<boolean> => {
      const cur = docsRef.current[path]
      if (!cur || cur.loaded.kind !== 'text' || !cur.loaded.dirty) return true
      const { content, mtimeMs, size } = cur.loaded
      updateDoc(path, (doc) => ({ ...doc, saving: true }))
      try {
        const result = await backend.write(path, content, { mtimeMs, size })
        if ('conflict' in result) {
          const disk = result.conflict
          updateDoc(path, (doc) => ({
            ...doc,
            conflict: {
              kind: 'changed',
              disk: disk.content,
              mtimeMs: disk.mtimeMs,
              size: disk.size
            }
          }))
          return false
        }
        // 写成了即不再冲突（服务器上已删除的，保存即重新创建）
        updateDoc(path, (doc) =>
          doc.loaded.kind === 'text'
            ? {
                ...doc,
                loaded: {
                  ...doc.loaded,
                  mtimeMs: result.mtimeMs,
                  size: result.size,
                  dirty: doc.loaded.content !== content
                },
                saveError: null,
                conflict: null
              }
            : doc
        )
        if (!remote) {
          // 自己刚写的文件：不等监听通知，作废它所在仓库的工作区快照后立即重拉 Git 标记
          void invalidateGitStatus(path).then(refreshGitStatus)
        }
        return true
      } catch (e) {
        updateDoc(path, (doc) => ({ ...doc, saveError: ipcErrorMessage(e) }))
        return false
      } finally {
        updateDoc(path, (doc) => ({ ...doc, saving: false }))
        // 服务器上切走了的文件存好即放掉
        pruneDocs()
      }
    },
    [backend, remote, updateDoc, pruneDocs, refreshGitStatus, invalidateGitStatus]
  )

  /** 写入全部有未保存修改的文件：本地自动保存的各个时机；服务器上的「全部保存」逐个写 */
  const flushAll = useCallback(async (): Promise<boolean> => {
    const dirty = Object.keys(docsRef.current).filter((p) => isDirtyDoc(docsRef.current[p]))
    if (!remote) return (await Promise.all(dirty.map((p) => flushSave(p)))).every(Boolean)
    for (const p of dirty) if (!(await flushSave(p))) return false
    return true
  }, [remote, flushSave])

  const scheduleIdleSave = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => {
      void flushAll()
    }, IDLE_SAVE_MS)
  }, [flushAll])

  /** 从 base 到 next 要先安顿的文件：本地被关掉或切走的、服务器上被关掉的，且有未保存的修改 */
  const unsettledDocs = useCallback(
    (base: EditorLayout, next: EditorLayout): string[] =>
      leavingEditorPaths(base, next, { keepDeactivated: remote }).filter((p) =>
        isDirtyDoc(docsRef.current[p])
      ),
    [remote]
  )

  /**
   * 安顿要离开的文件：本地的先自动保存，存不上就不继续；服务器上的先问一次（多个文件一起问），「保存」逐个写、存不上就
   * 不继续，「不保存」即丢掉这些修改，「取消」不继续。
   */
  const settleDocs = useCallback(
    async (paths: readonly string[]): Promise<boolean> => {
      if (paths.length === 0) return true
      if (!remote) return (await Promise.all(paths.map((p) => flushSave(p)))).every(Boolean)
      const choice = await useApp.getState().askUnsaved(paths.map(baseName))
      if (choice === 'cancel') return false
      if (choice === 'save') {
        for (const p of paths) if (!(await flushSave(p))) return false
        return true
      }
      for (const p of paths) {
        updateDoc(p, (doc) =>
          doc.loaded.kind === 'text' ? { ...doc, loaded: { ...doc.loaded, dirty: false } } : doc
        )
      }
      return true
    },
    [remote, flushSave, updateDoc]
  )

  /** 换上新布局：落盘、放掉不再要的文件（调用方已安顿过要离开的） */
  const commitLayout = useCallback(
    (next: EditorLayout): void => {
      if (next === layoutRef.current) return
      layoutRef.current = next
      setLayout(next)
      persistUi()
      pruneDocs()
    },
    [persistUi, pruneDocs]
  )

  /**
   * 布局变化的唯一入口（docs/prd/files-editor-tabs.md、ADR-0061）：按当前布局算出新布局，先安顿要离开的文件，再换上。
   * 安顿要等用户回答或写盘，期间布局可能又变了，所以安顿完按那时的布局重算一遍。安顿不成（取消、存不上）返回 null。
   */
  const transitionLayout = useCallback(
    async (make: (base: EditorLayout) => EditorLayout): Promise<EditorLayout | null> => {
      for (;;) {
        const base = layoutRef.current
        const next = make(base)
        if (next === base) return base
        const pending = unsettledDocs(base, next)
        if (pending.length === 0) {
          commitLayout(next)
          return next
        }
        if (!(await settleDocs(pending))) return null
      }
    },
    [unsettledDocs, settleDocs, commitLayout]
  )

  /** 树上的选中退回当前栏正显示的文件 */
  const selectShown = useCallback((): void => {
    const shown = activeEditorPath(layoutRef.current)
    setSelection(shown === null ? EMPTY_SELECTION : selectOnly(shown))
  }, [])

  /** 读不出来的文件：原因留在那一栏；服务器上已经不在的从「最近打开」里去掉（本地的在启动时剔除） */
  const noteUnreadable = useCallback(
    (paneId: string, path: string, error: unknown): void => {
      setPaneNotices((prev) => ({ ...prev, [paneId]: ipcErrorMessage(error) }))
      if (serverId === null) return
      void window.api.serverFilesStat(serverId, path).then(
        (st) => {
          if (st === null) dropRecent(path)
        },
        () => undefined
      )
    },
    [serverId, dropRecent]
  )

  /** 那一栏打开成功：撤掉留着的出错原因 */
  const clearPaneNotice = useCallback((paneId: string): void => {
    setPaneNotices((prev) => {
      if (!(paneId in prev)) return prev
      const next = { ...prev }
      delete next[paneId]
      return next
    })
  }, [])

  /**
   * 打开文件（docs/prd/files-editor-tabs.md「打开」）：在某栏（默认当前栏）打开并让它成为当前栏——已有它的 Tab 即激活，
   * 否则替换临时 Tab 或新开一个；pin 时同时固定（就地重读见 reloadDoc）。
   * 要离开的文件先安顿（本地自动保存，服务器上被关掉的未保存修改先问——不让人等完下载再被问）；没打开过的先读完再换布局：
   * 服务器上的文件先下载，期间那一栏盖上进度，「取消」即一切照旧；读不出来就去掉这个 Tab，原因留在那一栏的工具栏上。
   * 已打开的文件不重读，免得冲掉未保存的修改；意外断开期间不打开。
   */
  const openFile = useCallback(
    async (filePath: string, opts?: { pane?: string; pin?: boolean }): Promise<void> => {
      if (!connected) return
      setHunkPopup(null)
      const paneId =
        opts?.pane !== undefined && editorPaneOf(layoutRef.current, opts.pane) !== undefined
          ? opts.pane
          : layoutRef.current.current
      const make = (base: EditorLayout): EditorLayout =>
        openEditor(base, filePath, { pane: paneId, pin: opts?.pin, limit })
      const seq = ++openSeqRef.current
      if (docsRef.current[filePath] !== undefined) {
        setSelection(selectOnly(filePath))
        if ((await transitionLayout(make)) === null) {
          selectShown()
          return
        }
        clearPaneNotice(paneId)
        pushRecent(filePath)
        return
      }
      const base = layoutRef.current
      if (!(await settleDocs(unsettledDocs(base, make(base))))) return
      if (seq !== openSeqRef.current) return
      // 树上的选中先切过去，不等读完（服务器上的文件要下载一会儿）；被取消时退回正文所在的那个
      setSelection(selectOnly(filePath))
      if (remote) setOpening({ path: filePath, paneId, progress: null })
      try {
        const result = await backend.read(filePath)
        if (seq !== openSeqRef.current) return
        if (result.kind === 'canceled') {
          selectShown()
          return
        }
        replaceDocs({ ...docsRef.current, [filePath]: docFrom(result) })
        if ((await transitionLayout(make)) === null) {
          pruneDocs()
          selectShown()
          return
        }
        clearPaneNotice(paneId)
        pushRecent(filePath)
      } catch (e) {
        if (seq !== openSeqRef.current) return
        setSelection(EMPTY_SELECTION)
        noteUnreadable(paneId, filePath, e)
        // 按打开换上（替换掉的临时 Tab 随之没了），但不留打不开的这个
        await transitionLayout((b) => closeEditor(make(b), paneId, filePath))
      } finally {
        if (seq === openSeqRef.current) setOpening(null)
      }
    },
    [
      connected,
      limit,
      backend,
      remote,
      transitionLayout,
      settleDocs,
      unsettledDocs,
      replaceDocs,
      pruneDocs,
      selectShown,
      pushRecent,
      clearPaneNotice,
      noteUnreadable
    ]
  )

  /**
   * 就地重读一个打开着的文件，布局不动（放弃修改、冲突时换成别处的版本、「仍然打开」、磁盘上换了类型）：服务器上的在
   * 正显示它的那栏（当前栏优先）盖上进度；读不出来就去掉它的 Tab。
   */
  const reloadDoc = useCallback(
    async (path: string, opts?: { openLarge?: boolean }): Promise<void> => {
      const cur = layoutRef.current
      const showing = [currentEditorPane(cur), ...cur.panes].find((p) => p.active === path)
      if (showing === undefined || !connected) return
      const seq = ++openSeqRef.current
      if (remote) setOpening({ path, paneId: showing.id, progress: null })
      try {
        const result = await backend.read(path, opts?.openLarge)
        if (seq !== openSeqRef.current || result.kind === 'canceled') return
        replaceDocs({ ...docsRef.current, [path]: docFrom(result) })
        clearPaneNotice(showing.id)
      } catch (e) {
        if (seq !== openSeqRef.current) return
        setPaneNotices((prev) => ({ ...prev, [showing.id]: ipcErrorMessage(e) }))
        // 要丢掉的修改调用方已经认可（放弃修改）或没有：直接去掉
        updateDoc(path, (doc) =>
          doc.loaded.kind === 'text' ? { ...doc, loaded: { ...doc.loaded, dirty: false } } : doc
        )
        commitLayout(dropEditorPaths(layoutRef.current, (p) => p === path))
      } finally {
        if (seq === openSeqRef.current) setOpening(null)
      }
    },
    [connected, remote, backend, replaceDocs, clearPaneNotice, updateDoc, commitLayout]
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
      persistUi()
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
    persistUi()
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
        // 不进符号链接文件夹：链接绕成圈时会一直展开下去（docs/prd/symlinks.md），只能手动展开
        if (e.isDirectory && e.symlink === undefined) await walk(e.path)
      }
    }

    try {
      await walk(rootLogical)
    } finally {
      if (stillActive()) {
        flushChildren()
        flushExpanded()
        persistUi()
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
      await expandToPath(logical, false)
      persistUi()
    },
    [expandToPath, persistUi]
  )

  /**
   * 上一个 / 下一个媒体（位图 / SVG / PDF / PPT / 音视频）按**树里当前可见的顺序**走——跨目录、跨类型，
   * 但只进已展开的目录（折叠的不自动钻），并尊重类型筛选；到头停下。以当前栏正显示的文件为起点，走「打开」
   * （于是开进临时 Tab，docs/prd/files-editor-tabs.md「方向键切媒体」）。
   * 当前栏正文是媒体才响应（看图 / SVG 预览态 / PDF / PPT / 音视频，及服务器上超过预览上限的媒体占位）。
   * 服务器上的还在下载时，从正在打开的那个往下数：连按即连跳，不会反复重开同一个。
   */
  const goAdjacentMedia = useCallback(
    async (dir: -1 | 1) => {
      const pane = currentEditorPane(layoutRef.current)
      const cur = pane.active === null ? undefined : docsRef.current[pane.active]?.loaded
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
      if (isSvgPath(next)) setPaneView(pane.id, { sourcePreview: true })
      await openFile(next, { pane: pane.id })
    },
    [flatRows, openFile, setPaneView]
  )
  const goPrevImage = useCallback(() => void goAdjacentMedia(-1), [goAdjacentMedia])
  const goNextImage = useCallback(() => void goAdjacentMedia(1), [goAdjacentMedia])

  // 当前栏的音视频正文与服务器上的大媒体占位（没有自己的键盘处理）：四个方向键切上一个 / 下一个媒体
  // （同看图；守卫同看图——不抢输入框与弹层）。焦点落在播放器上时也拦下，播放器自己的键盘进度 / 音量让位给切换，进度条仍可拖。
  const avOpen = currentLoaded?.kind === 'audio' || currentLoaded?.kind === 'video'
  const arrowKeysHere =
    avOpen || (currentLoaded?.kind === 'too-large' && isMediaPreviewPath(currentLoaded.path))
  useEffect(() => {
    if (!visible || !arrowKeysHere) return
    const onKey = (e: KeyboardEvent): void => {
      const dir = arrowDirection(e)
      if (dir === null) return
      if (editableTarget(e.target) || filesTreeTarget(e.target) || overlayOpen()) return
      e.preventDefault()
      e.stopPropagation()
      void goAdjacentMedia(dir)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [visible, arrowKeysHere, goAdjacentMedia])

  // 当前栏在看图（位图或 SVG 预览态）时预取相邻的图
  const viewingImagePath =
    currentLoaded?.kind === 'image'
      ? currentLoaded.path
      : currentLoaded?.kind === 'text' &&
          isSvgPath(currentLoaded.path) &&
          (paneViews[currentPane.id] ?? DEFAULT_PANE_VIEW).sourcePreview
        ? currentLoaded.path
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

  /** 在右侧文件树展开并滚到目标（不打开/切换正文）。 */
  const revealInTree = useCallback(
    async (logical: string, isDirectory: boolean): Promise<void> => {
      setTreeVisible(true)
      await expandToPath(logical, isDirectory)
      setSelection(selectOnly(logical))
      // 已是焦点行时不会跟随定位，显式再滚一次
      scrollToRow(logical)
      persistUi()
    },
    [expandToPath, persistUi, scrollToRow]
  )

  /** 从「最近打开」（及前往路径、转到链接目标）打开：开进某栏（默认当前栏），焦点进正文 */
  const openFromRecent = useCallback(
    async (logical: string, paneId?: string) => {
      await expandToFile(logical)
      await openFile(logical, { pane: paneId })
      // 已是当前文件时焦点行不变、不会跟随定位，须显式再滚一次（同「在文件树中显示」）
      scrollToRow(logical)
      // 焦点进正文：文本进编辑器直接可键入（非文本不渲染编辑器，请求自然落空）
      setEditorJump({
        paneId: layoutRef.current.current,
        path: logical,
        nonce: ++editorJumpNonce.current
      })
    },
    [expandToFile, openFile, scrollToRow]
  )

  /**
   * 前往一个条目（「前往路径」与「转到链接目标」共用，docs/prd/symlinks.md）：文件夹即展开并定位，文件即打开；
   * 焦点先交给文件树（目标行已选中并滚到），文本文件打开后再进编辑器。
   */
  const goToEntry = useCallback(
    async (target: string, isDirectory: boolean): Promise<void> => {
      treeScrollRef.current?.focus({ preventScroll: true })
      if (isDirectory) await revealInTree(target, true)
      else await openFromRecent(target)
    },
    [treeScrollRef, revealInTree, openFromRecent]
  )
  /** 行上箭头的点击：目标在树里才可点（同右键「转到链接目标」）；链接条目的类型即目标的类型 */
  const jumpToLinkTarget = (row: FilesTreeRow): (() => void) | undefined => {
    const target = symlinkJumpTarget(row.symlink, rootLogical)
    return target === null ? undefined : () => void goToEntry(target, row.isDirectory)
  }

  const updateFilterQuery = useCallback((query: string): void => {
    filterSeqRef.current++
    setFilterQuery(query)
    setFilterScanning(query.trim().length > 0)
    if (!query.trim()) {
      filterViewRef.current = null
      setFilterView(null)
    }
  }, [])

  /** 清掉筛选：回到整棵树并定位到打开的文件（没有打开的就是焦点行），选中换成它 */
  const exitFilter = useCallback(async () => {
    updateFilterQuery('')
    const open = activeEditorPath(layoutRef.current) ?? selectionRef.current.focus
    if (open) {
      await expandToFile(open)
      setSelection(selectOnly(open))
    }
  }, [expandToFile, updateFilterQuery])

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

  // 首次变为可见时：项目与服务器宿主恢复树展开与打开的文件（按当前上限读入；pending 由下一 effect 统一消费），
  // 服务器头一回打开（没有记住的展开）时展开到家目录；预览宿主不读落盘态，展开到初始文件并打开（可预览的源文件按默认的
  // 预览态打开，SVG 起手即图）。各栏正显示的文件由下面的按需读取读进来
  const previewInitialLayout = host.kind === 'preview' ? host.initialLayout : null
  const serverHome = host.kind === 'server' ? host.home : null
  useEffect(() => {
    if (!visible || ready) return
    let cancelled = false
    void (async () => {
      await ensureDirLoaded(rootLogical)
      if (cancelled) return
      if (!persist) {
        const initial = normalizeEditorLayout(previewInitialLayout, limit)
        const shown = activeEditorPath(initial)
        if (shown !== null) await expandToFile(shown)
        if (cancelled) return
        commitLayout(initial)
        if (shown !== null) setSelection(selectOnly(shown))
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
      const restored = normalizeEditorLayout(ui.editors, limit)
      commitLayout(restored)
      const shown = activeEditorPath(restored)
      if (shown !== null) setSelection(selectOnly(shown))
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [
    visible,
    ready,
    persist,
    previewInitialLayout,
    serverHome,
    limit,
    backend,
    ensureDirLoaded,
    expandToFile,
    revealInTree,
    commitLayout,
    rootLogical
  ])

  /**
   * 按需读取：某栏正显示的文件还没读进来（重启恢复、改名移动之后、分栏或开关切换后）就读；读不出来就去掉这个 Tab，
   * 原因留在那一栏。服务器上同一时刻只打开一个（新的打开会取消旧的）：一个一个读，有打开在进行时先等它；被别的打开顶掉的
   * 下一轮再读，用户点了「取消」的才去掉这个 Tab
   */
  const loadShown = useCallback(
    async (paneId: string, path: string): Promise<void> => {
      loadingRef.current.add(path)
      if (remote) setOpening({ path, paneId, progress: null })
      try {
        const result = await backend.read(path)
        if (result.kind === 'canceled') {
          if (userCanceledRef.current === path) {
            await transitionLayout((base) => closeEditor(base, paneId, path))
          }
          return
        }
        if (activeEditorPaths(layoutRef.current).has(path) && docsRef.current[path] === undefined) {
          replaceDocs({ ...docsRef.current, [path]: docFrom(result) })
        }
      } catch (e) {
        noteUnreadable(paneId, path, e)
        await transitionLayout((base) => closeEditor(base, paneId, path))
      } finally {
        loadingRef.current.delete(path)
        if (userCanceledRef.current === path) userCanceledRef.current = null
        if (remote) setOpening((prev) => (prev?.path === path ? null : prev))
      }
    },
    [remote, backend, transitionLayout, replaceDocs, noteUnreadable]
  )
  useEffect(() => {
    if (!ready || !connected) return
    for (const pane of layout.panes) {
      const path = pane.active
      if (path === null || docs[path] !== undefined || loadingRef.current.has(path)) continue
      if (remote && (opening !== null || loadingRef.current.size > 0)) return
      void loadShown(pane.id, path)
    }
  }, [ready, connected, layout, docs, remote, opening, loadShown])

  // 关掉「启用编辑器标签页」：只留当前栏的当前 Tab（成为临时），其余按关闭处理；服务器上没保存的选了「取消」或存不上，
  // 开关退回开着（docs/prd/files-editor-tabs.md「开关」）
  const collapseToOne = useEffectEvent(async () => {
    const next = await transitionLayout((base) => {
      const one = normalizeEditorLayout(base, 1)
      return editorLayoutsEqual(one, base) ? base : one
    })
    if (next === null) void useApp.getState().setFilesEditorTabs(true)
  })
  useEffect(() => {
    if (ready && !tabsEnabled) void collapseToOne()
  }, [ready, tabsEnabled])

  // 预览宿主：把打开的文件回报给窗口壳（更新标题、上翻根时据此带过去）
  const onLayoutChange = host.kind === 'preview' ? host.onLayoutChange : null
  useEffect(() => {
    if (ready) onLayoutChange?.(layout)
  }, [ready, layout, onLayoutChange])

  // Git / 内容搜索 / 系统带进预览窗口的文件等外部 pending open（ready 之后才消费）：按到达顺序逐个开进当前栏。
  // 逐个等完再开下一个：同时打开时后一个会作废前一个还没读完的（openFile 只认最新一次）
  const pending = useFiles((s) => s.pendingOpenByProject[storeKey])
  const [pendingQueue] = useState(() => pLimit(1))
  useEffect(() => {
    if (!ready || !pending?.length) return
    const reqs = useFiles.getState().consumePendingOpens(storeKey)
    // 不在 cleanup 里取消：consume 会立刻把 pending 置空并重跑 effect，取消会误杀本次打开。
    const openPending = async (req: PendingFilesOpen): Promise<void> => {
      const logical = normalizePath(req.path)
      // 要打开的是文件夹（如 Git 里指向文件夹的符号链接）：同「前往路径」，在树里展开并定位（同 JetBrains 的导航）
      if ((await backend.stat(logical).catch(() => null))?.isDirectory) {
        await goToEntry(logical, true)
        return
      }
      await expandToFile(logical)
      await openFile(logical, { pin: req.pin })
      if (req.at) {
        // 定位落在编辑器上：Markdown / SVG 若停在预览态先切回编辑
        const paneId = layoutRef.current.current
        setPaneView(paneId, { sourcePreview: false })
        setEditorJump({ paneId, path: logical, ...req.at, nonce: ++editorJumpNonce.current })
      }
    }
    for (const req of reqs) void pendingQueue(() => openPending(req))
  }, [
    ready,
    pending,
    storeKey,
    backend,
    goToEntry,
    expandToFile,
    openFile,
    setPaneView,
    pendingQueue
  ])

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
    if (!visible && !remote) void flushAll()
  }, [visible, remote, flushAll])

  useEffect(() => {
    if (remote) return
    const onBlur = (): void => {
      void flushAll()
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [remote, flushAll])

  // —— Editor Tab 的操作（docs/prd/files-editor-tabs.md）：都经 transitionLayout ——

  /** 只换当前栏（在某栏里按下鼠标即是），不动任何 Tab */
  const focusPane = useCallback(
    (paneId: string): void => commitLayout(focusEditorPane(layoutRef.current, paneId)),
    [commitLayout]
  )
  const closeTab = useCallback(
    (paneId: string, path: string) => transitionLayout((b) => closeEditor(b, paneId, path)),
    [transitionLayout]
  )
  /** 编辑或显式动作固定 Tab（上限为 1 时不固定） */
  const pinTab = useCallback(
    (paneId: string, path: string): void =>
      commitLayout(pinEditor(layoutRef.current, paneId, path, limit)),
    [commitLayout, limit]
  )
  /** 向右分屏：当前栏的某个文件（默认当前 Tab）在右栏再开一份，同一个文件共用内容 */
  const splitTab = useCallback(
    (path?: string) => transitionLayout((b) => splitEditor(b, limit, path)),
    [transitionLayout, limit]
  )
  const moveTab = useCallback(
    (fromPaneId: string, path: string, toPaneId: string, index?: number) =>
      transitionLayout((b) => moveEditor(b, fromPaneId, path, toPaneId, index)),
    [transitionLayout]
  )

  /**
   * 键盘命令（⌘W、⇧⌘[ / ⇧⌘]、⌘\）：作用于当前栏。预览窗口里 ⌘W 关掉最后一个 Tab、或本来就没有打开的文件时关窗；
   * 主窗口里没有可关的时无效（Files Tab 本身任何时候都不关）。
   */
  const runEditorCommand = useCallback(
    async (command: FilesEditorCommand): Promise<void> => {
      const base = layoutRef.current
      const pane = currentEditorPane(base)
      if (command === 'split') {
        await splitTab()
        return
      }
      if (command === 'prev' || command === 'next') {
        const target = adjacentEditorPath(base, command === 'prev' ? -1 : 1)
        if (target !== null) await openFile(target, { pane: pane.id })
        return
      }
      const closeWindow = host.kind === 'preview' ? host.onCloseWindow : null
      if (pane.active === null) {
        closeWindow?.()
        return
      }
      const last = editorLayoutPaths(base).size === 1 && base.panes.length === 1
      const next = await closeTab(pane.id, pane.active)
      if (next !== null && last) closeWindow?.()
    },
    [host, splitTab, openFile, closeTab]
  )
  // 收命令：只认挂载之后的（同 ⌥⌘F / ⌘E）；命令到时面板须可见
  const editorCommand = useFiles((s) => s.editorCommandByKey[storeKey])
  const handledCommandNonce = useRef(editorCommand?.nonce ?? 0)
  useEffect(() => {
    if (editorCommand === undefined || editorCommand.nonce === handledCommandNonce.current) return
    handledCommandNonce.current = editorCommand.nonce
    if (visible && ready) void runEditorCommand(editorCommand.command)
  }, [editorCommand, visible, ready, runEditorCommand])

  /**
   * 一个打开着的文件跟上磁盘（服务器上的跟上服务器）：修改时间与大小都没变不动；无脏静默重载、有脏转冲突；已删除即静默
   * 关掉它的 Tab 并剔除最近打开（服务器上有未保存修改的不关、不重开——手动保存，修改可能放了很久——已删除、长过文本上限
   * 都转为保存栏里的冲突）；换了类型、预览与占位变了即就地重读。
   */
  const syncDoc = useCallback(
    async (path: string): Promise<void> => {
      const clearDoc = (): void => {
        commitLayout(dropEditorPaths(layoutRef.current, (p) => p === path))
        dropRecent(path)
      }
      if (serverId !== null) {
        // 正在打开别的文件时不动（查完再看一次）：同一台服务器同一时刻只能有一个打开，这里再读会把那个取消掉
        if (openingRef.current !== null) return
        const st = await window.api.serverFilesStat(serverId, path).catch(() => undefined)
        const still = docsRef.current[path]
        if (st === undefined || !still || openingRef.current !== null) return
        const dirty = isDirtyDoc(still)
        if (st === null) {
          if (dirty) updateDoc(path, (doc) => ({ ...doc, conflict: { kind: 'gone' } }))
          else clearDoc()
          return
        }
        // 文本比对载入 / 上次保存时的版本，其余比对载入时的；预览与占位变了就重新打开
        const base = still.loaded.kind === 'text' ? still.loaded : still.loaded.version
        if (base === undefined || sameServerFileVersion(st, base)) return
        if (still.loaded.kind !== 'text' || st.size > FILES_TEXT_MAX_BYTES) {
          if (dirty) {
            updateDoc(path, (doc) => ({
              ...doc,
              conflict: { kind: 'changed', disk: null, mtimeMs: st.mtimeMs, size: st.size }
            }))
          } else {
            await reloadDoc(path)
          }
          return
        }
      }

      let fresh: FilesOpenResult | null = null
      try {
        fresh = await backend.read(path)
      } catch {
        fresh = null
      }
      const still = docsRef.current[path]
      if (!still || fresh?.kind === 'canceled') return
      // 服务器上查完到读之间又变了（被删、长过上限）：有未保存的修改先不动，下次刷新按上面处理
      const unreadable = fresh === null || fresh.kind === 'too-large'
      if (remote && unreadable && isDirtyDoc(still)) return
      // 服务器上的文本长过了上限：重开即落到占位
      if (fresh?.kind === 'too-large') {
        await reloadDoc(path)
        return
      }

      if (still.loaded.kind === 'text') {
        const decision = resolveOpenTextDiskSync(still.loaded, fresh)
        if (decision.action === 'noop') return
        if (decision.action === 'reload') {
          const { content, mtimeMs, size } = decision
          updateDoc(path, (doc) => ({
            ...doc,
            loaded: { kind: 'text', path, content, mtimeMs, size, dirty: false }
          }))
          return
        }
        if (decision.action === 'conflict') {
          const { disk, mtimeMs, size } = decision
          updateDoc(path, (doc) => ({ ...doc, conflict: { kind: 'changed', disk, mtimeMs, size } }))
          return
        }
        if (decision.action === 'gone') {
          clearDoc()
          return
        }
        await reloadDoc(path)
        return
      }

      if (!fresh) {
        clearDoc()
        return
      }
      if (fresh.kind !== still.loaded.kind) await reloadDoc(path)
    },
    [serverId, remote, backend, commitLayout, dropRecent, updateDoc, reloadDoc]
  )

  /**
   * 磁盘变更（ADR-0011）：重拉已缓存目录；过滤态重扫；同步打开着的文件。
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
          persistUi()
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

    for (const path of Object.keys(docsRef.current)) await syncDoc(path)
  }, [connected, remote, backend, filterQuery, syncDoc, persistUi, rootPath, rootLogical])

  /**
   * 主动刷新（手动、切回、窗口回到前台、自己的文件操作与上传之后）：进行中「刷新」钮的图标转圈、钮置灰，
   * 结束后图标转回原位才恢复（RefreshButton）。本地不只靠监听通知（ADR-0011：系统的文件事件可能被压住、
   * 迟迟不到），这里一并作废文件名索引与工作区快照、重拉 Git 标记，筛选结果与文件颜色同步跟上。
   * 跟随监听通知的同步不走这里，免得构建等频繁变化时图标一直转。
   */
  const [refreshing, setRefreshing] = useState(0)
  const refreshFromDisk = useCallback(async () => {
    setRefreshing((n) => n + 1)
    try {
      if (remote) {
        await syncFromDisk()
      } else {
        await Promise.all([window.api.filesInvalidateIndex(rootPath), invalidateGitStatus()])
        await Promise.all([syncFromDisk(), refreshGitStatus()])
      }
    } finally {
      setRefreshing((n) => n - 1)
    }
  }, [remote, rootPath, syncFromDisk, refreshGitStatus, invalidateGitStatus])

  useEffect(() => {
    if (!ready) return
    return serverId !== null
      ? subscribeServerEntriesChanged(serverId, () => void refreshFromDisk())
      : subscribeFilesChanged(rootPath, () => void syncFromDisk())
  }, [ready, serverId, rootPath, refreshFromDisk, syncFromDisk])

  // 切回这个 Tab、窗口回到前台、断线后连回来时各主动刷新一次（首次就绪时刚读过，跳过）：
  // 服务器上的变化没人通知，本地的监听通知也可能迟迟不到（ADR-0011）。
  const refreshRef = useRef(refreshFromDisk)
  const flushSaveRef = useRef(flushSave)
  const flushAllRef = useRef(flushAll)
  useLayoutEffect(() => {
    refreshRef.current = refreshFromDisk
    flushSaveRef.current = flushSave
    flushAllRef.current = flushAll
  })
  const refreshArmed = useRef(false)
  useEffect(() => {
    if (!ready || !visible || !connected) return
    if (refreshArmed.current) void refreshRef.current()
    refreshArmed.current = true
    const onFocus = (): void => void refreshRef.current()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [ready, visible, connected])

  // 服务器上有未保存修改的文件登记到全局：断开、编辑或移除服务器、退出前据此一次问完（见 store）
  const unsavedKey =
    serverId === null
      ? ''
      : Object.keys(docs)
          .filter((p) => isDirtyDoc(docs[p]))
          .join('\n')
  useEffect(() => {
    if (serverId === null) return
    const paths = unsavedKey === '' ? [] : unsavedKey.split('\n')
    useApp
      .getState()
      .setUnsavedServerFiles(
        serverId,
        paths.length === 0
          ? null
          : { names: paths.map(baseName), save: () => flushAllRef.current() }
      )
  }, [serverId, unsavedKey])
  useEffect(() => {
    if (serverId === null) return
    return () => useApp.getState().setUnsavedServerFiles(serverId, null)
  }, [serverId])

  // ⌘S / Ctrl+S：保存当前栏正显示的服务器上的文件（编辑态与预览态都行；有弹层时让位）
  const savable = remote && visible && connected && currentLoaded?.kind === 'text'
  useEffect(() => {
    if (!savable) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() !== 's' || e.altKey || e.shiftKey || !isPrimaryModifierEvent(e))
        return
      if (overlayOpen()) return
      e.preventDefault()
      const shown = activeEditorPath(layoutRef.current)
      if (shown !== null) void flushSaveRef.current(shown)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [savable])

  /** 菜单、键盘作用的条目：选中的、去掉被包含的、按树上自上而下的顺序 */
  const selectedEntries = useCallback(
    (): FilesEntryRef[] =>
      topLevelPaths(selectedInOrder(selectionRef.current, navPaths)).map((path) =>
        entryRefOf(keyRowByPath.get(path) ?? { path, isDirectory: false })
      ),
    [keyRowByPath, navPaths]
  )

  /**
   * 树行 / 空白区右键 → 打开条目菜单（服务器意外断开期间不给：菜单里全是要连接才能做的事）。右键在已选中的行上，
   * 菜单作用于全部选中；在没选中的行上，选中换成这一行；在空白区清空选中、作用于根。
   */
  const openTreeMenu = useCallback(
    (target: FilesEntryRef, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!connected) return
      const { path, isDirectory } = target
      let entries: FilesEntryRef[]
      if (path === rootLogical) {
        setSelection(EMPTY_SELECTION)
        entries = []
      } else if (selectionRef.current.paths.has(path)) {
        entries = selectedEntries()
      } else {
        setSelection(selectOnly(path))
        entries = [entryRefOf(target)]
      }
      setTreeMenu({ x: e.clientX, y: e.clientY, path, isDirectory, entries })
    },
    [connected, rootLogical, selectedEntries]
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
            onDownload: (entries) => void window.api.serverFilesDownload(host.serverId, entries),
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
   * 「前往路径」：目录即展开并定位，文件即打开（goToEntry）；输入不对或路径不存在时就地提示（焦点留在输入框）。
   * 前往成功后焦点离开输入框、落到目标上。
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
      await goToEntry(target, st.isDirectory)
    } catch (e) {
      setGoError(ipcErrorMessage(e))
    }
  }, [serverId, serverHome, goQuery, changeGoQuery, goToEntry])

  /** 「断开连接」：有未保存的修改先问「保存 / 不保存 / 取消」，存不上（冲突 / 出错）就不断开。 */
  const disconnect = useCallback(async () => {
    if (host.kind !== 'server') return
    if (await useApp.getState().resolveServerUnsaved(host.serverId)) host.onDisconnect()
  }, [host])

  /**
   * 移动（含重命名）落定之后：展开集、选中、查找与阅读位置、最近打开、Editor Tab 按路径前缀重映射；打开着的文件跟着新路径
   * （服务器上就地换路径——不重新下载，未保存的编辑也还在，改路径不改内容与修改时间；本机的先放掉，由按需读取按新路径重读）。
   * 再从磁盘刷新树（反过来刷新会把旧路径判「已消失」误清），补载换了 key 的已展开目录。没有移动的（复制之后）只刷新。
   */
  const applyMoves = useCallback(
    async (pairs: readonly { from: string; to: string }[]): Promise<void> => {
      const moved = pairs.filter((m) => m.from !== m.to)
      if (moved.length > 0) {
        const remap = (p: string): string => {
          for (const { from, to } of moved) {
            const next = remapPathPrefix(p, from, to)
            if (next !== p) return next
          }
          return p
        }
        const nextExpanded = new Set([...expandedRef.current].map(remap))
        expandedRef.current = nextExpanded
        setExpanded(nextExpanded)
        setSelection((prev) => remapSelection(prev, remap))
        remapScopedKeys(findMemory, remap)
        remapScopedKeys(viewMemory, remap)
        const nextRecent = recentPathsRef.current.map(remap)
        recentPathsRef.current = nextRecent
        setRecentPaths(nextRecent)
        setUi({ recentPaths: nextRecent })
        const nextDocs: Record<string, FilesDoc> = {}
        for (const [path, doc] of Object.entries(docsRef.current)) {
          const to = remap(path)
          if (to === path) nextDocs[path] = doc
          else if (remote) nextDocs[to] = { ...doc, loaded: { ...doc.loaded, path: to } }
        }
        replaceDocs(nextDocs)
        // 本机移动前已落盘，不必再安顿；commitLayout 连同展开集一起落盘
        commitLayout(remapEditorPaths(layoutRef.current, remap))
        persistUi()
      }
      await refreshFromDisk()
      for (const dir of expandedRef.current) {
        if (moved.some((m) => dir === m.to || dir.startsWith(m.to + '/'))) {
          await ensureDirLoaded(dir).catch(() => undefined)
        }
      }
    },
    [
      findMemory,
      viewMemory,
      setUi,
      remote,
      replaceDocs,
      commitLayout,
      persistUi,
      refreshFromDisk,
      ensureDirLoaded
    ]
  )

  /**
   * 条目没了（删除）：打开着的文件在其中即放掉并关掉它们的 Tab（先放掉，免得挂起的自动保存写回来），查找与阅读位置、
   * 最近打开一并丢掉。删掉了树上的焦点行时，选中按删除前看得见的行落到邻居（同 Zed，见 selectionAfterRemoval）；
   * 当前栏正显示的也删了就打开它（是文件夹只选中），同方向键移到那一行。没删到焦点行的选中不动
   */
  const applyRemovals = useCallback(
    (paths: readonly string[]): void => {
      const gone = (p: string): boolean => paths.some((r) => p === r || p.startsWith(r + '/'))
      const shown = activeEditorPath(layoutRef.current)
      const kept = Object.entries(docsRef.current).filter(([p]) => !gone(p))
      if (kept.length !== Object.keys(docsRef.current).length) {
        replaceDocs(Object.fromEntries(kept))
      }
      commitLayout(dropEditorPaths(layoutRef.current, gone))
      const nextRecent = recentPathsRef.current.filter((p) => !gone(p))
      if (nextRecent.length !== recentPathsRef.current.length) {
        recentPathsRef.current = nextRecent
        setRecentPaths(nextRecent)
      }
      setUi({
        recentPaths: nextRecent,
        expandedPaths: [...expandedRef.current].filter((p) => !gone(p))
      })
      dropScopedKeys(findMemory, gone)
      dropScopedKeys(viewMemory, gone)
      // 落点在放掉旧文件之后再打开，免得换文件时把刚删的写回去
      const focus = selectionRef.current.focus
      if (focus === null || !gone(focus)) return
      const next = selectionAfterRemoval(navPaths, paths, logicalParentPath)
      setSelection(next === null ? EMPTY_SELECTION : selectOnly(next))
      if (next !== null && shown !== null && gone(shown) && !keyRowByPath.get(next)?.isDirectory) {
        void openFile(next)
      }
    },
    [replaceDocs, commitLayout, setUi, findMemory, viewMemory, navPaths, keyRowByPath, openFile]
  )

  /**
   * 条目操作执行（弹窗确认后）：主进程落盘 → 本地状态联动 → 统一从磁盘刷新树。
   * 抛错交由弹窗就地展示（弹窗保持打开）；删除多项时已删掉一部分再出错，关掉弹窗另行报错（再点删除会撞上已删掉的）。
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
          setPaneView(layoutRef.current.current, { sourcePreview: false })
          await expandToFile(entry.path)
          await openFile(entry.path)
        }
        return
      }

      if (req.kind === 'rename') {
        // 本地先落未保存的编辑（旧路径此刻仍在），失败则不动文件；服务器上的文件手动保存，编辑留在编辑器里跟着改名
        if (!remote && !(await flushAll())) {
          throw new Error('有未保存的更改且写入失败，已取消重命名')
        }
        const { path: newPath } = await backend.rename(req.path, name)
        setEntryDialog(null)
        if (newPath === req.path) return
        await applyMoves([{ from: req.path, to: newPath }])
        return
      }

      // 本机移到回收站，服务器上直接删除；逐项执行
      const done: string[] = []
      try {
        for (const entry of req.entries) {
          await backend.remove(entry.path)
          done.push(entry.path)
        }
      } catch (e) {
        if (done.length === 0) throw e
        setOpError(ipcErrorMessage(e))
      }
      setEntryDialog(null)
      applyRemovals(done)
      await refreshFromDisk()
    },
    [
      backend,
      remote,
      refreshFromDisk,
      revealInTree,
      expandToFile,
      openFile,
      flushAll,
      setPaneView,
      applyMoves,
      applyRemovals
    ]
  )

  /** 移动、复制的同名询问：替换后原有的本机进回收站，WSL 与服务器上无法恢复 */
  const irreversibleReplace = remote || wslDistroOf(rootLogical) !== null
  const askSameName = useCallback(
    (name: string, batch: boolean): Promise<ConflictAnswer> =>
      new Promise((resolve) =>
        setSameName({
          message: `目标文件夹里已有 “${name}”。要替换它吗？${
            irreversibleReplace ? '替换后原有的无法恢复。' : '原有的将移到回收站。'
          }`,
          batch,
          answer: (answer) => {
            setSameName(null)
            resolve(answer)
          }
        })
      ),
    [irreversibleReplace]
  )

  /**
   * 逐项移动 / 复制到 destDir（docs/prd/files-tree-move-copy.md）：去掉被包含的与落点不成立的；同名逐个问「替换 / 跳过」，
   * 可对其余同名项一次决定；某项出错即停，已完成的保留。之后联动（移动的按新路径重映射）、从磁盘刷新，
   * 展开到落点并选中落定的条目。
   */
  const transferEntries = useCallback(
    async (sources: readonly string[], destDir: string, mode: 'move' | 'copy'): Promise<void> => {
      const run = mode === 'move' ? backend.move : backend.copy
      if (run === null) return
      const allowed = mode === 'move' ? moveDropAllowed : copyDropAllowed
      const items = topLevelPaths(sources.map((p) => normalizePath(p))).filter((p) =>
        allowed(p, destDir)
      )
      if (items.length === 0) return
      // 移动前先落未保存的编辑（旧路径此刻仍在），失败则不动文件；服务器上的文件手动保存，编辑跟着改路径
      if (mode === 'move' && !remote && !(await flushAll())) {
        setOpError('有未保存的更改且写入失败，已取消移动')
        return
      }
      const policy = createConflictPolicy()
      const moves: { from: string; to: string }[] = []
      const landed: string[] = []
      let error: string | null = null
      for (const source of items) {
        try {
          let result = await run(source, destDir, false)
          if ('conflict' in result) {
            const action = await policy.resolve(() =>
              askSameName(lastPathSegment(source), items.length > 1)
            )
            if (action === 'skip') continue
            result = await run(source, destDir, true)
            if ('conflict' in result) continue
          }
          landed.push(result.path)
          if (mode === 'move') moves.push({ from: source, to: result.path })
        } catch (e) {
          error = ipcErrorMessage(e)
          break
        }
      }
      await applyMoves(moves)
      if (landed.length > 0) {
        await expandToPath(destDir, true)
        persistUi()
        setSelection(selectPaths(landed))
      }
      if (error !== null) setOpError(error)
    },
    [backend, remote, flushAll, askSameName, applyMoves, expandToPath, persistUi]
  )

  /** 「复制」「剪切」：放进系统剪贴板（剪切另记下这一批，粘贴即移动） */
  const copyToClipboard = useCallback((paths: readonly string[], cut: boolean): void => {
    if (paths.length === 0) return
    window.api
      .filesCopyToClipboard(topLevelPaths(paths), cut)
      .catch((e: unknown) => setOpError(ipcErrorMessage(e)))
  }, [])

  /** 「粘贴」：剪贴板里是剪切的那一批即移动，否则复制进来（含 Finder 里复制的） */
  const pasteInto = useCallback(
    async (destDir: string): Promise<void> => {
      try {
        const { paths, cut } = await window.api.filesReadClipboard()
        await transferEntries(paths, destDir, cut ? 'move' : 'copy')
      } catch (e) {
        setOpError(ipcErrorMessage(e))
      }
    },
    [transferEntries]
  )

  const clipboardActions = useMemo<FilesTreeClipboardActions | undefined>(
    () =>
      remote
        ? undefined
        : {
            onCut: (paths) => copyToClipboard(paths, true),
            onCopy: (paths) => copyToClipboard(paths, false),
            onPaste: (dir) => void pasteInto(dir)
          },
    [remote, copyToClipboard, pasteInto]
  )

  /** 冲突时换成别处的版本（服务器上的已删除或新版本超过文本上限时重开，落到出错或占位） */
  const reloadFromConflict = (path: string): void => {
    const conflict = docsRef.current[path]?.conflict
    if (!conflict) return
    updateDoc(path, (doc) => ({ ...doc, conflict: null }))
    if (conflict.kind === 'gone' || conflict.disk === null) {
      void reloadDoc(path)
      return
    }
    const { disk, mtimeMs, size } = conflict
    updateDoc(path, (doc) =>
      doc.loaded.kind === 'text'
        ? { ...doc, loaded: { ...doc.loaded, content: disk, mtimeMs, size, dirty: false } }
        : doc
    )
  }
  /** 冲突时保留编辑器内容：以别处的版本为基准，下次保存即覆盖它（服务器上已删除的，下次保存即重新创建） */
  const keepEditorContent = (path: string): void => {
    const conflict = docsRef.current[path]?.conflict
    if (!conflict) return
    updateDoc(path, (doc) => ({ ...doc, conflict: null }))
    if (conflict.kind === 'gone') return
    const { mtimeMs, size } = conflict
    updateDoc(path, (doc) =>
      doc.loaded.kind === 'text' ? { ...doc, loaded: { ...doc.loaded, mtimeMs, size } } : doc
    )
  }

  /** 服务器上的文本文件手动保存：保存栏（每栏一条，常驻在面包屑工具栏之下），冲突也在这里处理 */
  const saveBarOf = (doc: FilesDoc): React.ReactNode => {
    const { loaded, conflict, saving, saveError } = doc
    if (!remote || loaded.kind !== 'text') return undefined
    const path = loaded.path
    const state: ServerSaveState =
      conflict !== null
        ? { kind: 'conflict', gone: conflict.kind === 'gone' }
        : saving
          ? { kind: 'saving' }
          : !connected
            ? { kind: 'offline', dirty: loaded.dirty }
            : saveError !== null && loaded.dirty
              ? { kind: 'failed', message: saveError }
              : loaded.dirty
                ? { kind: 'dirty' }
                : { kind: 'clean' }
    return (
      <ServerSaveBar
        state={state}
        onSave={() => void flushSave(path)}
        // 放弃修改：重新读服务器上的版本
        onDiscard={() => void reloadDoc(path)}
        onReload={() => reloadFromConflict(path)}
        onOverwrite={() => {
          keepEditorContent(path)
          void flushSave(path)
        }}
      />
    )
  }

  const filterHint = shortcutTitle('筛选文件', SHORTCUT.filesFilter)
  const goHint = shortcutTitle('前往路径…', SHORTCUT.filesFilter)
  /** 服务器上某个文件的「下载」与「在 SSH 终端中打开」（占位与正文菜单用） */
  const downloadFile = (path: string): void =>
    serverActions?.onDownload([{ path, isDirectory: false }])
  /** Editor Tab：服务器上有未保存修改的显示圆点 */
  const tabUnsaved = (path: string): boolean => remote && isDirtyDoc(docs[path])

  // —— 拖拽（docs/prd/files-tree-move-copy.md「拖拽落点」「拖拽机制」） ——

  /** 正从这棵树拖出的条目：落回树内时判断落点成不成立；拖动结束后清掉（原生拖拽没有 dragend，见 startRowDrag） */
  const treeDragRef = useRef<string[] | null>(null)
  /** 拖动悬停在收起的文件夹上：稍候自动展开 */
  const hoverExpandRef = useRef<{ dir: string; timer: ReturnType<typeof setTimeout> } | null>(null)

  /** 拖动时按住即复制：macOS ⌥，Windows / Linux Ctrl（同各自的文件管理器） */
  const copyModifier = (e: React.DragEvent): boolean =>
    window.electron.process.platform === 'darwin' ? e.altKey : e.ctrlKey

  /** 落点：行上标的目录（目录行即自身，文件行即所在目录，根行即根）；空白处即根，服务器上不接受（同上传） */
  const dropDirOf = (e: React.DragEvent): string | null => {
    const marked = (e.target as HTMLElement).closest<HTMLElement>('[data-drop-dir]')?.dataset
      .dropDir
    if (marked !== undefined) return marked
    return !remote && treeScrollRef.current?.contains(e.target as Node) ? rootLogical : null
  }

  /**
   * 这次拖动落到 dir 是什么操作；不接受为 null。本机：拖进来的都是系统文件，从这棵树拖出的移动（按住复制键为复制），
   * 别处来的复制进来；服务器：树内拖动只移动，从本机拖进来即上传。
   */
  const dropOperation = (e: React.DragEvent, dir: string): 'move' | 'copy' | 'upload' | null => {
    const types = e.dataTransfer.types
    const own = treeDragRef.current
    if (remote) {
      if (types.includes(SERVER_TREE_DRAG)) {
        return !copyModifier(e) && own !== null && own.some((p) => moveDropAllowed(p, dir))
          ? 'move'
          : null
      }
      return types.includes('Files') ? 'upload' : null
    }
    if (!types.includes('Files')) return null
    if (own === null) return 'copy'
    const mode = copyModifier(e) ? 'copy' : 'move'
    const allowed = mode === 'move' ? moveDropAllowed : copyDropAllowed
    return own.some((p) => allowed(p, dir)) ? mode : null
  }

  /** 悬停在收起的文件夹上约 600 ms 自动展开；换了落点即重新计时 */
  const scheduleHoverExpand = (dir: string | null): void => {
    const pending = hoverExpandRef.current
    if (pending?.dir === dir) return
    if (pending) clearTimeout(pending.timer)
    hoverExpandRef.current = null
    const row = dir === null ? undefined : keyRowByPath.get(dir)
    if (dir === null || !row?.isDirectory || row.expanded) return
    hoverExpandRef.current = {
      dir,
      timer: setTimeout(() => {
        hoverExpandRef.current = null
        const open = filtering ? filterViewRef.current?.expanded : expandedRef.current
        if (!open?.has(dir)) void toggleDir(dir)
      }, DRAG_EXPAND_MS)
    }
  }

  /** 靠近树的上下边缘时自动滚动（拖动悬停期间 dragover 持续触发） */
  const autoScrollWhileDragging = (e: React.DragEvent): void => {
    const el = treeScrollRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (e.clientY < rect.top + DRAG_SCROLL_EDGE) el.scrollTop -= DRAG_SCROLL_STEP
    else if (e.clientY > rect.bottom - DRAG_SCROLL_EDGE) el.scrollTop += DRAG_SCROLL_STEP
  }

  /**
   * 从树上拖起：拖已选中的行带上全部选中，拖没选中的行只拖它自己。本机交给系统原生文件拖拽（Electron 官方做法，
   * 同一次拖动既能落回树内，也能拖到 Finder 等应用）；服务器上的不在本机，走页面内拖放、只能落回树内。
   */
  const startRowDrag = (row: FilesTreeRow, e: React.DragEvent): void => {
    if (!connected) {
      e.preventDefault()
      return
    }
    const paths = selectionRef.current.paths.has(row.path)
      ? selectedEntries().map((entry) => entry.path)
      : [row.path]
    treeDragRef.current = paths
    // 原生拖拽结束时页面收不到 dragend：指针松开后头一次移动即清掉
    const clear = (ev: PointerEvent): void => {
      if (ev.buttons !== 0) return
      treeDragRef.current = null
      window.removeEventListener('pointermove', clear)
    }
    window.addEventListener('pointermove', clear)
    if (remote) {
      e.dataTransfer.setData(SERVER_TREE_DRAG, JSON.stringify(paths))
      e.dataTransfer.effectAllowed = 'move'
      return
    }
    e.preventDefault()
    window.api.filesStartDrag(paths)
  }

  const onTreeDragOver = (e: React.DragEvent): void => {
    if (!connected) return
    const dir = dropDirOf(e)
    const op = dir === null ? null : dropOperation(e, dir)
    setDropDir(op === null ? null : dir)
    scheduleHoverExpand(op === null ? null : dir)
    autoScrollWhileDragging(e)
    if (op === null) return
    e.preventDefault()
    // 系统原生拖拽只许复制 / 链接时（Windows 上 Electron 的 startDrag 即如此），移动也只能显示为复制
    const effect = e.dataTransfer.effectAllowed
    const moveShown = effect === 'all' || effect === 'uninitialized' || /move/i.test(effect)
    e.dataTransfer.dropEffect = op === 'move' && moveShown ? 'move' : 'copy'
  }
  const onTreeDragLeave = (e: React.DragEvent): void => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setDropDir(null)
    scheduleHoverExpand(null)
  }
  const onTreeDrop = (e: React.DragEvent): void => {
    setDropDir(null)
    scheduleHoverExpand(null)
    const dir = dropDirOf(e)
    const op = dir === null || !connected ? null : dropOperation(e, dir)
    treeDragRef.current = null
    if (op === null || dir === null) return
    e.preventDefault()
    if (op === 'upload') {
      if (serverId === null) return
      const paths = [...e.dataTransfer.files].map((f) => window.drop.getPathForFile(f))
      void window.api.serverFilesUpload(serverId, dir, paths.filter(Boolean)).catch(reportError)
      return
    }
    if (remote) {
      let paths: string[] = []
      try {
        paths = JSON.parse(e.dataTransfer.getData(SERVER_TREE_DRAG)) as string[]
      } catch {
        return
      }
      void transferEntries(paths, dir, 'move')
      return
    }
    // 落定以真实来源为准：都在这棵树的根内即移动（按住复制键为复制），否则复制进来（同 Finder 判同一磁盘）
    const paths = [...e.dataTransfer.files]
      .map((f) => window.drop.getPathForFile(f))
      .filter(Boolean)
      .map((p) => normalizePath(p))
    void transferEntries(
      paths,
      dir,
      !copyModifier(e) && allUnderRoot(paths, rootLogical) ? 'move' : 'copy'
    )
  }

  // —— 树上的点选与键盘（docs/prd/files-tree-move-copy.md「选中」「键盘」） ——

  const isDoubleClick = useDoubleClick()
  /**
   * 单击只看：文件在正文显示内容、焦点留在树上（接着用键盘与快捷键），文件夹只选中；双击进去：文件打开并把焦点交给正文，
   * 文件夹开合（同左树，连续双击可来回切换）。⌘（Windows / Linux 为 Ctrl）点选切换单项、⇧ 点选连选，都不打开
   */
  const clickRow = (row: FilesTreeRow, e: React.MouseEvent): void => {
    const double = isDoubleClick(e)
    if (isPrimaryModifierEvent(e)) {
      setSelection((prev) => toggleSelected(prev, row.path))
      return
    }
    if (e.shiftKey) {
      setSelection((prev) => selectRange(prev, navPaths, row.path))
      return
    }
    setSelection(selectOnly(row.path))
    if (row.isDirectory) {
      if (double) void toggleDir(row.path)
      return
    }
    if (double) enterFile(row.path)
    else void openFile(row.path)
  }

  /** 就近的文件夹（粘贴的目标）：文件夹即自身，文件即所在文件夹，没有焦点行即根 */
  const nearestDirOf = (path: string | null): string => {
    if (path === null) return rootLogical
    return keyRowByPath.get(path)?.isDirectory ? path : logicalParentPath(path)
  }

  /**
   * 进入文件（双击、Enter）：打开并固定（docs/prd/files-editor-tabs.md「固定」），再把焦点交给正文——文本进编辑器
   * （直接可键入），其余离开文件树（焦点可能在树的某一行上），正文的方向键随即接管
   */
  const enterFile = (path: string): void => {
    void openFile(path, { pin: true }).then(() => {
      const active = document.activeElement
      if (active instanceof HTMLElement && treeScrollRef.current?.contains(active)) active.blur()
      setEditorJump({ paneId: layoutRef.current.current, path, nonce: ++editorJumpNonce.current })
    })
  }

  /** 焦点在树上的键：方向键同 WebStorm 的树，Enter / F2 / 删除 / 全选 / 剪切复制粘贴；其余可打印字符转进树顶输入 */
  const onTreeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    // 没连上时输入停用
    if (remote && !connected) return
    if (e.nativeEvent.isComposing) return
    const { key } = e
    const mod = isPrimaryModifierEvent(e.nativeEvent)
    const bare = !e.metaKey && !e.ctrlKey && !e.altKey
    const focus = selectionRef.current.focus
    if (
      bare &&
      (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight')
    ) {
      e.preventDefault()
      const action = treeArrowAction(keyRows, focus, key, logicalParentPath)
      if (action === null) return
      if (e.shiftKey) {
        if (action.kind === 'move' && (key === 'ArrowUp' || key === 'ArrowDown')) {
          setSelection((prev) => selectRange(prev, navPaths, action.path))
        }
        return
      }
      if (action.kind !== 'move') {
        void toggleDir(action.path)
        return
      }
      setSelection(selectOnly(action.path))
      if (!keyRowByPath.get(action.path)?.isDirectory) void openFile(action.path)
      return
    }
    if (bare && !e.shiftKey && key === 'Enter') {
      const row = focus === null ? undefined : keyRowByPath.get(focus)
      if (!row) return
      e.preventDefault()
      if (row.isDirectory) void toggleDir(row.path)
      else enterFile(row.path)
      return
    }
    if (bare && !e.shiftKey && key === 'F2') {
      const entries = selectedEntries()
      const [only] = entries
      if (entries.length !== 1 || only === undefined) return
      e.preventDefault()
      setEntryDialog({ kind: 'rename', path: only.path, isDirectory: only.isDirectory })
      return
    }
    const del = deleteEntryShortcut(window.electron.process.platform)
    if (!e.shiftKey && !e.altKey && key === del.key && (del.mod ? mod : bare)) {
      const entries = selectedEntries()
      if (entries.length === 0) return
      e.preventDefault()
      setEntryDialog(removalRequest(entries, { remote, root: rootLogical }))
      return
    }
    if (mod && !e.shiftKey && !e.altKey) {
      const letter = key.toLowerCase()
      if (letter === 'a') {
        e.preventDefault()
        setSelection((prev) => selectAll(prev, navPaths))
        return
      }
      // 剪切 / 复制 / 粘贴：在这里拦下，不交给编辑菜单（服务器上没有）
      if (clipboardActions !== undefined && (letter === 'x' || letter === 'c' || letter === 'v')) {
        e.preventDefault()
        if (letter === 'v') clipboardActions.onPaste(nearestDirOf(focus))
        else {
          const paths = selectedEntries().map((entry) => entry.path)
          if (letter === 'x') clipboardActions.onCut(paths)
          else clipboardActions.onCopy(paths)
        }
        return
      }
    }
    typeToInput(e, {
      query: remote ? goQuery : filterQuery,
      inputRef: filterInputRef,
      onChange: remote ? changeGoQuery : updateFilterQuery,
      onClear: remote ? () => changeGoQuery('') : () => void exitFilter()
    })
  }

  const treePanel = useRememberedPanel('treePanel')
  const editorSplit = useRememberedPanel('filesEditorSplit')
  const split = layout.panes.length > 1
  const lastPaneId = layout.panes[layout.panes.length - 1].id
  const statusOfPath = (path: string): GitFileStatus | undefined =>
    statusByRel.get(relPathUnderRoot(rootLogical, path))
  /** 文本改动（本栏键入的）：标未保存、固定它的 Tab（docs/prd/files-editor-tabs.md「固定」），本地排上空闲保存 */
  const changeText = (paneId: string, path: string, value: string): void => {
    // 文档一变，gutter 弹窗的 hunk 即过期，统一在此关闭（含弹窗内回滚）
    setHunkPopup(null)
    updateDoc(path, (doc) =>
      doc.loaded.kind === 'text'
        ? { ...doc, loaded: { ...doc.loaded, content: value, dirty: true } }
        : doc
    )
    pinTab(paneId, path)
    // 服务器上的文件手动保存，不自动写回
    if (!remote) scheduleIdleSave()
  }
  /** 点了 gutter 标记行：打开那个文件这一处改动的 diff 弹窗 */
  const openHunk = useCallback(
    (path: string, payload: GitGutterHunkClickPayload) => setHunkPopup({ path, payload }),
    []
  )
  /** 本地有冲突（未保存的编辑撞上磁盘上的改动）的文件，一次问一个 */
  const conflictPath = remote
    ? null
    : (Object.keys(docs).find((p) => docs[p].conflict?.kind === 'changed') ?? null)

  /**
   * 一栏：Editor Tab 行（开关开着时）+ 正文（各类型自带工具栏）。在栏里按下鼠标即成为当前栏；键盘（方向键、缩放、翻页、
   * 查找）只作用于当前栏。
   */
  const renderPane = (pane: EditorPane, find: FindSession): React.JSX.Element => {
    const path = pane.active
    const doc = path === null ? undefined : docs[path]
    const loaded = doc?.loaded ?? null
    const current = pane.id === layout.current
    const active = visible && current
    const view = paneViews[pane.id] ?? DEFAULT_PANE_VIEW
    const viewState = path === null ? null : viewStateOf(viewMemory, paneScopeKey(pane.id, path))
    // 打开失败的原因留在这一栏；本地文本保存出错也写在工具栏上（服务器上的写在保存栏里）
    const error =
      paneNotices[pane.id] ?? (!remote && loaded?.kind === 'text' ? doc!.saveError : null)
    const toolbar: FilesPaneToolbar = {
      projectRoot: rootLogical,
      recentPaths,
      recentMenuOpen: current && recentMenuOpen,
      onRecentMenuOpenChange: setRecentMenuOpen,
      fileStatus: path === null ? undefined : statusOfPath(path),
      // 「显示文件树」只在最右一栏（紧挨着树原来的位置）
      treeVisible: treeVisible || pane.id !== lastPaneId,
      onShowTree: () => setTreeVisible(true),
      onToggleTree: () => setTreeVisible((v) => !v),
      onRevealInTree: revealInTree,
      onOpenRecent: (logical) => openFromRecent(logical, pane.id)
    }
    const otherPane = layout.panes.find((p) => p.id !== pane.id)
    const tabActions: EditorTabsActions = {
      onActivate: (p) => void openFile(p, { pane: pane.id }),
      onPin: (p) => pinTab(pane.id, p),
      onClose: (p) => void closeTab(pane.id, p),
      onCloseOthers: (p) => void transitionLayout((b) => closeOtherEditors(b, pane.id, p)),
      onCloseToLeft: (p) => void transitionLayout((b) => closeEditorsToLeft(b, pane.id, p)),
      onCloseToRight: (p) => void transitionLayout((b) => closeEditorsToRight(b, pane.id, p)),
      onCloseAll: () => void transitionLayout((b) => closeAllEditors(b, pane.id)),
      onSplit: split ? null : (p) => void splitTab(p),
      onMoveToOther: otherPane === undefined ? null : (p) => void moveTab(pane.id, p, otherPane.id),
      onRevealInTree: (p) => void revealInTree(p, false)
    }
    const imageRef = (handle: MediaPreviewHandle | null): void => {
      if (handle === null) imageHandles.current.delete(pane.id)
      else imageHandles.current.set(pane.id, handle)
    }
    const prefetchHere = current ? prefetch : NO_PREFETCH
    const toggleSidebar = (): void => setPaneView(pane.id, { previewSidebar: !view.previewSidebar })

    let body: React.ReactNode
    if (loaded === null) {
      body = (
        <div className="flex h-full min-h-0 flex-col">
          {/* 打开失败（如没有权限）的原因留在这里；还在读的文件先只出工具栏 */}
          <FilesToolbar {...toolbar} path={path} error={error} />
          {path === null && <CenteredHint>在右侧选择文件</CenteredHint>}
        </div>
      )
    } else if (loaded.kind === 'text') {
      body = (
        <FilesTextEditor
          path={loaded.path}
          content={loaded.content}
          find={find}
          viewState={viewState!}
          docSync={docSync}
          baseline={baselines[loaded.path] ?? null}
          error={error}
          saveBar={saveBarOf(doc!)}
          toolbar={toolbar}
          sourcePreview={view.sourcePreview}
          onToggleSourcePreview={() => {
            const next = !view.sourcePreview
            // 本地切到预览前落盘，预览与磁盘一致（服务器上的预览看的是编辑器里的内容）；
            // 编辑器卸载，gutter 弹窗一并关闭
            if (next && !remote) void flushSave(loaded.path)
            setHunkPopup(null)
            setPaneView(pane.id, { sourcePreview: next })
          }}
          toc={view.previewSidebar}
          onToggleToc={toggleSidebar}
          jump={editorJump !== null && editorJump.paneId === pane.id ? editorJump : null}
          onJumpDone={() => setEditorJump(null)}
          onHunkClick={openHunk}
          onImagePrev={goPrevImage}
          onImageNext={goNextImage}
          active={active}
          imagePrefetch={prefetchHere}
          onChange={(value) => changeText(pane.id, loaded.path, value)}
        />
      )
    } else if (loaded.kind === 'image') {
      body = (
        <div className="flex h-full min-h-0 flex-col">
          <FilesToolbar
            {...toolbar}
            path={loaded.path}
            error={error}
            extra={
              <MediaFitButtons
                active={imageFits[pane.id] ?? null}
                onFit={(axis) => imageHandles.current.get(pane.id)?.fit(axis)}
              />
            }
          />
          <FilesMediaPreview
            // 服务器上的图是在进度遮罩后面换的：沿用旧图过渡会在遮罩撤掉时闪出上一张，按文件重挂
            key={remote ? loaded.path : undefined}
            ref={imageRef}
            onFitChange={(fit) =>
              setImageFits((prev) => (prev[pane.id] === fit ? prev : { ...prev, [pane.id]: fit }))
            }
            viewState={viewState!}
            src={loaded.mediaUrl}
            path={loaded.decode.path}
            projectPath={loaded.decode.root}
            width={loaded.width}
            height={loaded.height}
            tiled={loaded.tiled === true}
            prefetch={prefetchHere}
            active={active}
            onPrev={goPrevImage}
            onNext={goNextImage}
          />
        </div>
      )
    } else if (loaded.kind === 'video' || loaded.kind === 'audio') {
      body = (
        <div className="flex h-full min-h-0 flex-col">
          <FilesToolbar {...toolbar} path={loaded.path} error={error} />
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
            {loaded.kind === 'video' ? (
              <video
                key={loaded.mediaUrl}
                controls
                preload="metadata"
                className="max-h-full max-w-full"
              >
                <source src={loaded.mediaUrl} type={loaded.mime} />
              </video>
            ) : (
              <audio key={loaded.mediaUrl} controls preload="metadata">
                <source src={loaded.mediaUrl} type={loaded.mime} />
              </audio>
            )}
          </div>
        </div>
      )
    } else if (loaded.kind === 'pdf' || loaded.kind === 'pptx') {
      // PDF 与 PPT 同一套分页预览外壳，参数一致；换类型时组件随之换掉
      const PagedPreview = loaded.kind === 'pptx' ? FilesPptxPreview : FilesPdfPreview
      body = (
        <PagedPreview
          // 同上：服务器上的文档按文件重挂，不在遮罩撤掉时露出上一份
          key={remote ? loaded.path : undefined}
          src={loaded.mediaUrl}
          path={loaded.path}
          active={active}
          find={find}
          viewState={viewState!}
          thumbnails={view.previewSidebar}
          onToggleThumbnails={toggleSidebar}
          onPrev={goPrevImage}
          onNext={goNextImage}
          toolbar={toolbar}
        />
      )
    } else if (loaded.kind === 'xlsx') {
      body = (
        <div className="flex h-full min-h-0 flex-col">
          <FilesToolbar {...toolbar} path={loaded.path} error={error} />
          <FilesSheetPreview
            key={loaded.path}
            source={{ kind: 'xlsx', src: loaded.mediaUrl, size: loaded.size }}
            path={loaded.path}
            active={active}
            find={find}
            viewState={viewState!}
          />
        </div>
      )
    } else if (loaded.kind === 'sqlite') {
      body = (
        <div className="flex h-full min-h-0 flex-col">
          <FilesToolbar {...toolbar} path={loaded.path} error={error} />
          {/* 打不开时的占位（FilesPreviewError）盖满这一格 */}
          <div className="relative min-h-0 flex-1">
            <SqliteFileView key={loaded.path} rootPath={rootPath} filePath={loaded.path} />
          </div>
        </div>
      )
    } else if (loaded.kind === 'other') {
      body = (
        <div className="flex h-full min-h-0 flex-col">
          <FilesToolbar {...toolbar} path={loaded.path} error={error} />
          {host.kind === 'server' ? (
            <ServerFilePlaceholder
              reason="unsupported"
              size={loaded.size}
              connected={connected}
              onOpenAnyway={null}
              onDownload={() => downloadFile(loaded.path)}
              onOpenInSshTerminal={() => host.onOpenInSshTerminal(logicalParentPath(loaded.path))}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-sm text-muted-foreground">
              <p>无法在此编辑此文件</p>
              <p className="text-xs">{formatSize(loaded.size)}</p>
              <Button variant="secondary" onClick={() => void window.api.openPath(loaded.path)}>
                在其他应用中打开
              </Button>
            </div>
          )}
        </div>
      )
    } else if (host.kind === 'server') {
      body = (
        <div className="flex h-full min-h-0 flex-col">
          <FilesToolbar {...toolbar} path={loaded.path} error={error} fileStatus={undefined} />
          <ServerFilePlaceholder
            reason="too-large"
            size={loaded.size}
            connected={connected}
            onOpenAnyway={
              loaded.canForce ? () => void reloadDoc(loaded.path, { openLarge: true }) : null
            }
            onDownload={() => downloadFile(loaded.path)}
            onOpenInSshTerminal={() => host.onOpenInSshTerminal(logicalParentPath(loaded.path))}
          />
        </div>
      )
    }

    return (
      <div
        className="flex h-full min-h-0 flex-col bg-deepest"
        onPointerDownCapture={() => focusPane(pane.id)}
      >
        {tabsEnabled && (
          <FilesEditorTabs
            pane={pane}
            current={current}
            rootLogical={rootLogical}
            projectPath={rootPath}
            terminal={host.kind === 'project'}
            server={serverActions}
            connected={connected}
            statusOf={statusOfPath}
            unsaved={tabUnsaved}
            actions={tabActions}
          />
        )}
        {/* 预览出错的占位里的「下载」：服务器上打开的文件没有「在其他应用中打开」，给它一个出口；断开时不给 */}
        <FilesDownloadContext.Provider
          value={remote && connected && loaded !== null ? () => downloadFile(loaded.path) : null}
        >
          <div
            className="relative min-h-0 flex-1"
            onContextMenu={(e) => {
              // 任何已打开的条目都有正文菜单；空态没有。看图 / SVG 预览态另给「复制图片」取图源
              if (!loaded) return
              e.preventDefault()
              let imageSrc: (() => Promise<string>) | null = null
              if (loaded.kind === 'image') {
                // 复制屏上正显示的那张：超大位图与浏览器解不了、改由主进程出图的都是预览图（长边 4096），
                // 整图塞剪贴板不现实；加载中 / 打不开时不给复制
                const shown = imageHandles.current.get(pane.id)?.displayedSrc() ?? null
                if (shown) imageSrc = () => Promise.resolve(shown)
              } else if (loaded.kind === 'text' && isSvgPath(loaded.path) && view.sourcePreview) {
                const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(loaded.content)}`
                imageSrc = () => Promise.resolve(src)
              }
              setContentMenu({ x: e.clientX, y: e.clientY, path: loaded.path, imageSrc })
            }}
          >
            {/* 不按文件重挂：盖上之后换打开别的文件也一直盖着，旧文件不会在两次打开之间露出来 */}
            {opening !== null && opening.paneId === pane.id && serverId !== null && (
              <ServerOpenProgress
                path={opening.path}
                progress={opening.progress}
                onCancel={() => {
                  userCanceledRef.current = opening.path
                  void window.api.serverFilesCancelRead(serverId)
                }}
              />
            )}
            {body}
          </div>
        </FilesDownloadContext.Provider>
      </div>
    )
  }

  return (
    <FilesLocalContext.Provider value={!remote}>
      <ResizablePanelGroup {...treePanel.groupProps}>
        <ResizablePanel className="relative bg-deepest">
          {/* 编辑区：1–2 栏，每栏按自己的标识作键（分屏、另一栏收起时留下的那栏不重挂）；记住的比例只在分栏时挂到左栏上 */}
          <EditorTabsDnd
            layout={layout}
            statusOf={statusOfPath}
            unsaved={tabUnsaved}
            onMove={moveTab}
          >
            <ResizablePanelGroup {...(split ? editorSplit.groupProps : {})}>
              {layout.panes.flatMap((pane, i) => {
                if (pane.active !== null) {
                  // 这一栏第一次打开这个文件：阅读位置与查找取另一栏里那份
                  const others = layout.panes.filter((p) => p !== pane).map((p) => p.id)
                  seedPaneScope(findMemory, pane.id, pane.active, others, (v) => v)
                  seedPaneScope(viewMemory, pane.id, pane.active, others, (v) => v.clone())
                }
                const panel = (
                  <ResizablePanel
                    key={pane.id}
                    id={pane.id}
                    {...(split && i === 0 ? editorSplit.panelProps : {})}
                  >
                    <PaneFindScope
                      scope={pane.active === null ? null : paneScopeKey(pane.id, pane.active)}
                      memory={findMemory}
                    >
                      {(find) => renderPane(pane, find)}
                    </PaneFindScope>
                  </ResizablePanel>
                )
                return i === 0
                  ? [panel]
                  : [<ResizableHandle key="split" {...editorSplit.handleProps} />, panel]
              })}
            </ResizablePanelGroup>
          </EditorTabsDnd>
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
                <RefreshButton
                  refreshing={refreshing > 0}
                  title="刷新"
                  disabled={!connected}
                  onClick={() => void refreshFromDisk()}
                />
                {/* 服务器上不给「全部展开」：从 / 递归展开等于把整台服务器扫一遍 */}
                {!remote && (
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
              data-drop-dir={rootLogical}
              icon={<FolderOpen className={TREE_ICON} />}
              name={rootLogical.slice(rootLogical.lastIndexOf('/') + 1) || rootLogical}
              dropTarget={dropDir === rootLogical}
              menuActive={treeMenu !== null && treeMenu.path === rootLogical}
              onContextMenu={(e) => openTreeMenu({ path: rootLogical, isDirectory: true }, e)}
              onDisconnect={remote ? () => void disconnect() : undefined}
            />
            <div
              ref={treeScrollRef}
              tabIndex={0}
              // 焦点在树上时方向键归树，正文的切媒体、翻页让位（见 files-key-guards 的 filesTreeTarget）
              data-files-tree=""
              className={TREE_SCROLL}
              onContextMenu={(e) => openTreeMenu({ path: rootLogical, isDirectory: true }, e)}
              onKeyDown={onTreeKeyDown}
            >
              {filterLoading ? (
                <TreeHint loading>正在扫描…</TreeHint>
              ) : filterEmpty ? (
                <TreeHint>无匹配文件</TreeHint>
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
                        data-drop-dir={row.notice ? undefined : uploadTargetDir(row)}
                      >
                        {row.notice ? (
                          <TreeNoticeRow depth={row.depth} message={row.name} />
                        ) : row.isDirectory ? (
                          <TreeRow
                            depth={row.depth}
                            expanded={displayExpanded.has(row.path)}
                            icon={<Folder className={TREE_ICON} />}
                            name={row.name}
                            mark={
                              row.symlink && (
                                <SymlinkMark symlink={row.symlink} onJump={jumpToLinkTarget(row)} />
                              )
                            }
                            title={row.symlink && symlinkTitle(row.symlink)}
                            selected={selection.paths.has(row.path)}
                            menuActive={menuActive}
                            dropTarget={dropDir === row.path}
                            dimmed={!remote && cutPaths.has(row.path)}
                            draggable={connected}
                            onClick={(e) => clickRow(row, e)}
                            onToggle={() => void toggleDir(row.path)}
                            onContextMenu={(e) => openTreeMenu(row, e)}
                            onDragStart={(e) => startRowDrag(row, e)}
                          />
                        ) : (
                          <FileTreeFileRow
                            name={row.name}
                            depth={row.depth}
                            symlink={row.symlink}
                            onJumpToLinkTarget={jumpToLinkTarget(row)}
                            selected={selection.paths.has(row.path)}
                            menuActive={menuActive}
                            dimmed={!remote && cutPaths.has(row.path)}
                            draggable={connected}
                            status={statusByRel.get(relPathUnderRoot(rootLogical, row.path))}
                            onClick={(e) => clickRow(row, e)}
                            onMenu={(e) => openTreeMenu(row, e)}
                            onDragStart={(e) => startRowDrag(row, e)}
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

        {hunkPopup !== null && docs[hunkPopup.path]?.loaded.kind === 'text' && (
          <FilesGutterHunkPopover
            popup={hunkPopup.payload}
            filePath={hunkPopup.path}
            onUpdate={(payload) => setHunkPopup((prev) => prev && { ...prev, payload })}
            onClose={() => setHunkPopup(null)}
          />
        )}

        <FilesContentMenu
          menu={contentMenu}
          server={serverActions}
          connected={connected}
          onClose={() => setContentMenu(null)}
        />
        <FilesTreeMenu
          projectPath={rootPath}
          terminal={host.kind === 'project'}
          server={serverActions}
          clipboard={clipboardActions}
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
          onGoToLinkTarget={(target, isDirectory) => void goToEntry(target, isDirectory)}
          onClose={() => setTreeMenu(null)}
          onRequest={(req) => {
            // 菜单项随菜单卸掉，弹窗记下它当打开前的焦点就无处可还；先把焦点交回树，关掉后回到树（同在树上按键打开的）
            treeScrollRef.current?.focus({ preventScroll: true })
            setEntryDialog(req)
          }}
        />
        {entryDialog !== null && (
          <FilesEntryDialog
            key={`${entryDialog.kind}:${
              'dir' in entryDialog
                ? entryDialog.dir
                : 'path' in entryDialog
                  ? entryDialog.path
                  : entryDialog.entries.map((e) => e.path).join('\n')
            }`}
            request={entryDialog}
            onClose={() => setEntryDialog(null)}
            onSubmit={(name) => submitEntryDialog(entryDialog, name)}
          />
        )}
        {sameName !== null && (
          <SameNameDialog
            message={sameName.message}
            batch={sameName.batch}
            onAnswer={(action, applyToRest) => sameName.answer({ action, applyToRest })}
          />
        )}
        {opError !== null && <ErrorDialog message={opError} onClose={() => setOpError(null)} />}

        {conflictPath !== null && (
          <ConfirmDialog
            title={`重载 “${baseName(conflictPath)}”？`}
            message="文件已在磁盘上更改，当前还有未保存的编辑。重载会换成磁盘上的版本，丢掉这些编辑。"
            cancelLabel="保留编辑器内容"
            buttons={[{ label: '重载', onClick: () => reloadFromConflict(conflictPath) }]}
            onCancel={() => keepEditorContent(conflictPath)}
          />
        )}
      </ResizablePanelGroup>
    </FilesLocalContext.Provider>
  )
}

/** 树行 → 条目引用（菜单、删除、下载用），只取这三项 */
function entryRefOf(row: FilesEntryRef): FilesEntryRef {
  const { path, isDirectory, symlink } = row
  return symlink !== undefined ? { path, isDirectory, symlink } : { path, isDirectory }
}

/**
 * 符号链接紧跟名称的标记：正常链接 `ArrowUpRight`、断链 `Link2Off`（docs/prd/symlinks.md）。
 * 给 onJump（目标在树里）即可点：转到链接目标，不触发行的单击 / 双击；hover 只改字色。
 */
function SymlinkMark({
  symlink,
  onJump
}: {
  symlink: FilesSymlink
  onJump: (() => void) | undefined
}): React.JSX.Element {
  const Icon = symlink.broken ? Link2Off : ArrowUpRight
  if (onJump === undefined) return <Icon className="size-3" />
  return (
    <span
      title="转到链接目标"
      className="flex cursor-pointer items-center transition-colors hover:text-foreground"
      onClick={(e) => {
        e.stopPropagation()
        onJump()
      }}
    >
      <Icon className="size-3" />
    </span>
  )
}

/** 符号链接行的悬停提示：指向哪里，断链注明不存在 */
function symlinkTitle(symlink: FilesSymlink): string {
  return symlink.broken ? `指向 ${symlink.target}（不存在）` : `指向 ${symlink.target}`
}

/** 文件行：文件名与图标按工作区 Git 状态上色（无状态时图标 `--fg-icon`、名正文色）；符号链接带标记与悬停提示。 */
function FileTreeFileRow({
  name,
  depth,
  symlink,
  onJumpToLinkTarget,
  selected,
  menuActive,
  dimmed,
  draggable,
  status,
  onClick,
  onMenu,
  onDragStart
}: {
  name: string
  depth: number
  symlink: FilesSymlink | undefined
  /** 箭头可点时：转到链接目标 */
  onJumpToLinkTarget: (() => void) | undefined
  selected: boolean
  /** 右键菜单打开中：保持 hover 行底（指针已移入菜单会丢 :hover） */
  menuActive: boolean
  /** 被剪切、等着粘贴 */
  dimmed: boolean
  draggable: boolean
  status: GitFileStatus | undefined
  onClick: (e: React.MouseEvent) => void
  onMenu: (e: React.MouseEvent) => void
  onDragStart: (e: React.DragEvent) => void
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
      mark={symlink && <SymlinkMark symlink={symlink} onJump={onJumpToLinkTarget} />}
      title={symlink && symlinkTitle(symlink)}
      selected={selected}
      menuActive={menuActive}
      dimmed={dimmed}
      draggable={draggable}
      onClick={onClick}
      onContextMenu={onMenu}
      onDragStart={onDragStart}
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
