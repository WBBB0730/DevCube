// 记住尺寸的可拖面板（docs/prd/resizable-panels.md、ADR-0053）：各尺寸的单位与限位、全局共享的尺寸
// （主进程记一份，推给全部窗口），以及把它接到面板组 / 面板 / 分隔线上的 hook。
import { useEffect, useEffectEvent, useLayoutEffect, useState } from 'react'
import {
  useGroupCallbackRef,
  usePanelCallbackRef,
  type GroupImperativeHandle,
  type GroupProps,
  type PanelImperativeHandle,
  type PanelProps,
  type SeparatorProps
} from 'react-resizable-panels'
import { create } from 'zustand'
import {
  applyPanelSizesPatch,
  type PanelSizeKey,
  type PanelSizes,
  type PanelSizesPatch
} from '@shared/panel-sizes'

type PanelSizeSpec = {
  /** px 记像素（窗口缩放时保持像素），% 记占所在面板组的百分比 */
  unit: 'px' | '%'
  defaultSize: number
  minSize: number | string
  maxSize: number | string
}

/** 侧栏：默认 280px，最窄 200px，最宽不超过所在区域一半 */
const SIDEBAR: PanelSizeSpec = { unit: 'px', defaultSize: 280, minSize: 200, maxSize: '50%' }
/** 分栏：默认五五开，[20%, 80%] */
const SPLIT: PanelSizeSpec = { unit: '%', defaultSize: 50, minSize: '20%', maxSize: '80%' }

const SPECS: Record<PanelSizeKey, PanelSizeSpec> = {
  projectTree: SIDEBAR,
  treePanel: SIDEBAR,
  gitDetailsHeight: { unit: 'px', defaultSize: 250, minSize: 100, maxSize: 600 },
  gitDetailsSplit: SPLIT,
  contentSearchSplit: SPLIT
}

function initialPanelSizes(): PanelSizes {
  try {
    return window.api.getBootstrap().panelSizes
  } catch {
    // vitest / 非 Electron 环境
    return {}
  }
}

const usePanelSizes = create<PanelSizes>(() => initialPanelSizes())

/** 任一窗口记下或清掉尺寸，主进程推给全部窗口：整份替换本窗口的。 */
export function syncPanelSizesAcrossWindows(): () => void {
  return window.api.onPanelSizesChanged((sizes) => usePanelSizes.setState(sizes, true))
}

function savePanelSizes(patch: PanelSizesPatch): void {
  usePanelSizes.setState((sizes) => applyPanelSizesPatch(sizes, patch), true)
  void window.api.setPanelSizes(patch)
}

type Unit = PanelSizeSpec['unit']

/** 面板此刻的尺寸，按记的单位：像素取整，百分比留一位小数。像素取自 DOM，要在库的新布局提交到 DOM 之后读 */
function measure(panel: PanelImperativeHandle, unit: Unit): number {
  const { inPixels, asPercentage } = panel.getSize()
  return unit === 'px' ? Math.round(inPixels) : Math.round(asPercentage * 10) / 10
}

/**
 * 把面板摆成记住的尺寸。已经一样就不动——由库按它自己的布局判断，不拿 DOM 比：库刚改完布局、通知我们时 React
 * 还没提交，DOM 是旧的。面板组隐藏着（display:none，没有尺寸，没法换算）或库还没排过版（挂载时就隐藏着，
 * getLayout 为空）时先不动，等显示、排版之后再来。
 */
function align(
  panel: PanelImperativeHandle | null,
  group: GroupImperativeHandle | null,
  groupElement: HTMLElement | null,
  size: number,
  unit: Unit
): void {
  if (panel === null || group === null || groupElement === null) return
  if (groupElement.offsetWidth === 0 || Object.keys(group.getLayout()).length === 0) return
  panel.resize(`${size}${unit}`)
}

/**
 * 一个记住尺寸的面板（一个面板组里只有它一个记尺寸），返回分别接到面板组、面板、分隔线上的属性：
 * - 挂载即按记住的尺寸摆（在绘制之前）；没拖过用 fallback（默认取键表的）。只在用户拖完（指针或键盘）时记下。
 * - 库只在挂载时读默认尺寸，之后靠它的 resize 对齐，时机：尺寸变了（别处拖的、别的窗口拖的、双击回默认、
 *   恢复默认布局）、面板组重新有了尺寸（Tab 面板切走只隐藏）、库重排之后。库按它记的组尺寸换算，赶在它处理
 *   组尺寸变化之前对齐会算偏；它处理完会通知（onLayoutChanged），那时再对齐即对上。
 * - defaultSize 固定为出厂默认：记住的尺寸经 resize 摆上去；随记住的尺寸变的话，每变一次面板就在库里重新注册一次。
 * - 双击分隔线清掉这一项、回到默认：库自带的双击只会回到 defaultSize（不认 fallback，也不清掉记住的），故关掉自己处理。
 */
export function useRememberedPanel(
  key: PanelSizeKey,
  fallback?: number
): {
  groupProps: Pick<GroupProps, 'groupRef' | 'elementRef' | 'onLayoutChanged'>
  panelProps: Pick<
    PanelProps,
    'panelRef' | 'defaultSize' | 'minSize' | 'maxSize' | 'groupResizeBehavior'
  >
  handleProps: Pick<SeparatorProps, 'disableDoubleClick' | 'onDoubleClick'>
} {
  const { unit, minSize, maxSize, defaultSize } = SPECS[key]
  const size = usePanelSizes((sizes) => sizes[key]) ?? fallback ?? defaultSize
  const [panel, setPanel] = usePanelCallbackRef()
  const [group, setGroup] = useGroupCallbackRef()
  const [groupElement, setGroupElement] = useState<HTMLDivElement | null>(null)
  /** 用户拖完的次数：每次拖完，等这次布局提交到 DOM 之后再量（键盘调整时，通知先于提交） */
  const [userResizes, setUserResizes] = useState(0)

  useLayoutEffect(
    () => align(panel, group, groupElement, size, unit),
    [panel, group, groupElement, size, unit]
  )

  const onGroupResize = useEffectEvent(() => align(panel, group, groupElement, size, unit))
  useEffect(() => {
    if (groupElement === null) return
    const ro = new ResizeObserver(() => onGroupResize())
    ro.observe(groupElement)
    return () => ro.disconnect()
  }, [groupElement])

  const saveUserSize = useEffectEvent(() => {
    if (panel !== null) savePanelSizes({ [key]: measure(panel, unit) })
  })
  useLayoutEffect(() => {
    if (userResizes > 0) saveUserSize()
  }, [userResizes])

  return {
    groupProps: {
      groupRef: setGroup,
      elementRef: setGroupElement,
      onLayoutChanged: (_layout, meta) => {
        if (meta.isUserInteraction) setUserResizes((n) => n + 1)
        else align(panel, group, groupElement, size, unit)
      }
    },
    panelProps: {
      panelRef: setPanel,
      defaultSize: `${defaultSize}${unit}`,
      minSize,
      maxSize,
      groupResizeBehavior: unit === 'px' ? 'preserve-pixel-size' : 'preserve-relative-size'
    },
    handleProps: {
      disableDoubleClick: true,
      onDoubleClick: () => savePanelSizes({ [key]: null })
    }
  }
}
