// Git 图谱右键菜单（menus-dialogs §2）：菜单项定义是导出的纯函数 buildMenuItems（可测可审），
// 组件层只负责用 Base UI Menu 受控渲染（虚拟 anchor 定位于鼠标点）与注入动作分发。
// v1 取舍（原版有、此处不做）：
// - PR 创建整组不做（无 pullRequestConfig 契约）；
// - Issue 链接整组不做（产品演进中已删除该功能）；
// - 「创建归档」不做 —— GitAction 契约（@shared/git）没有 archive 动作；
// - 表头菜单只做排序三选一，列显隐 v1 不做（表格尚无列显隐状态可写）；
// - URL/链接菜单（§2.8）不做 —— GitMenuTarget 契约无该目标类型，详情面板链接直接外部打开；
// - 文件行的「查看该版本的文件」不做（无文件内容查看器契约）、「标记为已审阅」组不做（无 Code Review）。
import { Fragment, useMemo } from 'react'
import { Menu } from '@base-ui-components/react/menu'
import { Check } from 'lucide-react'
import {
  GIT_DEFAULTS,
  UNCOMMITTED,
  resolveOverride,
  type GitAction,
  type GitCommit,
  type GitCommitOrdering,
  type GitCommitStash,
  type GitFileChange,
  type GitOpInProgress,
  type GitRepoSettings,
  type GitViewPrefs
} from '@shared/git'
import { dropCommitPossible } from '@renderer/lib/git-graph'
import { gitState, useGit } from '@renderer/git-store'
import { cn } from '@renderer/lib/utils'
import { toggleBranch } from './GitBranchDropdown'
import { opBlockReason } from './GitOpStatusBar'
import { pathspecOf } from './git-details'
import { abbrevHash } from './git-format'
import type { GitDialogRequest, GitMenuTarget } from './git-view-types'

// —— 纯数据层（供测试）：菜单项构建 ——

/** 一个可点的菜单项。可见性过滤在构建时完成：不可见项不产出。 */
export interface GitMenuItem {
  title: string
  onClick: () => void
  /** checked 模式（表头排序菜单）：左侧 ✓ 列 */
  checked?: boolean
  /** 置灰（操作进行中防误触）：不可点，hover 以 disabledReason 说明原因 */
  disabled?: boolean
  disabledReason?: string
}

/** buildMenuItems 的动作出口：组件注入 store / window.api 分发，测试注入记录用实现。 */
export interface GitMenuActions {
  runAction(action: GitAction, label: string): void
  /** 静默动作（提交面板的暂存 / 取消暂存）：无进行中遮罩（store.runQuietAction） */
  runQuietAction(action: GitAction): void
  openDialog(req: GitDialogRequest): void
  setBranchFilter(branches: string[] | null): void
  updateSettings(patch: Partial<GitRepoSettings>): void
  openDiff(file: GitFileChange, fromHash: string, toHash: string): void
  copyText(text: string, typeLabel: string): void
  openPath(absolutePath: string): void
  revealInFolder(absolutePath: string): void
}

/** 构建菜单所需的图谱上下文（全部来自 git-store 的项目桶与视图偏好）。 */
export interface GitMenuContext {
  projectPath: string
  commits: GitCommit[]
  headHash: string | null
  currentBranch: string | null
  remotes: string[]
  branches: string[]
  branchFilter: string[] | null
  settings: GitRepoSettings | null
  viewPrefs: GitViewPrefs
  /** 进行中的多步操作（变基/合并/拣选/回滚）：非空时会撞车的菜单项置灰 */
  opInProgress: GitOpInProgress | null
  actions: GitMenuActions
}

/**
 * 操作进行中的防误触置灰：会动工作区 / HEAD 的项（检出、合并、变基、拉取、拣选、回滚、
 * 重置、贮藏应用/弹出等）在冲突中途执行必撞「already in progress」类 fatal。
 * 禁用而非隐藏——隐藏会让整组连分隔线一起消失（groupMenuItems 丢空组），用户不知入口去了哪。
 */
function blockDuringOp(item: GitMenuItem, ctx: GitMenuContext): GitMenuItem {
  if (ctx.opInProgress === null) return item
  return { ...item, disabled: true, disabledReason: opBlockReason(ctx.opInProgress) }
}

/** 提交说明取首行（复制提交说明用；数据层 message 已是主题行，防御性再切一次）。 */
function firstLine(text: string): string {
  const idx = text.indexOf('\n')
  return idx === -1 ? text : text.substring(0, idx)
}

/**
 * 按目标类型构建菜单项序列（'divider' 为组间分隔）。文案/可见性条件照 menus-dialogs §2；
 * 组过滤（空组不渲染分隔线）由 groupMenuItems 收口。
 */
// eslint-disable-next-line react-refresh/only-export-components -- 冻结契约：菜单纯函数与组件同文件导出
export function buildMenuItems(
  target: GitMenuTarget,
  ctx: GitMenuContext
): (GitMenuItem | 'divider')[] {
  switch (target.kind) {
    case 'commit':
      return commitMenu(target.hash, ctx)
    case 'branch':
      return branchMenu(target.name, ctx)
    case 'remote-branch':
      return remoteBranchMenu(target.fullRef, target.remote, ctx)
    case 'tag':
      return tagMenu(target.name, target.annotated, target.hash, ctx)
    case 'stash':
      return stashMenu(target.hash, target.stash, ctx)
    case 'uncommitted':
      return uncommittedMenu(ctx)
    case 'header':
      return headerMenu(ctx)
    case 'file':
      return fileMenu(target, ctx)
    case 'uncommitted-file':
      return uncommittedFileMenu(target, ctx)
    case 'uncommitted-files':
      return uncommittedFilesMenu(target, ctx)
  }
}

/** 提交行菜单（§2.1）。 */
function commitMenu(hash: string, ctx: GitMenuContext): (GitMenuItem | 'divider')[] {
  const { actions } = ctx
  const index = ctx.commits.findIndex((c) => c.hash === hash)
  const onlyFirstParent = resolveOverride(
    ctx.settings?.onlyFollowFirstParent ?? 'default',
    GIT_DEFAULTS.onlyFollowFirstParent
  )
  const message = index >= 0 ? ctx.commits[index].message : ''
  const items: (GitMenuItem | 'divider')[] = [
    { title: '添加标签…', onClick: () => actions.openDialog({ kind: 'add-tag', hash }) },
    { title: '创建分支…', onClick: () => actions.openDialog({ kind: 'create-branch', hash }) },
    'divider',
    // 勾选过「总是允许」后不再弹确认框，文案随之去掉省略号（§2.1 / D15）
    blockDuringOp(
      ctx.viewPrefs.alwaysAcceptCheckoutCommit
        ? {
            title: '检出提交',
            onClick: () => actions.runAction({ kind: 'checkout-commit', hash }, '正在检出提交')
          }
        : {
            title: '检出提交…',
            onClick: () => actions.openDialog({ kind: 'checkout-commit', hash })
          },
      ctx
    ),
    blockDuringOp(
      { title: '拣选提交…', onClick: () => actions.openDialog({ kind: 'cherrypick', hash }) },
      ctx
    ),
    blockDuringOp(
      { title: '回滚提交…', onClick: () => actions.openDialog({ kind: 'revert', hash }) },
      ctx
    )
  ]
  if (index >= 0 && dropCommitPossible(ctx.commits, ctx.headHash, index, onlyFirstParent)) {
    // 丢弃提交底层是 rebase --onto，正是「已存在 rebase-merge 目录」fatal 的高发入口，一并置灰
    items.push(
      blockDuringOp(
        {
          title: '丢弃提交…',
          onClick: () => actions.openDialog({ kind: 'drop-commit', hash })
        },
        ctx
      )
    )
  }
  items.push(
    'divider',
    blockDuringOp(
      {
        title: '合并到当前分支…',
        onClick: () =>
          actions.openDialog({
            kind: 'merge',
            obj: hash,
            on: 'commit',
            displayName: abbrevHash(hash)
          })
      },
      ctx
    ),
    blockDuringOp(
      {
        title: '将当前分支变基到此提交…',
        onClick: () =>
          actions.openDialog({
            kind: 'rebase',
            obj: hash,
            on: 'commit',
            displayName: abbrevHash(hash)
          })
      },
      ctx
    ),
    // reset --hard 会吞掉冲突进度且不清 rebase-merge 目录，统一置灰、引导走状态条「中止」
    blockDuringOp(
      {
        title: '将当前分支重置到此提交…',
        onClick: () => actions.openDialog({ kind: 'reset', hash })
      },
      ctx
    ),
    'divider',
    { title: '复制提交哈希', onClick: () => actions.copyText(hash, '提交哈希') },
    { title: '复制提交说明', onClick: () => actions.copyText(firstLine(message), '提交说明') }
  )
  return items
}

/** 本地分支标签菜单（§2.2）；当前分支隐藏「检出/删除/合并/变基」四项。 */
function branchMenu(name: string, ctx: GitMenuContext): (GitMenuItem | 'divider')[] {
  const { actions } = ctx
  const isCurrent = name === ctx.currentBranch
  const items: (GitMenuItem | 'divider')[] = []
  if (!isCurrent) {
    items.push(
      blockDuringOp(
        {
          title: '检出分支',
          onClick: () =>
            actions.runAction(
              { kind: 'checkout-branch', branch: name, remoteBranch: null },
              '正在检出分支'
            )
        },
        ctx
      )
    )
  }
  items.push({
    title: '重命名分支…',
    onClick: () => actions.openDialog({ kind: 'rename-branch', branch: name })
  })
  if (!isCurrent) {
    // 删除对话框需要知道哪些 remote 上也有同名分支（追加「同时删除远程」勾选，D2）
    const remotesWithBranch = ctx.remotes.filter((r) =>
      ctx.branches.includes(`remotes/${r}/${name}`)
    )
    items.push(
      {
        title: '删除分支…',
        onClick: () =>
          actions.openDialog({ kind: 'delete-branch', branch: name, remotesWithBranch })
      },
      blockDuringOp(
        {
          title: '合并到当前分支…',
          onClick: () =>
            actions.openDialog({ kind: 'merge', obj: name, on: 'branch', displayName: name })
        },
        ctx
      ),
      blockDuringOp(
        {
          title: '将当前分支变基到该分支…',
          onClick: () =>
            actions.openDialog({ kind: 'rebase', obj: name, on: 'branch', displayName: name })
        },
        ctx
      )
    )
  }
  if (ctx.remotes.length > 0) {
    items.push({
      title: '推送分支…',
      onClick: () => actions.openDialog({ kind: 'push-branch', branch: name })
    })
  }
  // 「创建 Pull Request」与「创建归档」v1 不做（见文件头注释）
  items.push('divider', selectInDropdownItem(name, ctx), 'divider', {
    title: '复制分支名',
    onClick: () => actions.copyText(name, '分支名')
  })
  return items
}

/**
 * 「在分支下拉中选中/取消选中」项（本地分支传分支名，远程分支传 remotes/ 前缀值）。
 * 切换语义复用分支下拉的 toggleBranch：含「当前分支」哨兵 ['HEAD'] 的从头选中
 * （防止哨兵与具体分支混排）与全不选回落 null。
 */
function selectInDropdownItem(filterValue: string, ctx: GitMenuContext): GitMenuItem {
  const selected = ctx.branchFilter !== null && ctx.branchFilter.includes(filterValue)
  return {
    title: selected ? '在分支下拉中取消选中' : '在分支下拉中选中',
    onClick: () => ctx.actions.setBranchFilter(toggleBranch(ctx.branchFilter, filterValue))
  }
}

/** 远程分支标签菜单（§2.3）；remote 为 null 表示所属 remote 已不存在（孤儿远程 ref）。 */
function remoteBranchMenu(
  fullRef: string,
  remote: string | null,
  ctx: GitMenuContext
): (GitMenuItem | 'divider')[] {
  const { actions } = ctx
  const branchName = remote !== null ? fullRef.substring(remote.length + 1) : ''
  const items: (GitMenuItem | 'divider')[] = [
    blockDuringOp(
      {
        title: '检出分支…',
        onClick: () =>
          actions.openDialog({ kind: 'checkout-remote-branch', remoteRef: fullRef, remote })
      },
      ctx
    )
  ]
  if (remote !== null) {
    items.push({
      title: '删除远程分支…',
      onClick: () =>
        actions.openDialog({
          kind: 'delete-remote-branch',
          remoteRef: fullRef,
          remote,
          branch: branchName
        })
    })
    if (ctx.branches.includes(branchName) && branchName !== ctx.currentBranch) {
      items.push({
        title: '获取到本地分支…',
        onClick: () =>
          actions.openDialog({
            kind: 'fetch-into-local',
            remote,
            remoteBranch: branchName,
            localBranch: branchName
          })
      })
    }
  }
  items.push(
    blockDuringOp(
      {
        title: '合并到当前分支…',
        onClick: () =>
          actions.openDialog({
            kind: 'merge',
            obj: fullRef,
            on: 'remote-tracking',
            displayName: fullRef
          })
      },
      ctx
    )
  )
  if (remote !== null) {
    items.push(
      blockDuringOp(
        {
          title: '拉取到当前分支…',
          // 预设该远程分支为表单初值（remote 与分支仍可在表单里改）
          onClick: () =>
            actions.openDialog({ kind: 'pull-branch', preset: { remote, branch: branchName } })
        },
        ctx
      )
    )
  }
  // 「创建 Pull Request」与「创建归档」v1 不做（见文件头注释）
  items.push('divider', selectInDropdownItem(`remotes/${fullRef}`, ctx), 'divider', {
    title: '复制分支名',
    onClick: () => actions.copyText(fullRef, '分支名')
  })
  return items
}

/** tag 标签菜单（§2.4）。 */
function tagMenu(
  name: string,
  annotated: boolean,
  hash: string,
  ctx: GitMenuContext
): (GitMenuItem | 'divider')[] {
  const { actions } = ctx
  const items: (GitMenuItem | 'divider')[] = []
  if (annotated) {
    items.push({
      title: '查看详情',
      onClick: () => actions.openDialog({ kind: 'tag-details', name })
    })
  }
  items.push({
    title: '删除标签…',
    onClick: () => actions.openDialog({ kind: 'delete-tag', name })
  })
  if (ctx.remotes.length > 0) {
    items.push({
      title: '推送标签…',
      onClick: () => actions.openDialog({ kind: 'push-tag', name, hash })
    })
  }
  // 「创建归档」v1 不做（见文件头注释）
  items.push('divider', { title: '复制标签名', onClick: () => actions.copyText(name, '标签名') })
  return items
}

/** stash 菜单（§2.5，标签与提交行共用）。 */
function stashMenu(
  hash: string,
  stash: GitCommitStash,
  ctx: GitMenuContext
): (GitMenuItem | 'divider')[] {
  const { actions } = ctx
  const selector = stash.selector
  // 应用 / 弹出会动工作区、创建分支含检出，操作进行中置灰；丢弃只删 ref、保留可用
  return [
    blockDuringOp(
      {
        title: '应用贮藏…',
        onClick: () => actions.openDialog({ kind: 'stash-apply', selector })
      },
      ctx
    ),
    blockDuringOp(
      {
        title: '从贮藏创建分支…',
        onClick: () => actions.openDialog({ kind: 'stash-branch', selector })
      },
      ctx
    ),
    blockDuringOp(
      { title: '弹出贮藏…', onClick: () => actions.openDialog({ kind: 'stash-pop', selector }) },
      ctx
    ),
    { title: '丢弃贮藏…', onClick: () => actions.openDialog({ kind: 'stash-drop', selector }) },
    'divider',
    { title: '复制贮藏名', onClick: () => actions.copyText(selector, '贮藏名') },
    { title: '复制贮藏哈希', onClick: () => actions.copyText(hash, '贮藏哈希') }
  ]
}

/**
 * 未提交更改行菜单（§2.6；「打开源代码管理视图」为 VS Code 专有，移植删除）。
 * HEAD 未出生（空仓库首次提交前）时贮藏与重置都以 HEAD 为基准、git 无法执行，不显示。
 */
function uncommittedMenu(ctx: GitMenuContext): (GitMenuItem | 'divider')[] {
  const { actions } = ctx
  const clean: GitMenuItem = {
    title: '清理未跟踪文件…',
    onClick: () => actions.openDialog({ kind: 'clean-untracked' })
  }
  if (ctx.headHash === null) return [clean]
  return [
    { title: '贮藏未提交的更改…', onClick: () => actions.openDialog({ kind: 'stash-save' }) },
    'divider',
    // reset --hard 会吞冲突进度且与操作状态文件交互很脆，置灰、引导走状态条「中止」
    blockDuringOp(
      {
        title: '重置未提交的更改…',
        onClick: () => actions.openDialog({ kind: 'reset-uncommitted' })
      },
      ctx
    ),
    clean
  ]
}

/** 表头菜单（§2.7，checked 模式）：排序三选一；列显隐 v1 不做（表格暂无列显隐状态）。 */
function headerMenu(ctx: GitMenuContext): (GitMenuItem | 'divider')[] {
  const ordering =
    ctx.settings !== null && ctx.settings.commitOrdering !== 'default'
      ? ctx.settings.commitOrdering
      : GIT_DEFAULTS.commitOrdering
  const set = (o: GitCommitOrdering): void => ctx.actions.updateSettings({ commitOrdering: o })
  return [
    { title: '按提交时间排序', checked: ordering === 'date', onClick: () => set('date') },
    {
      title: '按作者时间排序',
      checked: ordering === 'author-date',
      onClick: () => set('author-date')
    },
    { title: '拓扑排序', checked: ordering === 'topo', onClick: () => set('topo') }
  ]
}

/** 提交详情面板文件行菜单（§2.9）。 */
function fileMenu(
  target: Extract<GitMenuTarget, { kind: 'file' }>,
  ctx: GitMenuContext
): (GitMenuItem | 'divider')[] {
  const { actions } = ctx
  const { file, fromHash, toHash, isUncommitted } = target
  // 可打开 diff：未跟踪恒可（主进程合成新增 hunk），其余需有行数（二进制为 null）；
  // 目录型未跟踪条目（嵌套仓库 / 折叠目录）无单文件内容可比，排除（与 diffPossible 口径一致）
  const diffable =
    file.isDir !== true &&
    (file.type === 'U' || (file.additions !== null && file.deletions !== null))
  // 非比较模式推断：详情面板的端点满足 from===to（根提交/stash 第三父）或 from 是 to 的父提交；
  // 目标契约不带比较标记，此为等价近似——「比较直接父子提交」会被视作详情模式，
  // 此时「重置到此版本」语义仍然正确，无害。
  const toCommit = ctx.commits.find((c) => c.hash === toHash)
  const isCompare = !(fromHash === toHash || (toCommit?.parents.includes(fromHash) ?? false))
  const items: (GitMenuItem | 'divider')[] = []
  if (diffable) {
    items.push({ title: '查看差异', onClick: () => actions.openDiff(file, fromHash, toHash) })
  }
  // 「查看该版本的文件」v1 不做（见文件头注释）
  if (file.type !== 'D' && !isUncommitted && diffable) {
    items.push({
      title: '与工作区文件对比',
      onClick: () => actions.openDiff(file, toHash, UNCOMMITTED)
    })
  }
  if (file.type !== 'D') {
    items.push(
      {
        title: '打开文件',
        onClick: () => actions.openPath(`${ctx.projectPath}/${file.newFilePath}`)
      },
      {
        title: '在文件夹中显示',
        onClick: () => actions.revealInFolder(`${ctx.projectPath}/${file.newFilePath}`)
      }
    )
  }
  // 「标记为已审阅/未审阅」组 v1 不做（见文件头注释）
  if (file.type !== 'D' && !isUncommitted && !isCompare) {
    items.push('divider', {
      title: '将文件重置到此版本…',
      onClick: () =>
        actions.openDialog({ kind: 'reset-file', hash: toHash, filePath: file.newFilePath })
    })
  }
  items.push(
    'divider',
    {
      // 绝对路径以项目根拼接（项目根即打开的仓库目录；见 foundation「打开文件」约定）
      title: '复制文件绝对路径',
      onClick: () => actions.copyText(`${ctx.projectPath}/${file.newFilePath}`, '文件路径')
    },
    {
      title: '复制文件相对路径',
      onClick: () => actions.copyText(file.newFilePath, '文件路径')
    }
  )
  return items
}

/**
 * 提交面板文件行菜单（… 按钮与右键共用，ADR-0006）：已暂存段首项「取消暂存」（静默即时），
 * 未暂存段首项按类型分流——未跟踪走「删除文件…」、冲突走「标记为已解决」（静默即时，
 * = git add，与勾选同链路；git checkout -- 对 unmerged 路径直接报错故无撤销项）、
 * 其余走「撤销更改…」（删除类先弹危险确认）。
 */
function uncommittedFileMenu(
  target: Extract<GitMenuTarget, { kind: 'uncommitted-file' }>,
  ctx: GitMenuContext
): (GitMenuItem | 'divider')[] {
  const { actions } = ctx
  const { file, section } = target
  const items: (GitMenuItem | 'divider')[] = []
  if (section === 'staged') {
    items.push({
      title: '取消暂存',
      onClick: () => actions.runQuietAction({ kind: 'unstage-paths', paths: pathspecOf(file) })
    })
  } else if (file.type === 'U') {
    items.push({
      title: '删除文件…',
      onClick: () =>
        actions.openDialog({ kind: 'delete-untracked-file', paths: [file.newFilePath] })
    })
  } else if (file.type === '!') {
    items.push({
      title: '标记为已解决',
      onClick: () => actions.runQuietAction({ kind: 'stage-paths', paths: pathspecOf(file) })
    })
  } else {
    items.push({
      title: '撤销更改…',
      onClick: () => actions.openDialog({ kind: 'discard-file', paths: [file.newFilePath] })
    })
  }
  if (file.type !== 'D') {
    items.push(
      {
        title: '打开文件',
        onClick: () => actions.openPath(`${ctx.projectPath}/${file.newFilePath}`)
      },
      {
        title: '在文件夹中显示',
        onClick: () => actions.revealInFolder(`${ctx.projectPath}/${file.newFilePath}`)
      }
    )
  }
  items.push(
    'divider',
    {
      // 绝对路径以项目根拼接（同 fileMenu 的约定）
      title: '复制文件绝对路径',
      onClick: () => actions.copyText(`${ctx.projectPath}/${file.newFilePath}`, '文件路径')
    },
    {
      title: '复制文件相对路径',
      onClick: () => actions.copyText(file.newFilePath, '文件路径')
    }
  )
  return items
}

/**
 * 提交面板文件树多选批量菜单：已暂存段「取消暂存所选」；未暂存段「暂存所选」+ 按类型分流的
 * 「撤销所选更改」（跟踪文件）/「删除所选未跟踪文件」（未跟踪，均先弹危险确认）。
 * 未暂存段无重命名（R 仅在已暂存），故撤销 / 删除按 newFilePath 逐文件传路径。
 */
function uncommittedFilesMenu(
  target: Extract<GitMenuTarget, { kind: 'uncommitted-files' }>,
  ctx: GitMenuContext
): (GitMenuItem | 'divider')[] {
  const { actions } = ctx
  const { files, section } = target
  const items: (GitMenuItem | 'divider')[] = []
  if (section === 'staged') {
    items.push({
      title: `取消暂存所选 (${files.length})`,
      onClick: () =>
        actions.runQuietAction({ kind: 'unstage-paths', paths: files.flatMap(pathspecOf) })
    })
    return items
  }
  items.push({
    title: `暂存所选 (${files.length})`,
    onClick: () => actions.runQuietAction({ kind: 'stage-paths', paths: files.flatMap(pathspecOf) })
  })
  // 冲突文件不可撤销（checkout -- 对 unmerged 报错），批量撤销只收跟踪且无冲突的文件；
  // 「暂存所选」对冲突文件 = 标记已解决，天然覆盖，无需单列
  const discardPaths = files
    .filter((f) => f.type !== 'U' && f.type !== '!')
    .map((f) => f.newFilePath)
  const deletePaths = files.filter((f) => f.type === 'U').map((f) => f.newFilePath)
  if (discardPaths.length > 0) {
    items.push({
      title: `撤销所选更改 (${discardPaths.length})…`,
      onClick: () => actions.openDialog({ kind: 'discard-file', paths: discardPaths })
    })
  }
  if (deletePaths.length > 0) {
    items.push({
      title: `删除所选未跟踪文件 (${deletePaths.length})…`,
      onClick: () => actions.openDialog({ kind: 'delete-untracked-file', paths: deletePaths })
    })
  }
  return items
}

/** 按分隔符切组并丢弃空组（原版「整组为空则连分隔线一起不渲染」的等价物）。 */
// eslint-disable-next-line react-refresh/only-export-components -- 纯函数与组件同文件导出（供单测）
export function groupMenuItems(items: (GitMenuItem | 'divider')[]): GitMenuItem[][] {
  const groups: GitMenuItem[][] = [[]]
  for (const item of items) {
    if (item === 'divider') {
      if (groups[groups.length - 1].length > 0) groups.push([])
    } else {
      groups[groups.length - 1].push(item)
    }
  }
  if (groups[groups.length - 1].length === 0) groups.pop()
  return groups
}

// —— 组件层 ——

const MENU_ITEM =
  'flex h-8 cursor-pointer select-none items-center gap-2 rounded px-2 text-[13px] text-foreground outline-none transition-colors data-[highlighted]:bg-[var(--bg-row-hover)]'

/** 右键菜单组件：读 store 的 contextMenu，Base UI Menu 受控 open + 鼠标点虚拟 anchor。 */
export function GitContextMenu({ projectPath }: { projectPath: string }): React.JSX.Element | null {
  const menu = useGit((s) => gitState(s, projectPath).contextMenu)
  const commits = useGit((s) => gitState(s, projectPath).commits)
  const headHash = useGit((s) => gitState(s, projectPath).headHash)
  const currentBranch = useGit((s) => gitState(s, projectPath).currentBranch)
  const remotes = useGit((s) => gitState(s, projectPath).remotes)
  const branches = useGit((s) => gitState(s, projectPath).branches)
  const branchFilter = useGit((s) => gitState(s, projectPath).branchFilter)
  const settings = useGit((s) => gitState(s, projectPath).settings)
  const opInProgress = useGit((s) => gitState(s, projectPath).opInProgress)
  const viewPrefs = useGit((s) => s.viewPrefs)

  // 动作注入：全部经 store / window.api 分发（回调内取 getState 而非闭包，避免过期）
  const actions = useMemo<GitMenuActions>(
    () => ({
      runAction: (action, label) => void useGit.getState().runAction(projectPath, action, label),
      runQuietAction: (action) => void useGit.getState().runQuietAction(projectPath, action),
      openDialog: (req) => useGit.getState().openDialog(projectPath, req),
      setBranchFilter: (next) => void useGit.getState().setBranchFilter(projectPath, next),
      updateSettings: (patch) => void useGit.getState().updateSettings(projectPath, patch),
      openDiff: (file, fromHash, toHash) =>
        void useGit.getState().openDiff(projectPath, file, fromHash, toHash),
      copyText: (text, typeLabel) => {
        navigator.clipboard.writeText(text).catch(() => {
          // 复制失败：复用动作错误框展示。store 契约未开放 setActionErrors，
          // 这里直接 setState 写桶（桶必然已存在——菜单只会在已加载的项目上打开）。
          useGit.setState((s) => {
            const bucket = s.projects[projectPath]
            if (!bucket) return s
            return {
              projects: {
                ...s.projects,
                [projectPath]: { ...bucket, actionErrors: [`无法复制${typeLabel}到剪贴板`] }
              }
            }
          })
        })
      },
      openPath: (absolutePath) => void window.api.openPath(absolutePath),
      revealInFolder: (absolutePath) => void window.api.revealInFolder(absolutePath)
    }),
    [projectPath]
  )

  // 虚拟 anchor：鼠标点的 0×0 矩形（menus-dialogs §6），Base UI 负责翻转/贴边
  const anchor = useMemo(
    () =>
      menu === null
        ? null
        : { getBoundingClientRect: (): DOMRect => new DOMRect(menu.x, menu.y, 0, 0) },
    [menu]
  )

  if (menu === null) return null
  const groups = groupMenuItems(
    buildMenuItems(menu.target, {
      projectPath,
      commits,
      headHash,
      currentBranch,
      remotes,
      branches,
      branchFilter,
      settings,
      viewPrefs,
      opInProgress,
      actions
    })
  )
  if (groups.length === 0) return null
  const checkedMode = menu.target.kind === 'header'

  return (
    <Menu.Root
      open
      modal={false}
      onOpenChange={(open, eventDetails) => {
        if (open) return
        // 裸 Menu.Root（无 context-menu 父类型）会因 focus-out 等在鼠标移出/失焦时自动关；
        // 右键菜单只在「明确关闭意图」时关：Esc / 点菜单项 / 点外部，其余原因（focus-out 等）忽略。
        const reason = eventDetails?.reason
        if (
          reason === 'escape-key' ||
          reason === 'outside-press' ||
          reason === 'item-press' ||
          reason === 'close-press' ||
          reason === 'imperative-action'
        ) {
          useGit.getState().closeContextMenu(projectPath)
        }
      }}
    >
      <Menu.Portal>
        <Menu.Positioner
          className="z-50"
          anchor={anchor}
          side="bottom"
          align="start"
          sideOffset={2}
          collisionPadding={2}
        >
          <Menu.Popup className="min-w-44 rounded-lg border border-[color:var(--border-input)] bg-panel p-1.5 shadow-xl outline-none">
            {groups.map((group, gi) => (
              <Fragment key={gi}>
                {gi > 0 && <div className="mx-1.5 my-1 h-px bg-[var(--separator)]" />}
                {group.map((item, ii) => (
                  <Menu.Item
                    key={ii}
                    // 置灰项：Base UI disabled 挡掉点击与键盘导航；title 给禁用原因
                    disabled={item.disabled === true}
                    title={item.disabled === true ? item.disabledReason : undefined}
                    className={cn(MENU_ITEM, item.disabled === true && 'cursor-default opacity-50')}
                    onClick={item.onClick}
                  >
                    {checkedMode && (
                      <Check
                        className={cn('size-3.5 shrink-0', item.checked !== true && 'invisible')}
                      />
                    )}
                    <span className="whitespace-nowrap">{item.title}</span>
                  </Menu.Item>
                ))}
              </Fragment>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
