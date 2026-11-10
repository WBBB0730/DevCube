// Files 的文本正文（docs/prd/files-tab.md「编辑器」）：工具栏 + 服务器的保存栏 + CodeMirror 编辑器，
// Markdown / SVG / CSV 可切成预览。同一个文件在两栏各开一个时，经 EditorDocSync 互相转发改动
// （docs/prd/files-editor-tabs.md「同一文件两栏」）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import { WandSparkles } from 'lucide-react'
import { isCsvPath, isMarkdownPath, isPreviewableSourcePath, isSvgPath } from '@shared/files-kind'
import { SHORTCUT } from '@shared/shortcut-label'
import {
  FILES_BASIC_SETUP,
  filesEditorConfig,
  filesEditorTheme,
  filesGutters,
  filesHighlighting,
  languageExtensionForPath
} from '@renderer/lib/cm6-setup'
import { filesLinks } from '@renderer/lib/cm6-links'
import { rememberEditorView, restoreEditorView } from '@renderer/lib/cm6-view-state'
import { formatKeymap } from '@renderer/lib/cm6-format'
import { isForwardedUpdate, type EditorDocSync } from '@renderer/lib/cm6-doc-sync'
import { filesFormatLanguage, formatFileInEditor } from '@renderer/lib/files-format'
import {
  markdownTocHoverNext,
  markdownTocView,
  NO_TOC,
  type MarkdownTocHover,
  type MarkdownTocState
} from '@renderer/lib/files-markdown'
import { useEditorFind } from '@renderer/lib/use-editor-find'
import type { FindSession } from '@renderer/lib/use-find-session'
import type { FilesViewState } from '@renderer/lib/files-view-state'
import { gitDiffGutter, type GitGutterHunkClickPayload } from '@renderer/lib/cm6-git-gutter'
import type { MediaFitMode } from '@renderer/lib/files-media-zoom'
import { shortcutTitle } from '@renderer/lib/shortcut-label'
import { useApp } from '@renderer/store'
import { ErrorDialog } from '@renderer/components/ui/form-dialog'
import { Popover, PopoverTrigger } from '@renderer/components/ui/popover'
import { TOOLBAR_BTN } from '@renderer/components/ui/toolbar'
import { FilesFindWidget } from './FilesFindWidget'
import { FilesMarkdownPreview } from './FilesMarkdownPreview'
import { FilesSvgPreview, MediaFitButtons, type MediaPreviewHandle } from './FilesMediaPreview'
import { FilesSidebarToggle } from './FilesPagedControls'
import { FilesSheetPreview } from './FilesSheetPreview'
import { FilesToolbar, type FilesToolbarProps } from './FilesToolbar'

/** 鼠标离开目录钮或抽屉后多久才算离开：两者之间隔着 4px，从钮移到抽屉上不收 */
const TOC_LEAVE_DELAY = 100

/** 每栏各正文共用的那部分工具栏参数（路径、出错与正文专属控件由各正文自己给） */
export type FilesPaneToolbar = Omit<
  FilesToolbarProps,
  | 'path'
  | 'error'
  | 'extra'
  | 'pathExtra'
  | 'sourcePreview'
  | 'onToggleSourcePreview'
  | 'onFocusContent'
>

/** 编辑器跳转请求（FilesPane → FilesTextEditor）：内容搜索带行与选中区间；不带行只聚焦（最近打开选取后）。 */
export interface EditorJumpRequest {
  path: string
  line?: number
  col?: number
  endCol?: number
  nonce: number
}

export function FilesTextEditor({
  path,
  content,
  find,
  viewState,
  docSync,
  baseline,
  error,
  saveBar,
  toolbar,
  sourcePreview,
  onToggleSourcePreview,
  toc,
  onToggleToc,
  jump,
  onJumpDone,
  onHunkClick,
  onChange,
  onImagePrev,
  onImageNext,
  active,
  imagePrefetch
}: {
  path: string
  content: string
  /** 这一栏这个文件的查找会话：编辑与预览共用 */
  find: FindSession
  /** 这一栏这个文件的阅读位置：编辑与预览（Markdown / CSV）共用源码行，SVG 预览另记看图相机 */
  viewState: FilesViewState
  /** 同一文件另一栏的编辑器与它互相转发改动 */
  docSync: EditorDocSync
  /** HEAD 基线文本；null = 不显示 gutter diff 条纹 */
  baseline: string | null
  error: string | null
  /** 工具栏之下的保存栏（服务器上的文件手动保存才有） */
  saveBar?: React.ReactNode
  toolbar: FilesPaneToolbar
  /** Markdown / SVG / CSV 两态：true = 预览正文；其它文件忽略 */
  sourcePreview: boolean
  onToggleSourcePreview: () => void
  /** Markdown 预览侧边的目录开着（与 PDF / PPT 缩略图共用一个开关，会话内保持，归 FilesPane）；放不下时不显示 */
  toc: boolean
  onToggleToc: () => void
  /** 内容搜索跳转：编辑器就绪后选中命中区间并滚到行；应用后回调清除 */
  jump: EditorJumpRequest | null
  onJumpDone: () => void
  /** 点击 gutter 标记行 → 打开这个文件这一处的 diff 弹窗 */
  onHunkClick: (path: string, payload: GitGutterHunkClickPayload) => void
  /** 本栏键入的改动（另一栏转来的不报，内容已由那一栏报过） */
  onChange: (value: string) => void
  onImagePrev: () => void
  onImageNext: () => void
  /** Files Tab 可见：预览态（SVG 看图 / CSV 表格）的键盘只在可见时响应 */
  active: boolean
  imagePrefetch?: readonly string[]
}): React.JSX.Element {
  const canPreview = isPreviewableSourcePath(path)
  const markdown = isMarkdownPath(path)
  const svg = isSvgPath(path)
  const csv = isCsvPath(path)
  const theme = useApp((s) => s.theme)
  /** SVG 预览态的看图相机：工具栏「适应」钮组驱动 */
  const svgRef = useRef<MediaPreviewHandle>(null)
  const [svgFit, setSvgFit] = useState<MediaFitMode | null>(null)
  /** Markdown 预览的目录摆法：有标题才在面包屑前出目录钮；放不放得下侧边决定侧边显示与否、点钮响不响应 */
  const [tocState, setTocState] = useState<MarkdownTocState>(NO_TOC)
  /**
   * 目录钮的悬停（侧边的目录开不开只看 `toc`，怎么显示见 markdownTocView；悬停怎么变见 markdownTocHoverNext）。
   * 摆法一变即回到空闲
   */
  const [tocHover, setTocHover] = useState<MarkdownTocHover>('idle')
  const tocLeaveTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(tocLeaveTimer.current), [])
  const changeTocState = useCallback((state: MarkdownTocState) => {
    setTocState(state)
    setTocHover('idle')
  }, [])
  const tocView = markdownTocView(toc, tocState.dockable, tocHover === 'peek')
  const tocDocked = tocView === 'docked'
  /** 目录钮与抽屉的悬停、点钮：离开要等跨过两者之间的间隙才算，期间再进来即作罢 */
  const onTocHover = (event: 'enter' | 'leave' | 'click' | 'key'): void => {
    window.clearTimeout(tocLeaveTimer.current)
    if (event === 'leave') {
      tocLeaveTimer.current = window.setTimeout(
        () => setTocHover((hover) => markdownTocHoverNext(hover, 'leave', tocDocked)),
        TOC_LEAVE_DELAY
      )
    } else setTocHover((hover) => markdownTocHoverNext(hover, event, tocDocked))
  }
  /** 点目录钮：开关侧边的目录（放不下侧边时不响应）；键盘按的 detail 为 0 */
  const toggleToc = (e: React.MouseEvent): void => {
    if (!tocState.dockable) return
    onToggleToc()
    onTocHover(e.detail > 0 ? 'click' : 'key')
  }
  /** 编辑器：建好新的即换（跳转与查找栏据此重试）；预览态编辑器未挂载，可能还是卸掉的旧实例 */
  const [view, setView] = useState<EditorView | null>(null)
  // 工具栏下拉关掉后焦点回编辑器；预览态编辑器未挂载（view 可能是旧实例）则不动
  const focusEditor = useCallback(() => {
    if (view?.dom.isConnected) view.focus()
  }, [view])

  // 查找栏（Cmd+F）：这一栏这个文件的查找会话（FilesPane 按栏与文件记），编辑与预览（Markdown / CSV）共用，
  // 切换不关、不清空；SVG 预览没有查找，查找栏先藏起，切回编辑原样出现
  const findExtension = useEditorFind(view, find)

  // 格式化（JSON / SQL，见 lib/files-format）：工具栏钮与 ⌥⌘L（焦点在编辑器时），格式化选中的部分或全文；
  // SQL 认不出时弹「无法格式化」
  const formatLanguage = filesFormatLanguage(path)
  const [formatError, setFormatError] = useState<string | null>(null)
  const formatShortcut = useMemo(
    () =>
      formatLanguage === null
        ? []
        : formatKeymap((editor) => setFormatError(formatFileInEditor(editor, formatLanguage))),
    [formatLanguage]
  )

  // 跳转须等 CodeMirror 挂载（key=path 换文件重建）；建好新编辑器（view 换新）时重试。
  // 预览态（Markdown / SVG / CSV）编辑器未挂载，view 可能仍是上个文件的旧实例：留待切回编辑再应用。
  useEffect(() => {
    if (!jump || jump.path !== path) return
    if (!view || !view.dom.isConnected) return
    if (jump.line !== undefined) {
      const doc = view.state.doc
      const line = doc.line(Math.min(Math.max(jump.line, 1), doc.lines))
      const anchor = Math.min(line.from + (jump.col ?? 0), line.to)
      const head = Math.min(line.from + (jump.endCol ?? jump.col ?? 0), line.to)
      view.dispatch({
        selection: { anchor, head },
        effects: EditorView.scrollIntoView(anchor, { y: 'center' })
      })
    }
    view.focus()
    onJumpDone()
  }, [jump, path, view, onJumpDone])
  // 换 extensions 走的是 StateEffect.reconfigure，不重建 EditorState：文档 / 选区 / 滚动
  // 位置与撤销栈都在，切主题不打断编辑。
  const sync = useMemo(() => docSync.extension(path), [docSync, path])
  const hunkClick = useCallback(
    (payload: GitGutterHunkClickPayload) => onHunkClick(path, payload),
    [onHunkClick, path]
  )
  const extensions = useMemo(
    () => [
      filesEditorTheme[theme],
      filesHighlighting[theme],
      filesEditorConfig,
      filesGutters,
      filesLinks,
      languageExtensionForPath(path),
      findExtension,
      formatShortcut,
      rememberEditorView(viewState),
      sync,
      ...(baseline === null ? [] : [gitDiffGutter(baseline, hunkClick)])
    ],
    [theme, path, baseline, hunkClick, findExtension, formatShortcut, viewState, sync]
  )
  return (
    // Markdown 目录的抽屉：Trigger 是工具栏的目录钮，Popup 在预览里（FilesMarkdownTocDrawer）；Popup 浮在页面最上层，
    // Files Tab 不可见时不显示。悬停与点钮都自己处理，弹层只管点外面与 Esc：收起浮出的，打开与点钮的请求取消
    <Popover
      open={tocView === 'drawer' && active}
      onOpenChange={(open, details) => {
        if (open || details.reason === 'trigger-press') details.cancel()
        else setTocHover((hover) => (hover === 'peek' ? 'idle' : hover))
      }}
    >
      <div className="flex h-full min-h-0 flex-col">
        <FilesToolbar
          {...toolbar}
          path={path}
          error={error}
          sourcePreview={canPreview ? sourcePreview : null}
          onToggleSourcePreview={onToggleSourcePreview}
          pathExtra={
            markdown && sourcePreview && tocState.available ? (
              // 点亮 = 侧边的目录显示着（放不下侧边时不点亮）；抽屉浮出期间钮保持悬停态（工具栏钮样式自带）
              <PopoverTrigger
                onPointerEnter={() => onTocHover('enter')}
                onPointerLeave={() => onTocHover('leave')}
                render={<FilesSidebarToggle title="目录" on={tocDocked} onClick={toggleToc} />}
              />
            ) : undefined
          }
          extra={
            svg && sourcePreview ? (
              <MediaFitButtons active={svgFit} onFit={(axis) => svgRef.current?.fit(axis)} />
            ) : formatLanguage !== null ? (
              <button
                type="button"
                title={shortcutTitle('格式化', SHORTCUT.format)}
                className={TOOLBAR_BTN}
                onClick={() => {
                  if (view?.dom.isConnected)
                    setFormatError(formatFileInEditor(view, formatLanguage))
                }}
              >
                <WandSparkles className="size-4" />
              </button>
            ) : undefined
          }
          onFocusContent={focusEditor}
        />
        {saveBar}
        {markdown && sourcePreview ? (
          <FilesMarkdownPreview
            // 按文件重挂：换文件从头开始，切回来按记着的位置恢复
            key={path}
            path={path}
            content={content}
            projectRoot={toolbar.projectRoot}
            active={active}
            find={find}
            viewState={viewState}
            toc={toc}
            onTocChange={changeTocState}
            onTocDrawerHover={onTocHover}
          />
        ) : svg && sourcePreview ? (
          <FilesSvgPreview
            ref={svgRef}
            onFitChange={setSvgFit}
            viewState={viewState}
            path={path}
            content={content}
            prefetch={imagePrefetch}
            active={active}
            onPrev={onImagePrev}
            onNext={onImageNext}
          />
        ) : csv && sourcePreview ? (
          <FilesSheetPreview
            key={path}
            source={{ kind: 'csv', content }}
            path={path}
            active={active}
            find={find}
            viewState={viewState}
          />
        ) : (
          <>
            {find.open && <FilesFindWidget view={view} content={content} find={find} />}
            <div className="files-codemirror min-h-0 flex-1 overflow-hidden bg-deepest">
              <CodeMirror
                key={path}
                value={content}
                height="100%"
                theme="none"
                extensions={extensions}
                basicSetup={FILES_BASIC_SETUP}
                onChange={(value, update) => {
                  if (!isForwardedUpdate(update)) onChange(value)
                }}
                onCreateEditor={(created) => {
                  restoreEditorView(created, viewState)
                  setView(created)
                }}
                className="h-full [&_.cm-editor]:h-full [&_.cm-editor]:outline-none"
              />
            </div>
          </>
        )}
        {formatError !== null && (
          <ErrorDialog
            title="无法格式化"
            message={formatError}
            onClose={() => setFormatError(null)}
          />
        )}
      </div>
    </Popover>
  )
}
