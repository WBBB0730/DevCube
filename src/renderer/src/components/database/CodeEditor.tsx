// 数据源里的代码编辑器（控制台与对象定义共用，docs/prd/database.md「控制台」「当前对象」）：同 Files 编辑器——主题与高亮、
// 自绘选区（filesEditorConfig）、⌘F 查找栏（cm6-find + FilesFindWidget）。没有 Files 的 diff 行号与折叠列，行号由 basicSetup 提供。
// 可编辑的有当前行高亮，只读的没有。在 Data Source Tab 左侧当前显示的那一格里时是正文的焦点（见 useContentFocus）。
import { useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { FilesFindWidget } from '@renderer/components/files/FilesFindWidget'
import {
  FILES_BASIC_SETUP,
  filesEditorConfig,
  filesEditorTheme,
  filesHighlighting
} from '@renderer/lib/cm6-setup'
import { useContentFocus } from '@renderer/lib/data-source-content-focus'
import { useEditorFind } from '@renderer/lib/use-editor-find'
import { useApp } from '@renderer/store'

export function CodeEditor({
  viewRef,
  value,
  onChange,
  readOnly = false,
  completion = false,
  extensions
}: {
  /** 编辑器建好后指向它（查找栏与调用方的执行、格式化都读它） */
  viewRef: React.RefObject<EditorView | null>
  value: string
  onChange?: (value: string) => void
  /** 只读：能选中、查找、复制，不能改（没有当前行高亮） */
  readOnly?: boolean
  /** 补全（SQL 控制台的表名、列名、关键字） */
  completion?: boolean
  /** 语言与调用方的快捷键 */
  extensions: Extension
}): React.JSX.Element {
  const theme = useApp((s) => s.theme)

  // 查找栏（⌘F）同 Files 编辑器
  const find = useEditorFind(viewRef)

  // 编辑器要等挂上之后的又一次渲染才建好（见 onCreateEditor）：建好了才登记正文焦点
  const [view, setView] = useState<EditorView | null>(null)
  const focusEditor = useMemo(() => (view === null ? null : () => view.focus()), [view])
  useContentFocus(focusEditor)

  const allExtensions = useMemo(
    () => [
      filesEditorTheme[theme],
      filesHighlighting[theme],
      filesEditorConfig,
      find.extension,
      extensions
    ],
    [theme, find.extension, extensions]
  )

  // 以 Files 编辑器的 basicSetup 为底：行号改由这里提供，补全与当前行高亮按用途开
  const basicSetup = useMemo(
    () => ({
      ...FILES_BASIC_SETUP,
      lineNumbers: true,
      highlightActiveLine: !readOnly,
      highlightActiveLineGutter: !readOnly,
      autocompletion: completion,
      completionKeymap: completion
    }),
    [readOnly, completion]
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {find.open && (
        <FilesFindWidget
          viewRef={viewRef}
          content={value}
          focusNonce={find.focusNonce}
          onClose={find.close}
        />
      )}
      <div className="files-codemirror min-h-0 flex-1 overflow-hidden bg-deepest">
        <CodeMirror
          value={value}
          height="100%"
          theme="none"
          extensions={allExtensions}
          basicSetup={basicSetup}
          // 用 readOnly 而非 editable={false}：内容区仍可聚焦，⌘F、⌘A、方向键才收得到
          readOnly={readOnly}
          onChange={onChange}
          onCreateEditor={(created) => {
            viewRef.current = created
            setView(created)
          }}
          className="h-full [&_.cm-editor]:h-full [&_.cm-editor]:outline-none"
        />
      </div>
    </div>
  )
}
