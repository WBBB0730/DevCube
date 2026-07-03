// Git 单文件 diff 面板（details-diff §10）：读 git-store 的 diffView，绝对定位覆盖
// GitPane 内容区（集成者挂载于 relative 容器内）。unified 视图 + 双栏行号；
// 二进制 / 超大截断 / 延迟加载骨架 / 错误 四态兜底。Esc 关闭由 GitPane 统一处理
// （diff 优先于详情），本组件只提供 × 按钮。
import { useEffect, useState } from 'react'
import { LoaderCircle, X } from 'lucide-react'
import { UNCOMMITTED, type DiffLine, type GitFileStatus } from '@shared/git'
import { gitState, useGit } from '@renderer/git-store'
import { cn } from '@renderer/lib/utils'
import { abbrevHash } from './git-format'
import {
  DIFF_RENDER_LIMIT,
  FILE_STATUS_COLOR,
  FILE_STATUS_LABEL,
  countDiffLines,
  formatHunkHeader,
  limitDiffHunks
} from './git-details'

/**
 * 修订说明文案（§10.2 的描述规则）：单提交场景（from === to）按状态区分添加/删除/区间，
 * 工作区端（to === '*'）显示「工作区」。
 */
function revLabel(fromHash: string, toHash: string, type: GitFileStatus): string {
  if (toHash === UNCOMMITTED) {
    return fromHash === 'HEAD' ? '未提交' : `${abbrevHash(fromHash)} → 工作区`
  }
  if (fromHash === toHash) {
    if (type === 'A' || type === 'U') return `于 ${abbrevHash(toHash)} 添加`
    if (type === 'D') return `于 ${abbrevHash(toHash)} 删除`
    return `${abbrevHash(fromHash)}^ → ${abbrevHash(toHash)}`
  }
  return `${abbrevHash(fromHash)} → ${abbrevHash(toHash)}`
}

export function GitDiffView({ projectPath }: { projectPath: string }): React.JSX.Element | null {
  const diffView = useGit((s) => gitState(s, projectPath).diffView)
  const closeDiff = useGit((s) => s.closeDiff)
  /** 「仍要全部渲染」记录生效的文件身份：换文件后自然失效，无需 effect 重置 */
  const [renderAllKey, setRenderAllKey] = useState<string | null>(null)
  /** 加载骨架延迟 120ms 出现（防快速响应时闪烁，§10.2） */
  const [showLoading, setShowLoading] = useState(false)

  // 文件身份：端点 + 新路径
  const fileKey = diffView
    ? `${diffView.fromHash}|${diffView.toHash}|${diffView.file.newFilePath}`
    : ''
  const renderAll = renderAllKey === fileKey

  const loading = diffView?.loading ?? false
  useEffect(() => {
    // setState 只发生在定时回调里（骨架延迟出现 / 结束后异步收回），避免 effect 内同步级联渲染
    const timer = setTimeout(() => setShowLoading(loading), loading ? 120 : 0)
    return () => clearTimeout(timer)
  }, [loading, fileKey])

  if (diffView === null) return null
  const { file, data, error } = diffView

  const total = data !== null ? countDiffLines(data.hunks) : 0
  const truncated = data !== null && !renderAll && total > DIFF_RENDER_LIMIT
  const hunks =
    data === null ? [] : truncated ? limitDiffHunks(data.hunks, DIFF_RENDER_LIMIT) : data.hunks
  // 行号列宽：按两侧最大行号的位数计（ch 单位，等宽字体下即字符数）
  const maxLineNo = hunks.reduce(
    (n, h) => Math.max(n, h.oldStart + h.oldLines, h.newStart + h.newLines),
    99
  )
  const numW = `${String(maxLineNo).length + 2}ch`

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-deepest">
      {/* 头部：状态徽标 + 文件路径（R 显示 旧 → 新）+ 行数统计 + 修订说明 + 关闭 */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[color:var(--border-input)] px-3 text-[13px]">
        <span
          title={FILE_STATUS_LABEL[file.type]}
          className="shrink-0 font-mono font-bold"
          style={{ color: FILE_STATUS_COLOR[file.type] }}
        >
          {file.type}
        </span>
        <span
          className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
          title={file.type === 'R' ? `${file.oldFilePath} → ${file.newFilePath}` : file.newFilePath}
        >
          {file.type === 'R' ? `${file.oldFilePath} → ${file.newFilePath}` : file.newFilePath}
        </span>
        {file.additions !== null && file.deletions !== null && (
          <span className="shrink-0 text-[12px]">
            <span className="text-status-success" title={`${file.additions} 处添加`}>
              +{file.additions}
            </span>
            <span className="ml-1 text-status-failed" title={`${file.deletions} 处删除`}>
              -{file.deletions}
            </span>
          </span>
        )}
        <span className="shrink-0 text-[12px] text-muted-foreground">
          {revLabel(diffView.fromHash, diffView.toHash, file.type)}
        </span>
        <button
          type="button"
          title="关闭"
          onClick={() => closeDiff(projectPath)}
          className="flex size-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--bg-button-hover)]"
        >
          <X className="size-3.5 text-[color:var(--fg-icon)]" />
        </button>
      </div>
      {error !== null ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6">
          <div className="text-sm text-muted-foreground">无法查看差异</div>
          <div className="max-w-[560px] select-text whitespace-pre-wrap break-all text-center font-mono text-[12px] text-muted-foreground">
            {error}
          </div>
        </div>
      ) : data !== null && data.binary ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          二进制文件不支持对比
        </div>
      ) : data === null ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-1.5 text-sm text-muted-foreground">
          {showLoading && (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              <span>正在加载差异…</span>
            </>
          )}
        </div>
      ) : hunks.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          没有差异内容
        </div>
      ) : (
        <>
          <div
            className="min-h-0 flex-1 select-text overflow-auto font-mono text-[13px] leading-[20px]"
            style={{ tabSize: 4 }}
          >
            <div className="min-w-max pb-2">
              {hunks.map((h, hi) => (
                <div key={hi} className={hi > 0 ? 'mt-2' : undefined}>
                  <div className="whitespace-pre bg-[var(--diff-hunk-header-bg)] px-2 text-muted-foreground">
                    {formatHunkHeader(h)}
                  </div>
                  {h.lines.map((line, li) => (
                    <DiffRow key={li} line={line} numW={numW} />
                  ))}
                </div>
              ))}
            </div>
          </div>
          {truncated && (
            <div className="flex h-9 shrink-0 items-center justify-center gap-3 border-t border-[color:var(--separator)] text-[12px] text-muted-foreground">
              <span>差异过大，仅显示前 {DIFF_RENDER_LIMIT} 行。</span>
              <button
                type="button"
                onClick={() => setRenderAllKey(fileKey)}
                className="h-6 rounded-lg border border-[color:var(--border-input)] bg-panel px-3 text-[12px] text-foreground transition-colors hover:bg-[var(--bg-row-hover)]"
              >
                仍要全部渲染
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** 一行 diff：双栏行号（add 无旧号 / del 无新号）+ 原文内容；行尾无换行符附灰字标注行。 */
function DiffRow({ line, numW }: { line: DiffLine; numW: string }): React.JSX.Element {
  const bg =
    line.kind === 'add'
      ? 'bg-[var(--diff-add-bg)]'
      : line.kind === 'del'
        ? 'bg-[var(--diff-del-bg)]'
        : undefined
  return (
    <>
      <div className={cn('flex', bg)}>
        <span
          className="shrink-0 select-none pr-1 text-right tabular-nums text-muted-foreground"
          style={{ width: numW }}
        >
          {line.oldLineNo ?? ''}
        </span>
        <span
          className="shrink-0 select-none pr-1 text-right tabular-nums text-muted-foreground"
          style={{ width: numW }}
        >
          {line.newLineNo ?? ''}
        </span>
        {/* whitespace-pre + 外层 min-w-max：不折行、横向滚动（§10.2） */}
        <span className="whitespace-pre pl-2 pr-4">{line.text}</span>
      </div>
      {line.noEolAtEnd === true && (
        <div className="flex">
          <span className="shrink-0" style={{ width: numW }} />
          <span className="shrink-0" style={{ width: numW }} />
          <span className="whitespace-pre pl-2 italic text-muted-foreground">
            ⏎ 文件末尾无换行符
          </span>
        </div>
      )}
    </>
  )
}
