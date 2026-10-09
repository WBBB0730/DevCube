import { BrowserWindow, screen } from 'electron'
import { IPC } from '../shared/ipc'
import { applyPanelSizesPatch, type PanelSizes, type PanelSizesPatch } from '../shared/panel-sizes'
import {
  resolveWindowPlacement,
  type WindowPlacement,
  type WindowPlacementDefaults,
  type WindowPlacementKey
} from '../shared/window-placement'
import { broadcast, windowState } from './app-window'
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
 */

const placements = new Map<WindowPlacementKey, WindowPlacement>()
let panelSizes: PanelSizes = {}

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

/** 记下窗口此刻的几何：位置尺寸取「正常」状态下的那份，最大化 / 全屏取窗口壳记的状态（见 windowState）。 */
export function rememberWindowPlacement(win: BrowserWindow, key: WindowPlacementKey): void {
  if (win.isDestroyed()) return
  const { x, y, width, height } = win.getNormalBounds()
  placements.set(key, { x, y, width, height, ...windowState(win) })
  if (remembering()) setWindowPlacements(Object.fromEntries(placements))
}

export function resolveRememberedWindowPlacement(
  defaults: WindowPlacementDefaults,
  key: WindowPlacementKey
): ReturnType<typeof resolveWindowPlacement> {
  const displays = screen.getAllDisplays().map((d) => d.bounds)
  return resolveWindowPlacement(placements.get(key) ?? null, defaults, displays)
}

/** 恢复默认布局：清掉记住的窗口几何与面板尺寸（盘上的一并清掉），面板尺寸推给全部窗口。 */
export function resetLayoutMemory(): void {
  placements.clear()
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
