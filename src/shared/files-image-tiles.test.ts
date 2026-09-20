import { describe, expect, it } from 'vitest'
import {
  FILES_IMAGE_TILE_MAX_EDGE,
  FILES_IMAGE_TILE_MIN_PIXELS,
  imageTileMime,
  imageTileRelPath,
  needsImageTiles,
  parseDzi
} from './files-image-tiles'

describe('needsImageTiles', () => {
  it.each([
    ['普通截图', 2560, 1440, false],
    ['2400 万像素相机图', 6000, 4000, false],
    ['像素数刚过线', 8000, 4001, true],
    ['长图单边过纹理上限', 4433, 25707, true],
    ['非法尺寸', 0, 100, false]
  ])('%s', (_name, w, h, expected) => {
    expect(needsImageTiles(w, h)).toBe(expected)
  })

  it('阈值常量与判定一致', () => {
    expect(needsImageTiles(FILES_IMAGE_TILE_MAX_EDGE, 1)).toBe(false)
    expect(needsImageTiles(FILES_IMAGE_TILE_MAX_EDGE + 1, 1)).toBe(true)
    expect(needsImageTiles(4000, FILES_IMAGE_TILE_MIN_PIXELS / 4000)).toBe(false)
    expect(needsImageTiles(4000, FILES_IMAGE_TILE_MIN_PIXELS / 4000 + 1)).toBe(true)
  })
})

describe('parseDzi', () => {
  // libvips dzsave 的真实输出：属性各占一行
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Image xmlns="http://schemas.microsoft.com/deepzoom/2008"\n' +
    '  Format="jpeg"\n' +
    '  Overlap="0"\n' +
    '  TileSize="512"\n' +
    '  >\n' +
    '  <Size \n' +
    '    Height="25707"\n' +
    '    Width="4433"\n' +
    '  />\n' +
    '</Image>\n'

  it('解析 sharp 写出的 dzi', () => {
    expect(parseDzi(xml)).toEqual({
      width: 4433,
      height: 25707,
      tileSize: 512,
      overlap: 0,
      format: 'jpeg'
    })
  })

  it('png 与 jpg 别名', () => {
    expect(parseDzi(xml.replace('Format="jpeg"', 'Format="png"'))?.format).toBe('png')
    expect(parseDzi(xml.replace('Format="jpeg"', 'Format="jpg"'))?.format).toBe('jpeg')
  })

  it('缺字段或非法值为 null', () => {
    expect(parseDzi('')).toBeNull()
    expect(parseDzi(xml.replace('TileSize="512"', ''))).toBeNull()
    expect(parseDzi(xml.replace('Format="jpeg"', 'Format="webp"'))).toBeNull()
    expect(parseDzi(xml.replace('Width="4433"', 'Width="0"'))).toBeNull()
  })
})

describe('tile paths', () => {
  it('Deep Zoom 目录布局', () => {
    expect(imageTileRelPath(12, 3, 40, 'jpeg')).toBe('image_files/12/3_40.jpeg')
    expect(imageTileMime('png')).toBe('image/png')
    expect(imageTileMime('jpeg')).toBe('image/jpeg')
  })
})
