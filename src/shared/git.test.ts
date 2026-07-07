// shared/git 纯函数测试：图片扩展名 → MIME 判定（imageMimeOf）。
import { describe, expect, it } from 'vitest'
import { imageMimeOf } from './git'

describe('imageMimeOf', () => {
  it('常见图片扩展名给出对应 MIME（大小写不敏感）', () => {
    expect(imageMimeOf('a/b/logo.png')).toBe('image/png')
    expect(imageMimeOf('photo.JPG')).toBe('image/jpeg')
    expect(imageMimeOf('anim.webp')).toBe('image/webp')
  })

  it('非图片与无扩展名返回 null', () => {
    expect(imageMimeOf('src/main.ts')).toBeNull()
    expect(imageMimeOf('Makefile')).toBeNull()
  })

  it('svg 走文本 diff，不作为图片预览', () => {
    expect(imageMimeOf('icon.svg')).toBeNull()
  })
})
