// Git 单文件 diff 面板（details-diff §10）：读 git-store 的 diffView，绝对定位覆盖图谱表格区
// （集成者挂载于内层 relative 容器内，不盖吊底详情）。diff 正文由 @git-diff-view/react 渲染，
// 按官方 git mode 用法构造 DiffFile 实例（initRaw）交给 DiffView：统一（unified）/ 左右对比
// （split）经 diffViewMode 切换、偏好跨会话记忆（viewPrefs.diffSplitView）、语法高亮与词级 diff
// 由库内置；配色在 main.css 覆盖库的 CSS 主题变量对齐 Darcula。
// 二进制 / 空 diff / 延迟加载骨架 / 错误 四态兜底。Esc 关闭由 GitPane 统一处理。
import { useEffect, useMemo, useState } from 'react'
import { AlignJustify, Columns2, LoaderCircle, X } from 'lucide-react'
import { DiffFile, DiffModeEnum, DiffView } from '@git-diff-view/react'
import {
  GIT_INDEX,
  UNCOMMITTED,
  imageMimeOf,
  type GitFileChange,
  type GitFileStatus,
  type GitImageResult
} from '@shared/git'
import { gitState, useGit } from '@renderer/git-store'
import { abbrevHash } from './git-format'
import { FILE_STATUS_COLOR, FILE_STATUS_LABEL } from './git-details'

/**
 * 修订说明文案（§10.2 的描述规则）：单提交场景（from === to）按状态区分添加/删除/区间，
 * 工作区端（to === '*'）显示「工作区」。提交面板的 index 端点两分支必须放最前——
 * index→'*' 若先命中 to==='*' 分支会得到「::index → 工作区」的原文字样。
 */
function revLabel(fromHash: string, toHash: string, type: GitFileStatus): string {
  // 提交面板：未暂存段（index → 工作区，未跟踪行 from 亦为 index 同得此文案）
  if (fromHash === GIT_INDEX) return '未暂存'
  // 提交面板：已暂存段（HEAD → index）
  if (toHash === GIT_INDEX) return '已暂存'
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
  const splitView = useGit((s) => s.viewPrefs.diffSplitView)
  const setViewPrefs = useGit((s) => s.setViewPrefs)
  /** 加载骨架延迟 120ms 出现（防快速响应时闪烁，§10.2） */
  const [showLoading, setShowLoading] = useState(false)

  // 文件身份：端点 + 新路径（换文件时重置加载骨架的计时）。
  const fileKey = diffView
    ? `${diffView.fromHash}|${diffView.toHash}|${diffView.file.newFilePath}`
    : ''

  const loading = diffView?.loading ?? false
  useEffect(() => {
    // setState 只发生在定时回调里（骨架延迟出现 / 结束后异步收回），避免 effect 内同步级联渲染
    const timer = setTimeout(() => setShowLoading(loading), loading ? 120 : 0)
    return () => clearTimeout(timer)
  }, [loading, fileKey])

  // 官方 git mode 用法：new DiffFile(旧名, '', 新名, '', [git diff 原文]) → initRaw()。
  // 空串 content = 无全文（语法高亮由库按文件名推断语言、逐行处理）；主题由
  // diffViewTheme prop 落进实例，无需手动 initTheme。
  const srcFile = diffView?.file
  const srcData = diffView?.data ?? null
  const raw = srcData !== null && !srcData.binary ? srcData.raw : null
  const diffFile = useMemo(() => {
    if (srcFile === undefined || raw === null) return null
    // 无 hunk（纯重命名 / 模式变更 / 空文件新增）：没有内容可渲染，走空态文案
    if (!/^@@ -/m.test(raw)) return null
    const instance = new DiffFile(srcFile.oldFilePath, '', srcFile.newFilePath, '', [raw])
    instance.initRaw()
    return instance
  }, [srcFile, raw])

  if (diffView === null) return null
  const { file, data, error } = diffView

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-deepest">
      {/* 头部：状态徽标 + 文件路径（R 显示 旧 → 新）+ 行数统计 + 修订说明 + 切换 + 关闭 */}
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
          title={splitView ? '统一视图' : '左右对比'}
          onClick={() => void setViewPrefs({ diffSplitView: !splitView })}
          className="flex size-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--bg-button-hover)]"
        >
          {splitView ? (
            <AlignJustify className="size-3.5 text-[color:var(--fg-icon)]" />
          ) : (
            <Columns2 className="size-3.5 text-[color:var(--fg-icon)]" />
          )}
        </button>
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
      ) : file.type === '!' ? (
        // 冲突文件：git diff 对 unmerged 输出 combined diff（diff --cc，hunk 头 @@@）或
        // 「* Unmerged path」，实测 DiffFile.initRaw 均吃不下（Invalid hunk header format），
        // 按二进制同款兜底一句说明，不等数据返回
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          文件处于冲突状态，请在编辑器中解决后暂存
        </div>
      ) : data !== null && data.binary ? (
        // key=文件身份：换文件即重建组件（images 状态自然归零），不在 effect 里手动重置
        <BinaryBody
          key={fileKey}
          projectPath={projectPath}
          file={file}
          fromHash={diffView.fromHash}
          toHash={diffView.toHash}
        />
      ) : data === null ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-1.5 text-sm text-muted-foreground">
          {showLoading && (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              <span>正在加载差异…</span>
            </>
          )}
        </div>
      ) : diffFile === null ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          没有差异内容
        </div>
      ) : (
        // 滚动收进库的容器内（main.css 高度链），此层只圈定高度不再自滚
        <div className="min-h-0 flex-1 overflow-hidden">
          <DiffView
            diffFile={diffFile}
            diffViewMode={splitView ? DiffModeEnum.Split : DiffModeEnum.Unified}
            diffViewHighlight
            diffViewTheme="dark"
            diffViewFontSize={13}
          />
        </div>
      )}
    </div>
  )
}

/**
 * 二进制文件正文：图片给新旧预览（object-contain + 边距，M 双栏对照 / A·U·D 单栏），
 * 其余二进制保持一句说明。图片数据经 gitFileImage 按需取（data URL），换文件时丢弃过期响应。
 */
function BinaryBody({
  projectPath,
  file,
  fromHash,
  toHash
}: {
  projectPath: string
  file: GitFileChange
  fromHash: string
  toHash: string
}): React.JSX.Element {
  const isImage = imageMimeOf(file.newFilePath) !== null || imageMimeOf(file.oldFilePath) !== null
  const [images, setImages] = useState<GitImageResult | null>(null)
  useEffect(() => {
    if (!isImage) return
    let stale = false
    void window.api
      .gitFileImage(projectPath, {
        fromHash,
        toHash,
        oldFilePath: file.oldFilePath,
        newFilePath: file.newFilePath,
        type: file.type
      })
      .then((result) => {
        if (!stale) setImages(result)
      })
    return () => {
      stale = true
    }
  }, [projectPath, file, fromHash, toHash, isImage])

  if (!isImage || (images !== null && images.oldDataUrl === null && images.newDataUrl === null)) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
        二进制文件不支持对比
      </div>
    )
  }
  if (images === null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
      </div>
    )
  }
  const sides = [
    { label: '旧', url: images.oldDataUrl },
    { label: '新', url: images.newDataUrl }
  ].filter((side): side is { label: string; url: string } => side.url !== null)
  return (
    <div className="flex min-h-0 flex-1 gap-4 p-6">
      {sides.map((side) => (
        <div key={side.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
          <span className="shrink-0 text-[12px] text-muted-foreground">{side.label}</span>
          <div className="flex min-h-0 w-full flex-1 items-center justify-center rounded-lg bg-panel p-4">
            <img src={side.url} alt={side.label} className="max-h-full max-w-full object-contain" />
          </div>
        </div>
      ))}
    </div>
  )
}
