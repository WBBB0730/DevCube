import { describe, expect, it } from 'vitest'
import {
  classifyFilesOpenKind,
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

  it('未知二进制扩展走 other', () => {
    expect(classifyFilesOpenKind('a.wasm')).toBe('other')
    expect(classifyFilesOpenKind('font.woff2')).toBe('other')
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
