// 提交面板（ADR-0006）：未提交更改行的详情从只读升级为带暂存区的提交面板，行为对齐
// SourceTree —— 左栏 CommitForm（提交信息 + 修正 / 推送勾选 + 提交），右栏
// UncommittedFileSections（「已暂存 / 未暂存」两段文件树：勾选即 git add、取消勾选即
// unstage、区头 = 全部；同一文件可同时出现在两段——已暂存是暂存那一刻的快照）。
// 两个组件由 GitCommitDetails 的左右栏分别挂载；暂存类操作走 runQuietAction 静默即时
// （无进行中遮罩，PRD「静默即时」），错误由 GitDialogs 的错误框统一呈现。
import { useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Ellipsis,
  File as FileIcon,
  Folder,
  FolderOpen
} from 'lucide-react'
import type { GitFileChange } from '@shared/git'
import { gitState, useGit } from '@renderer/git-store'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import {
  FILE_STATUS_COLOR,
  buildFileTree,
  diffPossible,
  fileRowTitle,
  flattenFileTree,
  uncommittedDiffEndpoints
} from './git-details'

/** selector 稳定空引用：uncommitted 未落地时避免每次返回新数组触发无谓重渲染。 */
const EMPTY_FILES: GitFileChange[] = []

// —— 左栏：提交表单 ——

/** 提交表单：信息多行框（草稿存桶，切走不丢）+ 修正上次提交 + 提交 / 提交并推送。 */
export function CommitForm({ projectPath }: { projectPath: string }): React.JSX.Element {
  const draft = useGit((s) => gitState(s, projectPath).commitDraft)
  const stagedCount = useGit(
    (s) => gitState(s, projectPath).expanded?.uncommitted?.staged.length ?? 0
  )
  const currentBranch = useGit((s) => gitState(s, projectPath).currentBranch)
  /** HEAD 提交信息预填的异步在途标记（期间 checkbox / 提交钮禁点，防连点与预填竞态） */
  const [amendLoading, setAmendLoading] = useState(false)
  /** 提交在途标记（commit 非幂等：双击会排入两个 commit，第二个必以 nothing to commit 报错） */
  const [committing, setCommitting] = useState(false)
  /** 「提交后推送」勾选（本地态，切走重置）；detached HEAD 无当前分支时不可推送 */
  const [push, setPush] = useState(false)
  const canPush = currentBranch !== null

  const onAmendChange = async (checked: boolean): Promise<void> => {
    const store = useGit.getState()
    if (!checked) {
      // 取消勾选：恢复勾选前的草稿（备份存桶，面板收起重开后仍可恢复）
      store.setCommitDraft(projectPath, {
        message: gitState(store, projectPath).commitDraft.preAmendMessage,
        amend: false,
        preAmendMessage: ''
      })
      return
    }
    // 勾选：先备份当前草稿并同步置 amend（预填在途期间的提交也按修正意图执行），
    // 再取 HEAD 完整提交信息预填
    store.setCommitDraft(projectPath, { amend: true, preAmendMessage: draft.message })
    setAmendLoading(true)
    try {
      const st = gitState(store, projectPath)
      const head = st.headHash !== null ? st.commits.find((c) => c.hash === st.headHash) : undefined
      const result =
        st.headHash !== null
          ? await window.api.gitDetails(projectPath, {
              kind: 'commit',
              hash: st.headHash,
              hasParents: (head?.parents.length ?? 0) > 0
            })
          : null
      // 预填落地前修正勾选已被撤销（面板重开后取消勾选 / 提交成功清空草稿）：丢弃过期预填，
      // 防止旧 HEAD 消息 + amend 态「复活」草稿导致下次提交意外 --amend
      if (!gitState(useGit.getState(), projectPath).commitDraft.amend) return
      if (result !== null && result.details !== null) {
        useGit.getState().setCommitDraft(projectPath, { message: result.details.body })
      }
      // 取不到 HEAD 提交信息：静默容错——保持原草稿（amend 已在勾选时置上）
    } finally {
      setAmendLoading(false)
    }
  }

  // 禁用：无提交信息、既无已暂存文件又不是修正（amend 允许空暂存区只改信息）、
  // 或预填 / 提交在途（防双击重复提交与迟到预填的竞态）
  const disabled =
    draft.message.trim() === '' || (stagedCount === 0 && !draft.amend) || amendLoading || committing

  const commit = async (push: boolean): Promise<void> => {
    const store = useGit.getState()
    setCommitting(true)
    try {
      const r = await store.runQuietAction(projectPath, {
        kind: 'commit',
        message: draft.message,
        amend: draft.amend
      })
      if (r.status !== 'ok') return // 失败：错误框呈现（actionErrors），不清草稿
      store.setCommitDraft(projectPath, { message: '', amend: false, preAmendMessage: '' })
      if (push && currentBranch !== null) {
        // 提交并推送：复用既有推送对话框（内含 常规 / force-with-lease / 强制 三档）
        store.openDialog(projectPath, { kind: 'push-branch', branch: currentBranch })
      }
    } finally {
      setCommitting(false)
    }
  }

  return (
    // gap-3：信息框与操作行间距拉大
    <div className="flex h-full flex-col gap-3">
      <textarea
        value={draft.message}
        placeholder="提交信息"
        onChange={(e) => useGit.getState().setCommitDraft(projectPath, { message: e.target.value })}
        className="min-h-0 w-full flex-1 resize-none rounded border border-[color:var(--border-input)] bg-transparent px-2.5 py-1.5 text-[13px] text-foreground outline-none transition placeholder:text-[color:var(--fg-disabled)] focus-visible:ring-2 focus-visible:ring-ring"
      />
      {/* 修正 / 推送 两个勾选在左，「提交」按钮靠右；勾了推送则提交后弹推送对话框 */}
      <div className="flex items-center gap-4">
        <label className="flex cursor-pointer select-none items-center gap-1.5 text-[13px] text-foreground">
          <Checkbox
            checked={draft.amend}
            disabled={amendLoading || committing}
            onCheckedChange={(checked) => void onAmendChange(checked)}
          />
          修正上次提交
        </label>
        <label
          className={cn(
            'flex select-none items-center gap-1.5 text-[13px] text-foreground',
            canPush && !committing ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
          )}
          title={canPush ? '提交后推送到当前分支' : '当前为 detached HEAD，无法推送'}
        >
          <Checkbox
            checked={push && canPush}
            disabled={!canPush || committing}
            onCheckedChange={(checked) => setPush(checked)}
          />
          推送
        </label>
        <Button
          className="ml-auto"
          size="sm"
          disabled={disabled}
          onClick={() => void commit(push && canPush)}
        >
          提交
        </Button>
      </div>
    </div>
  )
}

// —— 右栏：已暂存 / 未暂存两段文件树 ——

/** 两段文件树：宿主保证 exp.uncommitted 非 null 时才挂载（防御性判空返回 null）。 */
export function UncommittedFileSections({
  projectPath
}: {
  projectPath: string
}): React.JSX.Element | null {
  const rawStaged = useGit(
    (s) => gitState(s, projectPath).expanded?.uncommitted?.staged ?? EMPTY_FILES
  )
  const rawUnstaged = useGit(
    (s) => gitState(s, projectPath).expanded?.uncommitted?.unstaged ?? EMPTY_FILES
  )
  /**
   * 乐观移动：点勾后立刻把文件挪到目标段（行位置与复选框态一起即时变），git 处理完（finally）
   * 撤销覆盖、交还真实数据；失败也撤销（文件退回原段）。
   */
  const [moves, setMoves] = useState<
    Map<string, { file: GitFileChange; to: 'staged' | 'unstaged' }>
  >(new Map())

  // 应用乐观移动派生某段的显示文件：无 move 时返回原数组（稳定引用，避免无谓重渲染）
  const derive = (raw: GitFileChange[], section: 'staged' | 'unstaged'): GitFileChange[] => {
    if (moves.size === 0) return raw
    const entries = [...moves.values()]
    const movedAway = new Set(
      entries.filter((m) => m.to !== section).map((m) => m.file.newFilePath)
    )
    const kept = raw.filter((f) => !movedAway.has(f.newFilePath))
    const movedIn = entries
      .filter((m) => m.to === section && !kept.some((k) => k.newFilePath === m.file.newFilePath))
      .map((m) => m.file)
    return movedAway.size === 0 && movedIn.length === 0 ? raw : [...kept, ...movedIn]
  }

  const toggleFile = async (file: GitFileChange, from: 'staged' | 'unstaged'): Promise<void> => {
    const to = from === 'staged' ? 'unstaged' : 'staged'
    const key = file.newFilePath
    setMoves((prev) => new Map(prev).set(key, { file, to }))
    try {
      await useGit.getState().runQuietAction(projectPath, {
        kind: from === 'staged' ? 'unstage-paths' : 'stage-paths',
        // R 需要同时传旧 / 新两个路径（pathspec 覆盖重命名两端）
        paths: file.type === 'R' ? [file.oldFilePath, file.newFilePath] : [file.newFilePath]
      })
    } finally {
      setMoves((prev) => {
        const next = new Map(prev)
        next.delete(key)
        return next
      })
    }
  }

  return (
    <div>
      <FileSection
        projectPath={projectPath}
        section="staged"
        files={derive(rawStaged, 'staged')}
        onToggleFile={toggleFile}
      />
      {/* 两段间 1px 分隔 */}
      <div className="my-1 h-px bg-[var(--separator)]" />
      <FileSection
        projectPath={projectPath}
        section="unstaged"
        files={derive(rawUnstaged, 'unstaged')}
        onToggleFile={toggleFile}
      />
    </div>
  )
}

/**
 * 单段文件树（已暂存 / 未暂存）：区头即 SourceTree 的「全部」开关——已暂存区头点击
 * 全取消（unstage-paths []）、未暂存区头点击全部暂存（stage-paths []）。文件夹开合为
 * 组件内 state（未提交面板目标恒为 '*'，软刷新不重挂，开合自然保留）。
 */
function FileSection({
  projectPath,
  section,
  files,
  onToggleFile
}: {
  projectPath: string
  section: 'staged' | 'unstaged'
  files: GitFileChange[]
  /** 勾选/取消单文件：交由父组件做乐观移动 + git（本段只负责触发） */
  onToggleFile: (file: GitFileChange, section: 'staged' | 'unstaged') => void
}): React.JSX.Element {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const tree = useMemo(() => buildFileTree(files), [files])
  const rows = useMemo(() => flattenFileTree(tree, closed), [tree, closed])
  const isStaged = section === 'staged'
  // 本段的 diff 端点（已暂存 HEAD↔index / 未暂存 index↔工作区）
  const { fromHash: secFrom, toHash: secTo } = uncommittedDiffEndpoints(section)
  // 当前打开 diff 的文件身份（端点 + 路径）：据此高亮本段中被选中的文件行
  const selectedKey = useGit((s) => {
    const d = gitState(s, projectPath).diffView
    return d !== null ? `${d.fromHash}|${d.toHash}|${d.file.newFilePath}` : null
  })

  const toggleFolder = (folderPath: string): void => {
    setClosed((prev) => {
      const next = new Set(prev)
      if (next.has(folderPath)) next.delete(folderPath)
      else next.add(folderPath)
      return next
    })
  }

  /** R 需要同时传旧 / 新两个路径（git add / reset 的 pathspec 覆盖重命名两端）。 */
  const pathsOf = (file: GitFileChange): string[] =>
    file.type === 'R' ? [file.oldFilePath, file.newFilePath] : [file.newFilePath]

  /** 区头「全部」开关：空数组 = 全部（add -A / reset）。 */
  const toggleAll = (): void => {
    void useGit.getState().runQuietAction(projectPath, {
      kind: isStaged ? 'unstage-paths' : 'stage-paths',
      paths: []
    })
  }

  /** 目录行复选框：暂存 / 取消暂存该目录下的全部文件（本段内文件同暂存态，无三态）。 */
  const toggleFolder2 = (folderPath: string): void => {
    const prefix = `${folderPath}/`
    const paths = files.filter((f) => f.newFilePath.startsWith(prefix)).flatMap(pathsOf)
    if (paths.length === 0) return
    void useGit.getState().runQuietAction(projectPath, {
      kind: isStaged ? 'unstage-paths' : 'stage-paths',
      paths
    })
  }

  const openFileDiff = (file: GitFileChange): void => {
    void useGit.getState().openDiff(projectPath, file, secFrom, secTo)
  }

  const openMenu = (x: number, y: number, file: GitFileChange): void => {
    useGit.getState().openContextMenu(projectPath, {
      x,
      y,
      target: { kind: 'uncommitted-file', file, section }
    })
  }

  return (
    <div>
      {/* 区头：全部开关 + 标题 + 计数（观感对齐仓库设置面板的 Section 小标题） */}
      <label
        className={cn(
          'flex h-7 select-none items-center gap-1.5 px-2 text-[12px] font-medium text-muted-foreground',
          files.length > 0 && 'cursor-pointer'
        )}
      >
        <Checkbox
          // 已暂存区头 = 「有内容即勾满，点击全取消」；未暂存区头 = 恒未勾，点击全部暂存
          checked={isStaged ? files.length > 0 : false}
          disabled={files.length === 0}
          onCheckedChange={() => toggleAll()}
        />
        <span>
          {isStaged ? '已暂存文件' : '未暂存文件'} ({files.length})
        </span>
      </label>
      {files.length === 0 ? (
        // 空段：区头保留（checkbox disabled），段内一行占位（缩进对齐文件行）
        <div
          className="flex h-[22px] items-center pr-2 text-[13px] text-muted-foreground"
          style={{ paddingLeft: 8 + 18 }}
        >
          {isStaged ? '无已暂存文件' : '无未暂存文件'}
        </div>
      ) : (
        rows.map((row) => {
          if (row.kind === 'folder') {
            return (
              <div
                key={`d-${row.folderPath}`}
                className="flex h-[22px] cursor-pointer items-center gap-1.5 pr-2 text-[13px] transition-colors hover:bg-[var(--bg-row-hover)]"
                style={{ paddingLeft: 8 + row.depth * 16 }}
                onClick={() => toggleFolder(row.folderPath)}
              >
                {row.open ? (
                  <ChevronDown className="size-3.5 shrink-0 text-[color:var(--fg-icon)]" />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0 text-[color:var(--fg-icon)]" />
                )}
                {/* 复选框放在箭头之后；包一层 stopPropagation 防止点勾连带触发折叠 */}
                <span className="flex shrink-0" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={isStaged}
                    onCheckedChange={() => toggleFolder2(row.folderPath)}
                  />
                </span>
                {row.open ? (
                  <FolderOpen className="size-3.5 shrink-0 text-[color:var(--fg-icon)]" />
                ) : (
                  <Folder className="size-3.5 shrink-0 text-[color:var(--fg-icon)]" />
                )}
                <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                  {row.name}
                </span>
              </div>
            )
          }
          const file = files[row.index]
          const clickable = diffPossible(file)
          const colour = FILE_STATUS_COLOR[file.type]
          const isSelected = selectedKey === `${secFrom}|${secTo}|${file.newFilePath}`
          return (
            <div
              key={`f-${row.index}`}
              title={fileRowTitle(file)}
              className={cn(
                'group flex h-[22px] items-center gap-1.5 pr-2 text-[13px] transition-colors',
                clickable ? 'cursor-pointer' : 'cursor-default',
                // 当前打开 diff 的文件行高亮（选中蓝底，hover 用更亮的选中蓝）
                isSelected
                  ? 'bg-[var(--selection-row)] hover:bg-[var(--selection-row-hover)]'
                  : 'hover:bg-[var(--bg-row-hover)]'
              )}
              // checkbox 与文件夹行对齐置首位，其后补 chevron 列占位让文件图标与文件夹图标对齐
              style={{ paddingLeft: 8 + row.depth * 16 }}
              onClick={() => clickable && openFileDiff(file)}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                openMenu(e.clientX, e.clientY, file)
              }}
            >
              {/* chevron 列占位（对齐文件夹箭头）；复选框放其后、紧挨文件名 */}
              <span className="size-3.5 shrink-0" />
              {/* 包一层 stopPropagation 防止点勾连带打开 diff；勾选态随乐观移动即时翻转 */}
              <span className="flex shrink-0" onClick={(e) => e.stopPropagation()}>
                <Checkbox checked={isStaged} onCheckedChange={() => onToggleFile(file, section)} />
              </span>
              <FileIcon className="size-3.5 shrink-0" style={{ color: colour }} />
              <span
                className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
                // 选中行文字变白（#DFE1E5），压过状态色以在蓝底上清晰
                style={{ color: isSelected ? 'var(--fg-primary)' : colour }}
              >
                {row.name}
              </span>
              {(file.type === 'M' || file.type === 'R') &&
                file.additions !== null &&
                file.deletions !== null && (
                  <span className="shrink-0 text-[12px]">
                    <span className="text-status-success" title={`${file.additions} 处添加`}>
                      +{file.additions}
                    </span>
                    <span className="ml-1 text-status-failed" title={`${file.deletions} 处删除`}>
                      -{file.deletions}
                    </span>
                  </span>
                )}
              {/* 行尾 … 菜单钮：默认隐藏、行 hover 才浮出（避免每行常驻噪点） */}
              <button
                type="button"
                title="更多操作"
                className="ml-auto flex size-6 shrink-0 items-center justify-center rounded opacity-0 transition-colors hover:bg-[var(--bg-button-hover)] group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  const rect = e.currentTarget.getBoundingClientRect()
                  openMenu(rect.left, rect.bottom, file) // 菜单锚在按钮左下角
                }}
              >
                <Ellipsis className="size-3.5 text-[color:var(--fg-icon)]" />
              </button>
            </div>
          )
        })
      )}
    </div>
  )
}
