/**
 * Files 编辑器的阅读位置（docs/prd/files-tab.md「阅读位置」）：滚动与选区一变就写进这个文件的记录，
 * 新建编辑器时按记录恢复视口顶边所在的行与选区。行按源码行记（带行内进度），与 Markdown 预览、CSV 表格共用。
 */
import { EditorSelection, type Extension, type StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { FilesViewState } from './files-view-state'

/** 视口顶边所在的源码行（0 起，带行内进度） */
function topLine(view: EditorView): number {
  const height = view.scrollDOM.getBoundingClientRect().top - view.documentTop
  const block = view.lineBlockAtHeight(height)
  const line = view.state.doc.lineAt(block.from).number - 1
  const progress = block.height > 0 ? (height - block.top) / block.height : 0
  return line + Math.min(1, Math.max(0, progress))
}

/** 把源码行（0 起，带行内进度）滚到视口顶边；超出文末的夹到最后一行 */
function scrollToLine(view: EditorView, target: number): StateEffect<unknown> {
  const { doc } = view.state
  const line = Math.min(Math.max(target, 0), doc.lines - 1)
  const index = Math.floor(line)
  const from = doc.line(index + 1).from
  // 行内进度：行顶在视口顶边之上这么多
  const offset = (line - index) * view.lineBlockAt(from).height
  return EditorView.scrollIntoView(from, { y: 'start', yMargin: -offset })
}

/** 把编辑器的阅读位置随时写进 `state` */
export function rememberEditorView(state: FilesViewState): Extension {
  return [
    EditorView.domEventObservers({
      scroll: (_, view) => {
        state.set('line', topLine(view))
      }
    }),
    EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.docChanged) state.set('selection', update.state.selection)
    })
  ]
}

/** 新建的编辑器按 `state` 恢复阅读位置；文件在别处变短了，行与选区夹到文末 */
export function restoreEditorView(view: EditorView, state: FilesViewState): void {
  const line = state.get('line')
  const selection = state.get('selection')
  if (line === undefined && !selection) return
  const clamp = (pos: number): number => Math.min(pos, view.state.doc.length)
  view.dispatch({
    selection:
      selection &&
      EditorSelection.create(
        selection.ranges.map((r) => EditorSelection.range(clamp(r.anchor), clamp(r.head))),
        selection.mainIndex
      ),
    effects: line === undefined ? [] : scrollToLine(view, line)
  })
}
