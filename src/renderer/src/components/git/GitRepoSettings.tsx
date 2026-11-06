// 仓库设置面板（toolbar-widgets §4）：外壳与应用设置共用 SettingsModal（有文本输入，点遮罩不关）。
// 版式同拉取 / 推送对话框的表单：一列字段（FieldRow：12px 灰色标签在上、控件在下，说明放在标签后的 ⓘ 里）；
// 字段距 20px 同配置对话框（同为 SettingsModal 外壳）
// ——用户信息、远程、整合方式、拉取与推送（「拉取时不显示窗口」「推送时不显示窗口」两个勾选）、工作树存放目录（图谱显示哪些远程在
// 工具栏的视图选项里，见 GitViewOptions）。编辑用户信息、添加 / 编辑远程
// 是叠在面板上的小对话框，移除 / 删除 / 清理先确认；动作走 runAction（进行中遮罩 / 错误框由 GitDialogs
// 统一呈现），成功后重拉 config。
import { useEffect, useState } from 'react'
import { Eraser, Pencil, Trash2 } from 'lucide-react'
import {
  GIT_PULL_MODE_LABEL,
  defaultWorktreeDirectory,
  resolveWorktreePath,
  worktreeAnchorPath,
  type GitAction,
  type GitPullMode,
  type GitRepoConfig
} from '@shared/git'
import { gitState, runActionsThenReloadConfig, useGit } from '@renderer/git-store'
import { SettingsModal } from '@renderer/components/SettingsModal'
import { Button } from '@renderer/components/ui/button'
import { CHOICE_ROW, Checkbox } from '@renderer/components/ui/checkbox'
import { ConfirmDialog, FieldRow, FormDialogShell } from '@renderer/components/ui/form-dialog'
import { Input } from '@renderer/components/ui/input'
import { RepoUrlInput } from '@renderer/components/RepoUrlInput'
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group'
import { TOOLBAR_BTN } from '@renderer/components/ui/toolbar'

// —— 私有类型与常量 ——

type Remote = GitRepoConfig['remotes'][number]

/** 叠在面板上的弹窗（同一时刻至多一个）：确认（移除 / 删除 / 清理），或编辑用户信息、添加 / 编辑远程。 */
type Overlay =
  | {
      kind: 'confirm'
      title: string
      message?: string
      actionLabel: string
      destructive: boolean
      run: () => void
    }
  | { kind: 'user' }
  /** remote = null 为添加 */
  | { kind: 'remote'; remote: Remote | null }

/** 整合方式单选里「跟随 git 配置」的取值（存为 pullIntegrationMode = null） */
const FOLLOW_GIT_CONFIG = 'git-config'

const PULL_MODE_ITEMS = [
  { value: FOLLOW_GIT_CONFIG, label: '跟随 git 配置' },
  ...(['merge', 'rebase', 'squash'] as const).map((m) => ({
    value: m,
    label: GIT_PULL_MODE_LABEL[m]
  }))
]

// —— 面板本体 ——

/** 仓库设置面板：open=false 时不渲染；打开即重拉仓库 config（用户信息 / 远程依赖它），拉到前整面板显示加载中。 */
export function GitRepoSettings({
  repoPath,
  open,
  onClose
}: {
  repoPath: string
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const loadRepoConfig = useGit((s) => s.loadRepoConfig)
  const config = useGit((s) => gitState(s, repoPath).config)
  const [overlay, setOverlay] = useState<Overlay | null>(null)

  // 打开即重拉 config；重开时清掉上次残留的弹窗
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 面板打开是外部驱动的一次性复位，非渲染热路径
    setOverlay(null)
    void loadRepoConfig(repoPath)
  }, [open, repoPath, loadRepoConfig])

  if (!open) return null
  const closeOverlay = (): void => setOverlay(null)

  return (
    <SettingsModal title="仓库设置" onClose={onClose} className="max-h-[85vh] w-[560px]">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 text-[13px]">
        {config === null ? (
          <div className="text-[color:var(--fg-muted)]">正在加载…</div>
        ) : (
          <div className="space-y-5">
            <UserFields repoPath={repoPath} config={config} onOverlay={setOverlay} />
            <RemotesField repoPath={repoPath} config={config} onOverlay={setOverlay} />
            {config.remotes.length > 0 && <PullPushFields repoPath={repoPath} />}
            <WorktreeField repoPath={repoPath} />
          </div>
        )}
      </div>
      {overlay?.kind === 'confirm' && (
        <ConfirmDialog
          title={overlay.title}
          message={overlay.message}
          buttons={[
            {
              label: overlay.actionLabel,
              destructive: overlay.destructive,
              onClick: () => {
                closeOverlay()
                overlay.run()
              }
            }
          ]}
          onCancel={closeOverlay}
        />
      )}
      {overlay?.kind === 'user' && config !== null && (
        <UserInfoDialog repoPath={repoPath} config={config} onClose={closeOverlay} />
      )}
      {overlay?.kind === 'remote' && config !== null && (
        <RemoteDialog
          repoPath={repoPath}
          config={config}
          remote={overlay.remote}
          onClose={closeOverlay}
        />
      )}
    </SettingsModal>
  )
}

// —— 通用小件 ——

/** 一项 user.* 配置的生效值（local 优先）与来源；两级都没有为 null。 */
function effectiveConfig(v: {
  local: string | null
  global: string | null
}): { value: string; scope: '本仓库' | '全局' } | null {
  if (v.local !== null) return { value: v.local, scope: '本仓库' }
  if (v.global !== null) return { value: v.global, scope: '全局' }
  return null
}

/**
 * 提交身份一行「名字 <邮箱>」（同提交详情的作者行）+ 12px 来源标注；缺的一半为灰字「未设置用户名 / 邮箱」，
 * 两者都没有只写「未设置」；两项来源不同时标注分别写明。
 */
function IdentityLine({ config }: { config: GitRepoConfig }): React.JSX.Element {
  const name = effectiveConfig(config.user.name)
  const email = effectiveConfig(config.user.email)
  if (name === null && email === null) return <div className="text-muted-foreground">未设置</div>
  const scope =
    name !== null && email !== null && name.scope !== email.scope
      ? `用户名：${name.scope}，邮箱：${email.scope}`
      : (name ?? email)?.scope
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 select-text truncate text-foreground">
        {name !== null ? name.value : <span className="text-muted-foreground">未设置用户名</span>}{' '}
        {email !== null ? (
          `<${email.value}>`
        ) : (
          <span className="text-muted-foreground">未设置邮箱</span>
        )}
      </span>
      <span className="shrink-0 text-[12px] text-muted-foreground">（{scope}）</span>
    </div>
  )
}

// —— 用户信息 ——

/** local / global 的 user.name / user.email（local 优先）；编辑走小对话框，移除先确认。 */
function UserFields({
  repoPath,
  config,
  onOverlay
}: {
  repoPath: string
  config: GitRepoConfig
  onOverlay: (o: Overlay) => void
}): React.JSX.Element {
  const { name, email } = config.user
  const hasAny =
    name.local !== null || name.global !== null || email.local !== null || email.global !== null

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
    onOverlay({
      kind: 'confirm',
      title: `移除${loc === 'local' ? '本仓库' : '全局'}配置的用户名与邮箱？`,
      actionLabel: '移除',
      destructive: true,
      run: () => void runActionsThenReloadConfig(repoPath, steps)
    })
  }

  return (
    // 用户名与邮箱合成一行身份（不再各带小标签），编辑 / 移除在字段内底部，一看即知作用于两者
    <FieldRow label="用户信息">
      <IdentityLine config={config} />
      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onOverlay({ kind: 'user' })}
        >
          编辑
        </Button>
        {hasAny && (
          <Button type="button" size="sm" variant="secondary" onClick={remove}>
            移除
          </Button>
        )}
      </div>
    </FieldRow>
  )
}

/** 编辑用户信息（叠在面板上）：写入位置默认 = 本地有覆盖则本仓库，否则全局。 */
function UserInfoDialog({
  repoPath,
  config,
  onClose
}: {
  repoPath: string
  config: GitRepoConfig
  onClose: () => void
}): React.JSX.Element {
  const { name, email } = config.user
  const [form, setForm] = useState<{ name: string; email: string; location: 'local' | 'global' }>(
    () => ({
      name: name.local ?? name.global ?? '',
      email: email.local ?? email.global ?? '',
      location: name.local === null && email.local === null ? 'global' : 'local'
    })
  )

  const submit = async (): Promise<void> => {
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
      // 写全局且本地存在覆盖时顺带清掉本地值，否则全局值不生效
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
    if (await runActionsThenReloadConfig(repoPath, steps)) onClose()
  }

  return (
    <FormDialogShell
      message="编辑用户信息："
      buttons={[
        {
          label: '保存',
          disabled: form.name.trim() === '' || form.email.trim() === '',
          onClick: () => void submit()
        }
      ]}
      onCancel={onClose}
    >
      <FieldRow label="用户名">
        <Input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          autoFocus
        />
      </FieldRow>
      <FieldRow label="邮箱">
        <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </FieldRow>
      <FieldRow label="写入位置">
        <RadioGroup
          className="flex-row items-center gap-4"
          value={form.location}
          onValueChange={(v) => setForm({ ...form, location: v as 'local' | 'global' })}
        >
          <label className={CHOICE_ROW}>
            <RadioGroupItem value="local" />
            本仓库
          </label>
          <label
            className={CHOICE_ROW}
            title="将该用户名与邮箱全局用于所有 Git 仓库（可按仓库覆盖）。"
          >
            <RadioGroupItem value="global" />
            全局
          </label>
        </RadioGroup>
      </FieldRow>
    </FormDialogShell>
  )
}

// —— 远程 ——

/** config.remotes 列表（行悬停出编辑 / 清理 / 删除）+ 添加；添加 / 编辑走小对话框，删除 / 清理先确认。 */
function RemotesField({
  repoPath,
  config,
  onOverlay
}: {
  repoPath: string
  config: GitRepoConfig
  onOverlay: (o: Overlay) => void
}): React.JSX.Element {
  const remove = (name: string): void =>
    onOverlay({
      kind: 'confirm',
      title: `删除远程 “${name}”？`,
      actionLabel: '删除',
      destructive: true,
      run: () =>
        void runActionsThenReloadConfig(repoPath, [
          { action: { kind: 'delete-remote', name }, label: '正在删除远程…' }
        ])
    })

  const prune = (name: string): void =>
    onOverlay({
      kind: 'confirm',
      title: `清理远程 “${name}” 的跟踪引用？`,
      message: '远程上已不存在的分支，它们在本地的远程跟踪引用会被删除。',
      actionLabel: '清理',
      destructive: false,
      run: () =>
        void runActionsThenReloadConfig(repoPath, [
          { action: { kind: 'prune-remote', name }, label: '正在清理远程…' }
        ])
    })

  return (
    <FieldRow label="远程">
      {/* 列表框（同服务器对话框的主机列表）：没有远程时框里显示「暂无远程」 */}
      <div className="rounded border border-[color:var(--border-input)] p-1">
        {config.remotes.length === 0 ? (
          <div className="px-2 py-1.5 text-muted-foreground">暂无远程</div>
        ) : (
          config.remotes.map((r) => (
            <div
              key={r.name}
              className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-row-hover"
            >
              <div className="min-w-0 flex-1">
                <div className="text-foreground">{r.name}</div>
                <div
                  className="select-text truncate font-mono text-[12px] text-muted-foreground"
                  title={r.url ?? undefined}
                >
                  {r.url ?? '未设置'}
                </div>
                {r.pushUrl !== null && (
                  <div
                    className="select-text truncate font-mono text-[12px] text-muted-foreground"
                    title={r.pushUrl}
                  >
                    推送：{r.pushUrl}
                  </div>
                )}
              </div>
              {/* 平时隐形占位（不随悬停改变截断），行悬停或键盘聚焦到其中时出现 */}
              <div className="flex shrink-0 items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                <button
                  type="button"
                  title="编辑远程"
                  className={TOOLBAR_BTN}
                  onClick={() => onOverlay({ kind: 'remote', remote: r })}
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  title="清理此远程已不存在的远程跟踪引用"
                  className={TOOLBAR_BTN}
                  onClick={() => prune(r.name)}
                >
                  <Eraser className="size-3.5" />
                </button>
                <button
                  type="button"
                  title="删除远程"
                  className={TOOLBAR_BTN}
                  onClick={() => remove(r.name)}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="mt-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onOverlay({ kind: 'remote', remote: null })}
        >
          添加远程
        </Button>
      </div>
    </FieldRow>
  )
}

/**
 * 添加 / 编辑远程（叠在面板上）。edit-remote 需要 old/new 全量传，主进程按差异生成命令序列。
 * 添加时仓库还没有 origin 的，名称占位为 origin、留空即用它（同工作树存放目录「占位即默认值」）。
 */
function RemoteDialog({
  repoPath,
  config,
  remote,
  onClose
}: {
  repoPath: string
  config: GitRepoConfig
  remote: Remote | null
  onClose: () => void
}): React.JSX.Element {
  const [form, setForm] = useState(() => ({
    name: remote?.name ?? '',
    url: remote?.url ?? '',
    pushUrl: remote?.pushUrl ?? '',
    fetchAfter: true
  }))
  const defaultName =
    remote === null && !config.remotes.some((r) => r.name === 'origin') ? 'origin' : undefined
  const name = form.name.trim() === '' ? (defaultName ?? '') : form.name.trim()

  const submit = async (): Promise<void> => {
    const pushUrl = form.pushUrl.trim() === '' ? null : form.pushUrl.trim()
    const action: GitAction =
      remote === null
        ? {
            kind: 'add-remote',
            name,
            url: form.url.trim(),
            pushUrl,
            fetchAfter: form.fetchAfter
          }
        : {
            kind: 'edit-remote',
            nameOld: remote.name,
            nameNew: name,
            urlOld: remote.url,
            urlNew: form.url.trim() === '' ? null : form.url.trim(),
            pushUrlOld: remote.pushUrl,
            pushUrlNew: pushUrl
          }
    const label = remote === null ? '正在添加远程…' : '正在保存远程修改…'
    if (await runActionsThenReloadConfig(repoPath, [{ action, label }])) onClose()
  }

  return (
    <FormDialogShell
      message={remote === null ? '添加远程：' : `编辑远程 “${remote.name}”：`}
      buttons={[
        {
          label: remote === null ? '添加' : '保存',
          disabled: name === '' || (remote === null && form.url.trim() === ''),
          onClick: () => void submit()
        }
      ]}
      onCancel={onClose}
    >
      <FieldRow label="名称">
        <Input
          className="font-mono"
          value={form.name}
          placeholder={defaultName}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          autoFocus
        />
      </FieldRow>
      <FieldRow label="Fetch URL">
        <RepoUrlInput value={form.url} onChange={(url) => setForm({ ...form, url })} />
      </FieldRow>
      <FieldRow label="Push URL">
        <RepoUrlInput
          value={form.pushUrl}
          placeholder="留空则使用 Fetch URL"
          onChange={(pushUrl) => setForm({ ...form, pushUrl })}
        />
      </FieldRow>
      {remote === null && (
        <label className={CHOICE_ROW}>
          <Checkbox
            checked={form.fetchAfter}
            onCheckedChange={(checked) => setForm({ ...form, fetchAfter: checked })}
          />
          添加后立即获取
        </label>
      )}
    </FormDialogShell>
  )
}

// —— 拉取与推送 ——

/**
 * 拉取的整合方式与工具栏拉取 / 推送钮的行为（都按仓库存，变更即写）：整合方式即拉取对话框的记忆值
 * （「跟随 git 配置」= 清空记忆），两个勾选即两张对话框里的「不再显示此窗口」。无远程时不渲染。
 */
function PullPushFields({ repoPath }: { repoPath: string }): React.JSX.Element {
  const settings = useGit((s) => gitState(s, repoPath).settings)
  const updateSettings = useGit((s) => s.updateSettings)
  return (
    <>
      {/* 同拉取对话框的「整合方式」字段，多一项「跟随 git 配置」 */}
      <FieldRow label="整合方式">
        <RadioGroup
          value={settings?.pullIntegrationMode ?? FOLLOW_GIT_CONFIG}
          onValueChange={(v) =>
            void updateSettings(repoPath, {
              pullIntegrationMode: v === FOLLOW_GIT_CONFIG ? null : (v as GitPullMode)
            })
          }
        >
          {PULL_MODE_ITEMS.map((item) => (
            <label key={item.value} className={CHOICE_ROW}>
              <RadioGroupItem value={item.value} />
              {item.label}
            </label>
          ))}
        </RadioGroup>
      </FieldRow>
      {/* 两个勾选的间距同上方单选组（gap-2） */}
      <FieldRow label="拉取与推送">
        <div className="flex flex-col gap-2">
          <label className={CHOICE_ROW}>
            <Checkbox
              checked={settings?.pullSkipDialog ?? false}
              onCheckedChange={(c) => void updateSettings(repoPath, { pullSkipDialog: c })}
            />
            拉取时不显示窗口
          </label>
          <label className={CHOICE_ROW}>
            <Checkbox
              checked={settings?.pushSkipDialog ?? false}
              onCheckedChange={(c) => void updateSettings(repoPath, { pushSkipDialog: c })}
            />
            推送时不显示窗口
          </label>
        </div>
      </FieldRow>
    </>
  )
}

// —— 工作树存放目录 ——

/**
 * 新工作树的存放目录：相对主工作树解析（也可绝对），留空 = 默认 `../<主项目名>.worktrees`
 * （与 VS Code / GitLens 约定一致）。失焦 / 回车即保存（非数据键，不触发图谱重载）；
 * 标签后的 ⓘ 里说明解析规则，并实时给出按当前值算出的示例路径。
 */
function WorktreeField({ repoPath }: { repoPath: string }): React.JSX.Element {
  const settings = useGit((s) => gitState(s, repoPath).settings)
  const worktrees = useGit((s) => gitState(s, repoPath).worktrees)
  const updateSettings = useGit((s) => s.updateSettings)
  /** 编辑中的草稿；null = 未编辑，显示已保存值 */
  const [draft, setDraft] = useState<string | null>(null)
  const saved = settings?.worktreeDirectory ?? ''
  const value = draft ?? saved
  const anchor = worktreeAnchorPath(worktrees, repoPath)
  const preview = resolveWorktreePath(anchor, value === '' ? null : value, '<名称>')

  const commit = (): void => {
    if (draft === null) return
    const next = draft.trim()
    setDraft(null)
    if (next === saved) return
    void updateSettings(repoPath, { worktreeDirectory: next === '' ? null : next })
  }

  return (
    <FieldRow
      label="工作树存放目录"
      info={`新建的工作树放在这里：相对主工作树解析，也可填绝对路径；留空使用默认位置。\n示例：${preview}`}
    >
      <Input
        value={value}
        placeholder={defaultWorktreeDirectory(anchor)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
      />
    </FieldRow>
  )
}
