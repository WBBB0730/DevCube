import { describe, expect, it } from 'vitest'
import {
  classifyFilesOpenKind,
  filesOpenKindFromMime,
  adjacentMediaPath,
  isImagePreviewPath,
  isMediaPreviewPath,
  isMarkdownPath,
  isPptxPath,
  isPreviewableSourcePath,
  isSvgPath,
  primaryMime,
  resolveFilesOpenKind,
  sniffTextBuffer
} from './files-kind'

describe('classifyFilesOpenKind', () => {
  it('源码与配置走 text', () => {
    expect(classifyFilesOpenKind('app.ts')).toBe('text')
    expect(classifyFilesOpenKind('a.tsx')).toBe('text')
    expect(classifyFilesOpenKind('package.json')).toBe('text')
    expect(classifyFilesOpenKind('icon.svg')).toBe('text')
    expect(classifyFilesOpenKind('.env')).toBe('text')
    expect(classifyFilesOpenKind('Dockerfile')).toBe('text')
  })

  it('位图走 image', () => {
    expect(classifyFilesOpenKind('a.png')).toBe('image')
    expect(classifyFilesOpenKind('b.JPEG')).toBe('image')
  })

  it('未知二进制扩展走 other（音视频靠 MIME，不靠扩展名）', () => {
    expect(classifyFilesOpenKind('a.wasm')).toBe('other')
    expect(classifyFilesOpenKind('font.woff2')).toBe('other')
    expect(classifyFilesOpenKind('clip.mp4')).toBe('other')
    expect(classifyFilesOpenKind('track.mp3')).toBe('other')
  })
})

describe('filesOpenKindFromMime / primaryMime', () => {
  it('去掉 codecs 参数', () => {
    expect(primaryMime('audio/ogg; codecs=vorbis')).toBe('audio/ogg')
  })

  it('可播音视频 → audio / video', () => {
    expect(filesOpenKindFromMime('audio/mpeg')).toBe('audio')
    expect(filesOpenKindFromMime('audio/mp4')).toBe('audio')
    expect(filesOpenKindFromMime('audio/ogg; codecs=opus')).toBe('audio')
    expect(filesOpenKindFromMime('video/mp4')).toBe('video')
    expect(filesOpenKindFromMime('video/webm')).toBe('video')
  })

  it('Chromium 不可播的音视频 → other（直接占位）', () => {
    expect(filesOpenKindFromMime('video/matroska')).toBe('other')
    expect(filesOpenKindFromMime('audio/matroska')).toBe('other')
    expect(filesOpenKindFromMime('video/x-ms-asf')).toBe('other')
    expect(filesOpenKindFromMime('audio/x-ms-asf')).toBe('other')
  })

  it('位图 → image；svg → text', () => {
    expect(filesOpenKindFromMime('image/png')).toBe('image')
    expect(filesOpenKindFromMime('image/jpeg')).toBe('image')
    expect(filesOpenKindFromMime('image/svg+xml')).toBe('text')
  })

  it('PDF → pdf', () => {
    expect(filesOpenKindFromMime('application/pdf')).toBe('pdf')
  })

  it('PPT（pptx 及放映版 / 模板 / 带宏变体）→ pptx；老二进制 ppt 不认', () => {
    for (const mime of [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
      'application/vnd.openxmlformats-officedocument.presentationml.template',
      'application/vnd.ms-powerpoint.presentation.macroenabled.12',
      'application/vnd.ms-powerpoint.slideshow.macroenabled.12',
      'application/vnd.ms-powerpoint.template.macroenabled.12'
    ]) {
      expect(filesOpenKindFromMime(mime)).toBe('pptx')
    }
    expect(filesOpenKindFromMime('application/vnd.ms-powerpoint')).toBeNull()
    expect(filesOpenKindFromMime('application/x-cfb')).toBeNull()
  })

  it('非媒体 MIME → null', () => {
    expect(filesOpenKindFromMime('application/wasm')).toBeNull()
    expect(filesOpenKindFromMime('application/zip')).toBeNull()
  })
})

describe('isMarkdownPath / isSvgPath / isPreviewableSourcePath', () => {
  it('Markdown 扩展名', () => {
    expect(isMarkdownPath('README.md')).toBe(true)
    expect(isMarkdownPath('a.markdown')).toBe(true)
    expect(isMarkdownPath('a.mdx')).toBe(false)
  })

  it('SVG 扩展名', () => {
    expect(isSvgPath('icon.svg')).toBe(true)
    expect(isSvgPath('ICON.SVG')).toBe(true)
    expect(isSvgPath('a.svgx')).toBe(false)
  })

  it('仅 Markdown / SVG 可切预览', () => {
    expect(isPreviewableSourcePath('a.md')).toBe(true)
    expect(isPreviewableSourcePath('a.svg')).toBe(true)
    expect(isPreviewableSourcePath('a.ts')).toBe(false)
    expect(isPreviewableSourcePath('a.png')).toBe(false)
  })
})

describe('isImagePreviewPath / isMediaPreviewPath / adjacentMediaPath', () => {
  it('位图与 SVG 可看图，源码不行', () => {
    expect(isImagePreviewPath('a.png')).toBe(true)
    expect(isImagePreviewPath('ICON.SVG')).toBe(true)
    expect(isImagePreviewPath('a.ts')).toBe(false)
    expect(isImagePreviewPath('clip.mp4')).toBe(false)
  })

  it('媒体序列含位图 / SVG / PDF / PPT / 可播音视频，不含文本、不可播容器与老 ppt', () => {
    for (const p of ['a.png', 'b.svg', 'c.pdf', 'd.mp4', 'e.mp3', 'F.WEBM', 'g.pptx', 'H.PPSX']) {
      expect(isMediaPreviewPath(p)).toBe(true)
    }
    for (const p of ['a.ts', 'README.md', 'movie.mkv', 'noext', 'old.ppt']) {
      expect(isMediaPreviewPath(p)).toBe(false)
    }
  })

  it('PPT 按扩展名：pptx 与同格式的放映版 / 模板 / 带宏变体', () => {
    for (const p of ['a.pptx', 'b.ppsx', 'c.potx', 'd.pptm', 'e.ppsm', 'f.potm', 'G.PPTX']) {
      expect(isPptxPath(p)).toBe(true)
    }
    for (const p of ['old.ppt', 'a.pps', 'a.pptx.bak', '/dir.pptx/noext']) {
      expect(isPptxPath(p)).toBe(false)
    }
  })

  it('按给定序取上一个 / 下一个媒体，跨类型，到头不回绕', () => {
    const entries = [
      { path: '/p/dir', isDirectory: true },
      { path: '/p/a.png', isDirectory: false },
      { path: '/p/note.ts', isDirectory: false },
      { path: '/p/b.svg', isDirectory: false },
      { path: '/p/c.jpg', isDirectory: false }
    ]
    expect(adjacentMediaPath(entries, '/p/a.png', 1)).toBe('/p/b.svg')
    expect(adjacentMediaPath(entries, '/p/b.svg', 1)).toBe('/p/c.jpg')
    expect(adjacentMediaPath(entries, '/p/c.jpg', 1)).toBeNull()
    expect(adjacentMediaPath(entries, '/p/a.png', -1)).toBeNull()
    expect(adjacentMediaPath(entries, '/p/c.jpg', -1)).toBe('/p/b.svg')
  })

  it('当前路径不在看图序列里 → null', () => {
    expect(
      adjacentMediaPath([{ path: '/p/a.png', isDirectory: false }], '/p/missing.png', 1)
    ).toBeNull()
  })
})

describe('sniffTextBuffer / resolveFilesOpenKind', () => {
  it('NUL 判为非文本', () => {
    expect(sniffTextBuffer(Uint8Array.from([0x68, 0x00, 0x69]))).toBe(false)
  })

  it('UTF-8 文本嗅探通过', () => {
    const enc = new TextEncoder().encode('hello 世界\n')
    expect(sniffTextBuffer(enc)).toBe(true)
  })

  it('未知扩展 + 文本缓冲 → text', () => {
    const enc = new TextEncoder().encode('plain')
    expect(resolveFilesOpenKind('weird', enc)).toBe('text')
  })

  it('未知扩展 + 二进制缓冲 → other', () => {
    expect(resolveFilesOpenKind('weird', Uint8Array.from([0, 1, 2]))).toBe('other')
  })
})
