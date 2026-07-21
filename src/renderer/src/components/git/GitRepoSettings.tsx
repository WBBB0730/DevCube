// 仓库设置面板（toolbar-widgets §4）：外壳与应用设置共用 SettingsModal。
// 三个区块 —— 隐藏的远程、用户信息、远程管理（三态开关与提交排序已移至工具栏的视图选项
// Popover，见 GitViewOptions）。用户信息与远程 CRUD 走 runAction（进行中遮罩 / 错误框由
// GitDialogs 统一呈现），成功后重拉 config。控件用 shadcn Checkbox / RadioGroup。
import { useEffect, useRef, useState } from 'react'
import { Eraser, Pencil, Plus, Trash2 } from 'lucide-react'
import { type GitAction } from '@shared/git'
import { gitState, useGit } from '@renderer/git-store'
import { SettingsModal } from '@renderer/components/SettingsModal'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group'

// —— 纯逻辑 ——

/** 切换某 remote 的隐藏态后的 hideRemotes 新数组（幂等：重复勾选不产生重复项）。 */
function nextHideRemotes(hideRemotes: string[], remote: string, hidden: boolean): string[] {
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
    <SettingsModal
      title="仓库设置"
      onClose={onClose}
      className="relative max-h-[85vh] w-[560px]"
    >
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-3">
        <HiddenRemotesSection projectPath={projectPath} />
        <UserSection projectPath={projectPath} onConfirm={setConfirm} />
        <RemotesSection projectPath={projectPath} onConfirm={setConfirm} />
      </div>
      {confirm !== null && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/40"
          onClick={() => setConfirm(null)}
        >
          <div
            className="w-96 rounded-xl border border-[color:var(--border-input)] bg-panel p-4 shadow-xl"
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
    </SettingsModal>
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
            <Checkbox
              checked={hidden.includes(r)}
              onCheckedChange={(checked) =>
                void updateSettings(projectPath, {
                  hideRemotes: nextHideRemotes(hidden, r, checked)
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
            <RadioGroup
              className="flex-row items-center gap-3"
              value={form.location}
              onValueChange={(v) => setForm({ ...form, location: v as 'local' | 'global' })}
            >
              <label className="flex cursor-pointer select-none items-center gap-1.5 text-[13px] text-foreground">
                <RadioGroupItem value="local" />
                本仓库
              </label>
              <label
                className="flex cursor-pointer select-none items-center gap-1.5 text-[13px] text-foreground"
                title="将该用户名与邮箱全局用于所有 Git 仓库（可按仓库覆盖）。"
              >
                <RadioGroupItem value="global" />
                全局
              </label>
            </RadioGroup>
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
              <Checkbox
                checked={form.fetchAfter}
                onCheckedChange={(checked) => setForm({ ...form, fetchAfter: checked })}
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
