// Files 编辑器里的网址（docs/prd/files-tab.md「网址」）：⌘ / Ctrl 点击用系统浏览器打开，同 WebStorm / VS Code；
// 平时与普通文字一样，按住 ⌘ / Ctrl 悬停时显示成可点（链接色 + 下划线 + 手形，样式见 cm6-setup 的编辑器主题）。
// 点在网址上不再添加光标（CodeMirror 默认 ⌘ / Ctrl 点击加光标），点在别处照旧。识别规则同 Git 提交信息正文（findUrls）。
import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'
import { findUrls } from './text-urls'
import { isPrimaryModifierEvent } from './shortcut-label'

/** 是否按着 ⌘ / Ctrl：按着时编辑器正文带上 `cm-links-armed`，悬停的网址才显示成可点 */
const setLinksArmed = StateEffect.define<boolean>()

const linksArmed = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setLinksArmed)) value = e.value
    return value
  },
  provide: (field) =>
    EditorView.contentAttributes.compute([field], (state): Record<string, string> =>
      state.field(field) ? { class: 'cm-links-armed' } : {}
    )
})

function armLinks(view: EditorView, armed: boolean): void {
  if (view.state.field(linksArmed) !== armed) view.dispatch({ effects: setLinksArmed.of(armed) })
}

/** 长行只扫视口左右这么多字（同官方 MatchDecorator 的 maxLength），压成一行的大文件滚动时不整行重扫 */
const LONG_LINE_MARGIN = 1000

/** 可见范围里的网址各包一层 `cm-link`（本身不带样式），网址记在 `data-url` 上 */
function buildLinkDecorations(view: EditorView): DecorationSet {
  const { doc } = view.state
  const builder = new RangeSetBuilder<Decoration>()
  let scanned = 0
  for (const range of view.visibleRanges) {
    const from = Math.max(doc.lineAt(range.from).from, range.from - LONG_LINE_MARGIN, scanned)
    const to = Math.min(doc.lineAt(range.to).to, range.to + LONG_LINE_MARGIN)
    if (to <= from) continue
    // 网址不跨行，整段一起扫
    const text = doc.sliceString(from, to)
    for (const link of findUrls(text)) {
      const url = text.slice(link.from, link.to)
      builder.add(
        from + link.from,
        from + link.to,
        Decoration.mark({ class: 'cm-link', attributes: { 'data-url': url } })
      )
    }
    scanned = to
  }
  return builder.finish()
}

const linkPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    // 在窗口里任何地方按下 / 松开都算（焦点在文件树上、鼠标停在网址上按 ⌘ 也要立刻显示）；切走窗口收不到松开，一并收起
    readonly onKey = (e: KeyboardEvent): void => armLinks(this.view, isPrimaryModifierEvent(e))
    readonly onBlur = (): void => armLinks(this.view, false)

    constructor(readonly view: EditorView) {
      this.decorations = buildLinkDecorations(view)
      window.addEventListener('keydown', this.onKey)
      window.addEventListener('keyup', this.onKey)
      window.addEventListener('blur', this.onBlur)
    }

    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged) this.decorations = buildLinkDecorations(u.view)
    }

    destroy(): void {
      window.removeEventListener('keydown', this.onKey)
      window.removeEventListener('keyup', this.onKey)
      window.removeEventListener('blur', this.onBlur)
    }
  },
  {
    // 包在所有其他装饰的最外层：语法色等不会把一个网址切成几段，悬停时整个网址一起变样
    provide: (plugin) =>
      EditorView.outerDecorations.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
    eventObservers: {
      // 修饰键在窗口外按下的，移进来时补上
      mousemove: (e, view) => armLinks(view, isPrimaryModifierEvent(e))
    },
    eventHandlers: {
      mousedown(e) {
        if (e.button !== 0 || !isPrimaryModifierEvent(e) || !(e.target instanceof Element)) {
          return false
        }
        const link = e.target.closest<HTMLElement>('.cm-link')
        if (link === null) return false
        e.preventDefault()
        void window.api.openExternal(link.dataset.url!)
        return true
      }
    }
  }
)

/** Files 编辑器的网址：⌘ / Ctrl 点击打开 */
export const filesLinks: Extension = [linksArmed, linkPlugin]
