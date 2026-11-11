import { describe, expect, it } from 'vitest'
import {
  centerInArea,
  fitInArea,
  nextWindowPlacement,
  normalizeWindowPlacements,
  resolveWindowPlacement,
  windowPlacementsEqual,
  type ScreenLayout
} from './window-placement'

const PRIMARY = {
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 25, width: 1920, height: 1055 }
}
/** 竖放在主屏右侧、上下错开的副屏 */
const PORTRAIT = {
  bounds: { x: 1920, y: -293, width: 1080, height: 1920 },
  workArea: { x: 1920, y: -293, width: 1080, height: 1920 }
}
const ONE_SCREEN: ScreenLayout = { displays: [PRIMARY], primaryWorkArea: PRIMARY.workArea }
const TWO_SCREENS: ScreenLayout = {
  displays: [PRIMARY, PORTRAIT],
  primaryWorkArea: PRIMARY.workArea
}
const DEFAULTS = { width: 1100, height: 720, minWidth: 720, minHeight: 480 }
const DEFAULT_PLACEMENT = {
  x: 410,
  y: 193,
  width: 1100,
  height: 720,
  isMaximized: false,
  isFullScreen: false
}

function placement(
  x: number,
  y: number,
  width: number,
  height: number,
  state: { isMaximized?: boolean; isFullScreen?: boolean } = {}
): {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
  isFullScreen: boolean
} {
  return {
    x,
    y,
    width,
    height,
    isMaximized: state.isMaximized ?? false,
    isFullScreen: state.isFullScreen ?? false
  }
}

describe('resolveWindowPlacement', () => {
  it('无记忆时默认大小摆在主显示器工作区正中', () => {
    expect(resolveWindowPlacement(null, DEFAULTS, TWO_SCREENS)).toEqual(DEFAULT_PLACEMENT)
  })

  it('与所有显示器都不相交时退回默认', () => {
    expect(
      resolveWindowPlacement(
        placement(2000, 80, 1100, 720, { isMaximized: true }),
        DEFAULTS,
        ONE_SCREEN
      )
    ).toEqual(DEFAULT_PLACEMENT)
  })

  it('完全在工作区内时保留几何与最大化/全屏', () => {
    const saved = placement(120, 80, 1000, 700, { isMaximized: true })
    expect(resolveWindowPlacement(saved, DEFAULTS, ONE_SCREEN)).toEqual(saved)
  })

  it('压边时收进所在显示器的工作区', () => {
    expect(resolveWindowPlacement(placement(1000, 600, 1100, 720), DEFAULTS, ONE_SCREEN)).toEqual(
      placement(820, 360, 1100, 720)
    )
  })

  it('跨两块屏时放到交集大的那块，状态照旧', () => {
    expect(
      resolveWindowPlacement(
        placement(1700, 100, 1000, 700, { isFullScreen: true }),
        DEFAULTS,
        TWO_SCREENS
      )
    ).toEqual(placement(1920, 100, 1000, 700, { isFullScreen: true }))
  })

  it('比工作区大时缩到放得下', () => {
    expect(resolveWindowPlacement(placement(0, 0, 2000, 1200), DEFAULTS, ONE_SCREEN)).toEqual(
      placement(0, 25, 1920, 1055)
    )
  })

  it('宽高低于最小值时抬升', () => {
    expect(resolveWindowPlacement(placement(10, 30, 100, 100), DEFAULTS, ONE_SCREEN)).toEqual(
      placement(10, 30, 720, 480)
    )
  })

  it('错开只作用于非最大化/全屏，错开后超出时收进工作区', () => {
    expect(
      resolveWindowPlacement(placement(100, 100, 1000, 680), DEFAULTS, ONE_SCREEN, 24)
    ).toEqual(placement(124, 124, 1000, 680))
    expect(
      resolveWindowPlacement(
        placement(100, 100, 1000, 680, { isMaximized: true }),
        DEFAULTS,
        ONE_SCREEN,
        24
      )
    ).toEqual(placement(100, 100, 1000, 680, { isMaximized: true }))
    expect(
      resolveWindowPlacement(placement(820, 360, 1100, 720), DEFAULTS, ONE_SCREEN, 24)
    ).toEqual(placement(820, 360, 1100, 720))
  })
})

describe('nextWindowPlacement', () => {
  const NORMAL = placement(100, 100, 1000, 700)
  const reading = (
    x: number,
    y: number,
    width: number,
    height: number,
    state: { isMinimized?: boolean; isMaximized?: boolean; isFullScreen?: boolean } = {}
  ): ReturnType<typeof placement> & { isMinimized: boolean } => ({
    ...placement(x, y, width, height, state),
    isMinimized: state.isMinimized ?? false
  })

  it('普通状态取实际矩形', () => {
    expect(
      nextWindowPlacement(
        placement(0, 25, 1920, 1055, { isMaximized: true }),
        reading(10, 40, 800, 600)
      )
    ).toEqual(placement(10, 40, 800, 600))
  })

  it('最大化时保持正常尺寸', () => {
    expect(nextWindowPlacement(NORMAL, reading(0, 25, 1920, 1055, { isMaximized: true }))).toEqual(
      placement(100, 100, 1000, 700, { isMaximized: true })
    )
  })

  it('全屏时保持正常尺寸与进全屏前是否最大化', () => {
    const maximized = placement(100, 100, 1000, 700, { isMaximized: true })
    expect(
      nextWindowPlacement(maximized, reading(0, 0, 1920, 1080, { isFullScreen: true }))
    ).toEqual(placement(100, 100, 1000, 700, { isMaximized: true, isFullScreen: true }))
  })

  it('最小化时整份不动', () => {
    expect(nextWindowPlacement(NORMAL, reading(0, 1080, 160, 28, { isMinimized: true }))).toEqual(
      NORMAL
    )
  })

  it('退出全屏后回到普通状态', () => {
    expect(
      nextWindowPlacement(
        placement(100, 100, 1000, 700, { isFullScreen: true }),
        reading(100, 100, 1000, 700)
      )
    ).toEqual(NORMAL)
  })
})

describe('windowPlacementsEqual', () => {
  it('位置、尺寸与状态都相同才相等', () => {
    const a = placement(10, 20, 800, 600, { isMaximized: true })
    expect(windowPlacementsEqual(a, { ...a })).toBe(true)
    expect(windowPlacementsEqual(a, { ...a, x: 11 })).toBe(false)
    expect(windowPlacementsEqual(a, { ...a, isFullScreen: true })).toBe(false)
  })
})

describe('fitInArea', () => {
  const AREA = { x: 0, y: 25, width: 1920, height: 1055 }

  it('在区域内时不动', () => {
    expect(fitInArea({ x: 100, y: 100, width: 800, height: 600 }, AREA)).toEqual({
      x: 100,
      y: 100,
      width: 800,
      height: 600
    })
  })

  it('越出时推回区域内', () => {
    expect(fitInArea({ x: -50, y: 900, width: 800, height: 600 }, AREA)).toEqual({
      x: 0,
      y: 480,
      width: 800,
      height: 600
    })
  })
})

describe('normalizeWindowPlacements', () => {
  const MAIN = { x: 10, y: 20, width: 1100, height: 720, isMaximized: false, isFullScreen: true }

  it('只留已知窗口里形状合法的记录，多余字段丢掉', () => {
    expect(
      normalizeWindowPlacements({
        main: { ...MAIN, extra: 1 },
        preview: { ...MAIN, width: '1000' },
        compress: MAIN
      })
    ).toEqual({ main: MAIN })
  })

  it('老档案没有这一项或不是对象时为空', () => {
    expect(normalizeWindowPlacements(undefined)).toEqual({})
    expect(normalizeWindowPlacements('main')).toEqual({})
  })
})

describe('centerInArea', () => {
  const AREA = { x: 1920, y: 25, width: 1920, height: 1055 }

  it('摆在区域正中', () => {
    expect(centerInArea({ width: 1100, height: 720 }, AREA)).toEqual({
      x: 2330,
      y: 193,
      width: 1100,
      height: 720
    })
  })

  it('错开时向右下移', () => {
    expect(centerInArea({ width: 1000, height: 680 }, AREA, 24)).toEqual({
      x: 2404,
      y: 237,
      width: 1000,
      height: 680
    })
  })

  it('比区域大或错开后超出时收进区域', () => {
    expect(
      centerInArea({ width: 1000, height: 680 }, { x: 0, y: 0, width: 800, height: 600 })
    ).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600
    })
    expect(
      centerInArea({ width: 1000, height: 680 }, { x: 0, y: 0, width: 1100, height: 700 }, 96)
    ).toEqual({
      x: 100,
      y: 20,
      width: 1000,
      height: 680
    })
  })
})
