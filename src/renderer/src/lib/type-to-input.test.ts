import { describe, expect, it } from 'vitest'
import { typeToInputEdit } from './type-to-input'

const press = (
  key: string,
  mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}
): { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean } => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods
})

describe('typeToInputEdit', () => {
  it('可打印字符接在后面（含空格与中文标点）', () => {
    expect(typeToInputEdit('ab', press('c'))).toEqual({ kind: 'set', query: 'abc' })
    expect(typeToInputEdit('', press(' '))).toEqual({ kind: 'set', query: ' ' })
    expect(typeToInputEdit('a', press('，'))).toEqual({ kind: 'set', query: 'a，' })
  })

  it('带 ⌘ / Ctrl / ⌥ 的按键留给树（快捷键）', () => {
    expect(typeToInputEdit('a', press('c', { metaKey: true }))).toBeNull()
    expect(typeToInputEdit('a', press('c', { ctrlKey: true }))).toBeNull()
    expect(typeToInputEdit('a', press('c', { altKey: true }))).toBeNull()
  })

  it('退格删一个；输入已空时不管', () => {
    expect(typeToInputEdit('abc', press('Backspace'))).toEqual({ kind: 'set', query: 'ab' })
    expect(typeToInputEdit('', press('Backspace'))).toBeNull()
  })

  it('Esc 有内容才清空；只有空白算没内容', () => {
    expect(typeToInputEdit('ab', press('Escape'))).toEqual({ kind: 'clear' })
    expect(typeToInputEdit('', press('Escape'))).toBeNull()
    expect(typeToInputEdit('  ', press('Escape'))).toBeNull()
  })

  it('方向键、回车等功能键留给树', () => {
    expect(typeToInputEdit('a', press('ArrowDown'))).toBeNull()
    expect(typeToInputEdit('a', press('Enter'))).toBeNull()
    expect(typeToInputEdit('a', press('Tab'))).toBeNull()
  })
})
