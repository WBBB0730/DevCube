// Files 编辑器行号栏 diff 条纹（对齐 WebStorm VCS gutter）：基线 = 文件在 HEAD 的文本，
// 与当前文档做行级 diff（jsdiff diffLines——与 VS Code / JetBrains 行状态同款的按行比较，
// 行语义与 git 一致，无字符级 diff 的末尾换行歧义）。标记经官方 lineNumberMarkers facet
// 附着到行号元素——新增绿条 / 修改蓝条画在行号列右缘，删除以小三角标在被删位置的下一行
// 顶部。基线变化（提交 / 暂存等）由 FilesPane 重建本扩展（换 extensions 数组即重配）。
import { diffLines } from 'diff'
import { RangeSetBuilder, StateField, type EditorState, type Extension } from '@codemirror/state'
import type { RangeSet, Text } from '@codemirror/state'
import { EditorView, GutterMarker, lineNumberMarkers } from '@codemirror/view'

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
 * 基线 vs 当前文本 → 行号(1 起) → 状态。removed 与 added 相邻 = modified；
 * 单独 added = added；单独 removed = deleted，标在被删位置的下一行（删至文末标最后一行）。
 */
export function gitGutterLineKinds(baseline: string, current: string): Map<number, GitLineKind> {
  const kinds = new Map<number, GitLineKind>()
  let line = 1
  let pendingRemoved = false
  for (const part of diffLines(baseline, current)) {
    const count = part.count ?? 0
    if (part.removed) {
      pendingRemoved = true
      continue
    }
    if (part.added) {
      const kind: GitLineKind = pendingRemoved ? 'modified' : 'added'
      for (let i = 0; i < count; i++) kinds.set(line + i, kind)
      pendingRemoved = false
      line += count
      continue
    }
    if (pendingRemoved) {
      kinds.set(line, 'deleted')
      pendingRemoved = false
    }
    line += count
  }
  if (pendingRemoved) kinds.set(Math.max(line - 1, 1), 'deleted')
  return kinds
}

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

/**
 * 条纹 4px 画在行号元素右缘（::before，水平贴边不偏移）；连续段中段顶满相连，
 * 段首/段尾上下各收 2px 并圆头——段与段之间由此留出上下空隙。删除三角骑在行顶边界上。
 */
const gutterTheme = EditorView.baseTheme({
  '.cm-lineNumbers .cm-gutterElement': { position: 'relative' },
  '.cm-lineNumbers .cm-gitLineBar::before': {
    content: "''",
    position: 'absolute',
    top: '0',
    bottom: '0',
    right: '0',
    width: '4px'
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
    top: '-4px',
    borderTop: '4px solid transparent',
    borderBottom: '4px solid transparent',
    borderLeft: `5px solid ${VCS_LINE.deleted}`
  }
})

/** 基线固定的 gutter diff 扩展：基线变化时由调用方重建（extensions 数组变更即重配）。 */
export function gitDiffGutter(baseline: string): Extension {
  // CM 文档 toString 以 \n 连接；基线（git blob 原文）同步归一，CRLF 文件才不会整页误判
  const normalized = baseline.split(/\r\n?|\n/).join('\n')
  const compute = (state: EditorState): Map<number, GitLineKind> =>
    state.doc.lines > MAX_GUTTER_LINES
      ? new Map()
      : gitGutterLineKinds(normalized, state.doc.toString())
  const kindsField = StateField.define<Map<number, GitLineKind>>({
    create: compute,
    update: (kinds, tr) => (tr.docChanged ? compute(tr.state) : kinds)
  })
  return [
    kindsField,
    lineNumberMarkers.compute([kindsField], (state) =>
      buildLineMarkers(state.doc, state.field(kindsField))
    ),
    gutterTheme
  ]
}
