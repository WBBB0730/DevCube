import { describe, expect, it } from 'vitest'
import { buildFilesAssetUrl, buildFilesMediaUrl, buildFilesTileUrl } from './files'

describe('dc-media URL', () => {
  it('项目内文件：p / f / m 三个参数，主进程按 f 解析', () => {
    const u = new URL(buildFilesMediaUrl('/p', '/p/a b.png', 'image/png'))
    expect(u.protocol).toBe('dc-media:')
    expect(u.searchParams.get('p')).toBe('/p')
    expect(u.searchParams.get('f')).toBe('/p/a b.png')
    expect(u.searchParams.get('m')).toBe('image/png')
  })

  it('瓦片缓存：t 为键，f 相对键目录', () => {
    const u = new URL(buildFilesTileUrl('ab', 'image_files/12/3_4.jpeg', 'image/jpeg'))
    expect(u.searchParams.get('t')).toBe('ab')
    expect(u.searchParams.get('f')).toBe('image_files/12/3_4.jpeg')
  })

  it('静态资源前缀：以 / 结尾、f 在末位，可直接拼文件名后仍能解析', () => {
    const prefix = buildFilesAssetUrl('pdfjs', 'cmaps/')
    expect(prefix.endsWith('/')).toBe(true)
    expect(prefix).toBe('dc-media://local/?a=pdfjs&f=cmaps/')
    const u = new URL(`${prefix}UniGB-UCS2-H.bcmap`)
    expect(u.searchParams.get('a')).toBe('pdfjs')
    expect(u.searchParams.get('f')).toBe('cmaps/UniGB-UCS2-H.bcmap')
  })
})
