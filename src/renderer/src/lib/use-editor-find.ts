import { useEffect, useMemo } from 'react'
import type { Extension } from '@codemirror/state'
import { keymap, type EditorView } from '@codemirror/view'
import { filesFindExtension, setFindQuery } from './cm6-find'
import type { FindSession } from './use-find-session'

/**
 * 编辑器内查找（⌘F）接到查找会话上（Files 编辑器与数据源的代码编辑器共用；查找栏本身是 FilesFindWidget）。
 * 返回的 extension 含命中高亮与键位：⌘F 开查找栏（已开则重新聚焦输入框），Esc 查找开着时关之（默认面板已由
 * FILES_BASIC_SETUP 关掉）。键位闭包直接引用会话的开关，开关时 extension 换新、编辑器走一次 reconfigure
 * （不重建编辑器状态，成本可忽略），换取无 ref 的直白数据流——调用方把 extension 放进 extensions 的依赖。
 * 关闭查找（含切走预览态卸载编辑器前）统一在此清命中高亮。
 */
export function useEditorFind(view: EditorView | null, find: FindSession): Extension {
  const { open, openFind, closeFind } = find

  useEffect(() => {
    if (open) return
    if (view?.dom.isConnected) view.dispatch({ effects: setFindQuery.of(null) })
  }, [open, view])

  return useMemo(
    () => [
      filesFindExtension,
      keymap.of([
        {
          key: 'Mod-f',
          run: () => {
            openFind()
            return true
          }
        },
        {
          key: 'Escape',
          run: () => {
            if (!open) return false
            closeFind()
            return true
          }
        }
      ])
    ],
    [open, openFind, closeFind]
  )
}
