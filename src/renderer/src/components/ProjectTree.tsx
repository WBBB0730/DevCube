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
  AppWindow,
  Database,
  FilePlusCorner,
  Folder,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  RotateCw,
  Search,
  Server as ServerIcon,
  Square,
  Terminal,
  Trash2
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
  ProjectSortMode,
  ProjectSortPrefs,
  RunConfig,
  RunTarget,
  SessionState,
  SessionStatus
} from '@shared/types'
import { serverTargetLabel, type ServerNode } from '@shared/server'
import { dataSourceTargetLabel, type DataSourceNode } from '@shared/data-source'
import {
  buildTreeEntries,
  configOwnerKey,
  dataSourceEntryKey,
  entryItem,
  serverEntryKey,
  type TreeEntry
} from '@shared/tree-entry'
import {
  DISCOVER_SOURCE_LABELS,
  DISCOVER_SOURCE_ORDER,
  type DiscoverSource
} from '@shared/discover-source'
import { configKey, scriptKey } from '@shared/runnable'
import { filterTreeEntries, sortTreeEntries } from '@shared/project-sort'
import { SHORTCUT } from '@shared/shortcut-label'
import { useDoubleClick } from '@renderer/lib/double-click'
import { shortcutLabel, shortcutTitle } from '@renderer/lib/shortcut-label'
import { treeStickyLayout } from '@renderer/lib/tree-sticky'
import { typeToInput } from '@renderer/lib/type-to-input'
import { cn } from '@renderer/lib/utils'
import { BAR_INPUT_ICON, BarInput } from '@renderer/components/ui/bar-input'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { OPEN_IN_APP_ICONS } from '@renderer/assets/open-in'
import { OPEN_IN_APP_IDS, OPEN_IN_APP_LABELS, type OpenInAppStatus } from '@shared/open-in-app'
import { useApp } from '@renderer/store'
import { ConnectSubmenu } from '@renderer/components/ConnectSubmenu'

// 所有行统一固定高 + 圆角。四周内边距 6px：px-1.5 各 6px，
// h-10(40px) 让 size-7(28px) 按钮上下各留 6px；固定高避免 hover 出按钮时整行跳动。
const ROW =
  'group flex h-10 cursor-pointer items-center gap-1.5 rounded px-1.5 text-[14px] transition-colors'
const BTN = 'flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors'
/** 条目行高（与 ROW 的 h-10 一致），供吸顶叠放 top / scroll-margin。 */
const PROJECT_ROW_H = 40
/** 钉住行之间的间隙；须用不透明底填满，避免配置文字从缝里透出。 */
const PIN_STICKY_GAP = 1
/** 吸顶位置（treeStickyLayout 的 slot）→ top：其前每个钉住行占一行加间隙。 */
const stickySlotTop = (slot: number): number => slot * (PROJECT_ROW_H + PIN_STICKY_GAP)
/** 吸顶时画在行下的 1px 不透明缝（不占布局，配合 stickySlotTop 的空档）。 */
const PIN_STICKY_SEAM: CSSProperties = {
  boxShadow: `0 ${PIN_STICKY_GAP}px 0 0 var(--bg-panel)`
}
/** 常驻吸顶 z：低于置顶叠放（20+），高于普通段吸顶（15）。 */
const PERSIST_STICKY_Z = 19

/**
 * sticky 标题在视口内时对其 scrollIntoView 不会动（已可见）。
 * 已滚过段起点：滚非 sticky 段锚 + start（scroll-margin-top 预留吸顶高度；对齐 Git 段头）。
 * 否则：对标题行 nearest（已在视口不动，裁切才微滚）。
 */
function scrollEntryIntoView(list: HTMLElement, key: string): void {
  const esc = globalThis.CSS.escape(key)
  const anchor = list.querySelector(`[data-entry-scroll-anchor="${esc}"]`) as HTMLElement | null
  const row = list.querySelector(`[data-entry-key="${esc}"]`) as HTMLElement | null
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
  const servers = useApp((s) => s.servers)
  const dataSources = useApp((s) => s.dataSources)
  const projectSortPrefs = useApp((s) => s.projectSortPrefs)
  const projectFilter = useApp((s) => s.projectFilter)
  const setProjectFilter = useApp((s) => s.setProjectFilter)
  const projectFilterFocusNonce = useApp((s) => s.projectFilterFocusNonce)
  const cycleSortMode = useApp((s) => s.cycleSortMode)
  const setSortPrefs = useApp((s) => s.setSortPrefs)
  const pinSticky = projectSortPrefs.pinSticky
  const reorderEntries = useApp((s) => s.reorderEntries)
  const addProject = useApp((s) => s.addProject)
  const addProjectByPath = useApp((s) => s.addProjectByPath)
  const createProject = useApp((s) => s.createProject)
  const setCloneDialogOpen = useApp((s) => s.setCloneDialogOpen)
  const openConnectionDialog = useApp((s) => s.openConnectionDialog)

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
  const restoreRef = useRef<{ key: string; clientTop: number } | null>(null)
  /** 条目拖拽中：当前项键，及同 Pin 组在列表内容坐标系下的 [top,bottom]（随收起/滚动重测）。 */
  const draggingKeyRef = useRef<string | null>(null)
  const dragGroupClampRef = useRef<{ top: number; bottom: number } | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  // 全部条目按当前规则排好（拖拽落盘用：按类型筛掉的条目也要保住相对位置）；可见的再按类型 / 名称筛。
  const sorted = useMemo(
    () => sortTreeEntries(buildTreeEntries(tree, servers, dataSources), projectSortPrefs),
    [tree, servers, dataSources, projectSortPrefs]
  )
  const filtered = filterTreeEntries(sorted, projectFilter, projectSortPrefs)
  const pinnedEntries = useMemo(() => filtered.filter((e) => entryItem(e).pinned), [filtered])
  const unpinnedEntries = useMemo(() => filtered.filter((e) => !entryItem(e).pinned), [filtered])
  const pinnedKeySet = useMemo(() => new Set(pinnedEntries.map((e) => e.key)), [pinnedEntries])
  // 碰撞只认同 Pin 组，拖拽过程中就不能跨界让位。
  const pinSealedCollision: CollisionDetection = useCallback(
    (args) => {
      const activePinned = pinnedKeySet.has(String(args.active.id))
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter(
          (c) => pinnedKeySet.has(String(c.id)) === activePinned
        )
      })
    },
    [pinnedKeySet]
  )

  /** 量同 Pin 组在列表内容坐标系中的纵向范围，供拖拽限位（与列表边缘限位同理）。 */
  const measurePinGroupClamp = useCallback(
    (activeKey: string): void => {
      const list = listRef.current
      if (!list) {
        dragGroupClampRef.current = null
        return
      }
      const activePinned = pinnedKeySet.has(activeKey)
      const scrollTop = list.scrollTop
      const listR = list.getBoundingClientRect()
      let top = Infinity
      let bottom = -Infinity
      const seen = new Set<string>()
      for (const node of list.querySelectorAll('[data-entry-key]')) {
        const key = node.getAttribute('data-entry-key')
        if (!key || seen.has(key) || pinnedKeySet.has(key) !== activePinned) continue
        seen.add(key)
        const r = (node as HTMLElement).getBoundingClientRect()
        top = Math.min(top, r.top - listR.top + scrollTop)
        bottom = Math.max(bottom, r.bottom - listR.top + scrollTop)
      }
      dragGroupClampRef.current = Number.isFinite(top) ? { top, bottom } : null
    },
    [pinnedKeySet]
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
  const currentEntryKey = useApp((s) => s.currentEntryKey)
  const sessions = useApp((s) => s.sessions)
  const scrollToEntryKey = useApp((s) => s.scrollToEntryKey)
  const clearScrollToEntryKey = useApp((s) => s.clearScrollToEntryKey)
  // 展开态提到父级：置顶供标题/配置区共用；未置顶避免常驻与否切换结构时丢折叠。
  const [pinnedOpen, setPinnedOpen] = useState<Record<string, boolean>>({})
  const [unpinnedOpen, setUnpinnedOpen] = useState<Record<string, boolean>>({})
  const isPinnedExpanded = (key: string): boolean => !forceCollapsed && pinnedOpen[key] !== false
  const togglePinnedOpen = (key: string): void => {
    setPinnedOpen((prev) => ({ ...prev, [key]: !(prev[key] !== false) }))
  }
  const isUnpinnedOpen = (key: string): boolean => unpinnedOpen[key] !== false
  const toggleUnpinnedOpen = (key: string): void => {
    setUnpinnedOpen((prev) => ({ ...prev, [key]: !(prev[key] !== false) }))
  }

  // 打开时间排序：等 touch 回写、当前项已排到本组最前之后，再滚入视口（有 Pin 时不滚到列表顶）。
  useLayoutEffect(() => {
    if (projectSortPrefs.mode !== 'lastOpenedAt' || !currentEntryKey) return
    const idx = filtered.findIndex((e) => e.key === currentEntryKey)
    if (idx < 0) return
    const pinned = entryItem(filtered[idx]).pinned
    const firstInGroup = filtered.findIndex((e) => entryItem(e).pinned === pinned)
    if (idx !== firstInGroup) return
    const list = listRef.current
    if (!list) return
    if (
      list.querySelector(`[data-entry-scroll-anchor="${globalThis.CSS.escape(currentEntryKey)}"]`)
    ) {
      scrollEntryIntoView(list, currentEntryKey)
    } else {
      list
        .querySelector(`[data-entry-key="${globalThis.CSS.escape(currentEntryKey)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    }
  }, [projectSortPrefs.mode, currentEntryKey, filtered])

  // 添加条目后：把目标行滚进视口（已可见则不动；吸顶项走非 sticky 锚 + scrollIntoView）。
  useLayoutEffect(() => {
    if (!scrollToEntryKey) return
    const list = listRef.current
    if (list) {
      const el = list.querySelector(
        `[data-entry-scroll-anchor="${globalThis.CSS.escape(scrollToEntryKey)}"]`
      )
      if (el) scrollEntryIntoView(list, scrollToEntryKey)
      else {
        list
          .querySelector(`[data-entry-key="${globalThis.CSS.escape(scrollToEntryKey)}"]`)
          ?.scrollIntoView({ block: 'nearest' })
      }
    }
    clearScrollToEntryKey()
  }, [scrollToEntryKey, filtered, pinnedKeySet, clearScrollToEntryKey])

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
      const item = list.querySelector('[data-dragging-entry]') as HTMLElement | null
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
      if (draggingKeyRef.current) measurePinGroupClamp(draggingKeyRef.current)
      return
    }

    // 展开后：仅用 scrollTop 尽量把被拖项拉回松手前的视口位置（浏览器钳制即「尽量」）。
    const restore = restoreRef.current
    if (!restore) return
    restoreRef.current = null
    const item = list.querySelector(
      `[data-entry-key="${globalThis.CSS.escape(restore.key)}"]`
    ) as HTMLElement | null
    if (!item) return
    list.scrollTop += item.getBoundingClientRect().top - restore.clientTop
  }, [forceCollapsed, filtered, measurePinGroupClamp])

  const clearCollapsePad = (): void => {
    setForceCollapsed(false)
    collapseAnchorRef.current = null
    collapsePadRef.current = 0
    lastScrollTopRef.current = 0
    draggingKeyRef.current = null
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
      if (draggingKeyRef.current) measurePinGroupClamp(draggingKeyRef.current)
    }
    lastScrollTopRef.current = list.scrollTop
  }

  const handleEntryDragStart = (e: DragStartEvent): void => {
    const list = listRef.current
    const key = e.active.id as string
    draggingKeyRef.current = key
    const item = list?.querySelector(
      `[data-entry-key="${globalThis.CSS.escape(key)}"]`
    ) as HTMLElement | null
    // 用视口 Y（非 offsetTop）：吸顶卡住时布局位置≠所见位置；收起后 sticky 会关掉，再靠 pad 对齐所见。
    collapseAnchorRef.current =
      item && list ? item.getBoundingClientRect().top - list.getBoundingClientRect().top : null
    setForceCollapsed(true)
  }

  /** 松手前记下被拖项视口 top（含 transform），展开后用 scrollTop 尽量还原。 */
  const captureRestoreAnchor = (key: string): void => {
    const list = listRef.current
    const item = list?.querySelector(
      `[data-entry-key="${globalThis.CSS.escape(key)}"]`
    ) as HTMLElement | null
    if (item) restoreRef.current = { key, clientTop: item.getBoundingClientRect().top }
  }

  const handleEntryDragEnd = (e: DragEndEvent): void => {
    const key = e.active.id as string
    captureRestoreAnchor(key)
    clearCollapsePad()
    const { active, over } = e
    if (!over || active.id === over.id) return
    const activePinned = pinnedKeySet.has(String(active.id))
    const overPinned = pinnedKeySet.has(String(over.id))
    // Pin 边界密封：跨区不落盘（碰撞层已限制，这里再兜底）。
    if (activePinned !== overPinned) return
    // 在全部条目的当前视觉序里挪位：按类型筛掉的条目保留各自相对位置。
    const keys = sorted.map((entry) => entry.key)
    const from = keys.indexOf(String(active.id))
    const to = keys.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    const next = arrayMove(keys, from, to)
    // 非自定义下拖成新序：先切到自定义，再按当前视觉序落盘。
    if (projectSortPrefs.mode !== 'custom') void cycleSortMode('custom')
    void reorderEntries(next)
  }

  const handleEntryDragCancel = (): void => {
    const list = listRef.current
    const item = list?.querySelector('[data-dragging-entry]') as HTMLElement | null
    const key = item?.getAttribute('data-entry-key')
    if (key) captureRestoreAnchor(key)
    clearCollapsePad()
  }

  const emptyMessage =
    tree.length === 0 && servers.length === 0 && dataSources.length === 0
      ? '拖入文件夹，或点上方 + 新建 / 添加项目、服务器或数据源'
      : '无匹配项'

  // 常驻吸顶（滚过自身后钉住，再往下也不走）：当前条目，及「固定运行中」开时有配置在运行的条目。
  // 常驻与否不看展开态：拖拽开始全部收起时结构不变，被拖项才钉得住。
  // 吸顶位置 = 排在其前的钉住行数（见 treeStickyLayout）：
  // - 未置顶常驻：摊平钉在其前的钉住行下；仅「排在其后」的段顶随之下移（其前不动，避免空一截）
  // - 已置顶 + 固定置顶开：已在叠放堆里，不再叠
  // - 已置顶 + 固定置顶关：摊平钉住；其后置顶段 / 全部未置顶再让一行
  const runningSticky = projectSortPrefs.runningSticky
  const sticky = treeStickyLayout(
    filtered.map((entry) => ({
      key: entry.key,
      pinned: entryItem(entry).pinned,
      persist:
        entry.key === currentEntryKey ||
        (runningSticky && hasRunningConfig(entry.node.configs, sessions))
    })),
    pinSticky
  )

  // 固定置顶开：标题摊平为列表直接子节点，才能跨整表叠放吸顶。
  // 关：每项包进段容器，sticky 只在本段内有效，下一段会把上一段顶走（而不是盖住）。
  // 置顶且需常驻时：即使关叠放也摊平。
  const pinnedRows = pinnedEntries.map((entry, pinStackIndex) => {
    const path = entry.key
    const expanded = isPinnedExpanded(path)
    const bodyVisible = expanded && entryHasBody(entry)
    const { persist, slot } = sticky.get(path)!
    const flatten = pinSticky || persist
    const headerStickTop = stickySlotTop(slot)
    const gapClass = bodyVisible ? undefined : 'mb-3'
    const scrollIntoPlace = (): void => {
      const list = listRef.current
      if (list) scrollEntryIntoView(list, path)
    }
    const headerStick =
      !pinSticky || persist
        ? {
            stickTop: headerStickTop,
            stickSeam: persist || pinSticky,
            stickZIndex: persist ? PERSIST_STICKY_Z : undefined
          }
        : {}
    const block = (
      <>
        {/* 段起点锚（0 高、非 sticky）：点吸顶标题经它 scrollIntoView——标题已在视口时直接滚它不动。 */}
        <div
          data-entry-scroll-anchor={path}
          aria-hidden
          style={{ scrollMarginTop: headerStickTop }}
        />
        {canDrag ? (
          <SortableEntryHeader
            entry={entry}
            expanded={expanded}
            pinStackIndex={pinStackIndex}
            forceCollapsed={forceCollapsed}
            pinSticky={pinSticky}
            {...headerStick}
            className={flatten ? gapClass : undefined}
            onScrollIntoPlace={scrollIntoPlace}
            onToggleExpand={() => togglePinnedOpen(path)}
          />
        ) : (
          <EntryHeader
            entry={entry}
            expanded={expanded}
            pinStackIndex={pinStackIndex}
            pinSticky={pinSticky}
            className={flatten ? gapClass : undefined}
            style={
              flatten || !pinSticky
                ? forceCollapsed
                  ? { position: 'relative' }
                  : {
                      position: 'sticky',
                      top: headerStickTop,
                      zIndex: persist ? PERSIST_STICKY_Z : pinSticky ? 20 + pinStackIndex : 15,
                      ...(persist || pinSticky ? PIN_STICKY_SEAM : {})
                    }
                : undefined
            }
            onScrollIntoPlace={scrollIntoPlace}
            onToggleExpand={() => togglePinnedOpen(path)}
          />
        )}
        <PinnedEntryBody
          entry={entry}
          expanded={expanded}
          className={flatten ? 'mb-3' : undefined}
        />
      </>
    )
    if (flatten) {
      return <Fragment key={path}>{block}</Fragment>
    }
    return (
      <div key={path} className={cn('relative', gapClass ?? 'mb-3')}>
        {block}
      </div>
    )
  })

  const unpinnedRows = unpinnedEntries.map((entry) => {
    const path = entry.key
    const scrollIntoPlace = (): void => {
      const list = listRef.current
      if (list) scrollEntryIntoView(list, path)
    }
    const open = isUnpinnedOpen(path)
    const onToggleOpen = (): void => toggleUnpinnedOpen(path)
    const { persist, slot } = sticky.get(path)!
    const stickyTop = stickySlotTop(slot)
    if (persist) {
      return (
        <PersistentUnpinnedEntry
          key={path}
          entry={entry}
          forceCollapsed={forceCollapsed}
          stickTop={stickyTop}
          canDrag={canDrag}
          open={open}
          onToggleOpen={onToggleOpen}
          onScrollIntoPlace={scrollIntoPlace}
        />
      )
    }
    return canDrag ? (
      <SortableEntryRow
        key={path}
        entry={entry}
        forceCollapsed={forceCollapsed}
        stickyTop={stickyTop}
        open={open}
        onToggleOpen={onToggleOpen}
        className="mb-3"
        onScrollIntoPlace={scrollIntoPlace}
      />
    ) : (
      <EntryRow
        key={path}
        entry={entry}
        forceCollapsed={forceCollapsed}
        stickyTop={forceCollapsed ? null : stickyTop}
        open={open}
        onToggleOpen={onToggleOpen}
        className="mb-3"
        onScrollIntoPlace={scrollIntoPlace}
      />
    )
  })

  const filterHint = shortcutTitle('按名称筛选', SHORTCUT.projectFilter)

  return (
    <div
      data-project-tree=""
      className="flex h-full flex-col bg-panel"
      onDragOver={(e) => e.preventDefault()}
      onDrop={async (e) => {
        e.preventDefault()
        for (const file of Array.from(e.dataTransfer.files)) {
          await addProjectByPath(window.drop.getPathForFile(file))
        }
      }}
    >
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--separator)] px-1.5 text-muted-foreground">
        <BarInput
          ref={filterInputRef}
          value={projectFilter}
          onChange={setProjectFilter}
          escapeFocusRef={listRef}
          leading={<Search className={BAR_INPUT_ICON} />}
          title={filterHint}
          placeholder={filterHint}
        />
        <div className="flex shrink-0 items-center gap-0.5">
          <SortMenu
            prefs={projectSortPrefs}
            onSelect={cycleSortMode}
            onPrefsChange={setSortPrefs}
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              title="新建 / 添加项目、服务器或数据源"
              className={cn(
                BTN,
                'text-muted-foreground hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]'
              )}
            >
              <FolderPlus className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={createProject}>新建空项目…</DropdownMenuItem>
              <DropdownMenuItem onClick={addProject}>添加现有项目…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCloneDialogOpen(true)}>
                从 Git 仓库克隆…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => openConnectionDialog({ kind: 'server' })}>
                添加服务器…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openConnectionDialog({ kind: 'dataSource' })}>
                添加数据源…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div
        ref={listRef}
        tabIndex={0}
        title={`切换项目、服务器或数据源 (${shortcutLabel(SHORTCUT.prevProject)} / ${shortcutLabel(SHORTCUT.nextProject)})`}
        className="min-h-0 flex-1 overflow-auto px-1.5 pb-1.5 outline-none"
        onScroll={forceCollapsed ? handleListScroll : undefined}
        // 焦点在列表上打字转进顶上的筛选
        onKeyDown={(e) =>
          typeToInput(e, {
            query: projectFilter,
            inputRef: filterInputRef,
            onChange: setProjectFilter,
            onClear: () => setProjectFilter('')
          })
        }
      >
        {filtered.length === 0 ? (
          <div className="flex h-full min-h-full items-center justify-center px-3 pb-10 text-[13px] text-muted-foreground">
            {emptyMessage}
          </div>
        ) : canDrag ? (
          <DndContext
            sensors={sensors}
            collisionDetection={pinSealedCollision}
            modifiers={[restrictToVerticalWithinPinGroup]}
            onDragStart={handleEntryDragStart}
            onDragEnd={handleEntryDragEnd}
            onDragCancel={handleEntryDragCancel}
          >
            <div ref={listContentRef} className="relative [&>*:last-child]:mb-0">
              <SortableContext
                items={pinnedEntries.map((e) => e.key)}
                strategy={verticalListSortingStrategy}
              >
                {pinnedRows}
              </SortableContext>
              <SortableContext
                items={unpinnedEntries.map((e) => e.key)}
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
  prefs,
  onSelect,
  onPrefsChange
}: {
  prefs: ProjectSortPrefs
  onSelect: (mode: ProjectSortMode) => void
  onPrefsChange: (
    patch: Partial<
      Pick<
        ProjectSortPrefs,
        'pinSticky' | 'runningSticky' | 'showProjects' | 'showServers' | 'showDataSources'
      >
    >
  ) => void
}): React.JSX.Element {
  const { mode, direction, pinSticky, runningSticky, showProjects, showServers, showDataSources } =
    prefs
  // 按类型显示：至少保留一类，剩下的那项不能再取消
  const kinds = [
    {
      label: '项目',
      checked: showProjects,
      onCheckedChange: (on: boolean) => onPrefsChange({ showProjects: on })
    },
    {
      label: '服务器',
      checked: showServers,
      onCheckedChange: (on: boolean) => onPrefsChange({ showServers: on })
    },
    {
      label: '数据源',
      checked: showDataSources,
      onCheckedChange: (on: boolean) => onPrefsChange({ showDataSources: on })
    }
  ]
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
          // 不关菜单：再点当前项会切换升降序，留着菜单能直接看到方向变化
          return (
            <DropdownMenuItem
              key={opt.mode}
              closeOnClick={false}
              onClick={() => onSelect(opt.mode)}
            >
              <span className="flex size-3.5 shrink-0 items-center justify-center">
                {active && <SortActiveIcon mode={opt.mode} direction={direction} />}
              </span>
              <span className="flex-1">{opt.label}</span>
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={pinSticky}
          onCheckedChange={(on) => onPrefsChange({ pinSticky: on })}
        >
          固定置顶
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={runningSticky}
          onCheckedChange={(on) => onPrefsChange({ runningSticky: on })}
        >
          固定运行中
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {kinds.map((kind) => {
          const last = kind.checked && kinds.filter((k) => k.checked).length === 1
          return (
            <DropdownMenuCheckboxItem
              key={kind.label}
              checked={kind.checked}
              onCheckedChange={kind.onCheckedChange}
              disabled={last}
              title={last ? '至少显示一类' : undefined}
            >
              {kind.label}
            </DropdownMenuCheckboxItem>
          )
        })}
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

/** 条目下是否有配置在运行。 */
function hasRunningConfig(configs: RunConfig[], sessions: Record<string, SessionState>): boolean {
  return configs.some((c) => sessions[configKey(c)]?.status === 'running')
}

/** 条目是否有可展开的配置区：Project 有配置或检测到的配置，Server、Data Source 有配置。 */
function entryHasBody(entry: TreeEntry): boolean {
  return (
    entry.node.configs.length > 0 || (entry.kind === 'project' && entry.node.discovered.length > 0)
  )
}

function SortableEntryHeader({
  entry,
  expanded,
  pinStackIndex,
  forceCollapsed,
  pinSticky,
  stickTop,
  stickSeam,
  stickZIndex,
  className,
  onScrollIntoPlace,
  onToggleExpand
}: {
  entry: TreeEntry
  expanded: boolean
  pinStackIndex: number
  /** 拖拽收起补偿期间关掉 sticky，避免与 padding 补偿抢位置 */
  forceCollapsed: boolean
  pinSticky: boolean
  /** 覆盖默认 top（段吸顶 / 常驻）。 */
  stickTop?: number
  stickSeam?: boolean
  stickZIndex?: number
  className?: string
  onScrollIntoPlace: () => void
  onToggleExpand: () => void
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.key
  })
  // 拖拽中所有项都要吃 transform（让位动画）。
  // 收起补偿期间关掉 sticky。偏好开：叠放吸顶；关：段内吸顶（下一段顶走上一段，不覆盖）。
  const sorting = transform !== null
  const stick = !forceCollapsed && !sorting
  const override = stickTop != null
  const style: CSSProperties = {
    transform: DndCSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
    // 叠放时按序抬高 z；段吸顶用同一 z，避免后一段盖住前一段被顶走的过程。
    zIndex: isDragging ? 40 : sorting ? 10 : (stickZIndex ?? (pinSticky ? 20 + pinStackIndex : 15)),
    ...(stick
      ? override
        ? {
            position: 'sticky',
            top: stickTop,
            ...(stickSeam ? PIN_STICKY_SEAM : {})
          }
        : pinSticky
          ? { position: 'sticky', top: stickySlotTop(pinStackIndex), ...PIN_STICKY_SEAM }
          : { position: 'sticky', top: 0 }
      : { position: 'relative' })
  }
  return (
    <EntryHeader
      ref={setNodeRef}
      entry={entry}
      expanded={expanded}
      pinStackIndex={pinStackIndex}
      pinSticky={pinSticky}
      className={className}
      style={style}
      dataEntryKey={entry.key}
      isDragging={isDragging}
      onScrollIntoPlace={onScrollIntoPlace}
      onToggleExpand={onToggleExpand}
      dragHandleProps={{ ...attributes, ...listeners }}
    />
  )
}

/**
 * 常驻的未置顶条目：标题摊平为列表直接子节点，钉在其前的钉住行下，滚过其它条目仍保持可见。
 * 写法对齐固定置顶（Header + Body 兄弟，勿包进段容器）。展开态由父级托管。
 */
function PersistentUnpinnedEntry({
  entry,
  forceCollapsed,
  stickTop,
  canDrag,
  open,
  onToggleOpen,
  onScrollIntoPlace
}: {
  entry: TreeEntry
  forceCollapsed: boolean
  stickTop: number
  canDrag: boolean
  open: boolean
  onToggleOpen: () => void
  onScrollIntoPlace: () => void
}): React.JSX.Element {
  const expanded = open && !forceCollapsed
  const bodyVisible = expanded && entryHasBody(entry)
  const gapClass = bodyVisible ? undefined : 'mb-3'
  const headerStyle: CSSProperties = {
    position: 'sticky',
    top: stickTop,
    zIndex: PERSIST_STICKY_Z,
    ...PIN_STICKY_SEAM
  }

  return (
    <>
      <div data-entry-scroll-anchor={entry.key} aria-hidden style={{ scrollMarginTop: stickTop }} />
      {canDrag ? (
        <SortableEntryHeader
          entry={entry}
          expanded={expanded}
          pinStackIndex={0}
          forceCollapsed={forceCollapsed}
          pinSticky={false}
          stickTop={stickTop}
          stickSeam
          stickZIndex={PERSIST_STICKY_Z}
          className={gapClass}
          onScrollIntoPlace={onScrollIntoPlace}
          onToggleExpand={onToggleOpen}
        />
      ) : (
        <EntryHeader
          entry={entry}
          expanded={expanded}
          pinStackIndex={0}
          pinSticky={false}
          className={gapClass}
          style={forceCollapsed ? { position: 'relative' } : headerStyle}
          onScrollIntoPlace={onScrollIntoPlace}
          onToggleExpand={onToggleOpen}
        />
      )}
      <PinnedEntryBody entry={entry} expanded={expanded} className="mb-3" />
    </>
  )
}

/** 条目行内容（折叠箭头 / 图标 / 名称 / 角标 / 更多），三类条目共用。 */
function EntryRowContent({
  entry,
  expanded,
  isCurrent,
  selected,
  rowHoverLike,
  forceMoreVisible,
  onToggleExpand,
  onMoreOpenChange
}: {
  entry: TreeEntry
  expanded: boolean
  isCurrent: boolean
  selected: boolean
  rowHoverLike: boolean
  forceMoreVisible: boolean
  onToggleExpand: () => void
  onMoreOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const item = entryItem(entry)
  const hasRunning = useApp((s) => hasRunningConfig(entry.node.configs, s.sessions))
  return (
    <>
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
      <EntryIcon entry={entry} />
      <span
        className={cn('min-w-0 flex-1 truncate', isCurrent && 'font-semibold')}
        title={entryTargetLabel(entry)}
      >
        {item.name}
      </span>
      {/* 有配置在运行（与配置行同款状态点）：仅吸顶中显示（配置已滚走），hover 与角标同样让位；
          进出淡入淡出（display 离散过渡 + 起始样式）。放在角标之前，出现 / 消失不推动角标。 */}
      <span
        className={cn(
          'hidden shrink-0 opacity-0 transition-[opacity,display] transition-discrete',
          hasRunning &&
            !rowHoverLike &&
            'stuck:not-group-hover:flex stuck:not-group-hover:opacity-100 stuck:not-group-hover:starting:opacity-0'
        )}
      >
        <StatusDot status="running" />
      </span>
      {entry.kind === 'project' &&
        entry.node.packageManager &&
        entry.node.packageManager !== 'pnpm' && (
          <span
            className={cn(
              'text-[12px] text-muted-foreground group-hover:hidden',
              rowHoverLike && 'hidden'
            )}
          >
            {entry.node.packageManager}
          </span>
        )}
      <EntryMoreMenu
        entry={entry}
        pinned={item.pinned}
        selected={selected}
        forceVisible={forceMoreVisible}
        onOpenChange={onMoreOpenChange}
      />
    </>
  )
}

/** 条目行图标：项目为文件夹（链接工作树换 FolderGit2），服务器为 Server，数据源为 Database。 */
function EntryIcon({ entry }: { entry: TreeEntry }): React.JSX.Element {
  switch (entry.kind) {
    case 'project':
      return <ProjectFolderIcon worktreeOf={entry.node.worktreeOf} />
    case 'server':
      return <ServerIcon className="size-4 shrink-0 text-muted-foreground" />
    case 'dataSource':
      return <Database className="size-4 shrink-0 text-muted-foreground" />
  }
}

/** 条目名 hover 显示的连接目标（项目不显示）。 */
function entryTargetLabel(entry: TreeEntry): string | undefined {
  if (entry.kind === 'server') return serverTargetLabel(entry.node.server.target)
  if (entry.kind === 'dataSource') return dataSourceTargetLabel(entry.node.dataSource.target)
  return undefined
}

/** 置顶区条目行标题；sticky 叠放，须为列表容器的直接子节点。 */
function EntryHeader({
  ref,
  entry,
  expanded,
  pinStackIndex,
  pinSticky,
  className,
  style,
  dataEntryKey,
  isDragging,
  onScrollIntoPlace,
  onToggleExpand,
  dragHandleProps
}: {
  ref?: React.Ref<HTMLDivElement>
  entry: TreeEntry
  expanded: boolean
  pinStackIndex: number
  pinSticky: boolean
  className?: string
  style?: CSSProperties
  dataEntryKey?: string
  isDragging?: boolean
  onScrollIntoPlace: () => void
  onToggleExpand: () => void
  dragHandleProps?: HTMLAttributes<HTMLDivElement>
}): React.JSX.Element {
  const selectEntry = useApp((s) => s.selectEntry)
  const isCurrent = useApp((s) => s.currentEntryKey === entry.key)
  // 蓝底仅当「条目本身」被选中（无配置选中）；当前条目另用浅底 + 加粗名标示。
  const selected = useApp((s) => s.currentEntryKey === entry.key && s.selectedKey === null)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  // 菜单开着时指针已离行，`:hover` 会丢；保持与 hover 相同的行底 / ⋮ 可见性。
  const rowHoverLike = !!isDragging || contextMenuOpen || moreMenuOpen
  const isDoubleClick = useDoubleClick()
  const stickyStyle: CSSProperties = style ?? {
    position: 'sticky',
    top: pinSticky ? stickySlotTop(pinStackIndex) : 0,
    zIndex: pinSticky ? 20 + pinStackIndex : 15,
    ...(pinSticky ? PIN_STICKY_SEAM : {})
  }

  // ContextMenu.Root 不渲染 DOM，Trigger 仍是列表的直接子节点，sticky 叠放不受影响。
  return (
    <ContextMenu onOpenChange={setContextMenuOpen}>
      <ContextMenuTrigger
        ref={ref}
        style={stickyStyle}
        data-entry-key={dataEntryKey ?? entry.key}
        {...(isDragging ? { 'data-dragging-entry': '' } : {})}
        className={cn(
          ROW,
          'select-none bg-panel text-foreground [container-type:scroll-state]',
          selected
            ? 'bg-[var(--selection-row)]'
            : rowHoverLike || isCurrent
              ? 'bg-[var(--bg-row-hover)]'
              : 'hover:bg-[var(--bg-row-hover)]',
          className
        )}
        {...dragHandleProps}
        onClick={(e) => {
          dragHandleProps?.onClick?.(e)
          selectEntry(entry.key)
          onScrollIntoPlace()
          if (isDoubleClick(e)) onToggleExpand()
        }}
      >
        <EntryRowContent
          entry={entry}
          expanded={expanded}
          isCurrent={isCurrent}
          selected={selected}
          rowHoverLike={rowHoverLike}
          forceMoreVisible={!!isDragging || contextMenuOpen}
          onToggleExpand={onToggleExpand}
          onMoreOpenChange={setMoreMenuOpen}
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <EntryMenuItems entry={entry} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** 置顶条目的配置区（标题 sticky，此处为兄弟节点）。 */
function PinnedEntryBody({
  entry,
  expanded,
  className
}: {
  entry: TreeEntry
  expanded: boolean
  className?: string
}): React.JSX.Element | null {
  if (!expanded || !entryHasBody(entry)) return null

  return (
    <div className={cn('mt-0.5', className)}>
      <EntryConfigList entry={entry} />
    </div>
  )
}

function SortableEntryRow({
  entry,
  forceCollapsed,
  stickyTop,
  open,
  onToggleOpen,
  className,
  onScrollIntoPlace
}: {
  entry: TreeEntry
  forceCollapsed: boolean
  /** 未置顶段吸顶 top（其前的钉住行下方）；拖拽/收起补偿期间关掉。 */
  stickyTop: number
  open: boolean
  onToggleOpen: () => void
  className?: string
  onScrollIntoPlace: () => void
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.key
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
      data-entry-key={entry.key}
      {...(isDragging ? { 'data-dragging-entry': '' } : {})}
    >
      <EntryRow
        entry={entry}
        forceCollapsed={forceCollapsed}
        stickyTop={stick ? stickyTop : null}
        open={open}
        onToggleOpen={onToggleOpen}
        isDragging={isDragging}
        onScrollIntoPlace={onScrollIntoPlace}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  )
}

function EntryRow({
  entry,
  forceCollapsed,
  stickyTop,
  open,
  onToggleOpen,
  className,
  isDragging,
  onScrollIntoPlace,
  dragHandleProps
}: {
  entry: TreeEntry
  forceCollapsed: boolean
  /** 非 null 时条目行在本块内吸顶（贴在其前的钉住行下）。 */
  stickyTop?: number | null
  /** 由父级托管，避免与常驻摊平结构切换时丢折叠。 */
  open: boolean
  onToggleOpen: () => void
  className?: string
  isDragging?: boolean
  onScrollIntoPlace: () => void
  /** 条目拖拽句柄（仅挂在行头） */
  dragHandleProps?: HTMLAttributes<HTMLDivElement>
}): React.JSX.Element {
  const selectEntry = useApp((s) => s.selectEntry)
  const isCurrent = useApp((s) => s.currentEntryKey === entry.key)
  // 蓝底仅当「条目本身」被选中（无配置选中）；当前条目另用浅底 + 加粗名标示。
  const selected = useApp((s) => s.currentEntryKey === entry.key && s.selectedKey === null)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  // 菜单开着时指针已离行，`:hover` 会丢；保持与 hover 相同的行底 / ⋮ 可见性。
  const rowHoverLike = !!isDragging || contextMenuOpen || moreMenuOpen
  const isDoubleClick = useDoubleClick()

  const expanded = open && !forceCollapsed
  const headerSticky =
    stickyTop != null
      ? ({
          position: 'sticky',
          top: stickyTop,
          zIndex: 15
        } satisfies CSSProperties)
      : undefined

  return (
    <div data-entry-key={entry.key} className={className}>
      {/* 段起点锚：吸顶标题已在视口时须靠它 scrollIntoView。 */}
      <div
        data-entry-scroll-anchor={entry.key}
        aria-hidden
        style={{ scrollMarginTop: stickyTop ?? 0 }}
      />
      <ContextMenu onOpenChange={setContextMenuOpen}>
        <ContextMenuTrigger
          style={headerSticky}
          className={cn(
            ROW,
            'select-none bg-panel text-foreground [container-type:scroll-state]',
            selected
              ? 'bg-[var(--selection-row)]'
              : rowHoverLike || isCurrent
                ? 'bg-[var(--bg-row-hover)]'
                : 'hover:bg-[var(--bg-row-hover)]'
          )}
          {...dragHandleProps}
          onClick={(e) => {
            dragHandleProps?.onClick?.(e)
            selectEntry(entry.key)
            onScrollIntoPlace()
            if (isDoubleClick(e)) onToggleOpen()
          }}
        >
          <EntryRowContent
            entry={entry}
            expanded={expanded}
            isCurrent={isCurrent}
            selected={selected}
            rowHoverLike={rowHoverLike}
            forceMoreVisible={!!isDragging || contextMenuOpen}
            onToggleExpand={onToggleOpen}
            onMoreOpenChange={setMoreMenuOpen}
          />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <EntryMenuItems entry={entry} />
        </ContextMenuContent>
      </ContextMenu>
      {expanded && (
        <div className="mt-0.5">
          <EntryConfigList entry={entry} />
        </div>
      )}
    </div>
  )
}

/**
 * 项目行的文件夹图标：链接工作树项目换成 FolderGit2（术语见 CONTEXT.md「Worktree」），
 * hover 说明属于哪个主工作树；主工作树与普通项目仍是 Folder。
 */
function ProjectFolderIcon({ worktreeOf }: { worktreeOf: string | null }): React.JSX.Element {
  if (worktreeOf === null) return <Folder className="size-4 shrink-0 text-muted-foreground" />
  const mainName =
    worktreeOf
      .split(/[/\\]/)
      .filter((seg) => seg !== '')
      .pop() ?? worktreeOf
  return (
    <span title={`“${mainName}” 的工作树\n${worktreeOf}`} className="flex shrink-0 items-center">
      <FolderGit2 className="size-4 text-muted-foreground" />
    </span>
  )
}

/**
 * 条目下的配置列表（Project 另有「检测到的配置」；Server、Data Source 只有命令型）；
 * 配置拖拽父容器不含探测行，限位到配置区边缘。
 */
function EntryConfigList({ entry }: { entry: TreeEntry }): React.JSX.Element {
  const reorderConfigs = useApp((s) => s.reorderConfigs)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const configs: RunConfig[] = entry.node.configs
  const discovered = entry.kind === 'project' ? entry.node.discovered : []

  const handleDragEnd = (e: DragEndEvent): void => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = configs.map((c) => c.id)
    const from = ids.indexOf(active.id as string)
    const to = ids.indexOf(over.id as string)
    if (from < 0 || to < 0) return
    reorderConfigs(entry.key, arrayMove(ids, from, to))
  }

  return (
    <>
      {configs.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalWithinList]}
          onDragEnd={handleDragEnd}
        >
          {/* 单独包裹：restrictToParent 的父级不含「检测到的配置」 */}
          <div>
            <SortableContext
              items={configs.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              {configs.map((c) => (
                <SortableConfigRow key={c.id} config={c} />
              ))}
            </SortableContext>
          </div>
        </DndContext>
      )}
      {discovered.length > 0 && <DiscoveredMenu discovered={discovered} />}
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
                  entryKey={s.projectPath}
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
        entryKey={configOwnerKey(config)}
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
  entryKey,
  config,
  indent,
  isDragging,
  onAction
}: {
  label: string
  rkey: string
  target: RunTarget
  /** 所属左树条目（Project 路径、`server:<id>` 或 `datasource:<id>`） */
  entryKey: string
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
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  // 菜单开着时指针已离行，`:hover` 会丢；保持与 hover 相同的行底 / 按钮可见性。
  const rowHoverLike = !!isDragging || contextMenuOpen || moreMenuOpen
  // 选中蓝底行上的按钮 hover 用蓝色高亮，而非灰色。
  const btnHover = selected
    ? 'hover:bg-[var(--selection-row-hover)]'
    : 'hover:bg-[var(--bg-button-hover)]'
  // 空闲时按钮仅 hover / 选中 / 拖拽中 / 菜单打开才显示；运行中的重跑与停止恒显。
  const idleVis = selected || rowHoverLike ? 'flex' : 'hidden group-hover:flex'

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
          run(target, rkey, entryKey)
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
            onOpenChange={setMoreMenuOpen}
          />
        )
      )}
    </>
  )

  const rowClass = cn(
    ROW,
    selected
      ? 'bg-[var(--selection-row)]'
      : rowHoverLike
        ? 'bg-[var(--bg-row-hover)]'
        : 'hover:bg-[var(--bg-row-hover)]'
  )
  const onRowClick = (): void => {
    onAction?.()
    // 探测脚本选中即晋升进「我的配置」，不必等运行。
    if (target.type === 'script') selectScript(target.projectPath, target.source, target.name, rkey)
    else select(rkey, entryKey)
  }

  if (!config) {
    return (
      <div className={rowClass} onClick={onRowClick}>
        {row}
      </div>
    )
  }

  return (
    <ContextMenu onOpenChange={setContextMenuOpen}>
      <ContextMenuTrigger className={rowClass} onClick={onRowClick}>
        {row}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ConfigMenuItems config={config} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * 配置菜单项：⋮ 与右键共用（编辑仅命令型，本机、服务器上或数据源上 / 删除）。删除命令型先确认（用户自己写的，
 * 删了就没了）；引用型不问（探测脚本还在，随时能再晋升回来）。
 */
function ConfigMenuItems({ config }: { config: RunConfig }): React.JSX.Element {
  const openEditDialog = useApp((s) => s.openEditDialog)
  const deleteConfig = useApp((s) => s.deleteConfig)
  const askConfirm = useApp((s) => s.askConfirm)
  const remove = async (): Promise<void> => {
    if (
      config.kind !== 'referenced' &&
      !(await askConfirm({
        title: `删除运行配置 “${config.name}”？`,
        message: '删除后无法恢复。',
        confirmLabel: '删除',
        destructive: true
      }))
    ) {
      return
    }
    await deleteConfig(config.id)
  }
  return (
    <>
      {config.kind !== 'referenced' && (
        <DropdownMenuItem onClick={() => openEditDialog(config)}>
          <Pencil className="size-4" /> 编辑
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={() => void remove()}>
        <Trash2 className="size-4" /> 删除
      </DropdownMenuItem>
    </>
  )
}

function MoreMenu({
  config,
  baseClass,
  idleVis,
  onOpenChange
}: {
  config: RunConfig
  baseClass: string
  idleVis: string
  onOpenChange?: (open: boolean) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        onOpenChange?.(nextOpen)
      }}
    >
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

/**
 * 项目菜单项：⋮ 与右键共用（打开文件夹 / 打开于 / 在新窗口中打开 / 新建终端 / 新建配置 / 置顶 / 移除项目）。
 * 移除项目先确认：它的运行配置一并删除，运行中的进程与终端会被结束。
 */
function ProjectMenuItems({
  projectPath,
  projectName,
  pinned
}: {
  projectPath: string
  projectName: string
  pinned: boolean
}): React.JSX.Element {
  const openCreateDialog = useApp((s) => s.openCreateDialog)
  const newTerminal = useApp((s) => s.newTerminal)
  const removeProject = useApp((s) => s.removeProject)
  const askConfirm = useApp((s) => s.askConfirm)
  const remove = async (): Promise<void> => {
    const confirmed = await askConfirm({
      title: `移除项目 “${projectName}”？`,
      message: '它的运行配置会一并删除，运行中的进程和终端会被结束；磁盘上的文件不受影响。',
      confirmLabel: '移除',
      destructive: true
    })
    if (confirmed) await removeProject(projectPath)
  }
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
      {/* 以项目根开一个 Preview Window（同一根复开即聚焦），见 docs/prd/file-preview-window.md */}
      <DropdownMenuItem onClick={() => void window.api.previewOpenRoot(projectPath)}>
        <AppWindow className="size-4" /> 在新窗口中打开
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => void newTerminal(projectPath)}>
        <Terminal className="size-4" /> 新建终端
      </DropdownMenuItem>
      {/* 在项目里开一个连到某台服务器的 SSH Terminal、连到某个数据源的 Data Source Tab；一个都没有时不出 */}
      <ConnectSubmenu kind="server" ownerKey={projectPath} />
      <ConnectSubmenu kind="dataSource" ownerKey={projectPath} />
      <DropdownMenuItem onClick={() => openCreateDialog(projectPath)}>
        <FilePlusCorner className="size-4" /> 新建配置
      </DropdownMenuItem>
      <PinMenuItem entryKey={projectPath} pinned={pinned} />
      <DropdownMenuItem onClick={() => void remove()}>
        <Trash2 className="size-4" /> 移除项目
      </DropdownMenuItem>
    </>
  )
}

/** 服务器菜单项：⋮ 与右键共用（新建终端 / 新建配置 / 编辑 / 置顶 / 移除服务器）。 */
function ServerMenuItems({ node }: { node: ServerNode }): React.JSX.Element {
  const newSshTerminal = useApp((s) => s.newSshTerminal)
  const openCreateDialog = useApp((s) => s.openCreateDialog)
  const openConnectionDialog = useApp((s) => s.openConnectionDialog)
  const removeServer = useApp((s) => s.removeServer)
  const key = serverEntryKey(node.server.id)
  return (
    <>
      <DropdownMenuItem onClick={() => void newSshTerminal(key, node.server.id)}>
        <Terminal className="size-4" /> 新建终端
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => openCreateDialog(key)}>
        <FilePlusCorner className="size-4" /> 新建配置
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => openConnectionDialog({ kind: 'server', node })}>
        <Pencil className="size-4" /> 编辑
      </DropdownMenuItem>
      <PinMenuItem entryKey={key} pinned={node.server.pinned} />
      <DropdownMenuItem onClick={() => void removeServer(node.server.id)}>
        <Trash2 className="size-4" /> 移除服务器
      </DropdownMenuItem>
    </>
  )
}

/** 数据源菜单项：⋮ 与右键共用（新建标签页 / 新建配置 / 编辑 / 置顶 / 移除数据源）。 */
function DataSourceMenuItems({ node }: { node: DataSourceNode }): React.JSX.Element {
  const newDataSourceTab = useApp((s) => s.newDataSourceTab)
  const openCreateDialog = useApp((s) => s.openCreateDialog)
  const openConnectionDialog = useApp((s) => s.openConnectionDialog)
  const removeDataSource = useApp((s) => s.removeDataSource)
  const key = dataSourceEntryKey(node.dataSource.id)
  return (
    <>
      <DropdownMenuItem onClick={() => newDataSourceTab(key, node.dataSource.id)}>
        <Plus className="size-4" /> 新建标签页
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => openCreateDialog(key)}>
        <FilePlusCorner className="size-4" /> 新建配置
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => openConnectionDialog({ kind: 'dataSource', node })}>
        <Pencil className="size-4" /> 编辑
      </DropdownMenuItem>
      <PinMenuItem entryKey={key} pinned={node.dataSource.pinned} />
      <DropdownMenuItem onClick={() => void removeDataSource(node.dataSource.id)}>
        <Trash2 className="size-4" /> 移除数据源
      </DropdownMenuItem>
    </>
  )
}

/** 「置顶 / 取消置顶」菜单项（三类条目的菜单共用）。 */
function PinMenuItem({
  entryKey,
  pinned
}: {
  entryKey: string
  pinned: boolean
}): React.JSX.Element {
  const setEntryPinned = useApp((s) => s.setEntryPinned)
  return (
    <DropdownMenuItem onClick={() => void setEntryPinned(entryKey, !pinned)}>
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
  )
}

/** 条目菜单项：按条目类型分派到项目、服务器或数据源菜单。 */
function EntryMenuItems({ entry }: { entry: TreeEntry }): React.JSX.Element {
  switch (entry.kind) {
    case 'project':
      return (
        <ProjectMenuItems
          projectPath={entry.key}
          projectName={entry.node.project.name}
          pinned={entry.node.project.pinned}
        />
      )
    case 'server':
      return <ServerMenuItems node={entry.node} />
    case 'dataSource':
      return <DataSourceMenuItems node={entry.node} />
  }
}

function EntryMoreMenu({
  entry,
  pinned,
  selected,
  forceVisible,
  onOpenChange
}: {
  entry: TreeEntry
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
          <EntryMenuItems entry={entry} />
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
