// Files 编辑器行号栏 diff 条纹（对齐 WebStorm VCS gutter）：基线 = 文件在 HEAD 的文本，
// 与当前文档做行级 diff（jsdiff diffLines——与 VS Code / JetBrains 行状态同款的按行比较，
// 行语义与 git 一致，无字符级 diff 的末尾换行歧义），产出 hunk 列表（当前侧行区间 + 基线侧
// 旧行）。标记经官方 lineNumberMarkers facet 附着到行号元素——新增绿条 / 修改蓝条画在行号
// 列右缘，删除以同款短竖条骑在被删位置的行顶边界。点击带标记的行号格子经 hunkClickFacet
// 通知外层（弹窗看 diff / 回滚）。基线变化（提交 / 暂存等）由 FilesPane 重建本扩展。
import { diffLines } from 'diff'
import {
  Facet,
  RangeSetBuilder,
  StateField,
  type EditorState,
  type Extension
} from '@codemirror/state'
import type { RangeSet, Text } from '@codemirror/state'
import { EditorView, GutterMarker, lineNumberMarkers, lineNumbers } from '@codemirror/view'

/** VCS 行状态色 token（main.css :root；值出自 docs/reference/Dark.icls 的 *_LINES_COLOR）。 */
const VCS_LINE = {
  added: 'var(--git-line-added)',
  modified: 'var(--git-line-modified)',
  deleted: 'var(--git-line-deleted)'
} as const

export type GitLineKind = keyof typeof VCS_LINE

/** 全量行级 diff 的性能守卫：超过该行数不再计算条纹（对齐大文件降级思路）。 */
const MAX_GUTTER_LINES = 30_000

/**
 * 一个改动块。added / modified 的 fromLine..toLine 是当前文档中被标记的行区间；
 * deleted 没有当前侧行（fromLine === toLine 为标记行——被删位置的下一行，
 * atEof 时为最后一行，删除发生在其后）。oldLines 为基线侧旧行（added 为空）。
 */
export interface GitGutterHunk {
  kind: GitLineKind
  fromLine: number
  toLine: number
  oldLines: string[]
  /** 仅 deleted：被删内容原位于文档末尾（标记行之后而非之前） */
  atEof?: boolean
}

/** diffLines 的 part.value → 行数组（行以 \n 结尾；末行可无终结符）。 */
function splitPartLines(value: string): string[] {
  const lines = value.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * 基线 vs 当前文本 → hunk 列表。removed 与 added 相邻 = modified；
 * 单独 added = added；单独 removed = deleted（标在被删位置的下一行，删至文末标最后一行）。
 */
export function gitGutterHunks(baseline: string, current: string): GitGutterHunk[] {
  const hunks: GitGutterHunk[] = []
  let line = 1
  let pendingOld: string[] | null = null
  for (const part of diffLines(baseline, current)) {
    const count = part.count ?? 0
    if (part.removed) {
      pendingOld = splitPartLines(part.value)
      continue
    }
    if (part.added) {
      hunks.push({
        kind: pendingOld === null ? 'added' : 'modified',
        fromLine: line,
        toLine: line + count - 1,
        oldLines: pendingOld ?? []
      })
      pendingOld = null
      line += count
      continue
    }
    if (pendingOld !== null) {
      hunks.push({ kind: 'deleted', fromLine: line, toLine: line, oldLines: pendingOld })
      pendingOld = null
    }
    line += count
  }
  if (pendingOld !== null) {
    const marker = Math.max(line - 1, 1)
    hunks.push({
      kind: 'deleted',
      fromLine: marker,
      toLine: marker,
      oldLines: pendingOld,
      atEof: true
    })
  }
  return hunks
}

function kindsFromHunks(hunks: readonly GitGutterHunk[]): Map<number, GitLineKind> {
  const kinds = new Map<number, GitLineKind>()
  for (const hunk of hunks) {
    for (let n = hunk.fromLine; n <= hunk.toLine; n++) kinds.set(n, hunk.kind)
  }
  return kinds
}

/** 行号 → 状态（兼容旧签名的派生视图，测试与标记构建共用）。 */
export function gitGutterLineKinds(baseline: string, current: string): Map<number, GitLineKind> {
  return kindsFromHunks(gitGutterHunks(baseline, current))
}

/**
 * 回滚一个 hunk 的文档变更（modified 换回旧行 / added 删行 / deleted 插回旧行）。
 * 只在 hunk 产出后文档未再变化时调用（弹窗文档一变即关，天然满足）。
 */
export function hunkRollbackChange(
  doc: Text,
  hunk: GitGutterHunk
): { from: number; to: number; insert: string } {
  if (hunk.kind === 'deleted') {
    if (hunk.atEof === true) {
      const end = doc.line(Math.min(hunk.fromLine, doc.lines)).to
      return { from: end, to: end, insert: '\n' + hunk.oldLines.join('\n') }
    }
    const at = doc.line(hunk.fromLine).from
    return { from: at, to: at, insert: hunk.oldLines.join('\n') + '\n' }
  }
  if (hunk.kind === 'added') {
    // diffLines 的 token 对齐保证新增字符恰从块首行行首开始；块后还有行时连带其间换行，
    // 块到文末则删到文档尾即可（前一行的换行不属于新增内容）
    if (hunk.toLine < doc.lines) {
      return { from: doc.line(hunk.fromLine).from, to: doc.line(hunk.toLine + 1).from, insert: '' }
    }
    return { from: doc.line(hunk.fromLine).from, to: doc.line(hunk.toLine).to, insert: '' }
  }
  return {
    from: doc.line(hunk.fromLine).from,
    to: doc.line(hunk.toLine).to,
    insert: hunk.oldLines.join('\n')
  }
}

// —— 编辑器接线：基线 facet → hunks 字段 → 行号标记 / 点击回调 ——

/** 归一后的基线文本；不提供即无条纹（filesLineNumbers 单独挂载时点击为 no-op）。 */
const baselineFacet = Facet.define<string, string | null>({
  combine: (values) => (values.length > 0 ? values[0] : null)
})

export interface GitGutterHunkClickPayload {
  view: EditorView
  hunks: readonly GitGutterHunk[]
  /** 被点中的 hunk 下标 */
  index: number
  /** 被点行号格子的矩形（弹窗虚拟锚点） */
  anchor: DOMRect
}

const hunkClickFacet = Facet.define<(payload: GitGutterHunkClickPayload) => void>()

interface GutterDiffState {
  hunks: readonly GitGutterHunk[]
  kinds: Map<number, GitLineKind>
}

const EMPTY_STATE: GutterDiffState = { hunks: [], kinds: new Map() }

function computeState(state: EditorState): GutterDiffState {
  const baseline = state.facet(baselineFacet)
  if (baseline === null || state.doc.lines > MAX_GUTTER_LINES) return EMPTY_STATE
  const hunks = gitGutterHunks(baseline, state.doc.toString())
  return { hunks, kinds: kindsFromHunks(hunks) }
}

const gutterDiffField = StateField.define<GutterDiffState>({
  create: computeState,
  update: (value, tr) =>
    tr.docChanged || tr.state.facet(baselineFacet) !== tr.startState.facet(baselineFacet)
      ? computeState(tr.state)
      : value
})

class LineKindMarker extends GutterMarker {
  constructor(cls: string) {
    super()
    this.elementClass = cls
  }
}

/** kind × 段首 × 段尾 → 单例 marker（identity eq，让 gutter 增量更新少重绘）。 */
const markerCache = new Map<string, LineKindMarker>()

function markerFor(kind: GitLineKind, first: boolean, last: boolean): LineKindMarker {
  const key = `${kind}:${first}:${last}`
  let marker = markerCache.get(key)
  if (marker === undefined) {
    const cls =
      kind === 'deleted'
        ? 'cm-gitLineDeleted'
        : [
            'cm-gitLineBar',
            kind === 'added' ? 'cm-gitLineAdded' : 'cm-gitLineModified',
            ...(first ? ['cm-gitRunFirst'] : []),
            ...(last ? ['cm-gitRunLast'] : [])
          ].join(' ')
    marker = new LineKindMarker(cls)
    markerCache.set(key, marker)
  }
  return marker
}

function buildLineMarkers(doc: Text, kinds: Map<number, GitLineKind>): RangeSet<GutterMarker> {
  const builder = new RangeSetBuilder<GutterMarker>()
  for (const [lineNo, kind] of [...kinds].sort((a, b) => a[0] - b[0])) {
    if (lineNo > doc.lines) continue
    // 连续同状态行连成一段：仅段首圆上端、段尾圆下端，中段两端顶满相连
    const first = kinds.get(lineNo - 1) !== kind
    const last = kinds.get(lineNo + 1) !== kind
    const from = doc.line(lineNo).from
    builder.add(from, from, markerFor(kind, first, last))
  }
  return builder.finish()
}

const hunkMarkers = lineNumberMarkers.compute([gutterDiffField], (state) =>
  buildLineMarkers(state.doc, state.field(gutterDiffField).kinds)
)

/** 行号所在的 hunk 下标（deleted 只命中其标记行）；无命中为 -1。 */
function hunkIndexAtLine(hunks: readonly GitGutterHunk[], lineNo: number): number {
  return hunks.findIndex((h) => h.fromLine <= lineNo && lineNo <= h.toLine)
}

/**
 * Files 编辑器的行号 gutter：带「点击标记行打开 diff 弹窗」的事件接线。
 * basicSetup 的 lineNumbers 已关闭，编辑器无条件挂载本扩展（无基线时点击 no-op）。
 */
export const filesLineNumbers: Extension = lineNumbers({
  domEventHandlers: {
    mousedown: (view, block, event) => {
      const handlers = view.state.facet(hunkClickFacet)
      const field = view.state.field(gutterDiffField, false)
      if (handlers.length === 0 || field === undefined || field.hunks.length === 0) return false
      const lineNo = view.state.doc.lineAt(block.from).number
      const index = hunkIndexAtLine(field.hunks, lineNo)
      if (index < 0) return false
      const cell =
        event.target instanceof Element ? event.target.closest('.cm-gutterElement') : null
      const anchor = (cell ?? view.dom).getBoundingClientRect()
      for (const handler of handlers) handler({ view, hunks: field.hunks, index, anchor })
      return true
    }
  }
})

/** 目标 hunk 标记行的行号格子锚点矩形（弹窗跳转后重新定位）；几何不可得时为 null。 */
export function hunkAnchorRect(view: EditorView, hunk: GitGutterHunk): DOMRect | null {
  const line = view.state.doc.line(Math.min(hunk.fromLine, view.state.doc.lines))
  const coords = view.coordsAtPos(line.from)
  const gutter = view.dom.querySelector('.cm-gutter.cm-lineNumbers')
  if (coords === null || gutter === null) return null
  const rect = gutter.getBoundingClientRect()
  return new DOMRect(rect.left, coords.top, rect.width, coords.bottom - coords.top)
}

/**
 * 条纹 4px 画在行号元素右缘（::before，水平贴边不偏移）；连续段中段顶满相连，
 * 段首/段尾上下各收 2px 并圆头——段与段之间由此留出上下空隙。
 * 删除为同宽 6px 高的圆头短条，骑在被删位置的行顶边界上（上下各探 3px）。
 * 带标记的格子可点（打开 diff 弹窗）：hover 给 pointer 光标，条纹加宽 / 删除短条放大。
 */
const gutterTheme = EditorView.baseTheme({
  '.cm-lineNumbers .cm-gutterElement': { position: 'relative' },
  '.cm-lineNumbers .cm-gitLineBar, .cm-lineNumbers .cm-gitLineDeleted': {
    cursor: 'pointer'
  },
  '.cm-lineNumbers .cm-gitLineBar::before': {
    content: "''",
    position: 'absolute',
    top: '0',
    bottom: '0',
    right: '0',
    width: '4px',
    transition: 'width 100ms'
  },
  '.cm-lineNumbers .cm-gitLineBar:hover::before': {
    width: '6px'
  },
  '.cm-lineNumbers .cm-gitLineAdded::before': {
    backgroundColor: VCS_LINE.added
  },
  '.cm-lineNumbers .cm-gitLineModified::before': {
    backgroundColor: VCS_LINE.modified
  },
  '.cm-lineNumbers .cm-gitRunFirst::before': {
    top: '2px',
    borderTopLeftRadius: '2px',
    borderTopRightRadius: '2px'
  },
  '.cm-lineNumbers .cm-gitRunLast::before': {
    bottom: '2px',
    borderBottomLeftRadius: '2px',
    borderBottomRightRadius: '2px'
  },
  '.cm-lineNumbers .cm-gitLineDeleted::after': {
    content: "''",
    position: 'absolute',
    right: '0',
    top: '-3px',
    width: '4px',
    height: '6px',
    borderRadius: '2px',
    backgroundColor: VCS_LINE.deleted,
    transition: 'width 100ms, height 100ms, top 100ms'
  },
  '.cm-lineNumbers .cm-gitLineDeleted:hover::after': {
    width: '6px',
    height: '8px',
    top: '-4px'
  }
})

/** 基线固定的 gutter diff 扩展：基线变化时由调用方重建（extensions 数组变更即重配）。 */
export function gitDiffGutter(
  baseline: string,
  onHunkClick?: (payload: GitGutterHunkClickPayload) => void
): Extension {
  // CM 文档 toString 以 \n 连接；基线（git blob 原文）同步归一，CRLF 文件才不会整页误判
  const normalized = baseline.split(/\r\n?|\n/).join('\n')
  return [
    baselineFacet.of(normalized),
    gutterDiffField,
    hunkMarkers,
    gutterTheme,
    ...(onHunkClick === undefined ? [] : [hunkClickFacet.of(onHunkClick)])
  ]
}
