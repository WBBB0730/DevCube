/**
 * 设置 → 快捷键只读列表（展示用；绑定仍由 matchAppShortcut 与各视图自己的键盘处理决定）。
 * 按使用场景分组，多处都有、行为一致的键只在「通用」列一次；收录范围见 docs/prd/settings-keymap.md。
 */

import {
  deleteEntryShortcut,
  formatShortcutLabel,
  SHORTCUT,
  type ShortcutChord
} from './shortcut-label'

export type AppShortcutListRow = {
  label: string
  /** 按平台给出键位文案 */
  keys: (platform: string) => string
  /** 只在这些平台出现；不给即全平台 */
  platforms?: readonly string[]
}

export type AppShortcutListGroup = { title: string; rows: AppShortcutListRow[] }

/** 一个或几个组合：成对的动作（上一个 / 下一个）合成一行，以「 / 」隔开。 */
function chords(...list: ShortcutChord[]): (platform: string) => string {
  return chordsBy(() => list)
}

/** 组合随平台不同（如 Windows 多一个、macOS 另有补全键） */
function chordsBy(pick: (platform: string) => ShortcutChord[]): (platform: string) => string {
  return (platform) =>
    pick(platform)
      .map((c) => formatShortcutLabel(c, platform))
      .join(' / ')
}

/** Tab 1…9：键位写作 `⌘ 1…9` / `Ctrl + 1…9`，避免占位符 N 与「新建」等键冲突歧义。 */
export function formatSelectTabRangeShortcut(platform: string): string {
  return formatShortcutLabel({ mod: true, key: '1…9' }, platform)
}

const NOT_MAC = ['win32', 'linux'] as const
const UP: ShortcutChord = { key: 'ArrowUp' }
const DOWN: ShortcutChord = { key: 'ArrowDown' }
const LEFT: ShortcutChord = { key: 'ArrowLeft' }
const RIGHT: ShortcutChord = { key: 'ArrowRight' }
const TERMINAL_COPY: ShortcutChord = { ctrl: true, shift: true, key: 'C' }
const TERMINAL_PASTE: ShortcutChord = { ctrl: true, shift: true, key: 'V' }
const COMPLETION: ShortcutChord = { ctrl: true, key: 'Space' }

export const APP_SHORTCUT_GROUPS: AppShortcutListGroup[] = [
  {
    title: '通用',
    rows: [
      { label: '查找', keys: chords(SHORTCUT.find) },
      { label: '查找下一个 / 上一个', keys: chords(SHORTCUT.findNext, SHORTCUT.findPrev) },
      { label: '最近打开的文件或数据源对象', keys: chords(SHORTCUT.recentFiles) }
    ]
  },
  {
    title: '项目与 Tab',
    rows: [
      { label: '聚焦项目、服务器和数据源筛选', keys: chords(SHORTCUT.projectFilter) },
      {
        label: '上一个 / 下一个项目、服务器或数据源',
        keys: chords(SHORTCUT.prevProject, SHORTCUT.nextProject)
      },
      { label: '上一个 / 下一个 Tab', keys: chords(SHORTCUT.prevTab, SHORTCUT.nextTab) },
      {
        label: '循环下一个 / 上一个 Tab',
        keys: chords(SHORTCUT.cycleTabNext, SHORTCUT.cycleTabPrev)
      },
      { label: '选择第 n 个 Tab', keys: formatSelectTabRangeShortcut },
      { label: '新建终端或数据源标签页', keys: chords(SHORTCUT.newTerminal) },
      { label: '关闭 Tab', keys: chords(SHORTCUT.closeTab) }
    ]
  },
  {
    title: '文件',
    rows: [
      { label: '聚焦文件筛选或前往路径', keys: chords(SHORTCUT.filesFilter) },
      { label: '搜索文件内容', keys: chords(SHORTCUT.contentSearch) },
      { label: '保存服务器上的文件', keys: chords(SHORTCUT.save) },
      { label: '上一个 / 下一个媒体文件', keys: chords(LEFT, RIGHT) },
      { label: 'PDF / PPT 上一页 / 下一页', keys: chords(UP, DOWN) },
      {
        label: '适应窗口 / 放大 / 缩小',
        keys: chords(SHORTCUT.fitWindow, { mod: true, key: '+' }, { mod: true, key: '-' })
      },
      { label: '拖动画面（PDF、PPT）', keys: () => '按住空格拖动' }
    ]
  },
  {
    title: '文件树',
    rows: [
      { label: '上一行 / 下一行', keys: chords(UP, DOWN) },
      {
        label: '向上 / 向下扩大选择',
        keys: chords({ shift: true, key: 'ArrowUp' }, { shift: true, key: 'ArrowDown' })
      },
      { label: '收起 / 展开', keys: chords(LEFT, RIGHT) },
      { label: '进入文件', keys: chords({ key: 'Enter' }) },
      { label: '重命名', keys: chords({ key: 'F2' }) },
      { label: '删除', keys: chordsBy((platform) => [deleteEntryShortcut(platform)]) }
    ]
  },
  {
    title: 'Git',
    rows: [
      { label: '刷新', keys: chords(SHORTCUT.refresh) },
      {
        label: '查找下一个 / 上一个',
        keys: chords({ key: 'F3' }, { shift: true, key: 'F3' })
      },
      {
        label: 'Diff 下一处 / 上一处改动',
        keys: chords(SHORTCUT.diffNextBlock, SHORTCUT.diffPrevBlock)
      },
      {
        label: 'Diff 上一个 / 下一个文件',
        keys: chords(SHORTCUT.diffPrevFile, SHORTCUT.diffNextFile)
      }
    ]
  },
  {
    title: '终端',
    rows: [
      {
        label: '复制选中的文字',
        keys: chordsBy((platform) =>
          platform === 'win32' ? [TERMINAL_COPY, { ctrl: true, key: 'C' }] : [TERMINAL_COPY]
        ),
        platforms: NOT_MAC
      },
      {
        label: '粘贴',
        keys: chordsBy((platform) =>
          platform === 'win32' ? [{ ctrl: true, key: 'V' }, TERMINAL_PASTE] : [TERMINAL_PASTE]
        ),
        platforms: NOT_MAC
      }
    ]
  },
  {
    title: '数据源',
    rows: [
      { label: '执行光标所在的语句或选中的部分', keys: chords(SHORTCUT.runStatement) },
      {
        label: '唤起补全',
        keys: chordsBy((platform) =>
          platform === 'darwin'
            ? [COMPLETION, { alt: true, key: '`' }, { alt: true, key: 'I' }]
            : [COMPLETION]
        )
      },
      { label: '表格全选', keys: chords({ mod: true, key: 'A' }) },
      { label: '表格扩大选区', keys: chords({ shift: true, key: '方向键' }) }
    ]
  }
]

/** 当前平台要显示的分组与条目（键位已格式化）；某组没有条目时整组不出。 */
export function appShortcutGroupsFor(
  platform: string
): { title: string; rows: { label: string; keys: string }[] }[] {
  return APP_SHORTCUT_GROUPS.map((group) => ({
    title: group.title,
    rows: group.rows
      .filter((row) => row.platforms === undefined || row.platforms.includes(platform))
      .map((row) => ({ label: row.label, keys: row.keys(platform) }))
  })).filter((group) => group.rows.length > 0)
}
