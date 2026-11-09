// Files 面板每栏最上面的 Editor Tab 行（docs/prd/files-editor-tabs.md、DESIGN.md「Editor Tab 与分栏」）：
// 外观与行为同项目 Tab 栏（共用 ui/tab-strip），字号与图标低一档；临时 Tab 斜体；服务器上未保存的在 × 的位置显示圆点。
// 拖动按 dnd-kit 多列表互拖的做法（两栏的 Tab 行共用一个 EditorTabsDnd）：跟手的是浮层（DragOverlay，不被 Tab 行的
// 横向滚动裁掉、也不撑大滚动范围），仅水平、钳制在指针所在那一栏的 Tab 范围里，原位留占位；指针进了另一栏，
// 被拖的 Tab 先挪进那一栏的预览让出位置，松手才真正移动。
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeftRight,
  ArrowLeftToLine,
  ArrowRightToLine,
  Columns2,
  Copy,
  CopyX,
  Download,
  FolderOpen,
  ListTree,
  ListX,
  Pin,
  SquareArrowOutUpRight,
  Terminal,
  X
} from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type MeasuringConfiguration,
  type Modifier,
  type UniqueIdentifier
} from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  editorPaneOf,
  editorTabLabels,
  type EditorLayout,
  type EditorPane,
  type EditorTab
} from '@shared/files-editor-tabs'
import { logicalParentPath } from '@shared/files-path'
import type { GitFileStatus } from '@shared/git'
import { SHORTCUT } from '@shared/shortcut-label'
import { copyablePath } from '@shared/wsl-path'
import { useApp } from '@renderer/store'
import { relPathUnderRoot } from '@renderer/lib/files-paths'
import { shortcutTitle } from '@renderer/lib/shortcut-label'
import { cn } from '@renderer/lib/utils'
import { FILE_STATUS_COLOR } from '@renderer/components/git/git-details'
import {
  ContextMenuItem,
  ContextMenuSeparator,
  PointContextMenu
} from '@renderer/components/ui/context-menu'
import {
  TAB,
  TAB_ACTIVE,
  TAB_BAR,
  TAB_BAR_FADE,
  TAB_BAR_SCROLLER,
  TAB_CLOSE,
  clampTabDrag,
  useActiveTabIntoView,
  useWheelScrollsTabs,
  type HorizontalBounds
} from '@renderer/components/ui/tab-strip'
import { TOOLBAR_BTN } from '@renderer/components/ui/toolbar'
import { FilesTreeIcon } from './FilesTreeIcon'
import type { FilesTreeServerActions } from './FilesTreeMenu'

/** 分栏时非当前栏的选中 Tab：下描边退为浅色，以此区分当前栏（DESIGN.md「Editor Tab 与分栏」） */
const TAB_ACTIVE_ELSEWHERE = { boxShadow: 'inset 0 -3px 0 0 var(--border-input)' } as const

const EDITOR_TAB = cn(TAB, 'group pr-2 text-[13px]')

const activeTabStyle = (active: boolean, current: boolean): React.CSSProperties | undefined =>
  active ? (current ? TAB_ACTIVE : TAB_ACTIVE_ELSEWHERE) : undefined

/** 拖拽项与落点的标识：Tab 为「按下时所在栏 + 路径」，整行落点为「栏」 */
const tabDragId = (paneId: string, path: string): string => `tab\n${paneId}\n${path}`
const rowDropId = (paneId: string): string => `row\n${paneId}`

function parseDragId(id: string): { paneId: string; path: string | null } {
  const [kind, paneId, ...rest] = id.split('\n')
  return { paneId, path: kind === 'tab' ? rest.join('\n') : null }
}

/** 各栏 Tab 的显示顺序（拖拽项标识） */
type TabOrder = Record<string, string[]>

const orderOf = (layout: EditorLayout): TabOrder =>
  Object.fromEntries(layout.panes.map((p) => [p.id, p.tabs.map((t) => tabDragId(p.id, t.path))]))

/** 某个拖拽项（Tab 或整行）在 order 里属于哪一栏 */
function paneIn(order: TabOrder, id: string): string | undefined {
  const { paneId, path } = parseDragId(id)
  return path === null ? paneId : Object.keys(order).find((k) => order[k].includes(id))
}

interface ShownTab {
  id: string
  tab: EditorTab
}

const NO_TABS: ShownTab[] = []

/** 一栏 Tab 行的两层：可见的滚动区，和其中只包住 Tab 的那一层 */
interface TabRowElements {
  scroller: HTMLElement
  list: HTMLElement
}

/**
 * 一栏里跟手的 Tab 能走的横向范围：Tab 占的那一段与滚动区可见部分的交集（不含最后一个 Tab 之后的空白）；
 * 这一栏没有 Tab（唯一的 Tab 正拖在另一栏）时即可见的滚动区，好拖回来
 */
function tabRowRange({ scroller, list }: TabRowElements): HorizontalBounds {
  const view = scroller.getBoundingClientRect()
  const tabs = list.getBoundingClientRect()
  if (tabs.width === 0) return { left: view.left, right: view.right }
  return { left: Math.max(view.left, tabs.left), right: Math.min(view.right, tabs.right) }
}

function sameRanges(
  a: Record<string, HorizontalBounds>,
  b: Record<string, HorizontalBounds>
): boolean {
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every((k) => b[k] !== undefined && a[k].left === b[k].left && a[k].right === b[k].right)
  )
}

/** 跨栏时 Tab 在两个列表间挪动，落点要随时重量（同 dnd-kit 多列表的示例） */
const MEASURING: MeasuringConfiguration = { droppable: { strategy: MeasuringStrategy.Always } }

/** EditorTabsDnd 交给各栏 Tab 行的东西 */
interface EditorTabsDndValue {
  /** 此刻显示的 Tab：平时即布局，拖拽中为预览顺序 */
  shown: Record<string, ShownTab[]>
  /** Tab 行登记自己的两层（null 即撤下），拖动时据此量各栏能走的范围 */
  registerRow: (paneId: string, row: TabRowElements | null) => void
}

const EditorTabsDndContext = createContext<EditorTabsDndValue>({
  shown: {},
  registerRow: () => {}
})

/**
 * 两栏 Tab 行共用的拖拽。落点按指针：指针所在（或最近）的那一栏，取其中与跟手 Tab 中心最近的 Tab（那一栏没有
 * Tab 时即这一行）。跟手的 Tab 仅水平、钳制在落点那一栏的 Tab 范围里（见 tabRowRange，随滚动与预览实时重量），
 * 所以停在最后一个 Tab 之后的空白上也不会超出去；指针进了另一栏才跟过去。Esc 取消。同一栏里即调整顺序，跨栏
 * 即移过去（目标栏已开着同一个文件时不进预览，松手并成那一个）；onMove 的 index 为移动后在目标栏里的位置。
 */
export function EditorTabsDnd({
  layout,
  statusOf,
  unsaved,
  onMove,
  children
}: {
  layout: EditorLayout
  statusOf: (path: string) => GitFileStatus | undefined
  unsaved: (path: string) => boolean
  onMove: (fromPaneId: string, path: string, toPaneId: string, index: number) => Promise<unknown>
  children: React.ReactNode
}): React.JSX.Element {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  /**
   * 拖拽中的预览顺序，只对按下时的那份布局有效：布局一变（移动落定，或别处改了布局）即按新布局显示；
   * 松手后移动没改动布局（放回原处、被取消）时由 onMove 落定后清掉
   */
  const [preview, setPreview] = useState<{ base: EditorLayout; order: TabOrder } | null>(null)
  /** 正在拖的 Tab，与各栏此刻能走的横向范围 */
  const [dragging, setDragging] = useState<{
    id: string
    ranges: Record<string, HorizontalBounds>
  } | null>(null)
  const order = preview !== null && preview.base === layout ? preview.order : null

  /** 各栏 Tab 行登记的两层 */
  const rows = useRef(new Map<string, TabRowElements>())
  const registerRow = useCallback((paneId: string, row: TabRowElements | null): void => {
    if (row === null) rows.current.delete(paneId)
    else rows.current.set(paneId, row)
  }, [])
  const measureRanges = (): Record<string, HorizontalBounds> =>
    Object.fromEntries([...rows.current].map(([paneId, row]) => [paneId, tabRowRange(row)]))

  // 显示的 Tab 与 items 数组要保持同一个引用：dnd-kit 的 sortable 见 items 换了引用，会关掉正要让位的 Tab 的
  // 过渡动画（让位时直接跳过去）
  const shownOrder = useMemo(() => order ?? orderOf(layout), [order, layout])
  const shown = useMemo(() => {
    const tabById = new Map(
      layout.panes.flatMap((p) => p.tabs.map((t) => [tabDragId(p.id, t.path), t] as const))
    )
    return Object.fromEntries(
      layout.panes.map((p) => [
        p.id,
        (shownOrder[p.id] ?? []).flatMap((id) => {
          const tab = tabById.get(id)
          return tab === undefined ? [] : [{ id, tab }]
        })
      ])
    )
  }, [layout, shownOrder])
  const dndValue = useMemo(() => ({ shown, registerRow }), [shown, registerRow])

  const withinTabRows: Modifier = ({ transform, draggingNodeRect, active, over }) => {
    const target = over?.id ?? active?.id
    const paneId = target === undefined ? undefined : paneIn(shownOrder, String(target))
    const range = paneId === undefined ? undefined : dragging?.ranges[paneId]
    return clampTabDrag(transform, draggingNodeRect, range ?? null)
  }

  const collisionDetection: CollisionDetection = (args) => {
    const { collisionRect, droppableContainers, droppableRects, pointerCoordinates } = args
    const x = pointerCoordinates?.x ?? collisionRect.left + collisionRect.width / 2
    const distance = (id: UniqueIdentifier): number => {
      const rect = droppableRects.get(id)
      if (rect === undefined) return Infinity
      return x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0
    }
    const [row] = droppableContainers
      .filter((c) => parseDragId(String(c.id)).path === null && distance(c.id) < Infinity)
      .sort((a, b) => distance(a.id) - distance(b.id))
    if (row === undefined) return []
    const ids = shownOrder[parseDragId(String(row.id)).paneId] ?? []
    if (ids.length === 0) return [{ id: row.id }]
    return closestCenter({
      ...args,
      droppableContainers: droppableContainers.filter((c) => ids.includes(String(c.id)))
    })
  }

  const handleDragStart = ({ active }: DragStartEvent): void => {
    setDragging({ id: String(active.id), ranges: measureRanges() })
    setPreview({ base: layout, order: orderOf(layout) })
  }

  // 移动、自动滚动、预览挪动之后重量各栏范围（这时 DOM 已是最新）
  const handleDragMove = (): void => {
    const ranges = measureRanges()
    setDragging((prev) =>
      prev === null || sameRanges(prev.ranges, ranges) ? prev : { ...prev, ranges }
    )
  }

  // 拖到另一栏：挪进那一栏的预览，按跟手 Tab 的中心在落点 Tab 的左半还是右半插在它前或后
  const handleDragOver = ({ active, over }: DragOverEvent): void => {
    if (over === null) return
    const id = String(active.id)
    const overId = String(over.id)
    const dragged = active.rect.current.translated
    const after =
      dragged !== null && dragged.left + dragged.width / 2 > over.rect.left + over.rect.width / 2
    setPreview((prev) => {
      if (prev === null) return prev
      const { order: o } = prev
      const from = paneIn(o, id)
      const to = paneIn(o, overId)
      if (from === undefined || to === undefined || from === to) return prev
      const path = parseDragId(id).path
      if (o[to].some((other) => parseDragId(other).path === path)) return prev
      const at = o[to].indexOf(overId)
      const index = at < 0 ? o[to].length : at + (after ? 1 : 0)
      const moved = {
        ...o,
        [from]: o[from].filter((other) => other !== id),
        [to]: [...o[to].slice(0, index), id, ...o[to].slice(index)]
      }
      return { ...prev, order: moved }
    })
  }

  const handleDragEnd = ({ active, over }: DragEndEvent): void => {
    setDragging(null)
    const id = String(active.id)
    const { paneId: from, path } = parseDragId(id)
    const to = order === null || over === null ? undefined : paneIn(order, String(over.id))
    if (order === null || over === null || path === null || to === undefined) {
      setPreview(null)
      return
    }
    const list = order[to]
    const at = list.indexOf(id)
    const overAt = list.indexOf(String(over.id))
    // 落在某个 Tab 上即挪到它的位置；落在空栏的行上即原地（已挪进预览）；目标栏已开着同一个文件时位置无关
    const index = at < 0 ? list.length : overAt < 0 ? at : overAt
    // 移动落定（本地要先存盘）前保持预览，免得先闪回旧顺序；落定时已开始下一次拖拽的不清
    const settled = preview
    void onMove(from, path, to, index).finally(() =>
      setPreview((current) => (current === settled ? null : current))
    )
  }

  const handleDragCancel = (): void => {
    setDragging(null)
    setPreview(null)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      modifiers={[withinTabRows]}
      measuring={MEASURING}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <EditorTabsDndContext.Provider value={dndValue}>{children}</EditorTabsDndContext.Provider>
      {createPortal(
        <DragOverlay>
          {dragging !== null && (
            <EditorTabOverlay
              layout={layout}
              id={dragging.id}
              statusOf={statusOf}
              unsaved={unsaved}
            />
          )}
        </DragOverlay>,
        document.body
      )}
    </DndContext>
  )
}

/** 跟手的那个 Tab：外观同终端 Tab 拖动中——按下时的样子、hover 底色、60% 不透明度 */
function EditorTabOverlay({
  layout,
  id,
  statusOf,
  unsaved
}: {
  layout: EditorLayout
  id: string
  statusOf: (path: string) => GitFileStatus | undefined
  unsaved: (path: string) => boolean
}): React.JSX.Element | null {
  const { paneId, path } = parseDragId(id)
  const pane = editorPaneOf(layout, paneId)
  const i = pane?.tabs.findIndex((t) => t.path === path) ?? -1
  if (pane === undefined || path === null || i < 0) return null
  const label = editorTabLabels(pane.tabs.map((t) => t.path))[i]
  return (
    <div
      className={cn(EDITOR_TAB, 'bg-[var(--bg-row-hover)]')}
      style={{ opacity: 0.6, ...activeTabStyle(pane.active === path, layout.current === paneId) }}
    >
      <EditorTabContent
        name={label.name}
        hint={label.hint}
        temporary={!pane.tabs[i].pinned}
        status={statusOf(path)}
        unsaved={unsaved(path)}
      />
    </div>
  )
}

export interface EditorTabsActions {
  onActivate: (path: string) => void
  /** 固定临时 Tab（双击 Tab、「保持打开」） */
  onPin: (path: string) => void
  onClose: (path: string) => void
  onCloseOthers: (path: string) => void
  onCloseToLeft: (path: string) => void
  onCloseToRight: (path: string) => void
  onCloseAll: () => void
  /** 把某个文件向右分屏（未分栏时；不给路径即当前 Tab）；已分栏时为 null */
  onSplit: ((path?: string) => void) | null
  /** 移到另一栏（已分栏时）；未分栏时为 null */
  onMoveToOther: ((path: string) => void) | null
  onRevealInTree: (path: string) => void
}

export function FilesEditorTabs({
  pane,
  current,
  rootLogical,
  projectPath,
  terminal,
  server,
  connected,
  statusOf,
  unsaved,
  actions
}: {
  pane: EditorPane
  /** 这一栏是当前栏 */
  current: boolean
  rootLogical: string
  /**
   * 右键菜单里文件本身那一组按宿主给，参数同文件树右键菜单：本机为在文件夹中显示 / 在其他应用中打开 / 在终端中打开，
   * 服务器为在 SSH 终端中打开 / 下载
   */
  projectPath: string
  /** 是否提供「在终端中打开」（预览窗口没有终端） */
  terminal: boolean
  /** 服务器宿主：换成服务器上的那一组 */
  server?: FilesTreeServerActions
  /** 服务器断开期间不给「下载…」（同正文右键菜单） */
  connected: boolean
  /** 文件的 Git 状态（文件名与图标随之上色，同文件树） */
  statusOf: (path: string) => GitFileStatus | undefined
  /** 服务器上的文件有未保存的修改 */
  unsaved: (path: string) => boolean
  actions: EditorTabsActions
}): React.JSX.Element {
  const { shown, registerRow } = useContext(EditorTabsDndContext)
  const tabs = shown[pane.id] ?? NO_TABS
  // 同一份 tabs 给同一个 items 数组（本组件在每次落点变化时都会重渲，见 EditorTabsDnd 里 shown 的说明）
  const items = useMemo(() => tabs.map((t) => t.id), [tabs])
  const scrollerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const scroller = scrollerRef.current
    const list = listRef.current
    registerRow(pane.id, scroller !== null && list !== null ? { scroller, list } : null)
    return () => registerRow(pane.id, null)
  }, [registerRow, pane.id])
  useActiveTabIntoView(scrollerRef, pane.active === null ? null : tabDragId(pane.id, pane.active))
  useWheelScrollsTabs(scrollerRef)
  const { setNodeRef: setRowRef } = useDroppable({ id: rowDropId(pane.id) })
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const labels = editorTabLabels(tabs.map((t) => t.tab.path))
  const menuTab = menu === null ? undefined : pane.tabs.find((t) => t.path === menu.path)
  const menuIndex = menuTab === undefined ? -1 : pane.tabs.indexOf(menuTab)
  /** 点了菜单项：先关菜单再执行 */
  const run = (action: () => void): void => {
    setMenu(null)
    action()
  }
  const copyText = (text: string): void =>
    run(() => void navigator.clipboard.writeText(text).catch(() => undefined))

  return (
    <div className={TAB_BAR}>
      <div ref={setRowRef} className="flex h-full items-center">
        {/* 渐隐遮罩只包滚动区，「向右分屏」在它之外，不被盖住 */}
        <div className={cn(TAB_BAR_FADE, 'h-full min-w-0 flex-1')}>
          <div ref={scrollerRef} className={TAB_BAR_SCROLLER}>
            {/* 只包住 Tab 的一层（同终端 Tab 组）：拖动钳制在它的范围里，不含后面的留白 */}
            <div ref={listRef} className="flex h-full shrink-0 items-center">
              <SortableContext items={items} strategy={horizontalListSortingStrategy}>
                {tabs.map(({ id, tab }, i) => (
                  <EditorTabItem
                    key={id}
                    dragId={id}
                    title={relPathUnderRoot(rootLogical, tab.path)}
                    name={labels[i].name}
                    hint={labels[i].hint}
                    temporary={!tab.pinned}
                    active={tab.path === pane.active}
                    current={current}
                    status={statusOf(tab.path)}
                    unsaved={unsaved(tab.path)}
                    menuActive={menu?.path === tab.path}
                    onActivate={() => actions.onActivate(tab.path)}
                    onPin={() => actions.onPin(tab.path)}
                    onClose={() => actions.onClose(tab.path)}
                    onMenu={(e) => {
                      e.preventDefault()
                      setMenu({ x: e.clientX, y: e.clientY, path: tab.path })
                    }}
                  />
                ))}
              </SortableContext>
            </div>
            <span aria-hidden className="w-2 shrink-0" />
          </div>
        </div>
        {actions.onSplit !== null && (
          <button
            type="button"
            title={shortcutTitle('向右分屏', SHORTCUT.splitEditor)}
            className={cn(TOOLBAR_BTN, 'mx-1 shrink-0')}
            onClick={() => actions.onSplit?.()}
          >
            <Columns2 className="size-4" />
          </button>
        )}
      </div>
      {menu !== null && menuTab !== undefined && (
        <PointContextMenu at={menu} onClose={() => setMenu(null)}>
          <ContextMenuItem onClick={() => run(() => actions.onClose(menu.path))}>
            <X className="size-4" /> 关闭
          </ContextMenuItem>
          <ContextMenuItem
            disabled={pane.tabs.length < 2}
            onClick={() => run(() => actions.onCloseOthers(menu.path))}
          >
            <CopyX className="size-4" /> 关闭其他
          </ContextMenuItem>
          <ContextMenuItem
            disabled={menuIndex === 0}
            onClick={() => run(() => actions.onCloseToLeft(menu.path))}
          >
            <ArrowLeftToLine className="size-4" /> 关闭左侧
          </ContextMenuItem>
          <ContextMenuItem
            disabled={menuIndex === pane.tabs.length - 1}
            onClick={() => run(() => actions.onCloseToRight(menu.path))}
          >
            <ArrowRightToLine className="size-4" /> 关闭右侧
          </ContextMenuItem>
          <ContextMenuItem onClick={() => run(actions.onCloseAll)}>
            <ListX className="size-4" /> 全部关闭
          </ContextMenuItem>
          {!menuTab.pinned && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => run(() => actions.onPin(menu.path))}>
                <Pin className="size-4" /> 保持打开
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          {actions.onMoveToOther !== null ? (
            <ContextMenuItem onClick={() => run(() => actions.onMoveToOther!(menu.path))}>
              <ArrowLeftRight className="size-4" /> 移到另一栏
            </ContextMenuItem>
          ) : (
            actions.onSplit !== null && (
              <ContextMenuItem onClick={() => run(() => actions.onSplit!(menu.path))}>
                <Columns2 className="size-4" /> 向右分屏
              </ContextMenuItem>
            )
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => run(() => actions.onRevealInTree(menu.path))}>
            <ListTree className="size-4" /> 在文件树中显示
          </ContextMenuItem>
          {server === undefined ? (
            <>
              <ContextMenuItem onClick={() => run(() => void window.api.revealInFolder(menu.path))}>
                <FolderOpen className="size-4" /> 在文件夹中显示
              </ContextMenuItem>
              <ContextMenuItem onClick={() => run(() => void window.api.openPath(menu.path))}>
                <SquareArrowOutUpRight className="size-4" /> 在其他应用中打开
              </ContextMenuItem>
              {terminal && (
                <ContextMenuItem
                  onClick={() =>
                    run(
                      () =>
                        void useApp
                          .getState()
                          .newTerminal(projectPath, logicalParentPath(menu.path))
                    )
                  }
                >
                  <Terminal className="size-4" /> 在终端中打开
                </ContextMenuItem>
              )}
            </>
          ) : (
            <>
              <ContextMenuItem
                onClick={() => run(() => server.onOpenInSshTerminal(logicalParentPath(menu.path)))}
              >
                <Terminal className="size-4" /> 在 SSH 终端中打开
              </ContextMenuItem>
              {connected && (
                <ContextMenuItem
                  onClick={() =>
                    run(() => server.onDownload([{ path: menu.path, isDirectory: false }]))
                  }
                >
                  <Download className="size-4" /> 下载…
                </ContextMenuItem>
              )}
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => copyText(copyablePath(menu.path))}>
            <Copy className="size-4" /> 复制路径
          </ContextMenuItem>
          {server === undefined && (
            <ContextMenuItem onClick={() => copyText(relPathUnderRoot(rootLogical, menu.path))}>
              <Copy className="size-4" /> 复制相对路径
            </ContextMenuItem>
          )}
        </PointContextMenu>
      )}
    </div>
  )
}

/** Tab 里面的内容（行里的 Tab 与跟手的浮层共用）：图标、文件名、重名时的上级目录、× 或未保存圆点 */
function EditorTabContent({
  name,
  hint,
  temporary,
  status,
  unsaved,
  onClose
}: {
  name: string
  hint: string | null
  temporary: boolean
  status: GitFileStatus | undefined
  unsaved: boolean
  /** 浮层里不给 */
  onClose?: () => void
}): React.JSX.Element {
  const colour = status ? FILE_STATUS_COLOR[status] : undefined
  return (
    <>
      <FilesTreeIcon
        name={name}
        className="size-3.5 shrink-0"
        style={{ color: colour ?? 'var(--fg-icon)' }}
      />
      <span
        className={cn('min-w-0 truncate', temporary && 'italic', !colour && 'text-foreground')}
        style={colour ? { color: colour } : undefined}
      >
        {name}
      </span>
      {hint !== null && <span className="shrink-0 text-xs text-muted-foreground">{hint}</span>}
      <button
        type="button"
        title={shortcutTitle('关闭', SHORTCUT.closeTab)}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onClose?.()
        }}
        className={TAB_CLOSE}
      >
        {unsaved ? (
          <>
            <span className="size-1.5 rounded-full bg-primary group-hover:hidden" />
            <X className="hidden size-3 group-hover:block" />
          </>
        ) : (
          <X className="size-3" />
        )}
      </button>
    </>
  )
}

function EditorTabItem({
  dragId,
  title,
  name,
  hint,
  temporary,
  active,
  current,
  status,
  unsaved,
  menuActive,
  onActivate,
  onPin,
  onClose,
  onMenu
}: {
  dragId: string
  title: string
  name: string
  hint: string | null
  temporary: boolean
  active: boolean
  current: boolean
  status: GitFileStatus | undefined
  unsaved: boolean
  /** 右键菜单开着：保持 hover 底 */
  menuActive: boolean
  onActivate: () => void
  onPin: () => void
  onClose: () => void
  onMenu: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: dragId
  })
  const style: React.CSSProperties = {
    // 只取位移、丢弃缩放（同终端 Tab）；拖动中这里是落点处的空位（跟手的是浮层），同终端 Tab 拖动时留出的空位
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0 : undefined,
    ...activeTabStyle(active, current)
  }
  return (
    <div
      ref={setNodeRef}
      data-tab-key={dragId}
      style={style}
      className={cn(EDITOR_TAB, menuActive && 'bg-[var(--bg-row-hover)]')}
      title={title}
      {...attributes}
      {...listeners}
      onClick={onActivate}
      onDoubleClick={() => {
        if (temporary) onPin()
      }}
      // 中键关闭；按下时先拦住，免得浏览器进入中键自动滚动
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault()
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return
        e.preventDefault()
        onClose()
      }}
      onContextMenu={onMenu}
    >
      <EditorTabContent
        name={name}
        hint={hint}
        temporary={temporary}
        status={status}
        unsaved={unsaved}
        onClose={onClose}
      />
    </div>
  )
}
