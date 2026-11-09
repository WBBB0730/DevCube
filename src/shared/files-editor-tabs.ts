/**
 * Files 面板的 Editor Tab 与分栏（docs/prd/files-editor-tabs.md、ADR-0061）：一套纯函数模型。
 * 偏好「启用编辑器标签页」只决定上限 limit：开着为不限，关着为 1。上限为 1 时只有一栏、一个 Tab，
 * 且它恒为临时（固定之后再打开别的文件就要第二个位置），「一次一个」由同一套规则自然推出，不另写一套。
 * 各函数在什么都不变时原样返回传入的布局（调用方据此判断无事发生）。
 */
import { lastPathSegment, logicalParentPath } from './files-path'

export interface EditorTab {
  path: string
  /** 已固定；未固定的即临时 Tab（下一次打开会替换它），每栏至多一个 */
  pinned: boolean
}

export interface EditorPane {
  /** 栏的稳定标识：另一栏收起后，留下的这栏不换标识（界面据此不重挂） */
  id: string
  tabs: EditorTab[]
  /** 当前 Tab 的路径；没有打开的文件为 null */
  active: string | null
}

export interface EditorLayout {
  /** 1–2 栏，自左向右 */
  panes: EditorPane[]
  /** 当前栏：打开文件、⌘W 与切换 Tab 都作用于它 */
  current: string
}

const PANE_IDS = ['p1', 'p2'] as const

export const EMPTY_EDITOR_LAYOUT: EditorLayout = {
  panes: [{ id: PANE_IDS[0], tabs: [], active: null }],
  current: PANE_IDS[0]
}

/** 偏好开关 → Tab 上限 */
export function editorTabLimit(enabled: boolean): number {
  return enabled ? Number.POSITIVE_INFINITY : 1
}

export function editorPaneOf(layout: EditorLayout, paneId: string): EditorPane | undefined {
  return layout.panes.find((p) => p.id === paneId)
}

export function currentEditorPane(layout: EditorLayout): EditorPane {
  return editorPaneOf(layout, layout.current) ?? layout.panes[0]
}

/** 当前栏的当前 Tab */
export function activeEditorPath(layout: EditorLayout): string | null {
  return currentEditorPane(layout).active
}

/** 各栏开着的全部文件 */
export function editorLayoutPaths(layout: EditorLayout): Set<string> {
  return new Set(layout.panes.flatMap((p) => p.tabs.map((t) => t.path)))
}

/** 某一栏正显示着的文件（各栏的当前 Tab） */
export function activeEditorPaths(layout: EditorLayout): Set<string> {
  return new Set(layout.panes.flatMap((p) => (p.active === null ? [] : [p.active])))
}

/** 从 base 到 next 被关掉（不再有任何 Tab）的文件 */
export function removedEditorPaths(base: EditorLayout, next: EditorLayout): string[] {
  const kept = editorLayoutPaths(next)
  return [...editorLayoutPaths(base)].filter((p) => !kept.has(p))
}

/** 从 base 到 next 被切走（还有 Tab，但哪一栏都不再显示它）的文件 */
export function deactivatedEditorPaths(base: EditorLayout, next: EditorLayout): string[] {
  const kept = editorLayoutPaths(next)
  const shown = activeEditorPaths(next)
  return [...activeEditorPaths(base)].filter((p) => kept.has(p) && !shown.has(p))
}

/**
 * 从 base 到 next 要离开、得先安顿的文件（docs/prd/files-editor-tabs.md「保存与外部变更」）：被关掉的，加上被切走的——
 * 本地文件切走即自动保存；keepDeactivated（服务器上的文件手动保存）时切走的修改留着，不算离开。
 */
export function leavingEditorPaths(
  base: EditorLayout,
  next: EditorLayout,
  opts: { keepDeactivated: boolean }
): string[] {
  const removed = removedEditorPaths(base, next)
  return opts.keepDeactivated ? removed : [...removed, ...deactivatedEditorPaths(base, next)]
}

/** 换掉一栏（同时成为当前栏）；什么都没变时原样返回 */
function withPane(layout: EditorLayout, pane: EditorPane): EditorLayout {
  const prev = editorPaneOf(layout, pane.id)
  if (prev === pane && layout.current === pane.id) return layout
  return {
    panes: layout.panes.map((p) => (p.id === pane.id ? pane : p)),
    current: pane.id
  }
}

/** 去掉一栏，当前栏转给留下的那栏 */
function withoutPane(layout: EditorLayout, paneId: string): EditorLayout {
  const panes = layout.panes.filter((p) => p.id !== paneId)
  return { panes, current: panes[0].id }
}

function replaceAt<T>(list: readonly T[], index: number, item: T): T[] {
  return list.map((x, i) => (i === index ? item : x))
}

/**
 * 在某栏（默认当前栏）打开文件，并让它成为当前栏：已有它的 Tab 即激活；否则替换临时 Tab；没有临时 Tab 就在
 * 当前 Tab 右侧新建一个临时 Tab。pin 时同时固定（上限为 1 时不固定）。
 */
export function openEditor(
  layout: EditorLayout,
  path: string,
  opts: { pane?: string; pin?: boolean; limit: number }
): EditorLayout {
  const pane = editorPaneOf(layout, opts.pane ?? layout.current) ?? currentEditorPane(layout)
  const pin = opts.pin === true && opts.limit > 1
  const existing = pane.tabs.findIndex((t) => t.path === path)
  if (existing >= 0) {
    const tab = pane.tabs[existing]
    const tabs =
      pin && !tab.pinned ? replaceAt(pane.tabs, existing, { path, pinned: true }) : pane.tabs
    if (tabs === pane.tabs && pane.active === path) return withPane(layout, pane)
    return withPane(layout, { ...pane, tabs, active: path })
  }
  const tab: EditorTab = { path, pinned: pin }
  const temp = pane.tabs.findIndex((t) => !t.pinned)
  let tabs: EditorTab[]
  if (temp >= 0) {
    tabs = replaceAt(pane.tabs, temp, tab)
  } else {
    const at = pane.tabs.findIndex((t) => t.path === pane.active) + 1 || pane.tabs.length
    tabs = [...pane.tabs.slice(0, at), tab, ...pane.tabs.slice(at)]
  }
  return withPane(layout, { ...pane, tabs, active: path })
}

/** 固定某栏里的 Tab（上限为 1 时不固定） */
export function pinEditor(
  layout: EditorLayout,
  paneId: string,
  path: string,
  limit: number
): EditorLayout {
  const pane = editorPaneOf(layout, paneId)
  const i = pane?.tabs.findIndex((t) => t.path === path) ?? -1
  if (pane === undefined || i < 0 || pane.tabs[i].pinned || limit <= 1) return layout
  return withPane(layout, { ...pane, tabs: replaceAt(pane.tabs, i, { path, pinned: true }) })
}

/** 只换当前栏，不动任何 Tab */
export function focusEditorPane(layout: EditorLayout, paneId: string): EditorLayout {
  if (layout.current === paneId || editorPaneOf(layout, paneId) === undefined) return layout
  return { ...layout, current: paneId }
}

/** 一栏去掉 keep 之外的 Tab：当前 Tab 被去掉时落到它左边留下的那个，其次右边；分栏时一栏关空即收起 */
function keepTabs(
  layout: EditorLayout,
  paneId: string,
  keep: (tab: EditorTab, index: number) => boolean
): EditorLayout {
  const pane = editorPaneOf(layout, paneId)
  if (pane === undefined) return layout
  const tabs = pane.tabs.filter(keep)
  if (tabs.length === pane.tabs.length) return layout
  if (tabs.length === 0 && layout.panes.length > 1) return withoutPane(layout, paneId)
  let active = pane.active
  if (active !== null && !tabs.some((t) => t.path === active)) {
    const at = pane.tabs.findIndex((t) => t.path === active)
    const left = pane.tabs.slice(0, at).reverse()
    const right = pane.tabs.slice(at + 1)
    active = [...left, ...right].find((t) => tabs.includes(t))?.path ?? null
  }
  return withPane(layout, { ...pane, tabs, active })
}

export function closeEditor(layout: EditorLayout, paneId: string, path: string): EditorLayout {
  return keepTabs(layout, paneId, (t) => t.path !== path)
}

export function closeOtherEditors(
  layout: EditorLayout,
  paneId: string,
  path: string
): EditorLayout {
  const kept = keepTabs(layout, paneId, (t) => t.path === path)
  const pane = editorPaneOf(kept, paneId)
  return pane === undefined || pane.active === path
    ? kept
    : withPane(kept, { ...pane, active: path })
}

export function closeEditorsToLeft(
  layout: EditorLayout,
  paneId: string,
  path: string
): EditorLayout {
  const at = editorPaneOf(layout, paneId)?.tabs.findIndex((t) => t.path === path) ?? -1
  if (at < 0) return layout
  return keepTabs(layout, paneId, (_t, i) => i >= at)
}

export function closeEditorsToRight(
  layout: EditorLayout,
  paneId: string,
  path: string
): EditorLayout {
  const at = editorPaneOf(layout, paneId)?.tabs.findIndex((t) => t.path === path) ?? -1
  if (at < 0) return layout
  return keepTabs(layout, paneId, (_t, i) => i <= at)
}

export function closeAllEditors(layout: EditorLayout, paneId: string): EditorLayout {
  return keepTabs(layout, paneId, () => false)
}

/**
 * 向右分屏：把当前栏的某个文件（默认当前 Tab）在右侧新栏开一个固定 Tab，新栏成为当前栏；上限为 1、已分栏或没有
 * 这个文件时不变
 */
export function splitEditor(
  layout: EditorLayout,
  limit: number,
  path: string | null = currentEditorPane(layout).active
): EditorLayout {
  const pane = currentEditorPane(layout)
  if (limit <= 1 || layout.panes.length >= PANE_IDS.length) return layout
  if (path === null || !pane.tabs.some((t) => t.path === path)) return layout
  const id = PANE_IDS.find((candidate) => editorPaneOf(layout, candidate) === undefined)!
  const at = layout.panes.indexOf(pane) + 1
  const added: EditorPane = { id, tabs: [{ path, pinned: true }], active: path }
  return {
    panes: [...layout.panes.slice(0, at), added, ...layout.panes.slice(at)],
    current: id
  }
}

/** 栏内调整顺序：把某个 Tab 挪到 index 处（挪动后的位置） */
function reorderEditor(
  layout: EditorLayout,
  paneId: string,
  path: string,
  index: number
): EditorLayout {
  const pane = editorPaneOf(layout, paneId)
  const from = pane?.tabs.findIndex((t) => t.path === path) ?? -1
  if (pane === undefined || from < 0 || from === index) return layout
  const tabs = [...pane.tabs]
  const [tab] = tabs.splice(from, 1)
  tabs.splice(Math.min(Math.max(index, 0), tabs.length), 0, tab)
  return withPane(layout, { ...pane, tabs })
}

/**
 * 把某个 Tab 移到另一栏（index 处，默认目标栏当前 Tab 右侧），在那里固定并激活，目标栏成为当前栏；
 * 目标栏已有同一文件即激活那个。来源栏按关闭处理（关空即收起）。
 */
export function moveEditor(
  layout: EditorLayout,
  fromPaneId: string,
  path: string,
  toPaneId: string,
  index?: number
): EditorLayout {
  if (fromPaneId === toPaneId) {
    return index === undefined ? layout : reorderEditor(layout, fromPaneId, path, index)
  }
  const source = editorPaneOf(layout, fromPaneId)
  if (!source?.tabs.some((t) => t.path === path) || !editorPaneOf(layout, toPaneId)) return layout
  const closed = closeEditor(layout, fromPaneId, path)
  const target = editorPaneOf(closed, toPaneId)!
  if (target.tabs.some((t) => t.path === path)) {
    return withPane(closed, { ...target, active: path })
  }
  const at =
    index === undefined
      ? target.tabs.findIndex((t) => t.path === target.active) + 1 || target.tabs.length
      : Math.min(Math.max(index, 0), target.tabs.length)
  const tabs = [...target.tabs.slice(0, at), { path, pinned: true }, ...target.tabs.slice(at)]
  return withPane(closed, { ...target, tabs, active: path })
}

/** 当前栏里上一个 / 下一个 Tab 的路径（到头回绕）；不足两个时为 null */
export function adjacentEditorPath(layout: EditorLayout, dir: -1 | 1): string | null {
  const { tabs, active } = currentEditorPane(layout)
  if (tabs.length < 2) return null
  const at = tabs.findIndex((t) => t.path === active)
  return tabs[(at + dir + tabs.length) % tabs.length].path
}

/** 改名、移动：各栏的路径按 remap 换成新的（换完重名的只留一个，已固定的优先） */
export function remapEditorPaths(
  layout: EditorLayout,
  remap: (path: string) => string
): EditorLayout {
  let changed = false
  const panes = layout.panes.map((pane) => {
    const tabs: EditorTab[] = []
    for (const tab of pane.tabs) {
      const path = remap(tab.path)
      if (path !== tab.path) changed = true
      const dup = tabs.findIndex((t) => t.path === path)
      if (dup < 0) tabs.push(path === tab.path ? tab : { ...tab, path })
      else if (tab.pinned) tabs[dup] = { path, pinned: true }
    }
    const active = pane.active === null ? null : remap(pane.active)
    return { ...pane, tabs, active }
  })
  return changed ? { ...layout, panes } : layout
}

/** 删除：去掉 gone 命中的 Tab（当前 Tab 落到邻居，分栏时一栏去空即收起） */
export function dropEditorPaths(
  layout: EditorLayout,
  gone: (path: string) => boolean
): EditorLayout {
  let next = layout
  for (const pane of layout.panes) {
    // 先收的那栏可能让当前栏换手，但不影响另一栏怎么收
    next = keepTabs(next, pane.id, (t) => !gone(t.path))
  }
  return next === layout ? layout : { ...next, current: layoutCurrentAfter(layout, next) }
}

/** 收拢后当前栏还在就留着，否则取留下的第一栏 */
function layoutCurrentAfter(before: EditorLayout, after: EditorLayout): string {
  return editorPaneOf(after, before.current) !== undefined ? before.current : after.panes[0].id
}

/** 两份布局是否一样（落盘读回、开关切换时判断要不要动） */
export function editorLayoutsEqual(a: EditorLayout, b: EditorLayout): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function parseTabs(raw: unknown): EditorTab[] {
  if (!Array.isArray(raw)) return []
  const tabs: EditorTab[] = []
  let temp = false
  for (const item of raw) {
    const path = (item as { path?: unknown })?.path
    if (typeof path !== 'string' || tabs.some((t) => t.path === path)) continue
    // 每栏至多一个临时 Tab：多出来的当作已固定
    const pinned = (item as { pinned?: unknown }).pinned === true || temp
    if (!pinned) temp = true
    tabs.push({ path, pinned })
  }
  return tabs
}

/**
 * 落盘读回或开关切换后按上限整理：形状不对的丢掉，至多两栏、栏内路径不重复、每栏至多一个临时 Tab，
 * 当前 Tab 与当前栏都落在实处；上限为 1 时只留当前栏的当前 Tab，且为临时。
 */
export function normalizeEditorLayout(raw: unknown, limit: number): EditorLayout {
  const rawPanes = (raw as { panes?: unknown } | null)?.panes
  const panes: EditorPane[] = []
  for (const item of Array.isArray(rawPanes) ? rawPanes : []) {
    const id = (item as { id?: unknown })?.id
    if (typeof id !== 'string' || !(PANE_IDS as readonly string[]).includes(id)) continue
    if (panes.some((p) => p.id === id)) continue
    const tabs = parseTabs((item as { tabs?: unknown }).tabs)
    const rawActive = (item as { active?: unknown }).active
    const active = tabs.some((t) => t.path === rawActive)
      ? (rawActive as string)
      : (tabs[0]?.path ?? null)
    panes.push({ id, tabs, active })
  }
  const nonEmpty = panes.filter((p) => p.tabs.length > 0).slice(0, PANE_IDS.length)
  const rawCurrent = (raw as { current?: unknown } | null)?.current
  if (nonEmpty.length === 0) {
    const id = panes.find((p) => p.id === rawCurrent)?.id ?? PANE_IDS[0]
    return { panes: [{ id, tabs: [], active: null }], current: id }
  }
  const current = nonEmpty.find((p) => p.id === rawCurrent) ?? nonEmpty[0]
  if (limit <= 1) {
    const only: EditorPane = {
      id: current.id,
      tabs: [{ path: current.active!, pinned: false }],
      active: current.active
    }
    return { panes: [only], current: current.id }
  }
  return { panes: nonEmpty, current: current.id }
}

/**
 * Tab 上显示的名字：文件名；同一栏里重名的另带上级文件夹名（hint），以便分得清。
 */
export function editorTabLabels(paths: readonly string[]): { name: string; hint: string | null }[] {
  const names = paths.map((p) => lastPathSegment(p))
  return paths.map((p, i) => {
    const dup = names.some((n, j) => j !== i && n === names[i])
    return { name: names[i], hint: dup ? lastPathSegment(logicalParentPath(p)) : null }
  })
}
