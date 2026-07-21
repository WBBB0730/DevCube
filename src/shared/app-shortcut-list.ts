/** 设置 → 快捷键只读列表（展示用；绑定仍由 matchAppShortcut 决定）。 */

import { formatShortcutLabel, SHORTCUT, type ShortcutChord } from './shortcut-label'

export type AppShortcutListRow = {
  label: string
  /** 单一组合；与 formatKeys 二选一 */
  chord?: ShortcutChord
  /** 占位符键（如 N）等无法用字面 chord 表达时 */
  formatKeys?: (platform: string) => string
}

/** Tab 1…9：键位写作 `⌘ 1…9` / `Ctrl+1…9`，避免占位符 N 与「新建」等键冲突歧义。 */
export function formatSelectTabRangeShortcut(platform: string): string {
  return formatShortcutLabel({ mod: true, key: '1…9' }, platform)
}

export const APP_SHORTCUT_LIST: AppShortcutListRow[] = [
  { label: '聚焦项目筛选', chord: SHORTCUT.projectFilter },
  { label: '聚焦文件筛选', chord: SHORTCUT.filesFilter },
  { label: '上一个项目', chord: SHORTCUT.prevProject },
  { label: '下一个项目', chord: SHORTCUT.nextProject },
  { label: '上一个 Tab', chord: SHORTCUT.prevTab },
  { label: '下一个 Tab', chord: SHORTCUT.nextTab },
  { label: '新建终端', chord: SHORTCUT.newTerminal },
  { label: '关闭 Tab', chord: SHORTCUT.closeTab },
  { label: '循环下一个 Tab', chord: SHORTCUT.cycleTabNext },
  { label: '循环上一个 Tab', chord: SHORTCUT.cycleTabPrev },
  { label: '选择第 n 个 Tab', formatKeys: formatSelectTabRangeShortcut }
]
