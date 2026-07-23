import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  Fragment,
  type CSSProperties,
  type HTMLAttributes
} from 'react'
import {
  AArrowDown,
  AArrowUp,
  ArrowUpDown,
  Check,
  ChevronRight,
  ClockArrowDown,
  ClockArrowUp,
  SquareArrowOutUpRight,
  FilePlusCorner,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  Play,
  RotateCw,
  Search,
  Square,
  Terminal,
  Trash2,
  X
} from 'lucide-react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS as DndCSS } from '@dnd-kit/utilities'
import type {
  DiscoveredScript,
  ProjectNode,
  ProjectSortMode,
  RunConfig,
  RunTarget,
  SessionStatus
} from '@shared/types'
import {
  DISCOVER_SOURCE_LABELS,
  DISCOVER_SOURCE_ORDER,
  type DiscoverSource
} from '@shared/discover-source'
import { configKey, scriptKey } from '@shared/runnable'
import { filterProjectNodes, sortProjectNodes } from '@shared/project-sort'
import { SHORTCUT } from '@shared/shortcut-label'
import { shortcutLabel, shortcutTitle } from '@renderer/lib/shortcut-label'
import { cn } from '@renderer/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { OPEN_IN_APP_ICONS } from '@renderer/assets/open-in'
import { OPEN_IN_APP_IDS, OPEN_IN_APP_LABELS, type OpenInAppStatus } from '@shared/open-in-app'
import { useApp } from '@renderer/store'

// 所有行统一固定高 + 圆角。四周内边距 6px：px-1.5 各 6px，
// h-10(40px) 让 size-7(28px) 按钮上下各留 6px；固定高避免 hover 出按钮时整行跳动。
const ROW =
  'group flex h-10 cursor-pointer items-center gap-1.5 rounded px-1.5 text-[14px] transition-colors'
const BTN = 'flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors'
/** 项目行高（与 ROW 的 h-10 一致），供 Pin 吸顶叠放 top / scroll-margin。 */
const PROJECT_ROW_H = 40
/** 置顶叠放行之间的间隙；须用不透明底填满，避免配置文字从缝里透出。 */
const PIN_STICKY_GAP = 1
const pinStickyTop = (index: number): number => index * (PROJECT_ROW_H + PIN_STICKY_GAP)
/** 未置顶「当前段」吸顶贴在整叠置顶下方（含置顶间间隙）。 */
const unpinnedStickyTop = (pinnedCount: number): number =>
  pinnedCount * (PROJECT_ROW_H + PIN_STICKY_GAP)
/** 吸顶时画在行下的 1px 不透明缝（不占布局，配合 pinStickyTop 的空档）。 */
const PIN_STICKY_SEAM: CSSProperties = {
  boxShadow: `0 ${PIN_STICKY_GAP}px 0 0 var(--bg-panel)`
}

/**
 * sticky 标题在视口内时对其 scrollIntoView 不会动（已可见）。
 * 已滚过段起点：滚非 sticky 段锚 + start（scroll-margin-top 预留吸顶高度；对齐 Git 段头）。
 * 否则：对标题行 nearest（已在视口不动，裁切才微滚）。
 */
function scrollProjectIntoView(list: HTMLElement, path: string): void {
  const esc = globalThis.CSS.escape(path)
  const anchor = list.querySelector(`[data-project-scroll-anchor="${esc}"]`) as HTMLElement | null
  const row = list.querySelector(`[data-project-path="${esc}"]`) as HTMLElement | null
  if (!anchor || !row) return

  const listRect = list.getBoundingClientRect()
  const marginTop = Number.parseFloat(getComputedStyle(anchor).scrollMarginTop) || 0
  if (anchor.getBoundingClientRect().top < listRect.top + marginTop - 1) {
    anchor.scrollIntoView({ block: 'start' })
    return
  }
  row.scrollIntoView({ block: 'nearest' })
}

// 列表仅垂直排序，且钳制在父容器内（containerNodeRect 即被拖行的父容器）。
// 等价 @dnd-kit/modifiers 的 restrictToVerticalAxis + restrictToParentElement，免引依赖。
// 用于配置行等「整块父容器」场景。
const restrictToVerticalWithinList: Modifier = ({
  transform,
  draggingNodeRect,
  containerNodeRect
}) => {
  const t = { ...transform, x: 0 }
  if (!draggingNodeRect || !containerNodeRect) return t
  if (draggingNodeRect.top + t.y < containerNodeRect.top) {
    t.y = containerNodeRect.top - draggingNodeRect.top
  } else if (draggingNodeRect.bottom + t.y > containerNodeRect.bottom) {
    t.y = containerNodeRect.bottom - draggingNodeRect.bottom
  }
  return t
}

const SORT_OPTIONS: { mode: ProjectSortMode; label: string }[] = [
  { mode: 'custom', label: '自定义' },
  { mode: 'name', label: '名称' },
  { mode: 'addedAt', label: '添加时间' },
  { mode: 'lastOpenedAt', label: '打开时间' }
]

export function ProjectTree(): React.JSX.Element {
  const tree = useApp((s) => s.tree)
  const projectSortPrefs = useApp((s) => s.projectSortPrefs)
  const projectFilter = useApp((s) => s.projectFilter)
  const setProjectFilter = useApp((s) => s.setProjectFilter)
  const projectFilterFocusNonce = useApp((s) => s.projectFilterFocusNonce)
  const cycleSortMode = useApp((s) => s.cycleSortMode)
  const setPinSticky = useApp((s) => s.setPinSticky)
  const pinSticky = projectSortPrefs.pinSticky
  const reorderProjects = useApp((s) => s.reorderProjects)
  const addProject = useApp((s) => s.addProject)
  const addProjectByPath = useApp((s) => s.addProjectByPath)
  const createProject = useApp((s) => s.createProject)

  // 拖项目时强制全部收起；松手后恢复各行原展开态（由 forceCollapsed 驱动，不改各行本地 open）。
  // 锚点用「所见视口 Y」（getBoundingClientRect，含吸顶卡住）；收起后关掉 sticky。
  // 单一方程：needScrollTop = offsetTop - anchor，使 visualY = offsetTop - scrollTop = anchor。
  // needScrollTop < 0 → paddingTop；在 [0,maxScroll] → 只设 scrollTop；> maxScroll → paddingBottom 撑高再滚。
  // 不用负 marginTop（会裁顶）。拖中向下滚按增量吃掉 paddingTop 并回退等量 scrollTop。
  // 松手后：记下被拖项视口 top，展开后再用 scrollTop 尽量拉回（不加 padding）。
  // forceCollapsed 期间置顶行关闭 sticky，避免与补偿抢位置。
  const [forceCollapsed, setForceCollapsed] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const listContentRef = useRef<HTMLDivElement>(null)
  const filterInputRef = useRef<HTMLInputElement>(null)
  const consumedFilterFocusNonce = useRef(0)
  const collapseAnchorRef = useRef<number | null>(null)
  const collapsePadRef = useRef(0)
  const lastScrollTopRef = useRef(0)
  const restoreRef = useRef<{ path: string; clientTop: number } | null>(null)
  /** 项目拖拽中：当前项 path，及同 Pin 组在列表内容坐标系下的 [top,bottom]（随收起/滚动重测）。 */
  const draggingPathRef = useRef<string | null>(null)
  const dragGroupClampRef = useRef<{ top: number; bottom: number } | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const filtered = filterProjectNodes(sortProjectNodes(tree, projectSortPrefs), projectFilter)
  const pinnedNodes = useMemo(() => filtered.filter((n) => n.project.pinned), [filtered])
  const unpinnedNodes = useMemo(() => filtered.filter((n) => !n.project.pinned), [filtered])
  const pinnedPathSet = useMemo(
    () => new Set(pinnedNodes.map((n) => n.project.path)),
    [pinnedNodes]
  )
  // 碰撞只认同 Pin 组，拖拽过程中就不能跨界让位。
  const pinSealedCollision: CollisionDetection = useCallback(
    (args) => {
      const activePinned = pinnedPathSet.has(String(args.active.id))
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter(
          (c) => pinnedPathSet.has(String(c.id)) === activePinned
        )
      })
    },
    [pinnedPathSet]
  )

  /** 量同 Pin 组在列表内容坐标系中的纵向范围，供拖拽限位（与列表边缘限位同理）。 */
  const measurePinGroupClamp = useCallback(
    (activePath: string): void => {
      const list = listRef.current
      if (!list) {
        dragGroupClampRef.current = null
        return
      }
      const activePinned = pinnedPathSet.has(activePath)
      const scrollTop = list.scrollTop
      const listR = list.getBoundingClientRect()
      let top = Infinity
      let bottom = -Infinity
      const seen = new Set<string>()
      for (const node of list.querySelectorAll('[data-project-path]')) {
        const path = node.getAttribute('data-project-path')
        if (!path || seen.has(path) || pinnedPathSet.has(path) !== activePinned) continue
        seen.add(path)
        const r = (node as HTMLElement).getBoundingClientRect()
        top = Math.min(top, r.top - listR.top + scrollTop)
        bottom = Math.max(bottom, r.bottom - listR.top + scrollTop)
      }
      dragGroupClampRef.current = Number.isFinite(top) ? { top, bottom } : null
    },
    [pinnedPathSet]
  )

  // 项目拖拽：垂直 + 钳制在当前 Pin 组边缘（并与列表可视区取交）。
  const restrictToVerticalWithinPinGroup: Modifier = useCallback(
    ({ transform, draggingNodeRect }) => {
      const t = { ...transform, x: 0 }
      const list = listRef.current
      const clamp = dragGroupClampRef.current
      if (!draggingNodeRect || !list || !clamp) return t
      const listR = list.getBoundingClientRect()
      const scrollTop = list.scrollTop
      let top = listR.top + (clamp.top - scrollTop)
      let bottom = listR.top + (clamp.bottom - scrollTop)
      top = Math.max(top, listR.top)
      bottom = Math.min(bottom, listR.bottom)
      if (bottom < top) return t
      if (draggingNodeRect.top + t.y < top) {
        t.y = top - draggingNodeRect.top
      } else if (draggingNodeRect.bottom + t.y > bottom) {
        t.y = bottom - draggingNodeRect.bottom
      }
      return t
    },
    []
  )
  // 有筛选时禁用拖拽；非自定义也可拖，松手且顺序实质变化后才切到自定义并落盘。
  const canDrag = projectFilter.trim() === '' && filtered.length > 1
  const currentProjectPath = useApp((s) => s.currentProjectPath)
  const scrollToProjectPath = useApp((s) => s.scrollToProjectPath)
  const clearScrollToProjectPath = useApp((s) => s.clearScrollToProjectPath)
  // 置顶项目的展开态提到父级，供吸顶标题条与下方配置区共用（默认展开）。
  const [pinnedOpen, setPinnedOpen] = useState<Record<string, boolean>>({})
  const isPinnedExpanded = (path: string): boolean => !forceCollapsed && pinnedOpen[path] !== false
  const togglePinnedOpen = (path: string): void => {
    setPinnedOpen((prev) => ({ ...prev, [path]: !(prev[path] !== false) }))
  }

  // 打开时间排序：等 touch 回写、当前项已排到本组最前之后，再滚入视口（有 Pin 时不滚到列表顶）。
  useLayoutEffect(() => {
    if (projectSortPrefs.mode !== 'lastOpenedAt' || !currentProjectPath) return
    const idx = filtered.findIndex((n) => n.project.path === currentProjectPath)
    if (idx < 0) return
    const pinned = filtered[idx].project.pinned
    const firstInGroup = filtered.findIndex((n) => n.project.pinned === pinned)
    if (idx !== firstInGroup) return
    const list = listRef.current
    if (!list) return
    if (
      list.querySelector(
        `[data-project-scroll-anchor="${globalThis.CSS.escape(currentProjectPath)}"]`
      )
    ) {
      scrollProjectIntoView(list, currentProjectPath)
    } else {
      list
        .querySelector(`[data-project-path="${globalThis.CSS.escape(currentProjectPath)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    }
  }, [projectSortPrefs.mode, currentProjectPath, filtered])

  // 添加项目后：把目标行滚进视口（已可见则不动；吸顶项走非 sticky 锚 + scrollIntoView）。
  useLayoutEffect(() => {
    if (!scrollToProjectPath) return
    const list = listRef.current
    if (list) {
      const el = list.querySelector(
        `[data-project-scroll-anchor="${globalThis.CSS.escape(scrollToProjectPath)}"]`
      )
      if (el) scrollProjectIntoView(list, scrollToProjectPath)
      else {
        list
          .querySelector(`[data-project-path="${globalThis.CSS.escape(scrollToProjectPath)}"]`)
          ?.scrollIntoView({ block: 'nearest' })
      }
    }
    clearScrollToProjectPath()
  }, [scrollToProjectPath, filtered, pinnedPathSet, clearScrollToProjectPath])

  // ⌥⌘P：聚焦项目筛选框并选中已有查询，方便直接覆盖输入。
  useEffect(() => {
    if (!projectFilterFocusNonce || projectFilterFocusNonce === consumedFilterFocusNonce.current)
      return
    consumedFilterFocusNonce.current = projectFilterFocusNonce
    const input = filterInputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [projectFilterFocusNonce])

  useLayoutEffect(() => {
    const list = listRef.current
    const content = listContentRef.current
    if (list === null) return

    if (forceCollapsed) {
      if (content === null) return
      const anchor = collapseAnchorRef.current
      if (anchor === null) return
      const item = list.querySelector('[data-dragging-project]') as HTMLElement | null
      if (!item) return

      content.style.paddingTop = ''
      content.style.paddingBottom = ''
      content.style.marginTop = ''
      // 内容变矮后先钳制 scrollTop，再解 needScrollTop = offsetTop - anchor。
      let maxScroll = Math.max(0, list.scrollHeight - list.clientHeight)
      if (list.scrollTop > maxScroll) list.scrollTop = maxScroll
      // sticky 已关；用布局 Y，避开 dnd transform。
      const needScrollTop = item.offsetTop - anchor

      if (needScrollTop < 0) {
        const pad = -needScrollTop
        content.style.paddingTop = `${pad}px`
        collapsePadRef.current = pad
        list.scrollTop = 0
      } else {
        collapsePadRef.current = 0
        if (needScrollTop > maxScroll) {
          content.style.paddingBottom = `${needScrollTop - maxScroll}px`
          maxScroll = Math.max(0, list.scrollHeight - list.clientHeight)
        }
        list.scrollTop = Math.min(needScrollTop, maxScroll)
      }
      lastScrollTopRef.current = list.scrollTop
      if (draggingPathRef.current) measurePinGroupClamp(draggingPathRef.current)
      return
    }

    // 展开后：仅用 scrollTop 尽量把被拖项拉回松手前的视口位置（浏览器钳制即「尽量」）。
    const restore = restoreRef.current
    if (!restore) return
    restoreRef.current = null
    const item = list.querySelector(
      `[data-project-path="${globalThis.CSS.escape(restore.path)}"]`
    ) as HTMLElement | null
    if (!item) return
    list.scrollTop += item.getBoundingClientRect().top - restore.clientTop
  }, [forceCollapsed, filtered, measurePinGroupClamp])

  const clearCollapsePad = (): void => {
    setForceCollapsed(false)
    collapseAnchorRef.current = null
    collapsePadRef.current = 0
    lastScrollTopRef.current = 0
    draggingPathRef.current = null
    dragGroupClampRef.current = null
    const content = listContentRef.current
    if (content) {
      content.style.paddingTop = ''
      content.style.paddingBottom = ''
      content.style.marginTop = ''
    }
  }

  // 向下滚动时按增量吃掉补偿 paddingTop，并回退等量 scrollTop，使视口位移仍为 1×。
  const handleListScroll = (): void => {
    const list = listRef.current
    const content = listContentRef.current
    if (!list || !content) return
    const pad = collapsePadRef.current
    const delta = list.scrollTop - lastScrollTopRef.current
    if (pad > 0 && delta > 0) {
      const consume = Math.min(pad, delta)
      const next = pad - consume
      collapsePadRef.current = next
      content.style.paddingTop = next > 0 ? `${next}px` : ''
      list.scrollTop -= consume
      // padding 变化后组边界需重测。
      if (draggingPathRef.current) measurePinGroupClamp(draggingPathRef.current)
    }
    lastScrollTopRef.current = list.scrollTop
  }

  const handleProjectDragStart = (e: DragStartEvent): void => {
    const list = listRef.current
    const path = e.active.id as string
    draggingPathRef.current = path
    const item = list?.querySelector(
      `[data-project-path="${globalThis.CSS.escape(path)}"]`
    ) as HTMLElement | null
    // 用视口 Y（非 offsetTop）：吸顶卡住时布局位置≠所见位置；收起后 sticky 会关掉，再靠 pad 对齐所见。
    collapseAnchorRef.current =
      item && list ? item.getBoundingClientRect().top - list.getBoundingClientRect().top : null
    setForceCollapsed(true)
  }

  /** 松手前记下被拖项视口 top（含 transform），展开后用 scrollTop 尽量还原。 */
  const captureRestoreAnchor = (path: string): void => {
    const list = listRef.current
    const item = list?.querySelector(
      `[data-project-path="${globalThis.CSS.escape(path)}"]`
    ) as HTMLElement | null
    if (item) restoreRef.current = { path, clientTop: item.getBoundingClientRect().top }
  }

  const handleProjectDragEnd = (e: DragEndEvent): void => {
    const path = e.active.id as string
    captureRestoreAnchor(path)
    clearCollapsePad()
    const { active, over } = e
    if (!over || active.id === over.id) return
    const activePinned = pinnedPathSet.has(String(active.id))
    const overPinned = pinnedPathSet.has(String(over.id))
    // Pin 边界密封：跨区不落盘（碰撞层已限制，这里再兜底）。
    if (activePinned !== overPinned) return
    const group = activePinned ? pinnedNodes : unpinnedNodes
    const other = activePinned ? unpinnedNodes : pinnedNodes
    const paths = group.map((n) => n.project.path)
    const from = paths.indexOf(active.id as string)
    const to = paths.indexOf(over.id as string)
    if (from < 0 || to < 0 || from === to) return
    const reorderedGroup = arrayMove(paths, from, to)
    const otherPaths = other.map((n) => n.project.path)
    const next = activePinned
      ? [...reorderedGroup, ...otherPaths]
      : [...otherPaths, ...reorderedGroup]
    // 非自定义下拖成新序：先切到自定义，再按当前视觉序落盘。
    if (projectSortPrefs.mode !== 'custom') void cycleSortMode('custom')
    reorderProjects(next)
  }

  const handleProjectDragCancel = (): void => {
    const list = listRef.current
    const item = list?.querySelector('[data-dragging-project]') as HTMLElement | null
    const path = item?.getAttribute('data-project-path')
    if (path) captureRestoreAnchor(path)
    clearCollapsePad()
  }

  const emptyMessage = tree.length === 0 ? '拖入文件夹，或点上方 + 新建 / 添加项目' : '无匹配项目'

  // 固定置顶开：标题摊平为列表直接子节点，才能跨整表叠放吸顶。
  // 关：每项包进段容器，sticky 只在本段内有效，下一段会把上一段顶走（而不是盖住）。
  const pinnedRows = pinnedNodes.map((node, pinStackIndex) => {
    const expanded = isPinnedExpanded(node.project.path)
    const bodyVisible = expanded && (node.configs.length > 0 || node.discovered.length > 0)
    const path = node.project.path
    const gapClass = bodyVisible ? undefined : 'mb-3'
    const block = (
      <>
        {/* 段起点锚（0 高、非 sticky）：点吸顶标题经它 scrollIntoView——标题已在视口时直接滚它不动。 */}
        <div
          data-project-scroll-anchor={path}
          aria-hidden
          style={{ scrollMarginTop: pinSticky ? pinStickyTop(pinStackIndex) : 0 }}
        />
        {canDrag ? (
          <SortableProjectHeader
            node={node}
            expanded={expanded}
            pinStackIndex={pinStackIndex}
            forceCollapsed={forceCollapsed}
            pinSticky={pinSticky}
            className={pinSticky ? gapClass : undefined}
            onScrollIntoPlace={() => {
              const list = listRef.current
              if (list) scrollProjectIntoView(list, path)
            }}
            onToggleExpand={() => togglePinnedOpen(path)}
          />
        ) : (
          <ProjectHeader
            node={node}
            expanded={expanded}
            pinStackIndex={pinStackIndex}
            pinSticky={pinSticky}
            className={pinSticky ? gapClass : undefined}
            onScrollIntoPlace={() => {
              const list = listRef.current
              if (list) scrollProjectIntoView(list, path)
            }}
            onToggleExpand={() => togglePinnedOpen(path)}
          />
        )}
        <PinnedProjectBody
          node={node}
          expanded={expanded}
          className={pinSticky ? 'mb-3' : undefined}
        />
      </>
    )
    if (pinSticky) {
      return <Fragment key={path}>{block}</Fragment>
    }
    return (
      <div key={path} className={cn('relative', gapClass ?? 'mb-3')}>
        {block}
      </div>
    )
  })

  const unpinnedSticky = unpinnedStickyTop(pinSticky ? pinnedNodes.length : 0)
  const unpinnedRows = unpinnedNodes.map((node) => {
    const path = node.project.path
    const scrollIntoPlace = (): void => {
      const list = listRef.current
      if (list) scrollProjectIntoView(list, path)
    }
    return canDrag ? (
      <SortableProjectRow
        key={path}
        node={node}
        forceCollapsed={forceCollapsed}
        stickyTop={unpinnedSticky}
        className="mb-3"
        onScrollIntoPlace={scrollIntoPlace}
      />
    ) : (
      <ProjectRow
        key={path}
        node={node}
        forceCollapsed={forceCollapsed}
        stickyTop={forceCollapsed ? null : unpinnedSticky}
        className="mb-3"
        onScrollIntoPlace={scrollIntoPlace}
      />
    )
  })

  return (
    <div
      data-project-tree=""
      className="flex h-full w-[280px] shrink-0 flex-col border-r border-[var(--separator)] bg-panel"
      onDragOver={(e) => e.preventDefault()}
      onDrop={async (e) => {
        e.preventDefault()
        for (const file of Array.from(e.dataTransfer.files)) {
          await addProjectByPath(window.drop.getPathForFile(file))
        }
      }}
    >
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--separator)] px-1.5 text-muted-foreground">
        <div
          title={shortcutTitle('筛选项目', SHORTCUT.projectFilter)}
          className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded px-1.5 transition-colors focus-within:bg-[var(--bg-row-hover)]"
        >
          <Search className="size-3.5 shrink-0 text-[color:var(--fg-disabled)]" />
          <input
            ref={filterInputRef}
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && projectFilter) {
                e.preventDefault()
                setProjectFilter('')
              }
            }}
            placeholder="筛选"
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-[color:var(--fg-disabled)]"
          />
          {projectFilter !== '' && (
            <button
              type="button"
              title="清空"
              className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]"
              onClick={() => setProjectFilter('')}
            >
              <X className="size-3" />
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <SortMenu
            mode={projectSortPrefs.mode}
            direction={projectSortPrefs.direction}
            pinSticky={pinSticky}
            onSelect={cycleSortMode}
            onPinStickyChange={setPinSticky}
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              title="新建 / 添加项目"
              className={cn(
                BTN,
                'text-muted-foreground hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]'
              )}
            >
              <FolderPlus className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={createProject}>新建项目…</DropdownMenuItem>
              <DropdownMenuItem onClick={addProject}>添加现有项目…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div
        ref={listRef}
        tabIndex={0}
        title={`切换项目 (${shortcutLabel(SHORTCUT.prevProject)} / ${shortcutLabel(SHORTCUT.nextProject)})`}
        className="min-h-0 flex-1 overflow-auto px-1.5 pb-1.5 outline-none"
        onScroll={forceCollapsed ? handleListScroll : undefined}
        onKeyDown={(e) => {
          if (e.target instanceof HTMLInputElement) return
          if (e.key === 'Escape') {
            if (projectFilter) {
              e.preventDefault()
              setProjectFilter('')
            }
            return
          }
          if (e.key === 'Backspace' && projectFilter) {
            e.preventDefault()
            setProjectFilter(projectFilter.slice(0, -1))
            filterInputRef.current?.focus()
            return
          }
          if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault()
            setProjectFilter(projectFilter + e.key)
            filterInputRef.current?.focus()
          }
        }}
      >
        {filtered.length === 0 ? (
          <div className="flex h-full min-h-full items-center justify-center px-3 text-[13px] text-muted-foreground">
            {emptyMessage}
          </div>
        ) : canDrag ? (
          <DndContext
            sensors={sensors}
            collisionDetection={pinSealedCollision}
            modifiers={[restrictToVerticalWithinPinGroup]}
            onDragStart={handleProjectDragStart}
            onDragEnd={handleProjectDragEnd}
            onDragCancel={handleProjectDragCancel}
          >
            <div ref={listContentRef} className="relative [&>*:last-child]:mb-0">
              <SortableContext
                items={pinnedNodes.map((n) => n.project.path)}
                strategy={verticalListSortingStrategy}
              >
                {pinnedRows}
              </SortableContext>
              <SortableContext
                items={unpinnedNodes.map((n) => n.project.path)}
                strategy={verticalListSortingStrategy}
              >
                {unpinnedRows}
              </SortableContext>
            </div>
          </DndContext>
        ) : (
          <div className="[&>*:last-child]:mb-0">
            {pinnedRows}
            {unpinnedRows}
          </div>
        )}
      </div>
    </div>
  )
}

function SortMenu({
  mode,
  direction,
  pinSticky,
  onSelect,
  onPinStickyChange
}: {
  mode: ProjectSortMode
  direction: 'asc' | 'desc'
  pinSticky: boolean
  onSelect: (mode: ProjectSortMode) => void
  onPinStickyChange: (pinSticky: boolean) => void
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title="排序"
        className={cn(
          BTN,
          'text-muted-foreground hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]'
        )}
      >
        <ArrowUpDown className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {SORT_OPTIONS.map((opt) => {
          const active = mode === opt.mode
          return (
            <DropdownMenuItem key={opt.mode} onClick={() => onSelect(opt.mode)}>
              <span className="flex size-4 shrink-0 items-center justify-center">
                {active && <SortActiveIcon mode={opt.mode} direction={direction} />}
              </span>
              <span className="flex-1">{opt.label}</span>
            </DropdownMenuItem>
          )
        })}
        <div className="mx-1.5 my-1 h-px bg-[var(--border-input)]" role="separator" />
        <DropdownMenuItem onClick={() => onPinStickyChange(!pinSticky)}>
          <span className="flex size-4 shrink-0 items-center justify-center">
            {pinSticky && <Check className="size-3.5" />}
          </span>
          <span className="flex-1">固定置顶</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 当前排序项左侧图标：自定义=勾；名称=AZ 箭头；时间=时钟箭头。兼作选中标记。 */
function SortActiveIcon({
  mode,
  direction
}: {
  mode: ProjectSortMode
  direction: 'asc' | 'desc'
}): React.JSX.Element {
  if (mode === 'custom') return <Check className="size-3.5" />
  if (mode === 'name') {
    return direction === 'asc' ? (
      <AArrowDown className="size-3.5" />
    ) : (
      <AArrowUp className="size-3.5" />
    )
  }
  // 打开时间固定降序，只用 ClockArrowDown；添加时间仍可升/降。
  if (mode === 'lastOpenedAt') return <ClockArrowDown className="size-3.5" />
  return direction === 'asc' ? (
    <ClockArrowUp className="size-3.5" />
  ) : (
    <ClockArrowDown className="size-3.5" />
  )
}

function SortableProjectHeader({
  node,
  expanded,
  pinStackIndex,
  forceCollapsed,
  pinSticky,
  className,
  onScrollIntoPlace,
  onToggleExpand
}: {
  node: ProjectNode
  expanded: boolean
  pinStackIndex: number
  /** 拖拽收起补偿期间关掉 sticky，避免与 padding 补偿抢位置 */
  forceCollapsed: boolean
  pinSticky: boolean
  className?: string
  onScrollIntoPlace: () => void
  onToggleExpand: () => void
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: node.project.path
  })
  // 拖拽中所有项都要吃 transform（让位动画）。
  // 收起补偿期间关掉 sticky。偏好开：叠放吸顶；关：段内吸顶（下一段顶走上一段，不覆盖）。
  const sorting = transform !== null
  const stick = !forceCollapsed && !sorting
  const style: CSSProperties = {
    transform: DndCSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
    // 叠放时按序抬高 z；段吸顶用同一 z，避免后一段盖住前一段被顶走的过程。
    zIndex: isDragging ? 40 : sorting ? 10 : pinSticky ? 20 + pinStackIndex : 15,
    ...(stick
      ? pinSticky
        ? { position: 'sticky', top: pinStickyTop(pinStackIndex), ...PIN_STICKY_SEAM }
        : { position: 'sticky', top: 0 }
      : { position: 'relative' })
  }
  return (
    <ProjectHeader
      ref={setNodeRef}
      node={node}
      expanded={expanded}
      pinStackIndex={pinStackIndex}
      pinSticky={pinSticky}
      className={className}
      style={style}
      dataProjectPath={node.project.path}
      isDragging={isDragging}
      onScrollIntoPlace={onScrollIntoPlace}
      onToggleExpand={onToggleExpand}
      dragHandleProps={{ ...attributes, ...listeners }}
    />
  )
}

/** 置顶区项目行标题；sticky 叠放，须为列表容器的直接子节点。 */
function ProjectHeader({
  ref,
  node,
  expanded,
  pinStackIndex,
  pinSticky,
  className,
  style,
  dataProjectPath,
  isDragging,
  onScrollIntoPlace,
  onToggleExpand,
  dragHandleProps
}: {
  ref?: React.Ref<HTMLDivElement>
  node: ProjectNode
  expanded: boolean
  pinStackIndex: number
  pinSticky: boolean
  className?: string
  style?: CSSProperties
  dataProjectPath?: string
  isDragging?: boolean
  onScrollIntoPlace: () => void
  onToggleExpand: () => void
  dragHandleProps?: HTMLAttributes<HTMLDivElement>
}): React.JSX.Element {
  const selectProject = useApp((s) => s.selectProject)
  const selected = useApp(
    (s) => s.currentProjectPath === node.project.path && s.selectedKey === null
  )
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  // 菜单开着时指针已离行，`:hover` 会丢；保持与 hover 相同的行底 / ⋮ 可见性。
  const rowHoverLike = !!isDragging || contextMenuOpen || moreMenuOpen
  const pinned = node.project.pinned
  const stickyStyle: CSSProperties = style ?? {
    position: 'sticky',
    top: pinSticky ? pinStickyTop(pinStackIndex) : 0,
    zIndex: pinSticky ? 20 + pinStackIndex : 15,
    ...(pinSticky ? PIN_STICKY_SEAM : {})
  }

  // ContextMenu.Root 不渲染 DOM，Trigger 仍是列表的直接子节点，sticky 叠放不受影响。
  return (
    <ContextMenu onOpenChange={setContextMenuOpen}>
      <ContextMenuTrigger
        ref={ref}
        style={stickyStyle}
        data-project-path={dataProjectPath ?? node.project.path}
        {...(isDragging ? { 'data-dragging-project': '' } : {})}
        className={cn(
          ROW,
          'select-none bg-panel text-foreground',
          selected
            ? 'bg-[var(--selection-row)]'
            : rowHoverLike
              ? 'bg-[var(--bg-row-hover)]'
              : 'hover:bg-[var(--bg-row-hover)]',
          className
        )}
        {...dragHandleProps}
        onClick={(e) => {
          dragHandleProps?.onClick?.(e)
          selectProject(node.project.path)
          onScrollIntoPlace()
        }}
        onDoubleClick={onToggleExpand}
      >
        <button
          type="button"
          title={expanded ? '折叠' : '展开'}
          onClick={(e) => {
            e.stopPropagation()
            onToggleExpand()
          }}
          className="-m-1 flex size-6 shrink-0 items-center justify-center text-muted-foreground"
        >
          <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
        </button>
        <Folder className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{node.project.name}</span>
        {node.packageManager && node.packageManager !== 'pnpm' && (
          <span
            className={cn(
              'text-[12px] text-muted-foreground group-hover:hidden',
              rowHoverLike && 'hidden'
            )}
          >
            {node.packageManager}
          </span>
        )}
        <ProjectMoreMenu
          projectPath={node.project.path}
          pinned={pinned}
          selected={selected}
          forceVisible={!!isDragging || contextMenuOpen}
          onOpenChange={setMoreMenuOpen}
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ProjectMenuItems projectPath={node.project.path} pinned={pinned} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** 置顶项目的配置区（标题 sticky，此处为兄弟节点）。 */
function PinnedProjectBody({
  node,
  expanded,
  className
}: {
  node: ProjectNode
  expanded: boolean
  className?: string
}): React.JSX.Element | null {
  if (!expanded) return null
  if (node.configs.length === 0 && node.discovered.length === 0) return null

  return (
    <div className={cn('mt-0.5', className)}>
      <ProjectConfigList node={node} />
    </div>
  )
}

function SortableProjectRow({
  node,
  forceCollapsed,
  stickyTop,
  className,
  onScrollIntoPlace
}: {
  node: ProjectNode
  forceCollapsed: boolean
  /** 未置顶当前段吸顶 top（置顶堆下方）；拖拽/收起补偿期间关掉。 */
  stickyTop: number
  className?: string
  onScrollIntoPlace: () => void
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: node.project.path
  })
  // 拖拽中所有项都要吃 transform，否则其它行不会让位；transform 会打断子孙 sticky。
  const sorting = transform !== null
  const stick = !forceCollapsed && !sorting
  const style: CSSProperties = {
    transform: DndCSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
    zIndex: isDragging ? 10 : undefined,
    position: 'relative'
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={className}
      data-project-path={node.project.path}
      {...(isDragging ? { 'data-dragging-project': '' } : {})}
    >
      <ProjectRow
        node={node}
        forceCollapsed={forceCollapsed}
        stickyTop={stick ? stickyTop : null}
        isDragging={isDragging}
        onScrollIntoPlace={onScrollIntoPlace}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  )
}

function ProjectRow({
  node,
  forceCollapsed,
  stickyTop,
  className,
  isDragging,
  onScrollIntoPlace,
  dragHandleProps
}: {
  node: ProjectNode
  forceCollapsed: boolean
  /** 非 null 时项目行在本块内吸顶（贴在置顶堆下）。 */
  stickyTop?: number | null
  className?: string
  isDragging?: boolean
  onScrollIntoPlace: () => void
  /** 项目拖拽句柄（仅挂在行头） */
  dragHandleProps?: HTMLAttributes<HTMLDivElement>
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const selectProject = useApp((s) => s.selectProject)
  // 与配置行同层级的互斥选中：仅当「项目本身」被选中（无配置选中）时高亮项目行。
  const selected = useApp(
    (s) => s.currentProjectPath === node.project.path && s.selectedKey === null
  )
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  // 菜单开着时指针已离行，`:hover` 会丢；保持与 hover 相同的行底 / ⋮ 可见性。
  const rowHoverLike = !!isDragging || contextMenuOpen || moreMenuOpen

  const expanded = open && !forceCollapsed
  const pinned = node.project.pinned
  const headerSticky =
    stickyTop != null
      ? ({
          position: 'sticky',
          top: stickyTop,
          zIndex: 15
        } satisfies CSSProperties)
      : undefined

  return (
    <div data-project-path={node.project.path} className={className}>
      {/* 段起点锚：吸顶标题已在视口时须靠它 scrollIntoView。 */}
      <div
        data-project-scroll-anchor={node.project.path}
        aria-hidden
        style={{ scrollMarginTop: stickyTop ?? 0 }}
      />
      <ContextMenu onOpenChange={setContextMenuOpen}>
        <ContextMenuTrigger
          style={headerSticky}
          className={cn(
            ROW,
            'select-none bg-panel text-foreground',
            selected
              ? 'bg-[var(--selection-row)]'
              : rowHoverLike
                ? 'bg-[var(--bg-row-hover)]'
                : 'hover:bg-[var(--bg-row-hover)]'
          )}
          {...dragHandleProps}
          onClick={(e) => {
            dragHandleProps?.onClick?.(e)
            selectProject(node.project.path)
            onScrollIntoPlace()
          }}
          onDoubleClick={() => setOpen((v) => !v)}
        >
          <button
            type="button"
            title={expanded ? '折叠' : '展开'}
            onClick={(e) => {
              e.stopPropagation()
              setOpen((v) => !v)
            }}
            className="-m-1 flex size-6 shrink-0 items-center justify-center text-muted-foreground"
          >
            <ChevronRight
              className={cn('size-3.5 transition-transform', expanded && 'rotate-90')}
            />
          </button>
          <Folder className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{node.project.name}</span>
          {node.packageManager && node.packageManager !== 'pnpm' && (
            <span
              className={cn(
                'text-[12px] text-muted-foreground group-hover:hidden',
                rowHoverLike && 'hidden'
              )}
            >
              {node.packageManager}
            </span>
          )}
          <ProjectMoreMenu
            projectPath={node.project.path}
            pinned={pinned}
            selected={selected}
            forceVisible={!!isDragging || contextMenuOpen}
            onOpenChange={setMoreMenuOpen}
          />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ProjectMenuItems projectPath={node.project.path} pinned={pinned} />
        </ContextMenuContent>
      </ContextMenu>
      {expanded && (
        <div className="mt-0.5">
          <ProjectConfigList node={node} />
        </div>
      )}
    </div>
  )
}

/** 项目下的配置列表 +「检测到的配置」；配置拖拽父容器不含探测行，限位到配置区边缘。 */
function ProjectConfigList({ node }: { node: ProjectNode }): React.JSX.Element {
  const reorderConfigs = useApp((s) => s.reorderConfigs)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const handleDragEnd = (e: DragEndEvent): void => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = node.configs.map((c) => c.id)
    const from = ids.indexOf(active.id as string)
    const to = ids.indexOf(over.id as string)
    if (from < 0 || to < 0) return
    reorderConfigs(node.project.path, arrayMove(ids, from, to))
  }

  return (
    <>
      {node.configs.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalWithinList]}
          onDragEnd={handleDragEnd}
        >
          {/* 单独包裹：restrictToParent 的父级不含「检测到的配置」 */}
          <div>
            <SortableContext
              items={node.configs.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              {node.configs.map((c) => (
                <SortableConfigRow key={c.id} config={c} />
              ))}
            </SortableContext>
          </div>
        </DndContext>
      )}
      {node.discovered.length > 0 && <DiscoveredMenu discovered={node.discovered} />}
    </>
  )
}

function groupDiscovered(
  discovered: DiscoveredScript[]
): Array<{ source: DiscoverSource; items: DiscoveredScript[] }> {
  const bySource = new Map<DiscoverSource, DiscoveredScript[]>()
  for (const s of discovered) {
    const list = bySource.get(s.source)
    if (list) list.push(s)
    else bySource.set(s.source, [s])
  }
  return DISCOVER_SOURCE_ORDER.filter((source) => bySource.has(source)).map((source) => ({
    source,
    items: bySource.get(source)!
  }))
}

// 探测脚本收进一个临时弹出菜单（Base UI Popover），菜单项与配置行同款样式。
// 受控 open：菜单项被选中或运行即刻关闭（选中即晋升，行随之移出候补区）。
function DiscoveredMenu({ discovered }: { discovered: DiscoveredScript[] }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-0.5">
      <Popover open={open} onOpenChange={(nextOpen) => setOpen(nextOpen)}>
        <PopoverTrigger
          className={cn(ROW, 'w-full text-muted-foreground hover:bg-[var(--bg-row-hover)]')}
        >
          {/* 占位补齐折叠箭头列；文案接着圆点列起始，与配置的状态点对齐 */}
          <span className="size-4 shrink-0" />
          <span className="flex-1 truncate text-left">检测到的配置</span>
          {/* 数字移到箭头前 */}
          <span className="shrink-0 text-[12px] text-[var(--fg-disabled)]">
            {discovered.length}
          </span>
          {/* 箭头放进 size-7 槽并靠右，与配置行最右的「更多」按钮图标同列对齐 */}
          <span className="flex size-7 shrink-0 items-center justify-center">
            <ChevronRight className="size-4 shrink-0" />
          </span>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-60 p-1">
          {groupDiscovered(discovered).map(({ source, items }) => (
            <div key={source} className="mb-1 last:mb-0">
              <div className="px-2 py-1 text-[11px] font-medium text-[var(--fg-disabled)]">
                {DISCOVER_SOURCE_LABELS[source]}
              </div>
              {items.map((s) => (
                <RunnableRow
                  key={`${s.source}\0${s.name}`}
                  label={s.name}
                  rkey={scriptKey(s.projectPath, s.source, s.name)}
                  target={{
                    type: 'script',
                    projectPath: s.projectPath,
                    source: s.source,
                    name: s.name
                  }}
                  projectPath={s.projectPath}
                  onAction={() => setOpen(false)}
                />
              ))}
            </div>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  )
}

function SortableConfigRow({ config }: { config: RunConfig }): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: config.id
  })
  const style: React.CSSProperties = {
    transform: DndCSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
    zIndex: isDragging ? 10 : undefined,
    position: 'relative'
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="mb-0.5"
      {...(isDragging ? { 'data-dragging-config': '' } : {})}
      {...attributes}
      {...listeners}
    >
      <RunnableRow
        label={config.kind === 'referenced' ? config.scriptName : config.name}
        rkey={configKey(config)}
        target={{ type: 'config', id: config.id }}
        projectPath={config.projectPath}
        config={config}
        indent
        isDragging={isDragging}
      />
    </div>
  )
}

function RunnableRow({
  label,
  rkey,
  target,
  projectPath,
  config,
  indent,
  isDragging,
  onAction
}: {
  label: string
  rkey: string
  target: RunTarget
  projectPath: string
  config?: RunConfig
  indent?: boolean
  isDragging?: boolean
  /** 选中或运行后回调（探测脚本弹出菜单用它及时关闭） */
  onAction?: () => void
}): React.JSX.Element {
  // 仅配置行右键；探测脚本无更多菜单，不加右键。
  const status = useApp((s) => s.sessions[rkey]?.status ?? 'idle')
  const selected = useApp((s) => s.selectedKey === rkey)
  const run = useApp((s) => s.run)
  const stop = useApp((s) => s.stop)
  const select = useApp((s) => s.select)
  const selectScript = useApp((s) => s.selectScript)
  const running = status === 'running'
  // 选中蓝底行上的按钮 hover 用蓝色高亮，而非灰色。
  const btnHover = selected
    ? 'hover:bg-[var(--selection-row-hover)]'
    : 'hover:bg-[var(--bg-button-hover)]'
  // 空闲时按钮仅 hover / 选中 / 拖拽中才显示；运行中的重跑与停止恒显。
  const idleVis = selected || isDragging ? 'flex' : 'hidden group-hover:flex'

  const row = (
    <>
      {/* 缩进对齐：占位补齐折叠箭头列，点居中于文件夹图标列 */}
      {indent && <span className="size-4 shrink-0" />}
      <span className="flex size-4 shrink-0 items-center justify-center">
        <StatusDot status={status} />
      </span>
      <span className="flex-1 truncate">{label}</span>

      {/* 左：运行 / 重新运行（恒在左，激活即原地替换） */}
      <button
        type="button"
        title={running ? '重新运行' : '运行'}
        className={cn(
          BTN,
          running
            ? 'bg-[var(--run-active-bg)] text-white hover:bg-[var(--run-active-bg-hover)]'
            : cn('text-[var(--run-glyph)]', btnHover, idleVis)
        )}
        onClick={(e) => {
          e.stopPropagation()
          onAction?.()
          run(target, rkey, projectPath)
        }}
      >
        {running ? <RotateCw className="size-4" /> : <Play className="size-4" />}
      </button>

      {/* 右：空闲=更多菜单（仅配置）/ 运行中=停止 */}
      {running ? (
        <button
          type="button"
          title="停止"
          className={cn(
            BTN,
            'bg-[var(--stop-active-bg)] text-white hover:bg-[var(--stop-active-bg-hover)]'
          )}
          onClick={(e) => {
            e.stopPropagation()
            stop(rkey)
          }}
        >
          <Square className="size-4" />
        </button>
      ) : (
        config && (
          <MoreMenu
            config={config}
            baseClass={cn(BTN, 'text-muted-foreground hover:text-[color:var(--fg-icon)]', btnHover)}
            idleVis={idleVis}
          />
        )
      )}
    </>
  )

  const rowClass = cn(
    ROW,
    selected
      ? 'bg-[var(--selection-row)]'
      : isDragging
        ? 'bg-[var(--bg-row-hover)]'
        : 'hover:bg-[var(--bg-row-hover)]'
  )
  const onRowClick = (): void => {
    onAction?.()
    // 探测脚本选中即晋升进「我的配置」，不必等运行。
    if (target.type === 'script')
      selectScript(target.projectPath, target.source, target.name, rkey)
    else select(rkey, projectPath)
  }

  if (!config) {
    return (
      <div className={rowClass} onClick={onRowClick}>
        {row}
      </div>
    )
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger className={rowClass} onClick={onRowClick}>
        {row}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ConfigMenuItems config={config} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** 配置菜单项：⋮ 与右键共用（编辑仅命令型 / 删除）。 */
function ConfigMenuItems({ config }: { config: RunConfig }): React.JSX.Element {
  const openEditDialog = useApp((s) => s.openEditDialog)
  const deleteConfig = useApp((s) => s.deleteConfig)
  return (
    <>
      {config.kind === 'command' && (
        <DropdownMenuItem onClick={() => openEditDialog(config)}>
          <Pencil className="size-4" /> 编辑
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={() => deleteConfig(config.id)}>
        <Trash2 className="size-4" /> 删除
      </DropdownMenuItem>
    </>
  )
}

function MoreMenu({
  config,
  baseClass,
  idleVis
}: {
  config: RunConfig
  baseClass: string
  idleVis: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={(nextOpen) => setOpen(nextOpen)}>
      <DropdownMenuTrigger
        className={cn(baseClass, open ? 'flex' : idleVis)}
        title="更多"
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <MoreVertical className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <ConfigMenuItems config={config} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 项目菜单项：⋮ 与右键共用（打开文件夹 / 打开于 / 新建配置 / 新建终端 / 置顶 / 移除项目）。 */
function ProjectMenuItems({
  projectPath,
  pinned
}: {
  projectPath: string
  pinned: boolean
}): React.JSX.Element {
  const openCreateDialog = useApp((s) => s.openCreateDialog)
  const newTerminal = useApp((s) => s.newTerminal)
  const removeProject = useApp((s) => s.removeProject)
  const setProjectPinned = useApp((s) => s.setProjectPinned)
  const [openInApps, setOpenInApps] = useState<OpenInAppStatus[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.listOpenInApps().then((list) => {
      if (!cancelled) setOpenInApps(list)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const openInItems: OpenInAppStatus[] =
    openInApps ??
    OPEN_IN_APP_IDS.map((id) => ({
      id,
      label: OPEN_IN_APP_LABELS[id],
      available: false,
      unavailableReason: '检测中…'
    }))

  return (
    <>
      <DropdownMenuItem onClick={() => void window.api.openPath(projectPath)}>
        <FolderOpen className="size-4" /> 打开文件夹
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <SquareArrowOutUpRight className="size-4" /> 打开于
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {openInItems.map((app) => (
            <DropdownMenuItem
              key={app.id}
              disabled={!app.available}
              title={app.available ? undefined : app.unavailableReason}
              onClick={() => {
                if (!app.available) return
                void window.api.openInApp(app.id, projectPath).then((result) => {
                  if (!result.ok) console.warn(result.error)
                })
              }}
            >
              <img src={OPEN_IN_APP_ICONS[app.id]} alt="" className="size-4" />
              {app.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem onClick={() => void newTerminal(projectPath)}>
        <Terminal className="size-4" /> 新建终端
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => openCreateDialog(projectPath)}>
        <FilePlusCorner className="size-4" /> 新建配置
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => void setProjectPinned(projectPath, !pinned)}>
        {pinned ? (
          <>
            <PinOff className="size-4" /> 取消置顶
          </>
        ) : (
          <>
            <Pin className="size-4" /> 置顶
          </>
        )}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => removeProject(projectPath)}>
        <Trash2 className="size-4" /> 移除项目
      </DropdownMenuItem>
    </>
  )
}

function ProjectMoreMenu({
  projectPath,
  pinned,
  selected,
  forceVisible,
  onOpenChange
}: {
  projectPath: string
  pinned: boolean
  selected?: boolean
  /** 拖拽 / 菜单打开等：等同 hover，恒显 ⋮ */
  forceVisible?: boolean
  onOpenChange?: (open: boolean) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const showMore = open || !!forceVisible

  return (
    // 已置顶：Pin 与 ⋮ 同槽切换（hover/拖拽/打开菜单时换 ⋮），避免挤到旁边。
    <div className={cn('relative shrink-0', pinned && 'size-7')}>
      {pinned && (
        <span
          className={cn(
            'flex size-7 items-center justify-center text-muted-foreground',
            'group-hover:hidden',
            showMore && 'hidden'
          )}
          aria-label="已置顶"
        >
          <Pin className="size-3.5" />
        </span>
      )}
      <DropdownMenu
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          onOpenChange?.(nextOpen)
        }}
      >
        <DropdownMenuTrigger
          className={cn(
            BTN,
            pinned && 'absolute inset-0',
            'text-muted-foreground hover:text-[color:var(--fg-icon)]',
            // 选中（蓝底）行上的按钮 hover 用蓝色高亮，而非灰色。
            selected
              ? 'hover:bg-[var(--selection-row-hover)]'
              : 'hover:bg-[var(--bg-button-hover)]',
            showMore ? 'flex' : 'hidden group-hover:flex'
          )}
          title="更多"
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <MoreVertical className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <ProjectMenuItems projectPath={projectPath} pinned={pinned} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

const STATUS_COLOR: Record<SessionStatus | 'idle', string> = {
  idle: 'var(--status-idle)',
  running: 'var(--status-running)',
  exited: 'var(--status-success)',
  failed: 'var(--status-failed)'
}

function StatusDot({ status }: { status: SessionStatus | 'idle' }): React.JSX.Element {
  return (
    <span
      className="size-2 shrink-0 rounded-full transition-colors"
      style={{ background: STATUS_COLOR[status] }}
    />
  )
}
