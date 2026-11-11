import { BrowserWindow, screen } from 'electron'
import { debounce } from 'es-toolkit'
import { IPC } from '../shared/ipc'
import { applyPanelSizesPatch, type PanelSizes, type PanelSizesPatch } from '../shared/panel-sizes'
import {
  nextWindowPlacement,
  resolveWindowPlacement,
  windowPlacementsEqual,
  type ScreenLayout,
  type WindowPlacement,
  type WindowPlacementDefaults,
  type WindowPlacementKey
} from '../shared/window-placement'
import { broadcast, createAppWindow, windowState } from './app-window'
import {
  getAppPrefs,
  getPanelSizes as getStoredPanelSizes,
  getWindowPlacements,
  setPanelSizes as setStoredPanelSizes,
  setWindowPlacements
} from './store'

/**
 * 布局记忆（ADR-0053）：窗口几何（主窗口与预览窗口各一份）与可拖面板的尺寸，在主进程内存里记，各窗口共享；
 * 「记住窗口和面板布局」开着时同步落盘、启动时载入，关着时只在本次运行内有效。
 * 窗口几何跟着窗口实时记：每个窗口各记自己的一份，最近变化过或聚焦过的那个代表这一类窗口的记忆。
 */

const placements = new Map<WindowPlacementKey, WindowPlacement>()
/** 记忆此刻来自哪个还开着的窗口：新窗按记忆开时据此错开，不叠在它上面 */
const owners = new Map<WindowPlacementKey, BrowserWindow>()
/** 各个记着几何的窗口：把还没来得及记的那次立刻记下 */
const flushes = new Set<() => void>()
let panelSizes: PanelSizes = {}

/** 窗口几何变化后静默这么久才记：拖动、动画期间的一连串变化只记停稳后的那次 */
const SETTLE_MS = 300

function remembering(): boolean {
  return getAppPrefs().rememberLayout
}

/** 启动时（store 就绪后、建窗前）载入上次落盘的布局；开关关着则不载入。 */
export function loadLayoutMemory(): void {
  if (!remembering()) return
  for (const [key, placement] of Object.entries(getWindowPlacements())) {
    placements.set(key as WindowPlacementKey, placement)
  }
  panelSizes = getStoredPanelSizes()
}

/** 开关切换：开 → 把本次运行里的布局写盘；关 → 清掉盘上的（内存照旧）。 */
export function persistLayoutMemory(on: boolean): void {
  setWindowPlacements(on ? Object.fromEntries(placements) : {})
  setStoredPanelSizes(on ? panelSizes : {})
}

/** 这个窗口的几何成为这一类窗口的记忆；值没变就不写盘（聚焦切换很频繁）。 */
function adopt(key: WindowPlacementKey, win: BrowserWindow, placement: WindowPlacement): void {
  owners.set(key, win)
  const prev = placements.get(key)
  if (prev !== undefined && windowPlacementsEqual(prev, placement)) return
  placements.set(key, placement)
  if (remembering()) setWindowPlacements(Object.fromEntries(placements))
}

function screenLayout(): ScreenLayout {
  return {
    displays: screen.getAllDisplays().map(({ bounds, workArea }) => ({ bounds, workArea })),
    primaryWorkArea: screen.getPrimaryDisplay().workArea
  }
}

/**
 * 窗口几何跟着窗口实时记（事件驱动）：位置、尺寸、最大化、全屏一变就重新计时，静默 SETTLE_MS 后按窗口此刻的读数
 * 记一次；聚焦时它的那份成为记忆；关窗时把还没记的那次立刻记下。initial 是建窗用的几何，即它的初始记录。
 */
function trackPlacement(
  win: BrowserWindow,
  key: WindowPlacementKey,
  initial: WindowPlacement
): void {
  let current = initial
  const record = debounce(() => {
    if (win.isDestroyed()) return
    current = nextWindowPlacement(current, {
      ...win.getBounds(),
      isMinimized: win.isMinimized(),
      ...windowState(win)
    })
    adopt(key, win, current)
  }, SETTLE_MS)

  adopt(key, win, current)
  flushes.add(record.flush)
  win.on('move', record)
  win.on('resize', record)
  win.on('maximize', record)
  win.on('unmaximize', record)
  // 最小化期间不记；还原后补记一次，免得最小化前那次变化被跳过
  win.on('restore', record)
  win.on('enter-full-screen', record)
  win.on('leave-full-screen', record)
  win.on('focus', () => adopt(key, win, current))
  win.on('close', record.flush)
  win.on('closed', () => {
    record.cancel()
    flushes.delete(record.flush)
    if (owners.get(key) === win) owners.delete(key)
  })
}

/**
 * 按记忆建窗（主窗口、预览窗口），之后它的几何跟着窗口实时记。
 * cascadeOffset：记忆来自一个还开着的同类窗口时向右下错开（多开预览窗口），不叠在它上面；最大化 / 全屏不错开。
 */
export function createRememberedWindow(
  key: WindowPlacementKey,
  opts: {
    defaults: WindowPlacementDefaults
    query?: Record<string, string>
    cascadeOffset?: number
  }
): BrowserWindow {
  const placement = resolveWindowPlacement(
    placements.get(key) ?? null,
    opts.defaults,
    screenLayout(),
    owners.has(key) ? (opts.cascadeOffset ?? 0) : 0
  )
  const win = createAppWindow({ placement, defaults: opts.defaults, query: opts.query })
  trackPlacement(win, key, placement)
  return win
}

/** 退出前把各窗口还没来得及记的那次记下（退出用 app.exit 直接销毁窗口、不走关窗事件）。 */
export function flushWindowPlacements(): void {
  for (const flush of flushes) flush()
}

/** 恢复默认布局：清掉记住的窗口几何与面板尺寸（盘上的一并清掉），面板尺寸推给全部窗口；开着的窗口复原后照常记下。 */
export function resetLayoutMemory(): void {
  placements.clear()
  owners.clear()
  panelSizes = {}
  setWindowPlacements({})
  setStoredPanelSizes({})
  broadcast(IPC.panelSizesChanged, panelSizes)
}

export function getPanelSizes(): PanelSizes {
  return panelSizes
}

/** 记下 / 清掉面板尺寸，推给全部窗口（同一处在别的窗口里跟着变）。 */
export function updatePanelSizes(patch: PanelSizesPatch): PanelSizes {
  panelSizes = applyPanelSizesPatch(panelSizes, patch)
  if (remembering()) setStoredPanelSizes(panelSizes)
  broadcast(IPC.panelSizesChanged, panelSizes)
  return panelSizes
}
