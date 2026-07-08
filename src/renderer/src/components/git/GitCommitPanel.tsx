// 提交面板（ADR-0006）：未提交更改行的详情从只读升级为带暂存区的提交面板，行为对齐
// SourceTree —— 左栏 CommitForm（提交信息 + 修正 / 推送勾选 + 提交），右栏
// UncommittedFileSections（「已暂存 / 未暂存」两段文件树：勾选即 git add、取消勾选即
// unstage、区头 = 全部；同一文件可同时出现在两段——已暂存是暂存那一刻的快照）。
// 两个组件由 GitCommitDetails 的左右栏分别挂载；暂存类操作走 runQuietAction 静默即时
// （无进行中遮罩，PRD「静默即时」），错误由 GitDialogs 的错误框统一呈现。
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, Ellipsis, File as FileIcon, Folder } from 'lucide-react'
import type { GitFileChange } from '@shared/git'
import { gitState, useGit } from '@renderer/git-store'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import {
  FILE_STATUS_COLOR,
  buildFileTree,
  canPushAfterCommit,
  diffPossible,
  fileRowTitle,
  filesInSelection,
  flattenFileTree,
  pathspecOf,
  uncommittedDiffEndpoints,
  type FileTreeRow
} from './git-details'
import { StickyTree, ROW_HEIGHT, type FolderRow, type FileRow } from './GitFileTree'

/** selector 稳定空引用：uncommitted 未落地时避免每次返回新数组触发无谓重渲染。 */
const EMPTY_FILES: GitFileChange[] = []

/** 非活跃段的选区恒为空集：稳定引用，避免 FileSection 每次渲染新建 Set。 */
const EMPTY_KEYS: ReadonlySet<string> = new Set()

/**
 * 文件树选区（提交面板多选，ADR-0006）：活跃段 + 选中行 key 集 + shift 范围选锚点。
 * key = 文件行的 newFilePath 或目录行的 folderPath；跨段互斥，只保留一份、切段即清空。
 */
type SectionSelection = {
  section: 'staged' | 'unstaged'
  keys: ReadonlySet<string>
  anchor: string | null
}

// —— 左栏：提交表单 ——

/** 提交表单：信息多行框（草稿存桶，切走不丢）+ 修正上次提交 + 提交 / 提交并推送。 */
export function CommitForm({ projectPath }: { projectPath: string }): React.JSX.Element {
  const draft = useGit((s) => gitState(s, projectPath).commitDraft)
  const stagedCount = useGit(
    (s) => gitState(s, projectPath).expanded?.uncommitted?.staged.length ?? 0
  )
  const currentBranch = useGit((s) => gitState(s, projectPath).currentBranch)
  const headHash = useGit((s) => gitState(s, projectPath).headHash)
  /** HEAD 提交信息预填的异步在途标记（期间 checkbox / 提交钮禁点，防连点与预填竞态） */
  const [amendLoading, setAmendLoading] = useState(false)
  /** 提交在途标记（commit 非幂等：双击会排入两个 commit，第二个必以 nothing to commit 报错） */
  const [committing, setCommitting] = useState(false)
  /** 「提交后推送」勾选（本地态，切走重置） */
  const [push, setPush] = useState(false)
  /** 空仓库（无 HEAD）没有提交可修正 */
  const canAmend = headHash !== null
  const canPush = canPushAfterCommit(currentBranch, headHash)

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
      if (push) {
        // 提交并推送：复用既有推送对话框（内含 常规 / force-with-lease / 强制 三档）。
        // 分支从提交后的最新状态取（runQuietAction 内已 await 软刷新落地）——空仓库的
        // 首次提交让分支刚刚出生，提交前闭包里的 currentBranch 还是 null
        const branch = gitState(useGit.getState(), projectPath).currentBranch
        if (branch !== null) {
          store.openDialog(projectPath, { kind: 'push-branch', branch })
        }
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
        <label
          className={cn(
            'flex select-none items-center gap-1.5 text-[13px] text-foreground',
            canAmend ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
          )}
          title={canAmend ? undefined : '还没有提交可修正'}
        >
          <Checkbox
            checked={draft.amend}
            disabled={!canAmend || amendLoading || committing}
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
   * 乐观勾选（不移段）：点勾后把这些文件的 newFilePath 记入 pending（值 = 目标段），复选框
   * 原地按目标态翻转、文件留在原段；期间面板锁定（locked）。真实两段数据反映该变更后由下方
   * 逐文件对账清除，判据成立前复选框不回弹故无闪烁；失败则显式清除以还原复选框并解锁。
   */
  const [pending, setPending] = useState<Map<string, 'staged' | 'unstaged'>>(new Map())
  /** 文件树选区（跨两段互斥，只保留一份）：切段即清空；批量 / 勾选致列表变动后清空。 */
  const [selection, setSelection] = useState<SectionSelection | null>(null)
  // 两段列表落地新引用（软刷新后文件移段 / 消失）即清空选区并对账 pending：旧 key 已失效。
  // 渲染期比对上一份引用（React「渲染中调整 state」模式，非 effect，避免级联渲染告警）。
  const [prevLists, setPrevLists] = useState({ staged: rawStaged, unstaged: rawUnstaged })
  if (prevLists.staged !== rawStaged || prevLists.unstaged !== rawUnstaged) {
    setPrevLists({ staged: rawStaged, unstaged: rawUnstaged })
    setSelection(null)
    // 逐文件对账：真实数据已反映该 pending 项即清除（暂存 = 已进暂存段且离未暂存段；
    // 取消暂存 = 已离暂存段）。判据成立前不清、复选框不回弹，故无闪烁；pending 清空即解锁。
    if (pending.size > 0) {
      const stagedSet = new Set(rawStaged.map((f) => f.newFilePath))
      const unstagedSet = new Set(rawUnstaged.map((f) => f.newFilePath))
      const next = new Map(pending)
      let changed = false
      for (const [key, to] of pending) {
        const done =
          to === 'staged' ? stagedSet.has(key) && !unstagedSet.has(key) : !stagedSet.has(key)
        if (done) {
          next.delete(key)
          changed = true
        }
      }
      if (changed) setPending(next)
    }
  }
  /** pending 非空 = 有暂存操作在途：锁定暂存类控件（复选框 / 区头「全部」）禁止操作。 */
  const locked = pending.size > 0
  /** 某段报告新选区：空集归一为 null（无选中），非空则记为该段的活跃选区。 */
  const selectInSection =
    (section: 'staged' | 'unstaged') =>
    (keys: ReadonlySet<string>, anchor: string | null): void =>
      setSelection(keys.size === 0 ? null : { section, keys, anchor })

  /**
   * 对一批文件乐观勾选 + 一次 runQuietAction（单文件 / 目录 / 联合选区 / 区头「全部」共用）。
   * all=true 时 git 侧用空 paths（add -A / reset 全部，避免几百路径撑爆命令行），乐观 pending
   * 仍按传入的整段文件逐一记录。成功后由对账清 pending；失败在此显式清除还原复选框并解锁。
   */
  const runToggle = async (
    targets: GitFileChange[],
    from: 'staged' | 'unstaged',
    all: boolean
  ): Promise<void> => {
    if (targets.length === 0) return
    const to = from === 'staged' ? 'unstaged' : 'staged'
    setPending((prev) => {
      const next = new Map(prev)
      for (const f of targets) next.set(f.newFilePath, to)
      return next
    })
    const result = await useGit.getState().runQuietAction(projectPath, {
      kind: from === 'staged' ? 'unstage-paths' : 'stage-paths',
      // R 需要同时传旧 / 新两个路径（pathspec 覆盖重命名两端）；all=空 = 全部
      paths: all ? [] : targets.flatMap(pathspecOf)
    })
    if (result.status !== 'ok') {
      setPending((prev) => {
        const next = new Map(prev)
        for (const f of targets) next.delete(f.newFilePath)
        return next
      })
    }
  }

  /** 两段起点锚 ref：点标题经锚 scrollIntoView 定位（标题恒 sticky，直接滚它不动）。 */
  const stagedAnchorRef = useRef<HTMLDivElement>(null)
  const unstagedAnchorRef = useRef<HTMLDivElement>(null)
  const scrollToSection = (section: 'staged' | 'unstaged'): void => {
    const el = section === 'staged' ? stagedAnchorRef.current : unstagedAnchorRef.current
    el?.scrollIntoView({ block: 'start' })
  }

  // 根层是唯一滚动容器（h-full overflow-auto）；两段标题以「全部内容」为约束框做双向 sticky：
  // 已暂存钉顶、未暂存未到时钉底预告 / 滚到时钉在已暂存下方，故两段标题恒可见，目录在其下逐级
  // 吸顶。点标题经锚 scrollIntoView 跳到对应段；末尾留白条给底部一点 padding。
  return (
    <div className="h-full overflow-auto">
      <FileSection
        projectPath={projectPath}
        section="staged"
        files={rawStaged}
        pending={pending}
        locked={locked}
        onToggle={(targets, section) => void runToggle(targets, section, false)}
        onToggleAll={() => void runToggle(rawStaged, 'staged', true)}
        selectedKeys={selection?.section === 'staged' ? selection.keys : EMPTY_KEYS}
        anchor={selection?.section === 'staged' ? selection.anchor : null}
        onSelect={selectInSection('staged')}
        anchorRef={stagedAnchorRef}
        onHeaderClick={() => scrollToSection('staged')}
      />
      {/* 两段间 1px 分隔 */}
      <div className="my-1 h-px bg-[var(--separator)]" />
      <FileSection
        projectPath={projectPath}
        section="unstaged"
        files={rawUnstaged}
        pending={pending}
        locked={locked}
        onToggle={(targets, section) => void runToggle(targets, section, false)}
        onToggleAll={() => void runToggle(rawUnstaged, 'unstaged', true)}
        selectedKeys={selection?.section === 'unstaged' ? selection.keys : EMPTY_KEYS}
        anchor={selection?.section === 'unstaged' ? selection.anchor : null}
        onSelect={selectInSection('unstaged')}
        anchorRef={unstagedAnchorRef}
        onHeaderClick={() => scrollToSection('unstaged')}
      />
      {/* 底部留白条：sticky 钉底 + bg-deepest 遮挡——既给内容留 8px 底距，又盖住未暂存标题
          bottom-2 悬起后其下 8px 缝里滚过的行（否则间距内会漏出内容）。 */}
      <div className="sticky bottom-0 z-30 h-2 bg-deepest" aria-hidden />
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
  pending,
  locked,
  onToggle,
  onToggleAll,
  selectedKeys,
  anchor,
  onSelect,
  anchorRef,
  onHeaderClick
}: {
  projectPath: string
  section: 'staged' | 'unstaged'
  files: GitFileChange[]
  /** 乐观勾选态：newFilePath → 目标段；含此文件即复选框按目标态原地翻转（不移段） */
  pending: ReadonlyMap<string, 'staged' | 'unstaged'>
  /** 有暂存操作在途：禁用本段所有暂存类控件（复选框 / 区头「全部」） */
  locked: boolean
  /** 勾选/取消一批文件（单文件 / 目录 / 联合选区）：交由父组件做乐观勾选 + git */
  onToggle: (targets: GitFileChange[], section: 'staged' | 'unstaged') => void
  /** 区头「全部」：暂存 / 取消暂存整段（git 侧走空 paths，父组件按整段做乐观勾选） */
  onToggleAll: () => void
  /** 本段当前选中的行 key 集（文件 newFilePath 或目录 folderPath）；非活跃段为空集 */
  selectedKeys: ReadonlySet<string>
  /** shift 范围选锚点行 key；null = 无锚点 */
  anchor: string | null
  /** 选区变化上报父组件（父负责套上本段身份、维持跨段互斥） */
  onSelect: (keys: ReadonlySet<string>, anchor: string | null) => void
  /** 段起点锚 ref：父组件据此 scrollIntoView 到本段（标题恒 sticky，须靠锚定位） */
  anchorRef: React.Ref<HTMLDivElement>
  /** 点标题：滚动到本段 */
  onHeaderClick: () => void
}): React.JSX.Element {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  /** 整段折叠态（标题行即本段顶级目录）：默认展开，折叠时段内容整体隐藏。 */
  const [sectionOpen, setSectionOpen] = useState(true)
  const tree = useMemo(() => buildFileTree(files), [files])
  const rows = useMemo(() => flattenFileTree(tree, closed), [tree, closed])
  const isStaged = section === 'staged'
  /** 复选框有效勾选态：pending 中的文件按目标段翻转，否则按所在段（isStaged）。 */
  const fileChecked = (file: GitFileChange): boolean => {
    const to = pending.get(file.newFilePath)
    return to ? to === 'staged' : isStaged
  }
  /** 文件夹勾选态：其下文件全部有效勾选为真才勾（无 pending 时恒等于 isStaged，短路）。 */
  const folderChecked = (folderPath: string): boolean => {
    if (pending.size === 0) return isStaged
    const dirFiles = filesInSelection(files, new Set([folderPath]))
    return dirFiles.length > 0 && dirFiles.every(fileChecked)
  }
  // 本段的 diff 端点（已暂存 HEAD↔index / 未暂存 index↔工作区）
  const { fromHash: secFrom, toHash: secTo } = uncommittedDiffEndpoints(section)
  // 本段选区解析出的文件（联合勾选：点选区内某行的复选框 → 对整批生效）
  const selFiles = useMemo(() => filesInSelection(files, selectedKeys), [files, selectedKeys])
  /** 本段标题上方的 sticky 标题数（含自身）：已暂存 1、未暂存 2（其上还有已暂存标题）。
   *  段内目录的吸顶 top 与层叠 z 都据它下推，故未暂存段目录钉在两条标题之下。 */
  const headerLevels = isStaged ? 1 : 2

  const toggleFolder = (folderPath: string): void => {
    setClosed((prev) => {
      const next = new Set(prev)
      if (next.has(folderPath)) next.delete(folderPath)
      else next.add(folderPath)
      return next
    })
  }

  const openFileDiff = (file: GitFileChange): void => {
    void useGit.getState().openDiff(projectPath, file, secFrom, secTo)
  }

  /** 行的稳定选中 key：目录用 folderPath、文件用 newFilePath（同段内互不冲突）。 */
  const rowKey = (row: FileTreeRow): string =>
    row.kind === 'folder' ? row.folderPath : files[row.index].newFilePath

  /**
   * 行点击选中（文件管理器式）：shift = 从锚点到当前的连续可见区间（替换、锚点不变）；
   * cmd/ctrl = 加减选该行并成为新锚点；普通单击 = 单选该行、文件行同时打开 diff。
   */
  const selectRow = (e: React.MouseEvent, row: FileTreeRow): void => {
    const key = rowKey(row)
    if (e.shiftKey && anchor !== null) {
      const keyList = rows.map(rowKey)
      const from = keyList.indexOf(anchor)
      const to = keyList.indexOf(key)
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from <= to ? [from, to] : [to, from]
        onSelect(new Set(keyList.slice(lo, hi + 1)), anchor)
        return
      }
    }
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selectedKeys)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      onSelect(next, key)
      return
    }
    onSelect(new Set([key]), key)
    if (row.kind === 'file') {
      const file = files[row.index]
      if (diffPossible(file)) openFileDiff(file)
    }
  }

  /**
   * 右键出菜单：右键选区外的行先把选区重置为该行（对齐文件管理器）。选区解析出单个文件且
   * 右键的是文件行 → 单文件菜单；否则（多文件 / 目录）→ 批量菜单。
   */
  const openRowMenu = (e: React.MouseEvent, row: FileTreeRow): void => {
    e.preventDefault()
    e.stopPropagation()
    const key = rowKey(row)
    const keys = selectedKeys.has(key) ? selectedKeys : new Set([key])
    if (!selectedKeys.has(key)) onSelect(keys, key)
    const selFiles = filesInSelection(files, keys)
    if (selFiles.length === 0) return
    useGit.getState().openContextMenu(projectPath, {
      x: e.clientX,
      y: e.clientY,
      target:
        selFiles.length === 1 && row.kind === 'file'
          ? { kind: 'uncommitted-file', file: selFiles[0], section }
          : { kind: 'uncommitted-files', files: selFiles, section }
    })
  }

  /** 区头「全部」开关：交父组件乐观勾选整段并走空 paths（add -A / reset）。 */
  const toggleAll = (): void => {
    onToggleAll()
  }

  /** 文件行复选框：在选区内则对整个选区联合切换，否则只切该文件（都走父组件乐观移动）。 */
  const toggleFileStage = (file: GitFileChange): void => {
    const inSel = selFiles.some((f) => f.newFilePath === file.newFilePath)
    onToggle(inSel ? selFiles : [file], section)
  }

  /** 目录行复选框：目录在选区内则对整个选区联合切换，否则切该目录下全部文件。 */
  const toggleFolderStage = (folderPath: string): void => {
    const dirFiles = selectedKeys.has(folderPath)
      ? selFiles
      : filesInSelection(files, new Set([folderPath]))
    onToggle(dirFiles, section)
  }

  const openMenu = (x: number, y: number, file: GitFileChange): void => {
    useGit.getState().openContextMenu(projectPath, {
      x,
      y,
      target: { kind: 'uncommitted-file', file, section }
    })
  }

  // 目录行：sticky 逐级吸顶（吸顶 top / z 按 stickyLevel 下推，让位上方标题）；圆角块观感对齐
  // 配置行，bg-deepest 兜底供 sticky 时盖住滚过的下方行；箭头旋转过渡、文件夹图标恒定不换。
  const renderFolder = (row: FolderRow): ReactNode => {
    const isSelected = selectedKeys.has(row.folderPath)
    const vDepth = row.depth + 1 // 缩进层级（标题占顶层，内容整体缩进一级）
    const stickyLevel = row.depth + headerLevels // 吸顶层数（含上方标题）：决定 top 与 z
    return (
      <div
        className={cn(
          'sticky mx-1 flex h-[22px] cursor-pointer select-none items-center gap-1.5 rounded pr-2 text-[13px] transition-colors',
          isSelected ? 'bg-[var(--selection-row)]' : 'bg-deepest hover:bg-[var(--bg-row-hover)]'
        )}
        style={{
          top: stickyLevel * ROW_HEIGHT,
          zIndex: 30 - stickyLevel,
          paddingLeft: 8 + vDepth * 16
        }}
        onClick={(e) => selectRow(e, row)}
        onDoubleClick={() => toggleFolder(row.folderPath)}
        onContextMenu={(e) => openRowMenu(e, row)}
      >
        {/* chevron 单独响应开合：stopPropagation 防止连带触发选中 */}
        <span
          className="flex shrink-0"
          onClick={(e) => {
            e.stopPropagation()
            toggleFolder(row.folderPath)
          }}
        >
          <ChevronRight
            className={cn(
              'size-3.5 text-[color:var(--fg-icon)] transition-transform',
              row.open && 'rotate-90'
            )}
          />
        </span>
        {/* 复选框放在箭头之后；包一层 stopPropagation 防止点勾连带触发选中 */}
        <span className="flex shrink-0" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={folderChecked(row.folderPath)}
            disabled={locked}
            onCheckedChange={() => toggleFolderStage(row.folderPath)}
          />
        </span>
        <Folder className="size-3.5 shrink-0 text-[color:var(--fg-icon)]" />
        <span
          className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
          style={isSelected ? { color: 'var(--fg-primary)' } : undefined}
        >
          {row.name}
        </span>
      </div>
    )
  }

  const renderFile = (row: FileRow): ReactNode => {
    const file = files[row.index]
    const colour = FILE_STATUS_COLOR[file.type]
    const isSelected = selectedKeys.has(file.newFilePath)
    const vDepth = row.depth + 1
    return (
      <div
        key={`f-${row.index}`}
        title={fileRowTitle(file)}
        className={cn(
          // mx-1 + rounded：行背景内缩成圆角块，观感对齐最左配置行
          'group mx-1 flex h-[22px] cursor-pointer items-center gap-1.5 rounded pr-2 text-[13px] transition-colors',
          // 选中行高亮（蓝底固定，不随 hover 变色，同左侧项目树）
          isSelected ? 'bg-[var(--selection-row)]' : 'hover:bg-[var(--bg-row-hover)]'
        )}
        // checkbox 与文件夹行对齐置首位，其后补 chevron 列占位让文件图标与文件夹图标对齐
        style={{ paddingLeft: 8 + vDepth * 16 }}
        onClick={(e) => selectRow(e, row)}
        onContextMenu={(e) => openRowMenu(e, row)}
      >
        {/* chevron 列占位（对齐文件夹箭头）；复选框放其后、紧挨文件名 */}
        <span className="size-3.5 shrink-0" />
        {/* 包一层 stopPropagation 防止点勾连带选中 / 打开 diff；勾选态随乐观勾选即时翻转 */}
        <span className="flex shrink-0" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={fileChecked(file)}
            disabled={locked}
            onCheckedChange={() => toggleFileStage(file)}
          />
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
  }

  return (
    <>
      {/* 段起点锚（0 高、非 sticky）：点标题经它 scrollIntoView 跳到本段——标题恒 sticky、直接
          滚它不动，故靠锚定位；锚在标题前，滚到后标题即钉在对应位置。 */}
      <div ref={anchorRef} aria-hidden />
      {/* 标题行 = 本段顶级目录：双向 sticky —— 已暂存钉顶（top-0）；未暂存 top-[22px] + bottom-2
          （未到时钉底预告，留出和底部留白条一致的 8px 间距；滚到时钉在已暂存下方），故两段标题
          恒可见。单击滚到本段、双击 / 箭头折叠；「全部」复选框独立 stopPropagation。bg-deepest 盖住滚过的行。 */}
      <div
        className={cn(
          'z-30 mx-1 flex h-[22px] cursor-pointer select-none items-center gap-1.5 rounded bg-deepest pr-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-[var(--bg-row-hover)]',
          isStaged ? 'sticky top-0' : 'sticky bottom-2 top-[22px]'
        )}
        style={{ paddingLeft: 8 }}
        title="点击跳到此段"
        onClick={onHeaderClick}
        onDoubleClick={() => setSectionOpen((v) => !v)}
      >
        {/* chevron 单独响应折叠：stopPropagation 防止连带触发跳转 */}
        <span
          className="flex shrink-0"
          onClick={(e) => {
            e.stopPropagation()
            setSectionOpen((v) => !v)
          }}
        >
          <ChevronRight
            className={cn(
              'size-3.5 text-[color:var(--fg-icon)] transition-transform',
              sectionOpen && 'rotate-90'
            )}
          />
        </span>
        {/* 「全部」复选框：显示逻辑同目录——本段文件全部有效勾选才勾（stopPropagation 防跳转） */}
        <span className="flex shrink-0" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={files.length > 0 && files.every(fileChecked)}
            disabled={files.length === 0 || locked}
            onCheckedChange={() => toggleAll()}
          />
        </span>
        <span>
          {isStaged ? '已暂存文件' : '未暂存文件'} ({files.length})
        </span>
      </div>
      {sectionOpen &&
        (files.length === 0 ? (
          // 空段占位：pl 对齐顶层行（8 + 一级 16），并补一个 chevron 列占位（size-3.5 + gap），
          // 使提示文字与顶层文件行 chevron 之后的内容同列
          <div
            className="flex h-[22px] items-center gap-1.5 pr-2 text-[13px] text-muted-foreground"
            style={{ paddingLeft: 8 + 16 }}
          >
            <span className="size-3.5 shrink-0" />
            {isStaged ? '无已暂存文件' : '无未暂存文件'}
          </div>
        ) : (
          <StickyTree rows={rows} renderFolder={renderFolder} renderFile={renderFile} />
        ))}
    </>
  )
}
