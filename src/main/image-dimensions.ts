// 图片像素尺寸：image-size 只读文件头，再按 EXIF 方向换成显示宽高。Files 看图与 Git 二进制 diff 共用。

import { imageSize } from 'image-size'

export interface ImageDimensions {
  width: number
  height: number
}

/** EXIF 方向 5–8 是转 90°，显示宽高与文件头相反（Chromium `<img>` 默认按 EXIF 转正）。 */
export function orientedSize(dim: {
  width: number
  height: number
  orientation?: number
}): ImageDimensions {
  const swap = dim.orientation !== undefined && dim.orientation >= 5 && dim.orientation <= 8
  return swap ? { width: dim.height, height: dim.width } : { width: dim.width, height: dim.height }
}

/** 内存里图片字节的显示宽高；格式不认识或读不出为 undefined。 */
export function imageDimensionsOf(bytes: Uint8Array): ImageDimensions | undefined {
  try {
    const dim = imageSize(bytes)
    return dim.width && dim.height ? orientedSize(dim) : undefined
  } catch {
    return undefined
  }
}
