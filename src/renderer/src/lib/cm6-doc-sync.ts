// 同一个文件在两栏各开一个编辑器时保持内容一致（docs/prd/files-editor-tabs.md「同一文件两栏」）：
// 按 CodeMirror 官方 Split View 示例的做法，一个视图的改动带标记转发给同一文件的其他视图。转来的改动不进对方的
// 撤销记录（CodeMirror 撤销记录对这类「别处来的改动」只做映射），所以各栏撤销的是自己的改动。
import { Annotation, Transaction, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

/** 标在转发来的事务上：收到的一方不再转发，也据此认出不是自己键入的改动 */
const forwarded = Annotation.define<boolean>()

/** 这次更新的改动是不是从同一文件的另一个视图转来的（不是本栏键入的） */
export function isForwardedUpdate(update: ViewUpdate): boolean {
  return update.transactions.some((tr) => tr.annotation(forwarded) === true)
}

/** 一个 Files 面板里各编辑器的同步：按文件路径记下开着的视图 */
export class EditorDocSync {
  readonly #views = new Map<string, Set<EditorView>>()

  /** 某个文件的编辑器带上它：本视图的改动转发给同一文件的其他视图 */
  extension(path: string): Extension {
    const views = this.#views
    return [
      ViewPlugin.define((view) => {
        let open = views.get(path)
        if (open === undefined) {
          open = new Set()
          views.set(path, open)
        }
        open.add(view)
        return {
          destroy: () => {
            open.delete(view)
            if (open.size === 0) views.delete(path)
          }
        }
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        for (const tr of update.transactions) {
          if (!tr.docChanged || tr.annotation(forwarded) === true) continue
          for (const other of views.get(path) ?? []) {
            if (other === update.view) continue
            other.dispatch({
              changes: tr.changes,
              annotations: [forwarded.of(true), Transaction.addToHistory.of(false)]
            })
          }
        }
      })
    ]
  }
}
