import { describe, expect, it } from 'vitest'
import { appShortcutGroupsFor, formatSelectTabRangeShortcut } from './app-shortcut-list'

describe('formatSelectTabRangeShortcut', () => {
  it('macOS：⌘ 1…9', () => {
    expect(formatSelectTabRangeShortcut('darwin')).toBe('⌘ 1…9')
  })

  it('Windows：Ctrl + 1…9', () => {
    expect(formatSelectTabRangeShortcut('win32')).toBe('Ctrl + 1…9')
  })
})

describe('appShortcutGroupsFor', () => {
  const row = (platform: string, group: string, label: string): string | undefined =>
    appShortcutGroupsFor(platform)
      .find((g) => g.title === group)
      ?.rows.find((r) => r.label === label)?.keys

  it('分组按场景排列', () => {
    expect(appShortcutGroupsFor('linux').map((g) => g.title)).toEqual([
      '通用',
      '项目与 Tab',
      '文件',
      '文件树',
      'Git',
      '终端',
      '数据源'
    ])
  })

  it('终端复制粘贴只在 Windows / Linux 出现，macOS 整组不出', () => {
    expect(appShortcutGroupsFor('darwin').some((g) => g.title === '终端')).toBe(false)
    expect(row('win32', '终端', '复制选中的文字')).toBe('Ctrl + Shift + C / Ctrl + C')
    expect(row('win32', '终端', '粘贴')).toBe('Ctrl + V / Ctrl + Shift + V')
    expect(row('linux', '终端', '复制选中的文字')).toBe('Ctrl + Shift + C')
    expect(row('linux', '终端', '粘贴')).toBe('Ctrl + Shift + V')
  })

  it('成对的动作合成一行', () => {
    expect(row('darwin', '项目与 Tab', '上一个 / 下一个 Tab')).toBe('⌥ ⌘ ← / ⌥ ⌘ →')
    expect(row('win32', 'Git', 'Diff 下一处 / 上一处改动')).toBe('F7 / Shift + F7')
  })

  it('按平台给出不同的键', () => {
    expect(row('darwin', '文件树', '删除')).toBe('⌘ ⌫')
    expect(row('win32', '文件树', '删除')).toBe('Delete')
    expect(row('darwin', '数据源', '唤起补全')).toBe('⌃ Space / ⌥ ` / ⌥ I')
    expect(row('linux', '数据源', '唤起补全')).toBe('Ctrl + Space')
  })
})
