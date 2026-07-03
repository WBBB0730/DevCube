// 仓库设置面板（toolbar-widgets §4）：居中弹层（骨架照 ConfigDialog 的手写 fixed 遮罩），
// 五个区块 —— 常规（显示名 / 三态开关 / 提交排序）、隐藏的远程、用户信息、远程管理、Issue 链接。
// 三态开关与排序直接 updateSettings（数据键变更由 store 自动硬刷新）；用户信息与远程 CRUD
// 走 runAction（进行中遮罩 / 错误框由 F 的 GitDialogs 统一呈现），成功后重拉 config。
// F 名下的 ui/select、ui/checkbox 与本文件并行写作，为避免跨波次依赖，这里刻意只用
// 原生 <select> / <input type="checkbox" | "radio">（观感用同一套 token 对齐 Input）。
import { useEffect, useRef, useState } from 'react'
import { Eraser, Pencil, Plus, Trash2, X } from 'lucide-react'
import {
  GIT_DEFAULTS,
  type BooleanOverride,
  type GitAction,
  type GitCommitOrdering,
  type GitRepoSettings as GitRepoSettingsShape
} from '@shared/git'
import { gitState, useGit } from '@renderer/git-store'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'

// —— 纯逻辑（导出供测试） ——

/** Issue 链接配置校验（§4.5）：返回错误文案，合法返回 null。 */
// eslint-disable-next-line react-refresh/only-export-components -- 纯函数与组件同文件导出（供单测）
export function validateIssueLinking(issue: string, url: string): string | null {
  if (issue.trim() === '' || url.trim() === '') return 'Issue 正则与 Issue URL 均不能为空。'
  if (!issue.includes('(') || !issue.includes(')')) return '正则表达式不包含捕获组 ( )。'
  try {
    void new RegExp(issue, 'gu')
  } catch (e) {
    return e instanceof Error ? e.message : '无效的正则表达式'
  }
  if (!/\$([1-9][0-9]*)/.test(url)) {
    return 'Issue URL 中不含用于代入 Issue 编号的占位符（$1、$2 等）。'
  }
  return null
}

/** 切换某 remote 的隐藏态后的 hideRemotes 新数组（幂等：重复勾选不产生重复项）。 */
// eslint-disable-next-line react-refresh/only-export-components -- 纯函数与组件同文件导出（供单测）
export function nextHideRemotes(hideRemotes: string[], remote: string, hidden: boolean): string[] {
  const without = hideRemotes.filter((r) => r !== remote)
  return hidden ? [...without, remote] : without
}

// —— 私有类型与常量 ——

/** 面板内确认条请求（删除 / 清理 / 移除等操作先确认再执行）。 */
interface ConfirmRequest {
  message: string
  actionLabel: string
  destructive: boolean
  run: () => void
}

/** 常规区的五个三态开关行：settings 键 → 文案 / 悬停说明 / default 档的回退值提示。 */
const OVERRIDE_ROWS: {
  key:
    | 'showRemoteBranches'
    | 'showStashes'
    | 'showTags'
    | 'includeCommitsMentionedByReflogs'
    | 'onlyFollowFirstParent'
  label: string
  title?: string
  def: boolean
}[] = [
  { key: 'showRemoteBranches', label: '显示远程分支', def: GIT_DEFAULTS.showRemoteBranches },
  { key: 'showStashes', label: '显示贮藏', def: GIT_DEFAULTS.showStashes },
  { key: 'showTags', label: '显示标签', def: GIT_DEFAULTS.showTags },
  {
    key: 'includeCommitsMentionedByReflogs',
    label: '包含仅被 reflog 提及的提交',
    title: '仅在显示所有分支时生效。',
    def: GIT_DEFAULTS.includeCommitsMentionedByReflogs
  },
  {
    key: 'onlyFollowFirstParent',
    label: '只跟随第一父提交',
    title: '发现提交时只沿第一父提交回溯，不展开其余父链。',
    def: GIT_DEFAULTS.onlyFollowFirstParent
  }
]

// 原生 select 的观感对齐 Input（h-7 紧凑高度、同一套边框与焦点环 token）
const SELECT =
  'h-7 shrink-0 rounded border border-[color:var(--border-input)] bg-[var(--bg-panel)] px-1 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring'
// 行内图标钮（编辑 / 清理 / 删除），观感对齐工具栏图标钮
const ICON_BTN =
  'flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]'
const HINT = 'text-[12px] text-muted-foreground'

/** 顺序执行一串动作（出错即停，进行中 / 错误呈现由 GitDialogs 统一负责），全部成功后重拉 config。 */
async function runActionsThenReloadConfig(
  projectPath: string,
  steps: { action: GitAction; label: string }[]
): Promise<boolean> {
  const store = useGit.getState()
  for (const step of steps) {
    const result = await store.runAction(projectPath, step.action, step.label)
    if (result.status !== 'ok') return false
  }
  await store.loadRepoConfig(projectPath)
  return true
}

// —— 面板本体 ——

/** 仓库设置面板：open=false 时不渲染；打开即重拉仓库 config（§4.1，用户信息 / 远程区依赖它）。 */
export function GitRepoSettings({
  projectPath,
  open,
  onClose
}: {
  projectPath: string
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const loadRepoConfig = useGit((s) => s.loadRepoConfig)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  // Esc 处理需要读最新 confirm，用 ref 镜像避免监听器闭包过期（在 effect 内写，不在渲染期碰 ref）
  const confirmRef = useRef<ConfirmRequest | null>(null)
  useEffect(() => {
    confirmRef.current = confirm
  }, [confirm])

  // 打开即重拉 config；重开时清掉上次残留的确认条
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 面板打开是外部驱动的一次性复位，非渲染热路径
    setConfirm(null)
    void loadRepoConfig(projectPath)
  }, [open, projectPath, loadRepoConfig])

  // Esc：先关确认条、再关面板（子表单用各自的取消按钮关闭）。焦点在面板输入控件内时
  // GitPane 的 capture 监听会让位（editable 检查），此处兜住面板自身的关闭路径。
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (confirmRef.current !== null) setConfirm(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[85vh] w-[560px] flex-col rounded border border-[color:var(--border-input)] bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-[13px] text-[color:var(--fg-dialog-title)]">仓库设置</span>
          <button type="button" title="关闭 (Esc)" className={ICON_BTN} onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-3">
          <GeneralSection projectPath={projectPath} />
          <HiddenRemotesSection projectPath={projectPath} />
          <UserSection projectPath={projectPath} onConfirm={setConfirm} />
          <RemotesSection projectPath={projectPath} onConfirm={setConfirm} />
          <IssueSection projectPath={projectPath} />
        </div>
        {confirm !== null && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/40"
            onClick={() => setConfirm(null)}
          >
            <div
              className="w-96 rounded border border-[color:var(--border-input)] bg-panel p-4 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="select-text text-[13px] text-foreground">{confirm.message}</div>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                  取消
                </Button>
                <Button
                  variant={confirm.destructive ? 'destructive' : 'default'}
                  size="sm"
                  onClick={() => {
                    const run = confirm.run
                    setConfirm(null)
                    run()
                  }}
                >
                  {confirm.actionLabel}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// —— 通用小件 ——

/** 区块骨架：小标题 + 内容。 */
function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section>
      <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">{title}</div>
      {children}
    </section>
  )
}

/** 只读信息行：标签 + 值 +（本仓库 / 全局）来源标注。 */
function InfoRow({
  label,
  value,
  scope
}: {
  label: string
  value: string | null
  scope: string
}): React.JSX.Element {
  return (
    <div className="flex h-6 items-center gap-2 text-[13px]">
      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 select-text truncate text-foreground">
        {value ?? '未设置'}
      </span>
      {value !== null && (
        <span className="shrink-0 text-[11px] text-muted-foreground">（{scope}）</span>
      )}
    </div>
  )
}

/** 表单行：左标签右控件（标签定宽 64px，与内联表单的缩进对齐）。 */
function FormRow({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[12px] text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

// —— 「常规」区 ——

/** 显示名（blur / Enter 提交，空 = 回退目录名）+ 五个三态开关 + 提交排序，全部走 updateSettings。 */
function GeneralSection({ projectPath }: { projectPath: string }): React.JSX.Element {
  const settings = useGit((s) => gitState(s, projectPath).settings)
  const updateSettings = useGit((s) => s.updateSettings)
  const [nameDraft, setNameDraft] = useState('')
  const storedName = settings?.name ?? null

  // settings 快照落桶（面板打开时可能仍在途）后同步草稿；只依赖字符串值，编辑其它项不清稿
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 同步外部 store 异步落地的快照到本地草稿
    setNameDraft(storedName ?? '')
  }, [storedName])

  const dirName = projectPath.split(/[\\/]/).filter(Boolean).pop() ?? projectPath

  const commitName = (): void => {
    const next = nameDraft.trim() === '' ? null : nameDraft.trim()
    if (next !== storedName) void updateSettings(projectPath, { name: next })
  }

  return (
    <Section title="常规">
      <div className="space-y-1">
        <div className="flex h-8 items-center justify-between gap-3">
          <span className="shrink-0 text-[13px] text-foreground">显示名</span>
          <Input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return // 输入法合成中的 Enter 是确认候选
              if (e.key === 'Enter') commitName()
            }}
            placeholder={dirName}
            className="h-7 w-56"
          />
        </div>
        {OVERRIDE_ROWS.map((row) => (
          <div
            key={row.key}
            className="flex h-8 items-center justify-between gap-3"
            title={row.title}
          >
            <span className="text-[13px] text-foreground">{row.label}</span>
            <select
              className={cn(SELECT, 'w-56')}
              value={settings?.[row.key] ?? 'default'}
              onChange={(e) =>
                // 计算键的对象字面量会宽化成索引签名，显式收窄回 Partial<GitRepoSettings>
                void updateSettings(projectPath, {
                  [row.key]: e.target.value as BooleanOverride
                } as Partial<GitRepoSettingsShape>)
              }
            >
              <option value="default">默认（{row.def ? '开启' : '关闭'}）</option>
              <option value="enabled">开启</option>
              <option value="disabled">关闭</option>
            </select>
          </div>
        ))}
        <div className="flex h-8 items-center justify-between gap-3">
          <span className="text-[13px] text-foreground">提交排序</span>
          <select
            className={cn(SELECT, 'w-56')}
            value={settings?.commitOrdering ?? 'default'}
            onChange={(e) =>
              void updateSettings(projectPath, {
                commitOrdering: e.target.value as 'default' | GitCommitOrdering
              })
            }
          >
            <option value="default">默认（提交时间）</option>
            <option value="date">提交时间</option>
            <option value="author-date">作者时间</option>
            <option value="topo">拓扑顺序</option>
          </select>
        </div>
      </div>
    </Section>
  )
}

// —— 「隐藏的远程」区 ——

/** 勾选 = 隐藏该远程的分支（写 hideRemotes，数据键变更自动硬刷新）；无远程时整区不渲染。 */
function HiddenRemotesSection({ projectPath }: { projectPath: string }): React.JSX.Element | null {
  const remotes = useGit((s) => gitState(s, projectPath).remotes)
  const settings = useGit((s) => gitState(s, projectPath).settings)
  const updateSettings = useGit((s) => s.updateSettings)
  if (remotes.length === 0) return null
  const hidden = settings?.hideRemotes ?? []
  return (
    <Section title="隐藏的远程">
      <div className={HINT}>勾选的远程不在图谱中显示其分支。</div>
      <div className="mt-1 space-y-0.5">
        {remotes.map((r) => (
          <label
            key={r}
            className="flex h-7 cursor-pointer select-none items-center gap-1.5 text-[13px] text-foreground"
          >
            <input
              type="checkbox"
              className="accent-[var(--primary)]"
              checked={hidden.includes(r)}
              onChange={(e) =>
                void updateSettings(projectPath, {
                  hideRemotes: nextHideRemotes(hidden, r, e.target.checked)
                })
              }
            />
            {r}
          </label>
        ))}
      </div>
    </Section>
  )
}

// —— 「用户信息」区 ——

interface UserFormState {
  name: string
  email: string
  location: 'local' | 'global'
}

/** 展示 local / global 的 user.name / user.email（local 优先），编辑与移除走 set/unset-config。 */
function UserSection({
  projectPath,
  onConfirm
}: {
  projectPath: string
  onConfirm: (c: ConfirmRequest) => void
}): React.JSX.Element {
  const config = useGit((s) => gitState(s, projectPath).config)
  const [form, setForm] = useState<UserFormState | null>(null)

  if (config === null) {
    return (
      <Section title="用户信息">
        <div className={HINT}>正在读取 git 配置…</div>
      </Section>
    )
  }

  const { name, email } = config.user
  const hasAny =
    name.local !== null || name.global !== null || email.local !== null || email.global !== null

  const openForm = (): void =>
    setForm({
      name: name.local ?? name.global ?? '',
      email: email.local ?? email.global ?? '',
      // 参考默认（§4.3）：本地无任何覆盖时默认写全局
      location: name.local === null && email.local === null ? 'global' : 'local'
    })

  const submit = async (): Promise<void> => {
    if (form === null) return
    const label = '正在设置用户信息…'
    const steps: { action: GitAction; label: string }[] = [
      {
        action: {
          kind: 'set-config',
          key: 'user.name',
          value: form.name.trim(),
          location: form.location
        },
        label
      },
      {
        action: {
          kind: 'set-config',
          key: 'user.email',
          value: form.email.trim(),
          location: form.location
        },
        label
      }
    ]
    if (form.location === 'global') {
      // 写全局且本地存在覆盖时顺带清掉本地值，否则全局值不生效（§4.3）
      if (name.local !== null) {
        steps.push({ action: { kind: 'unset-config', key: 'user.name', location: 'local' }, label })
      }
      if (email.local !== null) {
        steps.push({
          action: { kind: 'unset-config', key: 'user.email', location: 'local' },
          label
        })
      }
    }
    if (await runActionsThenReloadConfig(projectPath, steps)) setForm(null)
  }

  const remove = (): void => {
    // 本地有值优先移除本地覆盖，否则移除全局值
    const loc: 'local' | 'global' = name.local !== null || email.local !== null ? 'local' : 'global'
    const label = '正在移除用户信息…'
    const steps: { action: GitAction; label: string }[] = []
    if ((loc === 'local' ? name.local : name.global) !== null) {
      steps.push({ action: { kind: 'unset-config', key: 'user.name', location: loc }, label })
    }
    if ((loc === 'local' ? email.local : email.global) !== null) {
      steps.push({ action: { kind: 'unset-config', key: 'user.email', location: loc }, label })
    }
    onConfirm({
      message: `确定要移除${loc === 'local' ? '本仓库' : '全局'}配置的用户名与邮箱吗？`,
      actionLabel: '是，移除',
      destructive: true,
      run: () => void runActionsThenReloadConfig(projectPath, steps)
    })
  }

  return (
    <Section title="用户信息">
      {form === null ? (
        hasAny ? (
          <div className="space-y-0.5">
            <InfoRow
              label="用户名"
              value={name.local ?? name.global}
              scope={name.local !== null ? '本仓库' : '全局'}
            />
            <InfoRow
              label="邮箱"
              value={email.local ?? email.global}
              scope={email.local !== null ? '本仓库' : '全局'}
            />
            <div className="flex gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={openForm}>
                <Pencil className="size-3.5" /> 编辑
              </Button>
              <Button variant="ghost" size="sm" onClick={remove}>
                <Trash2 className="size-3.5" /> 移除
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className={HINT}>用户信息（名称与邮箱）用于 Git 记录提交对象的作者与提交者。</div>
            <Button variant="ghost" size="sm" onClick={openForm}>
              <Plus className="size-3.5" /> 添加用户信息
            </Button>
          </div>
        )
      ) : (
        <div className="space-y-2">
          <FormRow label="用户名">
            <Input
              className="h-7"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
            />
          </FormRow>
          <FormRow label="邮箱">
            <Input
              className="h-7"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </FormRow>
          <FormRow label="写入位置">
            <div className="flex items-center gap-3">
              <label className="flex cursor-pointer select-none items-center gap-1.5 text-[13px] text-foreground">
                <input
                  type="radio"
                  className="accent-[var(--primary)]"
                  checked={form.location === 'local'}
                  onChange={() => setForm({ ...form, location: 'local' })}
                />
                本仓库
              </label>
              <label
                className="flex cursor-pointer select-none items-center gap-1.5 text-[13px] text-foreground"
                title="将该用户名与邮箱全局用于所有 Git 仓库（可按仓库覆盖）。"
              >
                <input
                  type="radio"
                  className="accent-[var(--primary)]"
                  checked={form.location === 'global'}
                  onChange={() => setForm({ ...form, location: 'global' })}
                />
                全局
              </label>
            </div>
          </FormRow>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setForm(null)}>
              取消
            </Button>
            <Button
              size="sm"
              disabled={form.name.trim() === '' || form.email.trim() === ''}
              onClick={() => void submit()}
            >
              设置用户信息
            </Button>
          </div>
        </div>
      )}
    </Section>
  )
}

// —— 「远程管理」区 ——

interface RemoteFormState {
  mode: 'add' | 'edit'
  /** edit 时的原始值（edit-remote 需要 old/new 全量传，主进程按差异生成命令序列） */
  nameOld: string
  urlOld: string | null
  pushUrlOld: string | null
  name: string
  url: string
  pushUrl: string
  fetchAfter: boolean
}

/** config.remotes 列表 + 添加 / 编辑（内联表单）/ 删除 / 清理（确认条），全部走 runAction。 */
function RemotesSection({
  projectPath,
  onConfirm
}: {
  projectPath: string
  onConfirm: (c: ConfirmRequest) => void
}): React.JSX.Element {
  const config = useGit((s) => gitState(s, projectPath).config)
  const [form, setForm] = useState<RemoteFormState | null>(null)

  if (config === null) {
    return (
      <Section title="远程管理">
        <div className={HINT}>正在读取 git 配置…</div>
      </Section>
    )
  }

  const openAdd = (): void =>
    setForm({
      mode: 'add',
      nameOld: '',
      urlOld: null,
      pushUrlOld: null,
      name: '',
      url: '',
      pushUrl: '',
      fetchAfter: true
    })

  const openEdit = (r: { name: string; url: string | null; pushUrl: string | null }): void =>
    setForm({
      mode: 'edit',
      nameOld: r.name,
      urlOld: r.url,
      pushUrlOld: r.pushUrl,
      name: r.name,
      url: r.url ?? '',
      pushUrl: r.pushUrl ?? '',
      fetchAfter: false
    })

  const submit = async (): Promise<void> => {
    if (form === null) return
    const action: GitAction =
      form.mode === 'add'
        ? {
            kind: 'add-remote',
            name: form.name.trim(),
            url: form.url.trim(),
            pushUrl: form.pushUrl.trim() === '' ? null : form.pushUrl.trim(),
            fetchAfter: form.fetchAfter
          }
        : {
            kind: 'edit-remote',
            nameOld: form.nameOld,
            nameNew: form.name.trim(),
            urlOld: form.urlOld,
            urlNew: form.url.trim() === '' ? null : form.url.trim(),
            pushUrlOld: form.pushUrlOld,
            pushUrlNew: form.pushUrl.trim() === '' ? null : form.pushUrl.trim()
          }
    const label = form.mode === 'add' ? '正在添加远程…' : '正在保存远程修改…'
    if (await runActionsThenReloadConfig(projectPath, [{ action, label }])) setForm(null)
  }

  const remove = (name: string): void =>
    onConfirm({
      message: `确定要删除远程 “${name}” 吗？`,
      actionLabel: '是，删除',
      destructive: true,
      run: () =>
        void runActionsThenReloadConfig(projectPath, [
          { action: { kind: 'delete-remote', name }, label: '正在删除远程…' }
        ])
    })

  const prune = (name: string): void =>
    onConfirm({
      message: `确定要清理远程 “${name}” 上已不存在的远程跟踪引用吗？`,
      actionLabel: '是，清理',
      destructive: false,
      run: () =>
        void runActionsThenReloadConfig(projectPath, [
          { action: { kind: 'prune-remote', name }, label: '正在清理远程…' }
        ])
    })

  return (
    <Section title="远程管理">
      {config.remotes.length === 0 && form === null && (
        <div className={HINT}>此仓库尚未配置任何远程。</div>
      )}
      <div className="space-y-1">
        {config.remotes.map((r) => (
          <div
            key={r.name}
            className="group flex items-center gap-2 rounded px-1 py-0.5 hover:bg-[var(--bg-row-hover)]"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-foreground">{r.name}</div>
              <div
                className="select-text truncate font-mono text-[11px] text-muted-foreground"
                title={r.url ?? undefined}
              >
                {r.url ?? '未设置'}
              </div>
              {r.pushUrl !== null && (
                <div
                  className="select-text truncate font-mono text-[11px] text-muted-foreground"
                  title={r.pushUrl}
                >
                  推送：{r.pushUrl}
                </div>
              )}
            </div>
            <button type="button" title="编辑远程" className={ICON_BTN} onClick={() => openEdit(r)}>
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              title="清理此远程已不存在的远程跟踪引用"
              className={ICON_BTN}
              onClick={() => prune(r.name)}
            >
              <Eraser className="size-3.5" />
            </button>
            <button
              type="button"
              title="删除远程"
              className={ICON_BTN}
              onClick={() => remove(r.name)}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      {form === null ? (
        <Button variant="ghost" size="sm" className="mt-1" onClick={openAdd}>
          <Plus className="size-3.5" /> 添加远程
        </Button>
      ) : (
        <div className="mt-2 space-y-2 rounded border border-[color:var(--separator)] p-2.5">
          <div className="text-[12px] text-muted-foreground">
            {form.mode === 'add' ? '为此仓库添加新的远程：' : `编辑远程 “${form.nameOld}”：`}
          </div>
          <FormRow label="名称">
            <Input
              className="h-7 font-mono"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
            />
          </FormRow>
          <FormRow label="Fetch URL">
            <Input
              className="h-7 font-mono"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
            />
          </FormRow>
          <FormRow label="Push URL">
            <Input
              className="h-7 font-mono"
              value={form.pushUrl}
              onChange={(e) => setForm({ ...form, pushUrl: e.target.value })}
              placeholder="留空则使用 Fetch URL"
            />
          </FormRow>
          {form.mode === 'add' && (
            <label className="flex cursor-pointer select-none items-center gap-1.5 pl-[72px] text-[13px] text-foreground">
              <input
                type="checkbox"
                className="accent-[var(--primary)]"
                checked={form.fetchAfter}
                onChange={(e) => setForm({ ...form, fetchAfter: e.target.checked })}
              />
              添加后立即获取
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setForm(null)}>
              取消
            </Button>
            <Button
              size="sm"
              disabled={form.name.trim() === '' || (form.mode === 'add' && form.url.trim() === '')}
              onClick={() => void submit()}
            >
              {form.mode === 'add' ? '添加远程' : '保存修改'}
            </Button>
          </div>
        </div>
      )}
    </Section>
  )
}

// —— 「Issue 链接」区 ——

/** 把提交信息中的 Issue 编号渲染为超链接的配置（存 settings.issueLinkingConfig，纯展示项不触发重拉）。 */
function IssueSection({ projectPath }: { projectPath: string }): React.JSX.Element {
  const settings = useGit((s) => gitState(s, projectPath).settings)
  const updateSettings = useGit((s) => s.updateSettings)
  const stored = settings?.issueLinkingConfig ?? null
  const storedIssue = stored?.issue ?? null
  const storedUrl = stored?.url ?? null
  const [draft, setDraft] = useState({ issue: '', url: '' })
  const [error, setError] = useState<string | null>(null)

  // 已存配置落桶 / 被移除时同步草稿；只依赖字符串值，避免 settings 换引用清掉编辑中的输入
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 同步外部 store 异步落地的快照到本地草稿
    setDraft({ issue: storedIssue ?? '', url: storedUrl ?? '' })
    setError(null)
  }, [storedIssue, storedUrl])

  const save = (): void => {
    const err = validateIssueLinking(draft.issue, draft.url)
    setError(err)
    if (err !== null) return
    void updateSettings(projectPath, {
      issueLinkingConfig: { issue: draft.issue.trim(), url: draft.url.trim() }
    })
  }

  const removeCfg = (): void => {
    setError(null)
    void updateSettings(projectPath, { issueLinkingConfig: null })
  }

  const dirty = draft.issue !== (storedIssue ?? '') || draft.url !== (storedUrl ?? '')

  return (
    <Section title="Issue 链接">
      <div className={HINT}>
        将提交信息中的 Issue 编号转换为超链接。示例：正则 #(\d+)，URL
        https://github.com/owner/repo/issues/$1。
      </div>
      <div className="mt-1.5 space-y-2">
        <FormRow label="Issue 正则">
          <Input
            className="h-7 font-mono"
            value={draft.issue}
            onChange={(e) => setDraft({ ...draft, issue: e.target.value })}
            placeholder="#(\d+)"
            title="匹配 Issue 编号的正则表达式，须含至少一个捕获组 ( )，捕获内容将代入 Issue URL。"
          />
        </FormRow>
        <FormRow label="Issue URL">
          <Input
            className="h-7 font-mono"
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            placeholder="含 $1 占位符"
            title="Issue 跟踪系统中的 URL，用 $1、$2 等占位符引用正则中捕获的内容。"
          />
        </FormRow>
        {error !== null && (
          <div className="pl-[72px] text-[12px] text-[color:var(--status-failed)]">{error}</div>
        )}
        <div className="flex justify-end gap-2">
          {stored !== null && (
            <Button variant="ghost" size="sm" onClick={removeCfg}>
              移除
            </Button>
          )}
          <Button
            size="sm"
            disabled={!dirty || draft.issue.trim() === '' || draft.url.trim() === ''}
            onClick={save}
          >
            保存
          </Button>
        </div>
      </div>
    </Section>
  )
}
