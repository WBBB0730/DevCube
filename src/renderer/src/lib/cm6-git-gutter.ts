// Files 编辑器行号栏 diff 条纹（对齐 WebStorm VCS gutter）：基线 = 文件在 HEAD 的文本，
// 行级 chunk 由 @codemirror/merge 的 Chunk.build 计算、编辑时 Chunk.updateB 增量更新；
// 标记经官方 lineNumberMarkers facet 附着到行号元素——新增绿条 / 修改蓝条画在行号列
// 右缘，删除以小三角标在被删位置的下一行顶部。基线变化（提交 / 暂存等）由 FilesPane
// 重新构造本扩展（React 侧换 extensions 数组即重配）。
import { Chunk } from '@codemirror/merge'
import { RangeSetBuilder, StateField, Text, type Extension, type RangeSet } from '@codemirror/state'
import { EditorView, GutterMarker, lineNumberMarkers } from '@codemirror/view'

/** Dark.icls VCS 行状态色：ADDED / MODIFIED / DELETED_LINES_COLOR。 */
const VCS_LINE = {
  added: '#447152',
  modified: '#43698D',
  deleted: '#656E76'
} as const

export type GitLineKind = keyof typeof VCS_LINE

/** 与 unifiedMergeView 默认一致：限制扫描量防超大文件卡顿。 */
const DIFF_CONFIG = { scanLimit: 500 }

/**
 * chunks → 行号(1 起) → 状态。added / modified 覆盖 chunk 的 B 侧各行；
 * 删除（B 侧空）落在被删位置所在行（文档末尾的删除钳制到最后一行）。
 */
export function gitGutterLineKinds(doc: Text, chunks: readonly Chunk[]): Map<number, GitLineKind> {
  const kinds = new Map<number, GitLineKind>()
  for (const chunk of chunks) {
    if (chunk.fromB >= chunk.toB) {
      kinds.set(doc.lineAt(Math.min(chunk.fromB, doc.length)).number, 'deleted')
      continue
    }
    const kind: GitLineKind = chunk.fromA >= chunk.toA ? 'added' : 'modified'
    let pos = chunk.fromB
    while (pos < chunk.toB && pos <= doc.length) {
      const line = doc.lineAt(pos)
      kinds.set(line.number, kind)
      pos = line.to + 1
    }
  }
  return kinds
}

class LineKindMarker extends GutterMarker {
  constructor(cls: string) {
    super()
    this.elementClass = cls
  }
}

const MARKER: Record<GitLineKind, GutterMarker> = {
  added: new LineKindMarker('cm-gitLineAdded'),
  modified: new LineKindMarker('cm-gitLineModified'),
  deleted: new LineKindMarker('cm-gitLineDeleted')
}

function buildLineMarkers(doc: Text, chunks: readonly Chunk[]): RangeSet<GutterMarker> {
  const builder = new RangeSetBuilder<GutterMarker>()
  const byLine = [...gitGutterLineKinds(doc, chunks)].sort((a, b) => a[0] - b[0])
  for (const [lineNo, kind] of byLine) {
    const from = doc.line(lineNo).from
    builder.add(from, from, MARKER[kind])
  }
  return builder.finish()
}

/** 条纹 3px 画在行号元素右缘；删除三角骑在行顶边界上。 */
const gutterTheme = EditorView.baseTheme({
  '.cm-lineNumbers .cm-gutterElement': { position: 'relative' },
  '.cm-lineNumbers .cm-gitLineAdded': {
    boxShadow: `inset -3px 0 0 0 ${VCS_LINE.added}`
  },
  '.cm-lineNumbers .cm-gitLineModified': {
    boxShadow: `inset -3px 0 0 0 ${VCS_LINE.modified}`
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
  const original = Text.of(baseline.split(/\r\n?|\n/))
  const chunksField = StateField.define<readonly Chunk[]>({
    create: (state) => Chunk.build(original, state.doc, DIFF_CONFIG),
    update: (chunks, tr) =>
      tr.docChanged
        ? Chunk.updateB(chunks, original, tr.state.doc, tr.changes, DIFF_CONFIG)
        : chunks
  })
  return [
    chunksField,
    lineNumberMarkers.compute([chunksField], (state) =>
      buildLineMarkers(state.doc, state.field(chunksField))
    ),
    gutterTheme
  ]
}
