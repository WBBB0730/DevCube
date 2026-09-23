import { describe, expect, it } from 'vitest'
import { filesTreeIconKind } from './files-tree-icon'

describe('filesTreeIconKind', () => {
  it('按扩展名归大类', () => {
    expect(filesTreeIconKind('a.png')).toBe('image')
    expect(filesTreeIconKind('icon.SVG')).toBe('image')
    expect(filesTreeIconKind('spec.pdf')).toBe('pdf')
    expect(filesTreeIconKind('deck.pptx')).toBe('slides')
    expect(filesTreeIconKind('show.PPSX')).toBe('slides')
    expect(filesTreeIconKind('track.mp3')).toBe('audio')
    expect(filesTreeIconKind('clip.mp4')).toBe('video')
    expect(filesTreeIconKind('README.md')).toBe('text')
    expect(filesTreeIconKind('notes.txt')).toBe('text')
    expect(filesTreeIconKind('package.json')).toBe('json')
    expect(filesTreeIconKind('data.csv')).toBe('sheet')
    expect(filesTreeIconKind('book.xlsx')).toBe('sheet')
    expect(filesTreeIconKind('old.XLS')).toBe('sheet')
    expect(filesTreeIconKind('run.sh')).toBe('shell')
    expect(filesTreeIconKind('dist.tar.gz')).toBe('archive')
  })

  it('源码 / 配置 / 无扩展名文本文件当代码，未知二进制是普通文件', () => {
    expect(filesTreeIconKind('app.ts')).toBe('code')
    expect(filesTreeIconKind('.env')).toBe('code')
    expect(filesTreeIconKind('Dockerfile')).toBe('code')
    expect(filesTreeIconKind('a.wasm')).toBe('file')
    expect(filesTreeIconKind('noext')).toBe('file')
  })
})
