import { describe, expect, it } from 'vitest'
import {
  APP_SHORTCUT_GROUPS,
  appShortcutGroupsFor,
  formatSelectTabRangeShortcut,
  normalizeCollapsedShortcutGroups
} from './app-shortcut-list'

describe('formatSelectTabRangeShortcut', () => {
  it('macOS：⌘ 1…9', () => {
    expect(formatSelectTabRangeShortcut('darwin')).toBe('⌘ 1…9')
  })

  it('Windows：Ctrl + 1…9', () => {
    expect(formatSelectTabRangeShortcut('win32')).toBe('Ctrl + 1…9')
  })
})

describe('appShortcutGroupsFor', () => {
  const ON = { filesEditorTabs: true }
  const OFF = { filesEditorTabs: false }
  const row = (platform: string, group: string, label: string, prefs = ON): string | undefined =>
    appShortcutGroupsFor(platform, prefs)
      .find((g) => g.title === group)
      ?.rows.find((r) => r.label === label)?.keys

  it('分组按场景排列', () => {
    expect(appShortcutGroupsFor('linux', OFF).map((g) => g.title)).toEqual([
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
    expect(appShortcutGroupsFor('darwin', OFF).some((g) => g.title === '终端')).toBe(false)
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

describe('Editor Tab 的键', () => {
  const ON = { filesEditorTabs: true }
  const OFF = { filesEditorTabs: false }
  const row = (platform: string, label: string, prefs: typeof ON): string | undefined =>
    appShortcutGroupsFor(platform, prefs)
      .find((g) => g.title === '文件')
      ?.rows.find((r) => r.label === label)?.keys

  it('切换与分屏只在开着「启用编辑器标签页」时列出，关闭当前文件一直在', () => {
    expect(row('darwin', '上一个 / 下一个编辑器标签页', OFF)).toBeUndefined()
    expect(row('darwin', '向右分屏', OFF)).toBeUndefined()
    expect(row('darwin', '关闭当前文件', OFF)).toBe('⌘ W')
    expect(row('darwin', '向右分屏', ON)).toBe('⌘ \\')
  })

  it('切换键随平台不同', () => {
    expect(row('darwin', '上一个 / 下一个编辑器标签页', ON)).toBe('⇧ ⌘ [ / ⇧ ⌘ ]')
    expect(row('win32', '上一个 / 下一个编辑器标签页', ON)).toBe('Ctrl + PageUp / Ctrl + PageDown')
  })
})

describe('normalizeCollapsedShortcutGroups', () => {
  it('分组 id 不重复', () => {
    const ids = APP_SHORTCUT_GROUPS.map((g) => g.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('只留现有分组的 id，去重', () => {
    expect(normalizeCollapsedShortcutGroups(['git', 'removed', 42, 'git', 'terminal'])).toEqual([
      'git',
      'terminal'
    ])
  })

  it('不是数组时为全部展开', () => {
    for (const dirty of [undefined, null, 'git', {}]) {
      expect(normalizeCollapsedShortcutGroups(dirty)).toEqual([])
    }
  })
})
