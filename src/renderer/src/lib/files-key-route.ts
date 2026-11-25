/**
 * Files 面板的按键归属（docs/prd/files-tab.md「按键归属」、ADR-0066）：按焦点分文件树与正文两边，大部分键两边一样，
 * 少数只归一边。文件面板自己的键盘处理与各正文的键盘处理都按这一份判定，同一次按键只会有一个去处。
 */

/**
 * 一次按键的处境：
 * - blocked：弹窗或菜单开着，键归它们；
 * - typing：焦点在输入框或文本编辑器里，键是输入；
 * - content：进了正文（焦点在表格、PDF / PPT、Markdown 预览等「进得去」的正文里），正文自己要用的键归它；
 * - tree：焦点在文件树上，文件树自己的操作只在这时接；
 * - idle：其余位置（正文区上没进正文的地方、别处的按钮、无焦点），只接两边一样的键。
 */
export type FilesKeyScope = 'blocked' | 'typing' | 'content' | 'tree' | 'idle'

/** 当前栏的正文拿方向键做什么：看图换相邻媒体、音视频快退快进、分页文档（PDF / PPT）翻页；null 为用不上 */
export type FilesArrowContent = 'image' | 'av' | 'paged' | null

export type FilesArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

/** 方向键的去处：文件树、当前栏的正文；null 为都不接（留给输入、弹层或正文自己的原生处理） */
export type FilesArrowOwner = 'tree' | 'content' | null

export function isFilesArrowKey(key: string): key is FilesArrowKey {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight'
}

/**
 * 两边一样的键（播放、翻页滚动等）到不到得了当前栏的正文：焦点在文件树上或别处时都到；正在输入、弹层开着不到，
 * 进了正文的由正文自己原生处理
 */
export function reachesContent(scope: FilesKeyScope): boolean {
  return scope === 'tree' || scope === 'idle'
}

/**
 * 不带 ⌘ / Ctrl / ⌥ 的方向键归谁：
 * - ↑ / ↓ 换文件，两边一样，归文件树（在树上移动并打开）；带 ⇧ 的扩选是文件树自己的操作，焦点在树上才接；
 * - ← / → 是文件内前后，两边一样，归正文（看图换相邻媒体、音视频快退快进、分页文档翻页）；焦点在树上时，文件夹行
 *   与正文用不上这两个键的归文件树（开合、同 WebStorm 的树）；
 * - 进了正文：分页文档四个方向键都归它（翻页），其余正文不接、留给它们自己的原生处理（表格移格子、Markdown 滚动）。
 */
export function filesArrowOwner(
  key: FilesArrowKey,
  shift: boolean,
  ctx: {
    scope: FilesKeyScope
    /** 文件树的焦点行是文件夹 */
    treeRowIsDirectory: boolean
    content: FilesArrowContent
  }
): FilesArrowOwner {
  const { scope, content } = ctx
  if (scope === 'content') return !shift && content === 'paged' ? 'content' : null
  if (!reachesContent(scope)) return null
  const onTree = scope === 'tree'
  if (key === 'ArrowUp' || key === 'ArrowDown') return shift && !onTree ? null : 'tree'
  if (shift) return null
  if (onTree && (ctx.treeRowIsDirectory || content === null)) return 'tree'
  return content === null ? null : 'content'
}

/** 翻页滚动的键滚到哪：上一页 / 下一页（-1 / 1）、开头 / 结尾；不是这类键为 null。空格同 PageDown，⇧ 空格同 PageUp */
export type FilesScrollStep = -1 | 1 | 'start' | 'end'

export function filesScrollStep(key: string, shift: boolean): FilesScrollStep | null {
  if (key === ' ') return shift ? -1 : 1
  if (shift) return null
  if (key === 'PageUp') return -1
  if (key === 'PageDown') return 1
  if (key === 'Home') return 'start'
  if (key === 'End') return 'end'
  return null
}
