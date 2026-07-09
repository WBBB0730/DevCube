// Git 对话框宿主（menus-dialogs §3）：通用表单渲染器（骨架照 ConfigDialog：fixed 遮罩 +
// w-[440px] bg-panel 面板、Esc/点遮罩=取消、Enter=主按钮且排除输入法合成）+ D1–D30 逐个描述。
// 追问链（重名替换 / 强制删除 / 提交不在远程等）用组件内 chase 状态续弹，不经过 store.dialog。
// actionRunning 的进行中遮罩与 actionErrors 的错误框也由本组件呈现（§1.3 状态机）。
// v1 取舍：D6（创建 Pull Request）不做（无 PR 配置契约）；D30 数据加载错误的「重试」在
// GitPane 的 error 态，不在此处。
import { useEffect, useMemo, useState } from 'react'
import { Info, LoaderCircle, RotateCw, TriangleAlert } from 'lucide-react'
import {
  type GitAction,
  type GitActionResult,
  type GitCommit,
  type GitOpInProgress,
  type GitPullMode,
  type GitPushMode,
  type GitRepoConfig,
  type GitRepoSettings,
  type GitTagDetailsResult,
  type GitViewPrefs,
  GIT_DEFAULTS,
  resolveOverride
} from '@shared/git'
import { useApp } from '@renderer/store'
import { gitState, useGit } from '@renderer/git-store'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { abbrevHash, formatDateTime } from './git-format'
import { GIT_OP_LABEL, opBlockReason } from './GitOpStatusBar'
import type { GitDialogRequest } from './git-view-types'

// —— 纯函数层（供测试） ——

/**
 * ref 名（分支/标签）非法字符正则，照抄参考实现 web/utils.ts 的 REF_INVALID_REGEX
 * （去掉 g 标志：带 g 的正则 .test 会残留 lastIndex 状态）。
 * 命中即非法：以 - 或 / 开头；含 \ " 空格 > < ~ ^ : ? * [ 任一；含 .. // /. @{；
 * 以 . 或 / 结尾；以 .lock 结尾；整体为 @。
 */
export const REF_INVALID_REGEX = /^[-/].*|[\\" ><~^:?*[]|\.\.|\/\/|\/\.|@{|[./]$|\.lock$|^@$/

/** ref 名是否含非法字符（空串不算非法，由「未输入」状态单独禁用主按钮）。 */
// eslint-disable-next-line react-refresh/only-export-components -- 纯函数与组件同文件导出（供单测）
export function isRefInvalid(name: string): boolean {
  return REF_INVALID_REGEX.test(name)
}

/** 中文列表串：1 项直接显示，多项「A、B 和 C」（原版 formatCommaSeparatedList 的中文化）。 */
// eslint-disable-next-line react-refresh/only-export-components -- 纯函数与组件同文件导出（供单测）
export function formatCommaList(items: readonly string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join('、')} 和 ${items[items.length - 1]}`
}

/** 已加载提交中「最近的标签」：日期最大且带 tag 的那条提交的所有 tag 名（D11 的 info 提示）。 */
// eslint-disable-next-line react-refresh/only-export-components -- 纯函数与组件同文件导出（供单测）
export function latestTagNames(commits: readonly GitCommit[]): string[] {
  let best: GitCommit | null = null
  for (const c of commits) {
    if (c.tags.length === 0) continue
    if (best === null || c.date > best.date) best = c
  }
  return best === null ? [] : best.tags.map((t) => t.name)
}

/**
 * push remote 默认值（D5/D13）：branch 的 pushRemote → branch 的 remote → push.default →
 * origin → 第一个 remote。config 未加载（null）时直接走后两级回退。
 */
// eslint-disable-next-line react-refresh/only-export-components -- 纯函数与组件同文件导出（供单测）
export function defaultPushRemote(
  branch: string,
  remotes: readonly string[],
  config: GitRepoConfig | null
): string {
  if (remotes.length === 0) return ''
  const bc = config?.branches[branch]
  if (bc !== undefined && bc.pushRemote !== null && remotes.includes(bc.pushRemote)) {
    return bc.pushRemote
  }
  if (bc !== undefined && bc.remote !== null && remotes.includes(bc.remote)) return bc.remote
  const pushDefault = config?.pushDefault ?? null
  if (pushDefault !== null && remotes.includes(pushDefault)) return pushDefault
  return remotes.includes('origin') ? 'origin' : remotes[0]
}

/**
 * pull 对话框「从远程拉取」默认值：当前分支上游 remote（branch.<name>.remote 且仍在
 * remotes 中）→ 第一个 remote。config 未加载（null）/ detached HEAD 时直接取第一个。
 */
// eslint-disable-next-line react-refresh/only-export-components -- 纯函数与组件同文件导出（供单测）
export function defaultPullRemote(
  currentBranch: string | null,
  remotes: readonly string[],
  config: GitRepoConfig | null
): string {
  if (remotes.length === 0) return ''
  const configured =
    currentBranch !== null ? (config?.branches[currentBranch]?.remote ?? null) : null
  return configured !== null && remotes.includes(configured) ? configured : remotes[0]
}

/**
 * 某 remote 上已加载的远程分支名（剥掉 remotes/<remote>/ 前缀）。剔除 HEAD：clone 出来的
 * 仓库带 remotes/<remote>/HEAD 符号引用（parseBranches 保留该伪条目），它不是分支——
 * 选中会生成 `git pull <remote> HEAD`（实际拉远程默认分支）或推送到 HEAD 直接报错。
 */
// eslint-disable-next-line react-refresh/only-export-components -- 纯函数与组件同文件导出（供单测）
export function remoteBranchesOf(branches: readonly string[], remote: string): string[] {
  const prefix = `remotes/${remote}/`
  return branches
    .filter((b) => b.startsWith(prefix))
    .map((b) => b.substring(prefix.length))
    .filter((name) => name !== 'HEAD')
}

/**
 * pull 对话框「远程分支」默认值：上游分支（branch.<name>.merge 的 refs/heads/X → X）→
 * 与当前分支同名者 → ''（空值由确认按钮禁用兜底）。候选须在 options 里才生效。
 */
// eslint-disable-next-line react-refresh/only-export-components -- 纯函数与组件同文件导出（供单测）
export function defaultPullBranch(
  currentBranch: string | null,
  options: readonly string[],
  config: GitRepoConfig | null
): string {
  const merge = currentBranch !== null ? (config?.branches[currentBranch]?.merge ?? null) : null
  const upstream =
    merge !== null && merge.startsWith('refs/heads/') ? merge.substring('refs/heads/'.length) : null
  if (upstream !== null && options.includes(upstream)) return upstream
  if (currentBranch !== null && options.includes(currentBranch)) return currentBranch
  return ''
}

/**
 * pull 对话框「整合方式」默认值三层：viewPrefs 记忆 → 仓库 git 配置（branch.<当前分支>.rebase
 * 优先于 pull.rebase，对齐 git 自身的覆盖顺序；true/interactive/merges → 变基，其余 → 合并）
 * → 合并。
 */
// eslint-disable-next-line react-refresh/only-export-components -- 纯函数与组件同文件导出（供单测）
export function defaultPullMode(
  viewPrefs: GitViewPrefs,
  currentBranch: string | null,
  config: GitRepoConfig | null
): GitPullMode {
  if (viewPrefs.pullIntegrationMode !== null) return viewPrefs.pullIntegrationMode
  const raw =
    (currentBranch !== null ? (config?.branches[currentBranch]?.rebase ?? null) : null) ??
    config?.pullRebase ??
    null
  if (raw === null) return 'merge'
  return ['true', 'interactive', 'merges'].includes(raw.toLowerCase()) ? 'rebase' : 'merge'
}

// —— 表单模型（§1.2 的 DialogInput 判别联合，值按 key 收集） ——

interface SelectOption {
  name: string
  value: string
}

type DialogInputSpec =
  | {
      type: 'text'
      key: string
      label: string
      default: string
      placeholder?: string
      info?: string
    }
  | {
      type: 'text-ref'
      key: string
      label: string
      default: string
      info?: string
      /** 允许留空（不禁用主按钮）；非法字符校验照常。初始化对话框的分支名字段用 */
      allowEmpty?: boolean
    }
  | {
      type: 'select'
      key: string
      label: string
      options: SelectOption[]
      default: string
      info?: string
    }
  | {
      type: 'multi-select'
      key: string
      label: string
      options: SelectOption[]
      defaults: string[]
      info?: string
    }
  | { type: 'radio'; key: string; label: string; options: SelectOption[]; default: string }
  | {
      type: 'checkbox'
      key: string
      label: string
      default: boolean
      info?: string
      /** 置灰（操作进行中防误触等）：不可勾，hover 以 disabledReason 说明原因 */
      disabled?: boolean
      disabledReason?: string
    }

type DialogValues = Record<string, string | string[] | boolean>

interface DialogButton {
  label: string
  onClick: (values: DialogValues) => void
}

/** 一个待渲染的对话框描述：消息 + 输入 + 动作按钮（第 0 个为主按钮，Enter 触发）。 */
export interface DialogSpec {
  message: React.ReactNode
  inputs: DialogInputSpec[]
  buttons: DialogButton[]
  /** Message 型：无动作按钮语义，仅渲染「关闭」副按钮 */
  messageOnly?: boolean
  /** 副按钮文案（默认「取消」；messageOnly 默认「关闭」） */
  cancelLabel?: string
  /** 双按钮追问（showTwoButtons）：两个按钮都是动作，隐藏副按钮（Esc/遮罩仍可取消） */
  hideCancel?: boolean
}

/** 对话框构建环境：数据快照 + 动作出口（组件层注入；测试注入记录用实现）。 */
export interface DialogEnv {
  projectPath: string
  commits: GitCommit[]
  branches: string[]
  /** 全量远程分支（带 remotes/ 前缀，不受显示开关与 hideRemotes 过滤），拉取/推送对话框用 */
  remoteBranches: string[]
  tags: string[]
  remotes: string[]
  currentBranch: string | null
  config: GitRepoConfig | null
  settings: GitRepoSettings | null
  viewPrefs: GitViewPrefs
  /** 进行中的多步操作（变基/合并/拣选/回滚）：非空时会撞车的表单项置灰（如创建后检出） */
  opInProgress: GitOpInProgress | null
  closeDialog(): void
  runAction(action: GitAction, label: string): Promise<GitActionResult>
  /**
   * 静默动作（提交面板的撤销 / 删除未跟踪文件）：无进行中遮罩（store.runQuietAction）。
   * suppressErrorBox：错误不落全局错误框，由调用方就地呈现（行内刷新用，防表单被顶掉）
   */
  runQuietAction(action: GitAction, opts?: { suppressErrorBox?: boolean }): Promise<GitActionResult>
  clearActionErrors(): void
  /** 弹一个追问对话框（重名 / 强制删除 / 不在远程等续弹链） */
  openChase(spec: DialogSpec): void
  setViewPrefs(patch: Partial<GitViewPrefs>): void
}

/** 消息里的强调片段（原版 <b><i>…</i></b> 的等价物）。 */
function Em({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <b className="break-all font-semibold text-foreground">{children}</b>
}

// —— 对话框描述构建（D1–D29；D27 tag-details 需异步状态、D10 pull-branch 需字段联动与
// 行内刷新，均由组件层特判渲染） ——

/** 提交后统一收口：先关对话框再执行动作（进行中遮罩由 actionRunning 呈现）。 */
function dispatch(env: DialogEnv, action: GitAction, label: string): void {
  env.closeDialog()
  void env.runAction(action, label)
}

/** merge/rebase 对象类型 → 中文名（消息与进行时文案共用）。 */
const MERGE_ON_LABEL = {
  branch: '分支',
  'remote-tracking': '远程跟踪分支',
  commit: '提交'
} as const
const REBASE_ON_LABEL = { branch: '分支', commit: '提交' } as const

/** 「<当前分支>（当前分支）」片段；detached HEAD 时只显示「当前分支」。 */
function currentBranchText(currentBranch: string | null): React.ReactNode {
  return currentBranch === null ? (
    '当前分支'
  ) : (
    <>
      <Em>{currentBranch}</Em>（当前分支）
    </>
  )
}

/** 按 store 的对话框请求构建描述；返回 null 表示该请求由组件层特判（tag-details / pull-branch）。 */
// eslint-disable-next-line react-refresh/only-export-components -- 纯函数与组件同文件导出（供单测）
export function buildSpec(req: GitDialogRequest, env: DialogEnv): DialogSpec | null {
  switch (req.kind) {
    case 'init':
      // 初始化 Git 仓库（非仓库兜底态入口）：两个字段均可留空——分支名清空 = 裸 git init
      // （尊重 init.defaultBranch），远程地址留空 = 不加远程；填了远程则 init 后自动 fetch
      return {
        message: <>在此项目初始化 Git 仓库：</>,
        inputs: [
          {
            type: 'text-ref',
            key: 'branch',
            label: '初始分支',
            default: req.defaultBranch,
            allowEmpty: true,
            info: '留空使用 Git 默认分支名。'
          },
          {
            type: 'text',
            key: 'remote',
            label: '远程地址',
            default: '',
            placeholder: '可留空',
            info: '将添加为远程 origin 并自动获取一次。'
          }
        ],
        buttons: [
          {
            label: '确定',
            onClick: (v) => {
              const branch = (v.branch as string).trim()
              const remote = (v.remote as string).trim()
              dispatch(
                env,
                {
                  kind: 'init',
                  branchName: branch === '' ? null : branch,
                  remoteUrl: remote === '' ? null : remote
                },
                '正在初始化仓库'
              )
            }
          }
        ]
      }
    case 'rename-branch': // D1
      return {
        message: (
          <>
            输入分支 <Em>{req.branch}</Em> 的新名称：
          </>
        ),
        inputs: [{ type: 'text-ref', key: 'name', label: '', default: req.branch }],
        buttons: [
          {
            label: '重命名',
            onClick: (v) =>
              dispatch(
                env,
                { kind: 'rename-branch', oldName: req.branch, newName: v.name as string },
                '正在重命名分支'
              )
          }
        ]
      }
    case 'delete-branch': // D2（追问 D2b：未合并强删）
      return deleteBranchSpec(env, req.branch, req.remotesWithBranch)
    case 'merge': {
      // D3
      const onLabel = MERGE_ON_LABEL[req.on]
      return {
        message: (
          <>
            确定要将{onLabel} <Em>{req.displayName}</Em> 合并到{' '}
            {currentBranchText(env.currentBranch)}吗？
          </>
        ),
        inputs: [
          { type: 'checkbox', key: 'noFF', label: '即使可以快进也创建新的合并提交', default: true },
          {
            type: 'checkbox',
            key: 'squash',
            label: '压缩提交',
            default: false,
            info: `在当前分支上创建单个提交，其效果等同于合并该${onLabel}。`
          },
          {
            type: 'checkbox',
            key: 'noCommit',
            label: '不提交',
            default: false,
            info: '合并产生的更改将被暂存但不提交，以便你在提交前检查或修改合并结果。'
          }
        ],
        buttons: [
          {
            label: '是，合并',
            onClick: (v) =>
              dispatch(
                env,
                {
                  kind: 'merge',
                  obj: req.obj,
                  on: req.on,
                  noFastForward: v.noFF as boolean,
                  squash: v.squash as boolean,
                  noCommit: v.noCommit as boolean
                },
                `正在合并${onLabel}`
              )
          }
        ]
      }
    }
    case 'rebase': {
      // D4（交互式勾选时走 Terminal，不经 runAction）
      const onLabel = REBASE_ON_LABEL[req.on]
      return {
        message: (
          <>
            确定要将 {currentBranchText(env.currentBranch)}变基到{onLabel}{' '}
            <Em>{req.displayName}</Em> 吗？
          </>
        ),
        inputs: [
          { type: 'checkbox', key: 'interactive', label: '在终端启动交互式变基', default: false },
          {
            type: 'checkbox',
            key: 'ignoreDate',
            label: '忽略日期',
            default: true,
            info: '仅对非交互式变基生效。'
          }
        ],
        buttons: [
          {
            label: '是，变基',
            onClick: (v) => {
              if (v.interactive === true) {
                env.closeDialog()
                // 交互式变基：开一个项目终端 Tab 并把命令写进 stdin（menus-dialogs §0）
                void useApp
                  .getState()
                  .newTerminal(env.projectPath)
                  .then((key) => {
                    window.api.writeStdin(key, `git rebase --interactive ${req.obj}\n`)
                  })
              } else {
                dispatch(
                  env,
                  { kind: 'rebase', obj: req.obj, on: req.on, ignoreDate: v.ignoreDate as boolean },
                  '正在变基'
                )
              }
            }
          }
        ]
      }
    }
    case 'push-branch': // D5：目标分支 combobox 与行内刷新的异步状态不进声明式 spec，由组件层特判渲染
      return null
    case 'checkout-remote-branch': // D7（追问 D7b：重名双按钮）
      return checkoutRemoteSpec(env, req.remoteRef, req.remote, null)
    case 'delete-remote-branch': // D8
      return {
        message: (
          <>
            确定要删除远程分支 <Em>{req.remoteRef}</Em> 吗？
          </>
        ),
        inputs: [],
        buttons: [
          {
            label: '是，删除',
            onClick: () =>
              dispatch(
                env,
                { kind: 'delete-remote-branch', branch: req.branch, remote: req.remote },
                '正在删除远程分支'
              )
          }
        ]
      }
    case 'fetch-into-local': // D9
      return {
        message: (
          <>
            确定要将远程分支{' '}
            <Em>
              {req.remote}/{req.remoteBranch}
            </Em>{' '}
            获取到本地分支 <Em>{req.localBranch}</Em> 吗？
          </>
        ),
        inputs: [
          {
            type: 'checkbox',
            key: 'force',
            label: '强制获取',
            default: false,
            info: '强制将本地分支重置为该远程分支。'
          }
        ],
        buttons: [
          {
            label: '是，获取',
            onClick: (v) =>
              dispatch(
                env,
                {
                  kind: 'fetch-into-local',
                  remote: req.remote,
                  remoteBranch: req.remoteBranch,
                  localBranch: req.localBranch,
                  force: v.force as boolean
                },
                '正在获取分支'
              )
          }
        ]
      }
    case 'pull-branch': // D10：表单需 remote→分支联动与行内刷新的异步状态，由组件层特判渲染
      return null
    case 'add-tag': // D11（追问 D11b 重名替换、D11c 提交不在远程）
      return addTagSpec(env, req.hash, null)
    case 'delete-tag': // D12（形态随 remote 数量）
      return deleteTagSpec(env, req.name)
    case 'push-tag': // D13（追问 D13b 提交不在远程）
      return pushTagSpec(env, req.name, req.hash)
    case 'create-branch': // D14（追问 D14b 重名替换）
      return createBranchSpec(env, req.hash, null)
    default:
      return buildSpecRest(req, env)
  }
}

/** buildSpec 的后半段（D15–D29），单纯为控制函数长度而拆分。 */
function buildSpecRest(req: GitDialogRequest, env: DialogEnv): DialogSpec | null {
  switch (req.kind) {
    case 'checkout-commit': // D15
      return {
        message: (
          <>
            确定要检出提交 <Em>{abbrevHash(req.hash)}</Em> 吗？这将进入「分离 HEAD」状态。
          </>
        ),
        inputs: [
          { type: 'checkbox', key: 'always', label: '总是允许（不再提示）', default: false }
        ],
        buttons: [
          {
            label: '是，检出',
            onClick: (v) => {
              if (v.always === true) void env.setViewPrefs({ alwaysAcceptCheckoutCommit: true })
              dispatch(env, { kind: 'checkout-commit', hash: req.hash }, '正在检出提交')
            }
          }
        ]
      }
    case 'cherrypick': {
      // D16
      const inputs: DialogInputSpec[] = []
      const isMerge = parentOptions(env, req.hash).length > 1
      if (isMerge) {
        inputs.push({
          type: 'select',
          key: 'parent',
          label: '父提交',
          options: parentOptions(env, req.hash),
          default: '1',
          info: '选择主线所在的父提交，拣选将相对于它计算差异。'
        })
      }
      inputs.push(
        {
          type: 'checkbox',
          key: 'recordOrigin',
          label: '记录来源',
          default: false,
          info: '在提交信息末尾追加一行 “(cherry picked from commit ...)”，记录此次拣选的来源提交。'
        },
        {
          type: 'checkbox',
          key: 'noCommit',
          label: '不提交',
          default: false,
          info: '拣选的更改只暂存不提交，以便你选择并提交此提交中的部分内容。'
        }
      )
      return {
        message: (
          <>
            确定要拣选提交 <Em>{abbrevHash(req.hash)}</Em> 吗？
          </>
        ),
        inputs,
        buttons: [
          {
            label: '是，拣选',
            onClick: (v) =>
              dispatch(
                env,
                {
                  kind: 'cherrypick',
                  hash: req.hash,
                  parentIndex: isMerge ? Number(v.parent as string) : 0,
                  recordOrigin: v.recordOrigin as boolean,
                  noCommit: v.noCommit as boolean
                },
                '正在拣选提交'
              )
          }
        ]
      }
    }
    case 'revert': {
      // D17
      const options = parentOptions(env, req.hash)
      const isMerge = options.length > 1
      return {
        message: isMerge ? (
          <>
            确定要回滚合并提交 <Em>{abbrevHash(req.hash)}</Em>{' '}
            吗？选择主线所在的父提交，回滚将相对于它计算：
          </>
        ) : (
          <>
            确定要回滚提交 <Em>{abbrevHash(req.hash)}</Em> 吗？
          </>
        ),
        inputs: isMerge
          ? [{ type: 'select', key: 'parent', label: '父提交', options, default: '1' }]
          : [],
        buttons: [
          {
            label: '是，回滚',
            onClick: (v) =>
              dispatch(
                env,
                {
                  kind: 'revert',
                  hash: req.hash,
                  parentIndex: isMerge ? Number(v.parent as string) : 0
                },
                '正在回滚提交'
              )
          }
        ]
      }
    }
    case 'drop-commit': {
      // D18
      const onlyFirstParent = resolveOverride(
        env.settings?.onlyFollowFirstParent ?? 'default',
        GIT_DEFAULTS.onlyFollowFirstParent
      )
      return {
        message: (
          <>
            确定要永久丢弃提交 <Em>{abbrevHash(req.hash)}</Em> 吗？
            {onlyFirstParent && (
              <span className="mt-2 block text-[12px] italic text-muted-foreground">
                注意：由于启用了「只跟随第一父提交」，图中可能隐藏了会影响此操作结果的提交。
              </span>
            )}
          </>
        ),
        inputs: [],
        buttons: [
          {
            label: '是，丢弃',
            onClick: () => dispatch(env, { kind: 'drop-commit', hash: req.hash }, '正在丢弃提交')
          }
        ]
      }
    }
    case 'reset': // D19
      return {
        message: (
          <>
            确定要将 {currentBranchText(env.currentBranch)}重置到提交{' '}
            <Em>{abbrevHash(req.hash)}</Em> 吗？
          </>
        ),
        inputs: [
          {
            type: 'select',
            key: 'mode',
            label: '',
            options: [
              { name: 'Soft —— 保留所有更改，仅重置 HEAD', value: 'soft' },
              { name: 'Mixed —— 保留工作区，重置暂存区', value: 'mixed' },
              { name: 'Hard —— 丢弃所有更改', value: 'hard' }
            ],
            default: 'mixed'
          }
        ],
        buttons: [
          {
            label: '是，重置',
            onClick: (v) =>
              dispatch(
                env,
                { kind: 'reset', hash: req.hash, mode: v.mode as 'soft' | 'mixed' | 'hard' },
                '正在重置到提交'
              )
          }
        ]
      }
    case 'stash-save': // D20
      return {
        message: (
          <>
            确定要贮藏<Em>未提交的更改</Em>吗？
          </>
        ),
        inputs: [
          { type: 'text', key: 'message', label: '消息', default: '', placeholder: '可选' },
          {
            type: 'checkbox',
            key: 'includeUntracked',
            label: '包含未跟踪文件',
            default: true,
            info: '把所有未跟踪文件一并放入贮藏，并将其从工作目录清除。'
          }
        ],
        buttons: [
          {
            label: '是，贮藏',
            onClick: (v) =>
              dispatch(
                env,
                {
                  kind: 'stash-push',
                  message: v.message as string,
                  includeUntracked: v.includeUntracked as boolean
                },
                '正在贮藏未提交的更改'
              )
          }
        ]
      }
    case 'reset-uncommitted': // D21（无 Soft）
      return {
        message: (
          <>
            确定要将<Em>未提交的更改</Em>重置到 <Em>HEAD</Em> 吗？
          </>
        ),
        inputs: [
          {
            type: 'select',
            key: 'mode',
            label: '',
            options: [
              { name: 'Mixed —— 保留工作区，重置暂存区', value: 'mixed' },
              { name: 'Hard —— 丢弃所有更改', value: 'hard' }
            ],
            default: 'mixed'
          }
        ],
        buttons: [
          {
            label: '是，重置',
            onClick: (v) =>
              dispatch(
                env,
                { kind: 'reset', hash: 'HEAD', mode: v.mode as 'mixed' | 'hard' },
                '正在重置未提交的更改'
              )
          }
        ]
      }
    case 'clean-untracked': // D22
      return {
        message: <>确定要清理所有未跟踪文件吗？</>,
        inputs: [
          { type: 'checkbox', key: 'directories', label: '同时清理未跟踪目录', default: true }
        ],
        buttons: [
          {
            label: '是，清理',
            onClick: (v) =>
              dispatch(
                env,
                { kind: 'clean-untracked', directories: v.directories as boolean },
                '正在清理未跟踪文件'
              )
          }
        ]
      }
    case 'stash-apply': // D23
    case 'stash-pop': {
      // D24
      const pop = req.kind === 'stash-pop'
      return {
        message: (
          <>
            确定要{pop ? '弹出' : '应用'}贮藏 <Em>{req.selector.substring(5)}</Em> 吗？
          </>
        ),
        inputs: [
          {
            type: 'checkbox',
            key: 'reinstateIndex',
            label: '恢复暂存状态',
            default: false,
            info: '除工作区更改外，同时尝试恢复当时暂存区中的更改。'
          }
        ],
        buttons: [
          {
            label: pop ? '是，弹出贮藏' : '是，应用贮藏',
            onClick: (v) =>
              dispatch(
                env,
                {
                  kind: pop ? 'stash-pop' : 'stash-apply',
                  selector: req.selector,
                  reinstateIndex: v.reinstateIndex as boolean
                },
                pop ? '正在弹出贮藏' : '正在应用贮藏'
              )
          }
        ]
      }
    }
    case 'stash-drop': // D25
      return {
        message: (
          <>
            确定要丢弃贮藏 <Em>{req.selector.substring(5)}</Em> 吗？
          </>
        ),
        inputs: [],
        buttons: [
          {
            label: '是，丢弃',
            onClick: () =>
              dispatch(env, { kind: 'stash-drop', selector: req.selector }, '正在丢弃贮藏')
          }
        ]
      }
    case 'stash-branch': // D26
      return {
        message: (
          <>
            从贮藏 <Em>{req.selector.substring(5)}</Em> 创建分支，名称为：
          </>
        ),
        inputs: [{ type: 'text-ref', key: 'name', label: '', default: '' }],
        buttons: [
          {
            label: '创建分支',
            onClick: (v) =>
              dispatch(
                env,
                { kind: 'stash-branch', selector: req.selector, branchName: v.name as string },
                '正在创建分支'
              )
          }
        ]
      }
    case 'reset-file': // D29
      return {
        message: (
          <>
            确定要将 <Em>{req.filePath}</Em> 重置到它在提交 <Em>{abbrevHash(req.hash)}</Em>{' '}
            时的状态吗？该文件所有未提交的更改都将被覆盖。
          </>
        ),
        inputs: [],
        buttons: [
          {
            label: '是，重置文件',
            onClick: () =>
              dispatch(
                env,
                { kind: 'reset-file', hash: req.hash, filePath: req.filePath },
                '正在重置文件'
              )
          }
        ]
      }
    case 'discard-file': // 提交面板「撤销更改…」：确认后静默执行（PRD 12c，无进行中遮罩）
      return {
        message: (
          <>
            确定要撤销{' '}
            {req.paths.length === 1 ? (
              <Em>{req.paths[0]}</Em>
            ) : (
              <Em>所选 {req.paths.length} 个文件</Em>
            )}{' '}
            的未暂存更改吗？此操作不可撤销。
          </>
        ),
        inputs: [],
        buttons: [
          {
            label: '是，撤销更改',
            onClick: () => {
              env.closeDialog()
              void env.runQuietAction({ kind: 'discard-file', paths: req.paths })
            }
          }
        ]
      }
    case 'delete-untracked-file': // 提交面板「删除文件…」：确认后静默执行（同上）
      return {
        message: (
          <>
            确定要删除{' '}
            {req.paths.length === 1 ? (
              <>
                未跟踪文件 <Em>{req.paths[0]}</Em>
              </>
            ) : (
              <Em>所选 {req.paths.length} 个未跟踪文件</Em>
            )}{' '}
            吗？{req.paths.length === 1 ? '该文件' : '这些文件'}将从磁盘删除，此操作不可撤销。
          </>
        ),
        inputs: [],
        buttons: [
          {
            label: '是，删除',
            onClick: () => {
              env.closeDialog()
              void env.runQuietAction({ kind: 'delete-untracked-file', paths: req.paths })
            }
          }
        ]
      }
    case 'op-abort': {
      // 状态条「中止」的危险确认：git <op> --abort 会丢掉已解决的冲突进度
      const opLabel = GIT_OP_LABEL[req.op]
      return {
        message: <>确定要中止{opLabel}吗？已解决的冲突进度将丢失。</>,
        inputs: [],
        buttons: [
          {
            label: '是，中止',
            onClick: () => dispatch(env, { kind: 'op-abort', op: req.op }, `正在中止${opLabel}`)
          }
        ]
      }
    }
    case 'tag-details': // D27：需异步加载，由组件层特判渲染
      return null
    default:
      return null
  }
}

/** D16/D17 的父提交选项：`hash8: 消息首行`（父提交不在已加载列表时只显示 hash8）。 */
function parentOptions(env: DialogEnv, hash: string): SelectOption[] {
  const commit = env.commits.find((c) => c.hash === hash)
  if (commit === undefined) return []
  return commit.parents.map((p, i) => {
    const parent = env.commits.find((c) => c.hash === p)
    return {
      name: parent !== undefined ? `${abbrevHash(p)}: ${parent.message}` : abbrevHash(p),
      value: String(i + 1)
    }
  })
}

// —— 带追问链的对话框（D2/D7/D11/D13/D14） ——

/** D2 删除分支；失败且错误含 'git branch -D'（未完全合并）时续弹 D2b 强删确认。 */
function deleteBranchSpec(env: DialogEnv, branch: string, remotesWithBranch: string[]): DialogSpec {
  const inputs: DialogInputSpec[] = [
    { type: 'checkbox', key: 'force', label: '强制删除', default: false }
  ]
  if (remotesWithBranch.length > 0) {
    inputs.push({
      type: 'checkbox',
      key: 'onRemotes',
      label: remotesWithBranch.length > 1 ? '同时删除各远程上的该分支' : '同时删除远程上的该分支',
      default: false,
      info: `该分支存在于远程：${formatCommaList(remotesWithBranch.map((r) => `“${r}”`))}`
    })
  }
  const run = (force: boolean, deleteOnRemotes: string[]): void => {
    env.closeDialog()
    void env
      .runAction({ kind: 'delete-branch', name: branch, force, deleteOnRemotes }, '正在删除分支')
      .then((res) => {
        // D2b：本地删除因「未完全合并」被拒（git 提示改用 -D）→ 收掉错误框，续弹强删确认
        if (res.status === 'error' && res.errors.some((e) => e.includes('git branch -D'))) {
          env.clearActionErrors()
          env.openChase({
            message: (
              <>
                分支 <Em>{branch}</Em> 尚未完全合并。要强制删除吗？
              </>
            ),
            inputs: [],
            buttons: [{ label: '是，强制删除', onClick: () => run(true, deleteOnRemotes) }]
          })
        }
      })
  }
  return {
    message: (
      <>
        确定要删除分支 <Em>{branch}</Em> 吗？
      </>
    ),
    inputs,
    buttons: [
      {
        label: '是，删除',
        onClick: (v) => run(v.force as boolean, v.onRemotes === true ? remotesWithBranch : [])
      }
    ]
  }
}

/** D7 检出远程分支（输入本地分支名）；输入名与现有本地分支重名时续弹 D7b 双按钮。 */
function checkoutRemoteSpec(
  env: DialogEnv,
  remoteRef: string,
  remote: string | null,
  presetName: string | null
): DialogSpec {
  const defaultName =
    presetName ?? (remote !== null ? remoteRef.substring(remote.length + 1) : remoteRef)
  return {
    message: (
      <>
        输入检出 <Em>{remoteRef}</Em> 时要创建的新分支名称：
      </>
    ),
    inputs: [{ type: 'text-ref', key: 'name', label: '', default: defaultName }],
    buttons: [
      {
        label: '检出分支',
        onClick: (v) => {
          const name = v.name as string
          if (!env.branches.includes(name)) {
            dispatch(
              env,
              { kind: 'checkout-branch', branch: name, remoteBranch: remoteRef },
              '正在检出分支'
            )
            return
          }
          // D7b：重名双按钮（两个按钮都是动作，Esc/遮罩仍可取消）
          env.closeDialog()
          env.openChase({
            message: (
              <>
                名称 <Em>{name}</Em> 已被另一个分支占用：
              </>
            ),
            inputs: [],
            hideCancel: true,
            buttons: [
              {
                label: '换一个分支名',
                onClick: () => env.openChase(checkoutRemoteSpec(env, remoteRef, remote, name))
              },
              {
                label: remote !== null ? '检出现有分支并拉取更改' : '检出现有分支',
                onClick: () => {
                  env.closeDialog()
                  void env
                    .runAction(
                      { kind: 'checkout-branch', branch: name, remoteBranch: null },
                      '正在检出分支'
                    )
                    .then((res) => {
                      // 检出成功且可拉取：自动 pull（整合方式固定用默认的合并，不走 D10 表单）
                      if (res.status === 'ok' && remote !== null) {
                        void env.runAction(
                          {
                            kind: 'pull-branch',
                            remote,
                            branch: remoteRef.substring(remote.length + 1),
                            mode: 'merge',
                            noFastForward: false
                          },
                          '正在拉取分支'
                        )
                      }
                    })
                }
              }
            ]
          })
        }
      }
    ]
  }
}

/** D11 添加标签；重名续弹 D11b 替换确认，推送阶段「提交不在远程」续弹 D11c（同 D13b）。 */
function addTagSpec(
  env: DialogEnv,
  hash: string,
  preset: { name: string; type: string; message: string; pushTo: string | boolean } | null
): DialogSpec {
  const recent = latestTagNames(env.commits)
  const multi = env.remotes.length > 1
  const inputs: DialogInputSpec[] = [
    {
      type: 'text-ref',
      key: 'name',
      label: '名称',
      default: preset?.name ?? '',
      info:
        recent.length === 0
          ? undefined
          : recent.length === 1
            ? `已加载提交中最近的标签是 ${`“${recent[0]}”`}`
            : `已加载提交中最近的标签是 ${formatCommaList(recent.map((t) => `“${t}”`))}`
    },
    {
      type: 'select',
      key: 'type',
      label: '类型',
      options: [
        { name: '附注标签', value: 'annotated' },
        { name: '轻量标签', value: 'lightweight' }
      ],
      default: (preset?.type as string | undefined) ?? 'annotated'
    },
    {
      type: 'text',
      key: 'message',
      label: '消息',
      default: preset?.message ?? '',
      placeholder: '可选',
      info: '只有附注标签可以添加消息。'
    }
  ]
  if (multi) {
    inputs.push({
      type: 'select',
      key: 'pushTo',
      label: '推送到远程',
      options: [{ name: '不推送', value: '' }, ...env.remotes.map((r) => ({ name: r, value: r }))],
      default: typeof preset?.pushTo === 'string' ? preset.pushTo : '',
      info: '标签添加后，推送到该远程。'
    })
  } else if (env.remotes.length === 1) {
    inputs.push({
      type: 'checkbox',
      key: 'pushTo',
      label: '推送到远程',
      default: preset?.pushTo === true,
      info: '标签添加后，推送到该远程。'
    })
  }
  const run = (values: DialogValues, force: boolean): void => {
    const name = values.name as string
    const pushToRemote = multi
      ? (values.pushTo as string) !== ''
        ? (values.pushTo as string)
        : null
      : env.remotes.length === 1 && values.pushTo === true
        ? env.remotes[0]
        : null
    env.closeDialog()
    void env
      .runAction(
        {
          kind: 'add-tag',
          hash,
          name,
          type: values.type as 'annotated' | 'lightweight',
          message: values.message as string,
          force,
          pushToRemote,
          skipRemoteCheck: env.viewPrefs.pushTagSkipRemoteCheck
        },
        '正在添加标签'
      )
      .then((res) => {
        // D11c：add-tag 的推送阶段返回「提交不在远程」时同样续弹警告，重发用 push-tag 动作
        if (res.status === 'push-tag-not-on-remote' && pushToRemote !== null) {
          env.openChase(pushTagWarningSpec(env, name, hash, [pushToRemote], res.remotes))
        }
      })
  }
  return {
    message: (
      <>
        为提交 <Em>{abbrevHash(hash)}</Em> 添加标签：
      </>
    ),
    inputs,
    buttons: [
      {
        label: '添加标签',
        onClick: (v) => {
          const name = v.name as string
          if (env.tags.includes(name)) {
            // D11b：标签重名双按钮（替换 / 换名保留已填值）
            env.closeDialog()
            env.openChase({
              message: (
                <>
                  标签 <Em>{name}</Em> 已存在，要用新标签替换它吗？
                </>
              ),
              inputs: [],
              hideCancel: true,
              buttons: [
                { label: '是，替换现有标签', onClick: () => run(v, true) },
                {
                  label: '否，换一个标签名',
                  onClick: () =>
                    env.openChase(
                      addTagSpec(env, hash, {
                        name,
                        type: v.type as string,
                        message: v.message as string,
                        pushTo: (v.pushTo as string | boolean | undefined) ?? ''
                      })
                    )
                }
              ]
            })
          } else {
            run(v, false)
          }
        }
      }
    ]
  }
}

/** D12 删除标签：0 个 remote 纯确认；1 个附 checkbox；≥2 个附 select。 */
function deleteTagSpec(env: DialogEnv, name: string): DialogSpec {
  const count = env.remotes.length
  const inputs: DialogInputSpec[] = []
  if (count === 1) {
    inputs.push({ type: 'checkbox', key: 'onRemote', label: '同时在远程上删除', default: false })
  } else if (count >= 2) {
    inputs.push({
      type: 'select',
      key: 'onRemote',
      label: '',
      options: [
        { name: '不在任何远程上删除', value: '' },
        ...env.remotes.map((r) => ({ name: r, value: r }))
      ],
      default: ''
    })
  }
  return {
    message: (
      <>
        确定要删除标签 <Em>{name}</Em> 吗？
        {count >= 2 && <span className="mt-2 block">是否同时删除某个远程上的标签：</span>}
      </>
    ),
    inputs,
    buttons: [
      {
        label: '是，删除',
        onClick: (v) => {
          const deleteOnRemote =
            count === 1
              ? v.onRemote === true
                ? env.remotes[0]
                : null
              : count >= 2 && (v.onRemote as string) !== ''
                ? (v.onRemote as string)
                : null
          dispatch(env, { kind: 'delete-tag', name, deleteOnRemote }, '正在删除标签')
        }
      }
    ]
  }
}

/** D13 推送标签；预检返回「提交不在远程」时续弹 D13b 警告。 */
function pushTagSpec(env: DialogEnv, name: string, hash: string): DialogSpec {
  const multi = env.remotes.length > 1
  const run = (targets: string[]): void => {
    env.closeDialog()
    void env
      .runAction(
        {
          kind: 'push-tag',
          name,
          remotes: targets,
          commitHash: hash,
          // 勾选过「总是继续」后跳过主进程的 branch -r --contains 预检
          skipRemoteCheck: env.viewPrefs.pushTagSkipRemoteCheck
        },
        '正在推送标签'
      )
      .then((res) => {
        if (res.status === 'push-tag-not-on-remote') {
          env.openChase(pushTagWarningSpec(env, name, hash, targets, res.remotes))
        }
      })
  }
  return {
    message: multi ? (
      <>
        确定要推送标签 <Em>{name}</Em> 吗？选择要推送到的远程：
      </>
    ) : (
      <>
        确定要将标签 <Em>{name}</Em> 推送到远程 <Em>{env.remotes[0] ?? ''}</Em> 吗？
      </>
    ),
    inputs: multi
      ? [
          {
            type: 'multi-select',
            key: 'remotes',
            label: '',
            options: env.remotes.map((r) => ({ name: r, value: r })),
            defaults: [defaultPushRemote('', env.remotes, env.config)]
          }
        ]
      : [],
    buttons: [
      {
        label: '是，推送',
        onClick: (v) => run(multi ? (v.remotes as string[]) : env.remotes.slice(0, 1))
      }
    ]
  }
}

/** D11c / D13b：「提交不在远程」警告；确认后以 skipRemoteCheck=true 用 push-tag 重发。 */
function pushTagWarningSpec(
  env: DialogEnv,
  tag: string,
  hash: string,
  targets: string[],
  missing: string[]
): DialogSpec {
  return {
    message: (
      <span className="block space-y-2">
        <span className="flex items-center gap-1.5 font-semibold text-foreground">
          <TriangleAlert className="size-4 shrink-0 text-[color:var(--status-failed)]" />
          警告：提交不在远程上
        </span>
        <span className="block">
          标签 <Em>{tag}</Em> 所在的提交不在远程 {formatCommaList(missing.map((r) => `“${r}”`))}{' '}
          的任何已知分支上。
        </span>
        <span className="block">
          仍要将标签推送到远程 {formatCommaList(targets.map((r) => `“${r}”`))} 吗？
        </span>
      </span>
    ),
    inputs: [{ type: 'checkbox', key: 'always', label: '总是继续（不再提示）', default: false }],
    buttons: [
      {
        label: '继续推送',
        onClick: (v) => {
          if (v.always === true) void env.setViewPrefs({ pushTagSkipRemoteCheck: true })
          env.closeDialog()
          void env.runAction(
            {
              kind: 'push-tag',
              name: tag,
              remotes: targets,
              commitHash: hash,
              skipRemoteCheck: true
            },
            '正在推送标签'
          )
        }
      }
    ]
  }
}

/** D14 创建分支；重名续弹 D14b 替换确认（换名保留已填值）。 */
function createBranchSpec(
  env: DialogEnv,
  hash: string,
  preset: { name: string; checkout: boolean } | null
): DialogSpec {
  const run = (name: string, checkout: boolean, force: boolean): void => {
    dispatch(env, { kind: 'create-branch', hash, name, checkout, force }, '正在创建分支')
  }
  return {
    message: (
      <>
        在提交 <Em>{abbrevHash(hash)}</Em> 处创建分支：
      </>
    ),
    inputs: [
      { type: 'text-ref', key: 'name', label: '名称', default: preset?.name ?? '' },
      {
        type: 'checkbox',
        key: 'checkout',
        label: '创建后检出',
        // 操作进行中防误触：checkout 在变基等中途会被 git 拒绝（分支已建、检出失败），
        // 与检出类入口统一置灰；default 一并压 false，防 preset 带入的勾选态漏网
        default: env.opInProgress !== null ? false : (preset?.checkout ?? false),
        disabled: env.opInProgress !== null,
        disabledReason: env.opInProgress !== null ? opBlockReason(env.opInProgress) : undefined
      }
    ],
    buttons: [
      {
        label: '创建分支',
        onClick: (v) => {
          const name = v.name as string
          const checkout = v.checkout as boolean
          if (env.branches.includes(name)) {
            env.closeDialog()
            env.openChase({
              message: (
                <>
                  分支 <Em>{name}</Em> 已存在，要用新分支替换它吗？
                </>
              ),
              inputs: [],
              hideCancel: true,
              buttons: [
                { label: '是，替换现有分支', onClick: () => run(name, checkout, true) },
                {
                  label: '否，换一个分支名',
                  onClick: () => env.openChase(createBranchSpec(env, hash, { name, checkout }))
                }
              ]
            })
          } else {
            run(name, checkout, false)
          }
        }
      }
    ]
  }
}

// —— 组件层 ——

/**
 * 对话框宿主：按 store 的 dialog 请求渲染表单，叠加追问链（chase）、进行中遮罩与错误框。
 * 渲染优先级：错误框 > 进行中遮罩 > 追问对话框 > store 对话框（同一时刻全局最多一个，§1.2）。
 */
export function GitDialogs({ projectPath }: { projectPath: string }): React.JSX.Element | null {
  const dialog = useGit((s) => gitState(s, projectPath).dialog)
  const actionRunning = useGit((s) => gitState(s, projectPath).actionRunning)
  const actionErrors = useGit((s) => gitState(s, projectPath).actionErrors)
  const commits = useGit((s) => gitState(s, projectPath).commits)
  const branches = useGit((s) => gitState(s, projectPath).branches)
  const remoteBranches = useGit((s) => gitState(s, projectPath).remoteBranches)
  const tags = useGit((s) => gitState(s, projectPath).tags)
  const remotes = useGit((s) => gitState(s, projectPath).remotes)
  const currentBranch = useGit((s) => gitState(s, projectPath).currentBranch)
  const config = useGit((s) => gitState(s, projectPath).config)
  const settings = useGit((s) => gitState(s, projectPath).settings)
  const viewPrefs = useGit((s) => s.viewPrefs)
  const opInProgress = useGit((s) => gitState(s, projectPath).opInProgress)

  /** 追问链状态：nonce 作为表单 key，同一链上连续两个表单也能重置输入值 */
  const [chase, setChase] = useState<{ spec: DialogSpec; nonce: number } | null>(null)
  /** 「隐藏」进行中遮罩时记住其文案；文案不匹配（新动作）即重新显示，无需 effect 复位 */
  const [hiddenFor, setHiddenFor] = useState<string | null>(null)
  /** D27 标签详情的异步加载结果（带 name 归属；与当前请求不匹配即视作加载中） */
  const [tagInfo, setTagInfo] = useState<{ name: string; result: GitTagDetailsResult } | null>(null)

  // 新对话框请求到来 → 旧追问链作废（软刷新目标消失导致 store 关闭 dialog 时不误清 chase）。
  // 这是对外部 store 变化的状态同步，非级联渲染热路径，规则例外可接受。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 见上：同步作废过期追问链
    if (dialog !== null) setChase(null)
  }, [dialog])

  // D27：打开即异步加载 tag 详情；StrictMode 双挂载与快速切换都以 cancelled 作废
  const tagName = dialog?.kind === 'tag-details' ? dialog.name : null
  useEffect(() => {
    if (tagName === null) return
    let cancelled = false
    void window.api.gitTagDetails(projectPath, tagName).then((r) => {
      if (!cancelled) setTagInfo({ name: tagName, result: r })
    })
    return () => {
      cancelled = true
    }
  }, [tagName, projectPath])

  // push remote / pull 表单默认值需要仓库 config（branch.<name>.remote/merge/rebase 等）：
  // 相关对话框打开时按需拉取
  const needsConfig =
    dialog !== null &&
    (dialog.kind === 'push-branch' ||
      dialog.kind === 'pull-branch' ||
      dialog.kind === 'push-tag' ||
      dialog.kind === 'add-tag')
  useEffect(() => {
    if (needsConfig && config === null) void useGit.getState().loadRepoConfig(projectPath)
  }, [needsConfig, config, projectPath])

  const env = useMemo<DialogEnv>(
    () => ({
      projectPath,
      commits,
      branches,
      remoteBranches,
      tags,
      remotes,
      currentBranch,
      config,
      settings,
      viewPrefs,
      opInProgress,
      closeDialog: () => useGit.getState().closeDialog(projectPath),
      runAction: (action, label) => useGit.getState().runAction(projectPath, action, label),
      runQuietAction: (action, opts) => useGit.getState().runQuietAction(projectPath, action, opts),
      clearActionErrors: () => useGit.getState().clearActionErrors(projectPath),
      openChase: (spec) => setChase((prev) => ({ spec, nonce: (prev?.nonce ?? 0) + 1 })),
      setViewPrefs: (patch) => void useGit.getState().setViewPrefs(patch)
    }),
    [
      projectPath,
      commits,
      branches,
      remoteBranches,
      tags,
      remotes,
      currentBranch,
      config,
      settings,
      viewPrefs,
      opInProgress
    ]
  )

  // 1. 错误框（动作失败 / 复制失败）：正文等宽多行，「知道了」清除
  if (actionErrors !== null) {
    return (
      <Mask onClick={env.clearActionErrors}>
        <DialogPanel>
          <div className="space-y-3 px-4 py-4">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
              <TriangleAlert className="size-4 shrink-0 text-[color:var(--status-failed)]" />
              操作失败
            </div>
            <pre className="max-h-64 select-text overflow-auto whitespace-pre-wrap break-all rounded border border-[color:var(--border-input)] bg-[var(--bg-deepest)] p-2.5 font-mono text-[12px] leading-relaxed text-muted-foreground">
              {actionErrors.filter((e) => e !== '').join('\n\n')}
            </pre>
          </div>
          <div className="flex justify-end gap-2 border-t px-4 py-2.5">
            <Button onClick={env.clearActionErrors}>知道了</Button>
          </div>
        </DialogPanel>
      </Mask>
    )
  }

  // 2. 进行中遮罩：spinner + 文案；「隐藏」只收起提示，动作继续（§1.3）。
  // 以「隐藏时的文案」判断是否收起：新动作（文案不同）自然重新显示；
  // 同文案的连续两个动作会沿用隐藏态，属可接受的边角。
  if (actionRunning !== null) {
    if (hiddenFor === actionRunning) return null
    return (
      <Mask>
        <DialogPanel className="w-[300px]">
          <div className="flex flex-col items-center gap-3 px-6 py-5">
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
            <div className="text-[13px] text-foreground">{actionRunning} …</div>
            <Button variant="ghost" size="sm" onClick={() => setHiddenFor(actionRunning)}>
              隐藏
            </Button>
          </div>
        </DialogPanel>
      </Mask>
    )
  }

  // 3. 追问对话框（不经过 store.dialog）
  if (chase !== null) {
    return (
      <DialogForm key={`chase-${chase.nonce}`} spec={chase.spec} onCancel={() => setChase(null)} />
    )
  }

  if (dialog === null) return null

  // 4a. D27 标签详情（Message 型，异步加载；已落地结果不属于当前 tag 时仍显示加载中）
  if (dialog.kind === 'tag-details') {
    const info = tagInfo !== null && tagInfo.name === dialog.name ? tagInfo.result : null
    return <TagDetailsDialog name={dialog.name} info={info} onClose={env.closeDialog} />
  }

  // 4b. D10 拉取（表单式）：remote→分支联动与行内刷新的异步 spinner 不进声明式 spec，
  // 照 tag-details 的先例由组件层特判（key 同 dialogKey：请求变化即重置表单）。
  // config 未就绪时先不挂表单（needsConfig 的 effect 正在拉）：默认值（上游 remote/分支、
  // 整合方式的配置层）在挂载时冻结，提前挂会把空 config 算出的错误默认值定死。
  if (dialog.kind === 'pull-branch') {
    if (env.config === null) return null
    return <PullBranchDialog key={dialogKey(dialog)} req={dialog} env={env} />
  }

  // 4c. D5 推送（表单式）：目标分支跟随本地分支、combobox 与行内刷新同理由组件层特判；
  // config 门控理由同 4b（defaultPushRemote 依赖 branch.<name>.pushremote/remote）
  if (dialog.kind === 'push-branch') {
    if (env.config === null) return null
    return <PushBranchDialog key={dialogKey(dialog)} req={dialog} env={env} />
  }

  // 4d. 常规表单对话框
  const spec = buildSpec(dialog, env)
  if (spec === null) return null
  return <DialogForm key={dialogKey(dialog)} spec={spec} onCancel={env.closeDialog} />
}

/** 表单重挂 key：请求变化（含同类对话框换目标）即重置输入值。 */
function dialogKey(req: GitDialogRequest): string {
  return JSON.stringify(req)
}

/** 全屏遮罩（ConfigDialog 同款）：点击遮罩 = 取消（进行中遮罩不传 onClick 即不可关）。 */
function Mask({
  children,
  onClick
}: {
  children: React.ReactNode
  onClick?: () => void
}): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClick}
    >
      {children}
    </div>
  )
}

/** 对话框面板外壳：440px 宽（ConfigDialog 同款），拦截冒泡防误触遮罩关闭。 */
function DialogPanel({
  children,
  className,
  onKeyDown
}: {
  children: React.ReactNode
  className?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'w-[440px] rounded border border-[color:var(--border-input)] bg-panel shadow-xl',
        className
      )}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  )
}

/** ⓘ 提示图标：原生 title tooltip（项目约定，无 tooltip 组件）。 */
function InfoIcon({ text }: { text: string }): React.JSX.Element {
  return (
    <span title={text} className="flex shrink-0 cursor-help items-center">
      <Info className="size-3.5 text-muted-foreground" />
    </span>
  )
}

/** 通用表单渲染器：按 DialogSpec 渲染消息 + 输入 + 按钮，含 TextRef 校验与键盘处理。 */
function DialogForm({
  spec,
  onCancel
}: {
  spec: DialogSpec
  onCancel: () => void
}): React.JSX.Element {
  const [values, setValues] = useState<DialogValues>(() => {
    const init: DialogValues = {}
    for (const input of spec.inputs) {
      init[input.key] =
        input.type === 'checkbox'
          ? input.default
          : input.type === 'multi-select'
            ? input.defaults
            : input.default
    }
    return init
  })
  const setValue = (key: string, value: string | string[] | boolean): void =>
    setValues((v) => ({ ...v, [key]: value }))

  // TextRef 校验（§1.2）：空 = noInput（allowEmpty 除外）、命中非法字符正则 = inputInvalid，
  // 均禁用主按钮
  const refInputs = spec.inputs.filter(
    (i): i is Extract<DialogInputSpec, { type: 'text-ref' }> => i.type === 'text-ref'
  )
  const hasInvalid = refInputs.some((i) => isRefInvalid((values[i.key] as string) ?? ''))
  const hasEmpty = refInputs.some(
    (i) => i.allowEmpty !== true && ((values[i.key] as string) ?? '') === ''
  )
  const valid = !hasInvalid && !hasEmpty

  // Escape 兜底：焦点在对话框输入控件里时 GitPane 的 capture 监听会让位，这里补一份
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const submit = (btn: DialogButton): void => {
    if (!valid) return
    btn.onClick(values)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    // Enter = 主按钮；必须排除输入法合成中的回车（isComposing / keyCode 229）
    if (e.key !== 'Enter') return
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (spec.buttons.length === 0) return
    e.preventDefault()
    submit(spec.buttons[0])
  }

  // 第一个 Text/TextRef 输入自动聚焦（§1.2）
  const autoFocusKey =
    spec.inputs.find((i) => i.type === 'text' || i.type === 'text-ref')?.key ?? null

  return (
    <Mask onClick={onCancel}>
      <DialogPanel onKeyDown={onKeyDown}>
        <div className="space-y-3 px-4 py-4">
          <div className="select-text text-[13px] leading-relaxed text-foreground">
            {spec.message}
          </div>
          {spec.inputs.map((input) => (
            <DialogInputRow
              key={input.key}
              input={input}
              value={values[input.key]}
              autoFocusInput={input.key === autoFocusKey}
              setValue={setValue}
            />
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-2.5">
          {spec.hideCancel !== true && (
            <Button variant="ghost" onClick={onCancel}>
              {spec.cancelLabel ?? (spec.messageOnly === true ? '关闭' : '取消')}
            </Button>
          )}
          {spec.buttons.map((btn, i) => (
            <Button
              key={i}
              disabled={!valid}
              title={hasInvalid ? `无法${btn.label}，输入包含非法字符` : undefined}
              onClick={() => submit(btn)}
            >
              {btn.label}
            </Button>
          ))}
        </div>
      </DialogPanel>
    </Mask>
  )
}

/** 单个表单输入行：类型 → 控件映射（Text/TextRef → Input，Select/Radio/Checkbox → ui 封装）。 */
function DialogInputRow({
  input,
  value,
  autoFocusInput,
  setValue
}: {
  input: DialogInputSpec
  value: string | string[] | boolean | undefined
  autoFocusInput: boolean
  setValue: (key: string, value: string | string[] | boolean) => void
}): React.JSX.Element {
  if (input.type === 'checkbox') {
    const disabled = input.disabled === true
    return (
      <label
        className={cn(
          'flex select-none items-center gap-2 text-[13px] text-foreground',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
        )}
        title={disabled ? input.disabledReason : undefined}
      >
        <Checkbox
          checked={value === true}
          disabled={disabled}
          onCheckedChange={(c) => setValue(input.key, c)}
        />
        <span>{input.label}</span>
        {input.info !== undefined && <InfoIcon text={input.info} />}
      </label>
    )
  }
  let control: React.JSX.Element
  switch (input.type) {
    case 'text':
      control = (
        <Input
          value={value as string}
          autoFocus={autoFocusInput}
          placeholder={input.placeholder}
          onChange={(e) => setValue(input.key, e.target.value)}
        />
      )
      break
    case 'text-ref': {
      const invalid = isRefInvalid(value as string)
      control = (
        <div className="space-y-1">
          <Input
            value={value as string}
            autoFocus={autoFocusInput}
            className={cn(
              'font-mono',
              invalid &&
                'border-[color:var(--destructive)] focus-visible:ring-[color:var(--destructive)]'
            )}
            onChange={(e) => setValue(input.key, e.target.value)}
          />
          {invalid && (
            <div className="text-[12px] text-[color:var(--destructive)]">名称包含非法字符。</div>
          )}
        </div>
      )
      break
    }
    case 'select':
      control = (
        <Select
          value={value as string}
          onValueChange={(v) => setValue(input.key, v as string)}
          items={input.options.map((o) => ({ value: o.value, label: o.name }))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {input.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
      break
    case 'multi-select': {
      const nameOf = new Map(input.options.map((o) => [o.value, o.name]))
      control = (
        <Select
          multiple
          value={value as string[]}
          onValueChange={(v) => setValue(input.key, v as string[])}
        >
          <SelectTrigger>
            <SelectValue>
              {(selected: string[]) =>
                selected.length === 0
                  ? '无'
                  : formatCommaList(selected.map((s) => nameOf.get(s) ?? s))
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {input.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
      break
    }
    case 'radio':
      control = (
        <RadioGroup value={value as string} onValueChange={(v) => setValue(input.key, v)}>
          {input.options.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer select-none items-center gap-2 text-[13px] text-foreground"
            >
              <RadioGroupItem value={o.value} />
              {o.name}
            </label>
          ))}
        </RadioGroup>
      )
      break
  }
  if (input.label === '') return control
  // radio 变体没有 info 字段，用 in 收窄统一取值
  const info = 'info' in input ? input.info : undefined
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-[12px] text-muted-foreground">{input.label}</span>
        {info !== undefined && <InfoIcon text={info} />}
      </div>
      {control}
    </div>
  )
}

// —— 自定义表单对话框（联动 / combobox / 行内刷新等超出声明式 spec 的表单；pull/push 用） ——

/** 自定义表单按钮：disabled/title 由表单自身校验状态驱动（确认禁用 + 禁用原因提示）。 */
interface FormDialogButton {
  label: string
  disabled?: boolean
  /** 禁用原因等 hover 提示 */
  title?: string
  onClick: () => void
}

/**
 * 自定义表单对话框外壳：Mask + DialogPanel + 消息 + children（字段自由布局）+ 按钮行。
 * 键盘约定与 DialogForm 一致：Esc = 取消、Enter = 主按钮（排除输入法合成与禁用态）。
 */
function FormDialogShell({
  message,
  children,
  buttons,
  onCancel
}: {
  message: React.ReactNode
  children: React.ReactNode
  buttons: FormDialogButton[]
  onCancel: () => void
}): React.JSX.Element {
  // Escape 兜底：焦点在对话框输入控件里时 GitPane 的 capture 监听会让位，这里补一份
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    // Enter = 主按钮；必须排除输入法合成中的回车（isComposing / keyCode 229）
    if (e.key !== 'Enter') return
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    const primary = buttons[0]
    if (primary === undefined || primary.disabled === true) return
    e.preventDefault()
    primary.onClick()
  }

  return (
    <Mask onClick={onCancel}>
      <DialogPanel onKeyDown={onKeyDown}>
        <div className="space-y-3 px-4 py-4">
          <div className="select-text text-[13px] leading-relaxed text-foreground">{message}</div>
          {children}
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-2.5">
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
          {buttons.map((btn, i) => (
            <Button
              key={i}
              disabled={btn.disabled === true}
              title={btn.title}
              onClick={btn.onClick}
            >
              {btn.label}
            </Button>
          ))}
        </div>
      </DialogPanel>
    </Mask>
  )
}

/** 自定义表单的字段行：标签 + 可选 ⓘ + 控件（DialogInputRow 标签包装的可组合版）。 */
function FieldRow({
  label,
  info,
  children
}: {
  label: string
  info?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-[12px] text-muted-foreground">{label}</span>
        {info !== undefined && <InfoIcon text={info} />}
      </div>
      {children}
    </div>
  )
}

/** 行内刷新钮（分支字段旁）：对所选 remote 静默 fetch，期间转圈禁点；观感对齐输入控件。 */
function InlineRefreshButton({
  refreshing,
  title,
  onClick
}: {
  refreshing: boolean
  title: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      disabled={refreshing}
      className="flex size-8 shrink-0 items-center justify-center rounded border border-[color:var(--border-input)] bg-[var(--bg-panel)] text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)] disabled:pointer-events-none disabled:opacity-50"
      onClick={onClick}
    >
      {refreshing ? (
        <LoaderCircle className="size-4 animate-spin" />
      ) : (
        <RotateCw className="size-4" />
      )}
    </button>
  )
}

/** 行内刷新失败的就地错误行（观感对齐 text-ref 的非法字符提示）；null = 无错误不渲染。 */
function RefreshErrorLine({ error }: { error: string | null }): React.JSX.Element | null {
  if (error === null) return null
  return (
    <div className="mt-1 select-text whitespace-pre-wrap break-all text-[12px] text-[color:var(--destructive)]">
      刷新失败：{error}
    </div>
  )
}

/**
 * 可输可选 combobox（推送对话框「目标远程分支」用）：自由文本输入 + 建议列表（子串过滤，
 * 点击回填）。Escape 在列表展开时只收起列表（stopPropagation 拦下外壳的取消监听）。
 */
export function DialogCombobox({
  value,
  onValueChange,
  suggestions,
  placeholder
}: {
  value: string
  onValueChange: (value: string) => void
  suggestions: readonly string[]
  placeholder?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const matched = suggestions.filter((s) => s.toLowerCase().includes(value.toLowerCase()))
  const listOpen = open && matched.length > 0
  return (
    <div className="relative min-w-0 flex-1">
      <Input
        value={value}
        placeholder={placeholder}
        className="font-mono"
        onChange={(e) => {
          onValueChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && listOpen) {
            e.stopPropagation()
            setOpen(false)
          }
        }}
      />
      {listOpen && (
        <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-48 overflow-auto rounded-lg border border-[color:var(--border-input)] bg-panel p-1.5 shadow-xl">
          {matched.map((s) => (
            <button
              key={s}
              type="button"
              className="flex w-full cursor-pointer items-center rounded px-1.5 py-1.5 text-left font-mono text-[13px] text-foreground hover:bg-[var(--bg-row-hover)]"
              // 防止 blur 先收起列表、吞掉点击
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onValueChange(s)
                setOpen(false)
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** 单选 / 勾选行样式（拉取整合方式、推送模式的 radio 行及各自附属勾选行共用）。 */
const CHOICE_ROW = 'flex cursor-pointer select-none items-center gap-2 text-[13px] text-foreground'

/**
 * D10 拉取当前分支（表单式）：从远程拉取 / 远程分支 / 整合方式三字段。
 * 远程分支选项来自 env.remoteBranches（全量口径，不受「显示远程分支」开关与 hideRemotes
 * 过滤——展示口径的 env.branches 被过滤时会让拉取变成死路），行内刷新钮对所选 remote
 * 静默 fetch（runQuietAction 不弹进行中遮罩，成功后软刷新流回选项列表；失败就地提示，
 * 不走全局错误框——那会顶掉表单、丢掉用户已填状态）。
 * 确认时把所选整合方式写回 viewPrefs.pullIntegrationMode（下次默认值的第一层）。
 */
function PullBranchDialog({
  req,
  env
}: {
  req: Extract<GitDialogRequest, { kind: 'pull-branch' }>
  env: DialogEnv
}): React.JSX.Element {
  // remote 与分支合并为一份状态：切 remote 必须按默认规则重置分支，二者不单独变化
  const [target, setTarget] = useState<{ remote: string; branch: string }>(() => {
    if (req.preset !== null && env.remotes.includes(req.preset.remote)) return req.preset
    const remote = defaultPullRemote(env.currentBranch, env.remotes, env.config)
    return {
      remote,
      branch: defaultPullBranch(
        env.currentBranch,
        remoteBranchesOf(env.remoteBranches, remote),
        env.config
      )
    }
  })
  const [mode, setMode] = useState<GitPullMode>(() =>
    defaultPullMode(env.viewPrefs, env.currentBranch, env.config)
  )
  const [noFF, setNoFF] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  /** 行内刷新失败的就地提示；换 remote / 重试时清掉 */
  const [refreshError, setRefreshError] = useState<string | null>(null)

  const branchOptions = remoteBranchesOf(env.remoteBranches, target.remote)

  const selectRemote = (remote: string): void => {
    setRefreshError(null)
    setTarget({
      remote,
      branch: defaultPullBranch(
        env.currentBranch,
        remoteBranchesOf(env.remoteBranches, remote),
        env.config
      )
    })
  }

  const refresh = (): void => {
    setRefreshing(true)
    setRefreshError(null)
    void env
      .runQuietAction(
        { kind: 'fetch', remote: target.remote, prune: false, pruneTags: false },
        { suppressErrorBox: true }
      )
      .then((r) => {
        if (r.status === 'error') setRefreshError(r.errors.filter((e) => e !== '').join('\n'))
      })
      .finally(() => setRefreshing(false))
  }

  const disabled = target.branch === '' || refreshing
  const confirm = (): void => {
    env.setViewPrefs({ pullIntegrationMode: mode })
    dispatch(
      env,
      {
        kind: 'pull-branch',
        remote: target.remote,
        branch: target.branch,
        mode,
        // noFF 仅合并模式有意义；切去变基/压缩时勾选状态保留但不下发
        noFastForward: mode === 'merge' && noFF
      },
      '正在拉取分支'
    )
  }

  return (
    <FormDialogShell
      message={<>将远程分支拉取到 {currentBranchText(env.currentBranch)}：</>}
      buttons={[
        {
          label: '是，拉取',
          disabled,
          title: disabled ? (refreshing ? '正在刷新远程分支列表' : '请先选择远程分支') : undefined,
          onClick: confirm
        }
      ]}
      onCancel={env.closeDialog}
    >
      <FieldRow label="从远程拉取">
        <Select
          value={target.remote}
          onValueChange={(v) => selectRemote(v as string)}
          items={env.remotes.map((r) => ({ value: r, label: r }))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {env.remotes.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>
      <FieldRow label="远程分支">
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <Select
              value={target.branch}
              onValueChange={(v) => setTarget((t) => ({ ...t, branch: v as string }))}
            >
              <SelectTrigger>
                <SelectValue>
                  {(selected: string) =>
                    selected === '' ? (
                      <span className="text-[color:var(--fg-disabled)]">选择分支</span>
                    ) : (
                      selected
                    )
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {branchOptions.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <InlineRefreshButton
            refreshing={refreshing}
            title={`获取 ${target.remote} 的最新分支列表`}
            onClick={refresh}
          />
        </div>
        <RefreshErrorLine error={refreshError} />
      </FieldRow>
      <FieldRow label="整合方式">
        <RadioGroup value={mode} onValueChange={(v) => setMode(v as GitPullMode)}>
          <label className={CHOICE_ROW}>
            <RadioGroupItem value="merge" />
            合并
          </label>
          {/* 合并的附属勾选：非合并模式禁用置灰（勾选状态保留，切回合并时仍在） */}
          <label className={cn(CHOICE_ROW, 'ml-6', mode !== 'merge' && 'opacity-50')}>
            <Checkbox
              checked={noFF}
              disabled={mode !== 'merge'}
              onCheckedChange={(c) => setNoFF(c)}
            />
            即使可以快进也创建新的合并提交
          </label>
          <label className={CHOICE_ROW}>
            <RadioGroupItem value="rebase" />
            变基
            <InfoIcon text="变基会重写本地未推送的提交；若这些提交已推送过，请勿使用。" />
          </label>
          <label className={CHOICE_ROW}>
            <RadioGroupItem value="squash" />
            压缩提交
            <InfoIcon text="在当前分支上创建单个提交，其效果等同于合并该远程分支。" />
          </label>
        </RadioGroup>
      </FieldRow>
    </FormDialogShell>
  )
}

/**
 * D5 推送分支（表单式）：推送到远程 / 本地分支 / 目标远程分支 / 设置上游 / 推送标签 /
 * 推送模式。目标远程分支是可输可选 combobox（建议 = 所选 remote 已加载的远程分支，
 * 行内刷新钮同 D10）。「目标跟随本地分支同名直到手动编辑」「设置上游默认 = 目标与本地
 * 同名、点过后不再自动变」都用「没动过则派生、动过存实值」表达，不引 effect 联动。
 */
function PushBranchDialog({
  req,
  env
}: {
  req: Extract<GitDialogRequest, { kind: 'push-branch' }>
  env: DialogEnv
}): React.JSX.Element {
  // 本地分支选项：env.branches 剔除带 remotes/ 前缀的远程项即本地分支（当前分支排第 0）
  const localOptions = env.branches.filter((b) => !b.startsWith('remotes/'))
  const [remote, setRemote] = useState(() => defaultPushRemote(req.branch, env.remotes, env.config))
  const [localBranch, setLocalBranch] = useState(req.branch)
  /** 目标远程分支：null = 未手动编辑，跟随本地分支同名 */
  const [editedTarget, setEditedTarget] = useState<string | null>(null)
  const targetBranch = editedTarget ?? localBranch
  /** 设置上游：null = 未手动点过，默认 = 目标与本地同名 */
  const [touchedUpstream, setTouchedUpstream] = useState<boolean | null>(null)
  const setUpstream = touchedUpstream ?? targetBranch === localBranch
  const [pushTags, setPushTags] = useState(false)
  const [mode, setMode] = useState<GitPushMode>('normal')
  const [refreshing, setRefreshing] = useState(false)
  /** 行内刷新失败的就地提示（同 D10：不走全局错误框，防表单被顶掉丢已填状态） */
  const [refreshError, setRefreshError] = useState<string | null>(null)

  const refresh = (): void => {
    setRefreshing(true)
    setRefreshError(null)
    void env
      .runQuietAction(
        { kind: 'fetch', remote, prune: false, pruneTags: false },
        { suppressErrorBox: true }
      )
      .then((r) => {
        if (r.status === 'error') setRefreshError(r.errors.filter((e) => e !== '').join('\n'))
      })
      .finally(() => setRefreshing(false))
  }

  // remote 为空 = 仓库没有远程（「提交并推送」入口不看 remote 数量，可能走到这里）
  const disabled = remote === '' || targetBranch === '' || refreshing
  const confirm = (): void =>
    dispatch(
      env,
      { kind: 'push-branch', remote, localBranch, targetBranch, setUpstream, pushTags, mode },
      '正在推送分支'
    )

  return (
    <FormDialogShell
      message={<>将本地分支推送到远程：</>}
      buttons={[
        {
          label: '是，推送',
          disabled,
          title: disabled
            ? refreshing
              ? '正在刷新远程分支列表'
              : remote === ''
                ? '仓库没有配置远程'
                : '请先填写目标远程分支'
            : undefined,
          onClick: confirm
        }
      ]}
      onCancel={env.closeDialog}
    >
      <FieldRow label="推送到远程">
        <Select
          value={remote}
          onValueChange={(v) => {
            setRemote(v as string)
            // 刷新失败提示归属于具体 remote 的 fetch，换 remote 即失效
            setRefreshError(null)
          }}
          items={env.remotes.map((r) => ({ value: r, label: r }))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {env.remotes.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>
      <FieldRow label="本地分支">
        <Select
          value={localBranch}
          onValueChange={(v) => setLocalBranch(v as string)}
          items={localOptions.map((b) => ({ value: b, label: b }))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {localOptions.map((b) => (
              <SelectItem key={b} value={b}>
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>
      <FieldRow label="目标远程分支">
        <div className="flex items-center gap-1.5">
          <DialogCombobox
            value={targetBranch}
            onValueChange={setEditedTarget}
            suggestions={remoteBranchesOf(env.remoteBranches, remote)}
            placeholder="分支名"
          />
          <InlineRefreshButton
            refreshing={refreshing}
            title={`获取 ${remote} 的最新分支列表`}
            onClick={refresh}
          />
        </div>
        <RefreshErrorLine error={refreshError} />
      </FieldRow>
      <label className={CHOICE_ROW}>
        <Checkbox checked={setUpstream} onCheckedChange={(c) => setTouchedUpstream(c)} />
        <span>设置上游</span>
      </label>
      <label className={CHOICE_ROW}>
        <Checkbox checked={pushTags} onCheckedChange={(c) => setPushTags(c)} />
        <span>同时推送该分支上的标签</span>
        <InfoIcon text="推送该分支历史上的全部标签（附注与轻量都含）。" />
      </label>
      <FieldRow label="推送模式">
        <RadioGroup value={mode} onValueChange={(v) => setMode(v as GitPushMode)}>
          <label className={CHOICE_ROW}>
            <RadioGroupItem value="normal" />
            普通
          </label>
          <label className={CHOICE_ROW}>
            <RadioGroupItem value="force-with-lease" />
            强制（with lease）
          </label>
          <label className={CHOICE_ROW}>
            <RadioGroupItem value="force" />
            强制
          </label>
        </RadioGroup>
      </FieldRow>
    </FormDialogShell>
  )
}

/**
 * D27 标签详情（Message 型）。「指向的提交」不展示：GitTagDetails 契约只有 tag 对象自身
 * 的 hash，对话框请求也不携带所在提交（v1 取舍）。
 */
function TagDetailsDialog({
  name,
  info,
  onClose
}: {
  name: string
  /** null = 加载中 */
  info: GitTagDetailsResult | null
  onClose: () => void
}): React.JSX.Element {
  // Message 型不走 DialogForm，Escape 监听单独补一份
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <Mask onClick={onClose}>
      <DialogPanel>
        <div className="space-y-3 px-4 py-4">
          <div className="text-[13px] font-semibold text-foreground">
            标签 <Em>{name}</Em>
          </div>
          {info === null ? (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              正在获取标签详情 …
            </div>
          ) : info.error !== null || info.details === null ? (
            <pre className="select-text whitespace-pre-wrap break-all rounded border border-[color:var(--border-input)] bg-[var(--bg-deepest)] p-2.5 font-mono text-[12px] text-muted-foreground">
              {info.error ?? '无法获取标签详情'}
            </pre>
          ) : (
            <div className="space-y-1 text-[13px]">
              <TagDetailRow label="对象">
                <span className="font-mono">{info.details.hash}</span>
              </TagDetailRow>
              <TagDetailRow label="打标签者">
                {info.details.taggerName} &lt;{info.details.taggerEmail}&gt;
                {info.details.signed && '（已签名）'}
              </TagDetailRow>
              <TagDetailRow label="日期">{formatDateTime(info.details.taggerDate)}</TagDetailRow>
              {info.details.message !== '' && (
                <pre className="mt-2 select-text whitespace-pre-wrap break-all rounded border border-[color:var(--border-input)] bg-[var(--bg-deepest)] p-2.5 text-[12px] leading-relaxed text-foreground">
                  {info.details.message}
                </pre>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-2.5">
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
      </DialogPanel>
    </Mask>
  )
}

/** 标签详情的一行键值。 */
function TagDetailRow({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 text-muted-foreground">{label}:</span>
      <span className="min-w-0 flex-1 select-text break-all text-foreground">{children}</span>
    </div>
  )
}
