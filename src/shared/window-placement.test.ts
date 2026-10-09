import { describe, expect, it } from 'vitest'
import {
  centerInArea,
  isPlacementOnSomeDisplay,
  normalizeWindowPlacements,
  resolveWindowPlacement
} from './window-placement'

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1080 }
const SECONDARY = { x: 1920, y: 0, width: 1920, height: 1080 }
const DEFAULTS = { width: 1100, height: 720, minWidth: 720, minHeight: 480 }

describe('isPlacementOnSomeDisplay', () => {
  it('完全在主屏内为 true', () => {
    expect(isPlacementOnSomeDisplay({ x: 100, y: 100, width: 1100, height: 720 }, [PRIMARY])).toBe(
      true
    )
  })

  it('在副屏内为 true', () => {
    expect(
      isPlacementOnSomeDisplay({ x: 2000, y: 80, width: 1100, height: 720 }, [PRIMARY, SECONDARY])
    ).toBe(true)
  })

  it('跨屏或越界为 false', () => {
    expect(isPlacementOnSomeDisplay({ x: 1500, y: 100, width: 1100, height: 720 }, [PRIMARY])).toBe(
      false
    )
  })
})

describe('resolveWindowPlacement', () => {
  it('无记忆时用默认宽高且不带坐标', () => {
    expect(resolveWindowPlacement(null, DEFAULTS, [PRIMARY])).toEqual({
      width: 1100,
      height: 720,
      isMaximized: false,
      isFullScreen: false
    })
  })

  it('显示器已消失时退回默认', () => {
    expect(
      resolveWindowPlacement(
        {
          x: 2000,
          y: 80,
          width: 1100,
          height: 720,
          isMaximized: true,
          isFullScreen: false
        },
        DEFAULTS,
        [PRIMARY]
      )
    ).toEqual({
      width: 1100,
      height: 720,
      isMaximized: false,
      isFullScreen: false
    })
  })

  it('有效记忆时保留几何与最大化/全屏', () => {
    expect(
      resolveWindowPlacement(
        {
          x: 120,
          y: 80,
          width: 1000,
          height: 700,
          isMaximized: true,
          isFullScreen: false
        },
        DEFAULTS,
        [PRIMARY]
      )
    ).toEqual({
      x: 120,
      y: 80,
      width: 1000,
      height: 700,
      isMaximized: true,
      isFullScreen: false
    })
  })

  it('宽高低于最小值时抬升', () => {
    const resolved = resolveWindowPlacement(
      {
        x: 10,
        y: 10,
        width: 100,
        height: 100,
        isMaximized: false,
        isFullScreen: false
      },
      DEFAULTS,
      [PRIMARY]
    )
    expect(resolved.width).toBe(720)
    expect(resolved.height).toBe(480)
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
