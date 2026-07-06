// 文件树的嵌套 sticky 骨架：把展平行按 depth 重组成嵌套 DOM，使目录头的 position:sticky
// 以「目录子树」为约束框——滚过整个目录后目录头被自然顶走，逐级吸顶（VSCode 式粘性滚动）。
// 提交面板两段树（GitCommitPanel）与普通详情树（GitCommitDetails）共用此骨架，sticky 定位
// 与行内容一律交给 renderFolder / renderFile，本组件只负责嵌套结构。
import type { ReactNode } from 'react'
import type { FileTreeRow } from './git-details'

/** 行高（px）：目录头 sticky 逐级吸顶的层叠步距，须与行的 h-[22px] 保持一致。 */
export const ROW_HEIGHT = 22

export type FolderRow = Extract<FileTreeRow, { kind: 'folder' }>
export type FileRow = Extract<FileTreeRow, { kind: 'file' }>

/**
 * 把一段展平文件树行渲染成嵌套 DOM：每个目录连同其子孙包进一个 wrapper（sticky 目录头的
 * 约束框），文件为叶子。收起的目录在展平结果里本就没有子行，子行切片自然为空。
 */
export function StickyTree({
  rows,
  renderFolder,
  renderFile
}: {
  rows: FileTreeRow[]
  renderFolder: (row: FolderRow) => ReactNode
  renderFile: (row: FileRow) => ReactNode
}): React.JSX.Element {
  const nodes: ReactNode[] = []
  let i = 0
  while (i < rows.length) {
    const row = rows[i]
    if (row.kind === 'folder') {
      // 子孙 = 紧随其后 depth 更深的连续行（展平即深度优先，子在父后）
      let j = i + 1
      while (j < rows.length && rows[j].depth > row.depth) j++
      nodes.push(
        <div key={`d-${row.folderPath}`}>
          {renderFolder(row)}
          <StickyTree
            rows={rows.slice(i + 1, j)}
            renderFolder={renderFolder}
            renderFile={renderFile}
          />
        </div>
      )
      i = j
    } else {
      nodes.push(renderFile(row))
      i++
    }
  }
  return <>{nodes}</>
}
