import { describe, expect, it } from 'vitest'
import {
  classifyFilesOpenKind,
  filesOpenKindFromMime,
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

  it('非媒体 MIME → null', () => {
    expect(filesOpenKindFromMime('application/wasm')).toBeNull()
    expect(filesOpenKindFromMime('application/pdf')).toBeNull()
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
