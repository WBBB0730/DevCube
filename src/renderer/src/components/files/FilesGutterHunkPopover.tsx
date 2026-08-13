// Files gutter diff 弹窗（对齐 WebStorm 点击 VCS 条纹）：工具条（回滚该块 / 复制旧文本 /
// 上一个·下一个改动）+ 基线旧行预览（只读 mini CodeMirror，复用 Darcula 主题与语法高亮；
// added 无旧行只出工具条）。受控 Popover + 标准化虚拟锚点。关闭时机：Esc / 点外 / 滚动；
// 上下跳转是「先关 → 滚动并切光标 → 布局稳定后按新几何重开」，滚动发生时弹窗已关，
// 无须豁免逻辑。文档一变由 FilesPane 的 onChange 统一关闭。
import { useEffect, useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import { ChevronDown, ChevronUp, Copy, Undo2 } from 'lucide-react'
import {
  hunkPopupAnchor,
  hunkRollbackChange,
  type GitGutterHunkClickPayload
} from '@renderer/lib/cm6-git-gutter'
import {
  filesEditorTheme,
  filesHighlighting,
  languageExtensionForPath
} from '@renderer/lib/cm6-setup'
import { Popover, PopoverContent } from '@renderer/components/ui/popover'

/** 对齐 GitDiffView 头部图标钮：size-6 + hover 底。 */
const HUNK_BTN =
  'flex size-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--bg-button-hover)] disabled:pointer-events-none disabled:opacity-40'

export function FilesGutterHunkPopover({
  popup,
  filePath,
  onUpdate,
  onClose
}: {
  popup: GitGutterHunkClickPayload
  /** 当前打开文件（旧行预览按它选语言） */
  filePath: string
  /** 上一个 / 下一个改动跳转后带新锚点重开 */
  onUpdate: (next: GitGutterHunkClickPayload) => void
  onClose: () => void
}): React.JSX.Element {
  const { view, hunks, index } = popup
  const hunk = hunks[index]

  // 滚动即关（跳转时弹窗已先关闭再滚动，此处无须区分滚动来源）
  useEffect(() => {
    const scroller = view.scrollDOM
    const onScroll = (): void => onClose()
    scroller.addEventListener('scroll', onScroll)
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [view, onClose])

  const anchor = useMemo(
    () => ({ getBoundingClientRect: (): DOMRect => popup.anchor }),
    [popup.anchor]
  )

  const navigate = (dir: 1 | -1): void => {
    const nextIndex = index + dir
    if (nextIndex < 0 || nextIndex >= hunks.length) return
    const target = hunks[nextIndex]
    // 目标块锚定行（弹窗挂靠的尾行）滚到固定位：编辑器上 40% 处，弹窗位置可预期
    const line = view.state.doc.line(Math.min(target.toLine, view.state.doc.lines))
    const scroller = view.scrollDOM
    const yMargin = Math.round(scroller.clientHeight * 0.4)

    const reopen = (): void => {
      view.requestMeasure({
        read: (measuredView) => {
          const rect = hunkPopupAnchor(measuredView, target)
          if (rect !== null) onUpdate({ ...popup, index: nextIndex, anchor: rect })
        }
      })
    }

    // 先关弹窗再滚动（「滚动即关」无须豁免），光标一并切到块尾行行首。
    // 实测（Chromium）：CM 的滚动在 dispatch 后的测量周期异步落地，scroll/scrollend
    // 事件更晚一帧——必须等 scrollend 才能重开，否则刚开就被迟到的 scroll 关掉。
    // 目标已在位时不会有任何滚动事件：按 CM 同款公式（块顶 - yMargin、钳入可滚区间）
    // 预判位移，无位移直接重开。
    onClose()
    const block = view.lineBlockAt(line.from)
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    const targetTop = Math.max(0, Math.min(block.top - yMargin, maxScroll))
    const willScroll = Math.abs(targetTop - scroller.scrollTop) > 1
    if (willScroll) scroller.addEventListener('scrollend', reopen, { once: true })
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin })
    })
    if (!willScroll) reopen()
  }

  const rollback = (): void => {
    // 文档变化经 FilesPane 的 onChange 关闭弹窗并走既有自动保存管线
    view.dispatch({ changes: hunkRollbackChange(view.state.doc, hunk) })
    view.focus()
  }

  const previewExtensions = useMemo(
    () => [
      filesEditorTheme,
      filesHighlighting,
      languageExtensionForPath(filePath),
      EditorView.editable.of(false)
    ],
    [filePath]
  )

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <PopoverContent
        anchor={anchor}
        side="bottom"
        align="start"
        sideOffset={0}
        className="max-h-none w-[var(--anchor-width)] min-w-0 overflow-hidden p-0"
      >
        <div className="flex h-8 items-center gap-0.5 px-1.5">
          <button type="button" title="回滚该块" className={HUNK_BTN} onClick={rollback}>
            <Undo2 className="size-3.5 text-[color:var(--fg-icon)]" />
          </button>
          {hunk.oldLines.length > 0 && (
            <button
              type="button"
              title="复制旧文本"
              className={HUNK_BTN}
              onClick={() => {
                navigator.clipboard.writeText(hunk.oldLines.join('\n')).catch(() => undefined)
              }}
            >
              <Copy className="size-3.5 text-[color:var(--fg-icon)]" />
            </button>
          )}
          <div className="mx-0.5 h-3 w-px shrink-0 bg-[var(--border-input)]" role="separator" />
          <button
            type="button"
            title="上一个改动"
            className={HUNK_BTN}
            disabled={index === 0}
            onClick={() => navigate(-1)}
          >
            <ChevronUp className="size-3.5 text-[color:var(--fg-icon)]" />
          </button>
          <button
            type="button"
            title="下一个改动"
            className={HUNK_BTN}
            disabled={index === hunks.length - 1}
            onClick={() => navigate(1)}
          >
            <ChevronDown className="size-3.5 text-[color:var(--fg-icon)]" />
          </button>
        </div>
        {hunk.oldLines.length > 0 && (
          <div className="files-codemirror max-h-64 overflow-auto border-t border-[var(--separator)]">
            <CodeMirror
              value={hunk.oldLines.join('\n')}
              theme="none"
              basicSetup={false}
              editable={false}
              extensions={previewExtensions}
              className="[&_.cm-editor]:h-auto [&_.cm-editor]:outline-none"
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
