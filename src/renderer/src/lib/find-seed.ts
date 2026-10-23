// 查找（⌘F）的预填：打开查找时有选中的文字就填进查找框（同 VS Code / JetBrains），各处查找共用。
import { escapeRegExp } from './text-find'

/**
 * 由选中的文字得出预填词；null 为不预填、沿用原查询。没选中或跨行不预填（查找框是单行输入框，同 VS Code）；
 * 开着正则时转义成字面量（同 VS Code）。
 */
export function findSeed(selection: string, regexp: boolean): string | null {
  if (selection === '' || /[\r\n]/.test(selection)) return null
  return regexp ? escapeRegExp(selection) : selection
}

/** 页面上选中的文字（预览、Git 面板等页面文字）；选区不全在 root 内时为空串。 */
export function selectedTextWithin(root: Node | null): string {
  const selection = window.getSelection()
  if (root === null || selection === null || selection.isCollapsed) return ''
  const inside = root.contains(selection.anchorNode) && root.contains(selection.focusNode)
  return inside ? selection.toString() : ''
}
