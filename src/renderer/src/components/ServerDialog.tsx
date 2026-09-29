// 「添加服务器 / 编辑服务器」对话框（左树「+」菜单「添加服务器…」、服务器行菜单「编辑」）：
// 服务器不绑定任何项目，故挂在 App 根上。添加有两种来源——从 `~/.ssh/config` 勾选（可多选），
// 或手填地址 / 用户名 / 端口 / 私钥 / 密码；DevCube 只写自己的配置，不改 `~/.ssh/config`（ADR-0038）。
// 每台服务器可单独打开「绕开代理直连」（ADR-0039）。
import { useCallback, useEffect, useState } from 'react'
import { Check, FolderOpen, LoaderCircle, X } from 'lucide-react'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { ErrorDialog, FieldRow, FormDialogShell } from '@renderer/components/ui/form-dialog'
import { Input } from '@renderer/components/ui/input'
import { PasswordInput } from '@renderer/components/ui/password-input'
import { SegmentedControl } from '@renderer/components/ui/segmented-control'
import { useApp } from '@renderer/store'
import {
  DEFAULT_SSH_PORT,
  manualTargetError,
  sameServerTarget,
  serverTargetLabel,
  supportsSshDirect,
  type PasswordChange,
  type ServerNode,
  type ServerTarget,
  type ServerTestInput,
  type ServerTestResult,
  type SshConfigHost
} from '@shared/server'

type ManualTarget = Extract<ServerTarget, { kind: 'manual' }>

/** 常规图标钮（28px），与 Input（h-7）同行居中；与克隆对话框的目录选择钮同款。 */
const INPUT_ICON_BTN =
  'flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]'

export function ServerDialog(): React.JSX.Element {
  const editing = useApp((s) => s.serverDialog.server)
  return editing ? <EditServerForm node={editing} /> : <AddServerForm />
}

/** 「记住密码」为什么不可用（没有可用的系统钥匙串）；可用或尚未查到时为 null。 */
function usePasswordUnavailableReason(): string | null {
  const [reason, setReason] = useState<string | null>(null)
  useEffect(() => {
    void window.api.getPasswordUnavailableReason().then(setReason)
  }, [])
  return reason
}

/** 手填目标的表单状态；端口按文本存，提交时再解析。 */
interface ManualFields {
  host: string
  user: string
  port: string
  identityFile: string
}

function manualFieldsOf(target: ServerTarget | null): ManualFields {
  if (target?.kind !== 'manual') {
    return { host: '', user: '', port: String(DEFAULT_SSH_PORT), identityFile: '' }
  }
  return {
    host: target.host,
    user: target.user,
    port: String(target.port),
    identityFile: target.identityFile ?? ''
  }
}

function manualTargetOf(fields: ManualFields): ManualTarget {
  const identityFile = fields.identityFile.trim()
  return {
    kind: 'manual',
    host: fields.host.trim(),
    user: fields.user.trim(),
    port: fields.port.trim() === '' ? Number.NaN : Number(fields.port.trim()),
    ...(identityFile === '' ? {} : { identityFile })
  }
}

/** 手填目标的四个字段：地址 + 端口一行，用户名、私钥各一行。 */
function ManualTargetFields({
  fields,
  onChange,
  autoFocus
}: {
  fields: ManualFields
  onChange: (next: ManualFields) => void
  autoFocus?: boolean
}): React.JSX.Element {
  const set = (patch: Partial<ManualFields>): void => onChange({ ...fields, ...patch })
  const pickIdentity = (): void => {
    void window.api.pickSshIdentityFile().then((picked) => {
      if (picked !== null) set({ identityFile: picked })
    })
  }
  return (
    <>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <FieldRow label="地址">
            <Input
              value={fields.host}
              autoFocus={autoFocus}
              placeholder="example.com 或 10.0.0.8"
              className="font-mono"
              onChange={(e) => set({ host: e.target.value })}
            />
          </FieldRow>
        </div>
        <div className="w-20 shrink-0">
          <FieldRow label="端口">
            <Input
              value={fields.port}
              inputMode="numeric"
              className="font-mono"
              onChange={(e) => set({ port: e.target.value })}
            />
          </FieldRow>
        </div>
      </div>
      <FieldRow label="用户名">
        <Input
          value={fields.user}
          placeholder="root"
          className="font-mono"
          onChange={(e) => set({ user: e.target.value })}
        />
      </FieldRow>
      <FieldRow label="私钥">
        <div className="flex items-center gap-1.5">
          <Input
            value={fields.identityFile}
            placeholder="可选"
            className="min-w-0 flex-1 font-mono"
            onChange={(e) => set({ identityFile: e.target.value })}
          />
          <button type="button" title="选择文件" className={INPUT_ICON_BTN} onClick={pickIdentity}>
            <FolderOpen className="size-4" />
          </button>
        </div>
      </FieldRow>
    </>
  )
}

/**
 * 密码字段 +「记住密码」勾选（同 SSH 提问弹窗）：勾着保存才记下，连接时自动填入；取消勾选保存即删掉
 * 记住的密码。系统没有可用钥匙串时整项不可用并说明原因。
 */
function PasswordField({
  value,
  onChange,
  remember,
  onRememberChange,
  unavailableReason,
  placeholder
}: {
  value: string
  onChange: (value: string) => void
  remember: boolean
  onRememberChange: (remember: boolean) => void
  unavailableReason: string | null
  placeholder: string
}): React.JSX.Element {
  return (
    <>
      <FieldRow label="密码">
        <PasswordInput
          value={value}
          disabled={unavailableReason !== null}
          placeholder={unavailableReason === null ? placeholder : '无法记住密码'}
          onChange={(e) => onChange(e.target.value)}
        />
        {unavailableReason !== null && (
          <div className="mt-1 text-[12px] text-muted-foreground">{unavailableReason}</div>
        )}
      </FieldRow>
      {unavailableReason === null && (
        <label className="flex cursor-pointer select-none items-center gap-2 text-[13px] text-foreground">
          <Checkbox checked={remember} onCheckedChange={onRememberChange} />
          <span>记住密码</span>
        </label>
      )}
    </>
  )
}

/** 「绕开代理直连」（ADR-0039）：只在 macOS / Windows 出现——Linux 上普通进程绕不开 TUN。 */
function DirectField({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element | null {
  if (!supportsSshDirect(window.electron.process.platform)) return null
  return (
    <label className="flex cursor-pointer select-none items-center gap-2 text-[13px] text-foreground">
      <Checkbox checked={checked} onCheckedChange={onChange} />
      <span>绕开代理直连</span>
    </label>
  )
}

/**
 * 测试连接：结果只对发起测试时的表单内容有效——内容一改、或又开始测试，旧结果就不再显示。
 * 失败时另弹错误框；closeFailureDialog 只关错误框，结果留着。
 * 对话框关闭时取消还在进行的测试（其间弹出的 ssh 提问随之撤下）。
 */
function useConnectionTest(input: ServerTestInput | null): {
  testing: boolean
  result: Exclude<ServerTestResult, { status: 'canceled' }> | null
  failureDialogOpen: boolean
  start: () => void
  closeFailureDialog: () => void
} {
  const signature = input === null ? null : JSON.stringify(input)
  const [testing, setTesting] = useState(false)
  const [done, setDone] = useState<{
    signature: string
    result: Exclude<ServerTestResult, { status: 'canceled' }>
    failureDialogOpen: boolean
  } | null>(null)

  useEffect(() => () => void window.api.cancelServerTest(), [])
  const closeFailureDialog = useCallback(
    () => setDone((d) => (d === null ? d : { ...d, failureDialogOpen: false })),
    []
  )

  const start = (): void => {
    if (input === null || signature === null) return
    setTesting(true)
    void window.api.testServerConnection(input).then((result) => {
      // 被新一次测试取代：旧结果作废，转圈交给新测试
      if (result.status === 'canceled') return
      setTesting(false)
      setDone({ signature, result, failureDialogOpen: result.status === 'failed' })
    })
  }

  const current = !testing && done !== null && done.signature === signature ? done : null
  return {
    testing,
    result: current?.result ?? null,
    failureDialogOpen: current?.failureDialogOpen === true,
    start,
    closeFailureDialog
  }
}

/**
 * 底栏左侧的「测试连接」：文字按钮（`--link` 色），无底色、无内边距，与正文左缘对齐；
 * 进行中转圈，不能测时置灰、hover 说明原因（不屏蔽指针事件，提示才出得来）。
 * 结果紧跟在按钮右侧同一行，不撑高对话框：成功「连接成功」；失败「连接失败」（hover 看报错），
 * 同时另弹错误框（TestFailureDialog）。
 */
function TestConnection({
  test,
  disabledReason
}: {
  test: ReturnType<typeof useConnectionTest>
  disabledReason: string | null
}): React.JSX.Element {
  const { testing, result, start } = test
  return (
    <>
      <button
        type="button"
        disabled={testing || disabledReason !== null}
        title={disabledReason ?? undefined}
        onClick={start}
        className="inline-flex items-center gap-1.5 text-[13px] text-[color:var(--link)] hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-50"
      >
        {testing && <LoaderCircle className="size-3.5 animate-spin" />}
        测试连接
      </button>
      {result?.status === 'ok' && (
        <span className="flex items-center gap-1 text-[13px] text-[color:var(--status-success)]">
          <Check className="size-3.5" />
          连接成功
        </span>
      )}
      {result?.status === 'failed' && (
        <span
          title={result.message}
          className="flex cursor-default items-center gap-1 text-[13px] text-[color:var(--status-failed)]"
        >
          <X className="size-3.5" />
          连接失败
        </span>
      )}
    </>
  )
}

/**
 * 测试失败：弹错误框给出 ssh 的报错。它叠在服务器对话框之上、与之并列渲染（放进对话框里的话，
 * 在「确定」上按回车会冒泡成对话框的主按钮）；Esc 在捕获阶段先由它收下，只关错误框。
 */
function TestFailureDialog({
  message,
  onClose
}: {
  message: string
  onClose: () => void
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return <ErrorDialog title="连接失败" message={message} onClose={onClose} />
}

function AddServerForm(): React.JSX.Element {
  const close = useApp((s) => s.closeServerDialog)
  const addServers = useApp((s) => s.addServers)
  const servers = useApp((s) => s.servers)
  const unavailableReason = usePasswordUnavailableReason()
  const [source, setSource] = useState<'config' | 'manual'>('config')
  const [hosts, setHosts] = useState<SshConfigHost[] | null>(null)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [name, setName] = useState('')
  const [fields, setFields] = useState<ManualFields>(() => manualFieldsOf(null))
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  // 两种来源共用，对勾选的全部主机生效
  const [direct, setDirect] = useState(false)

  useEffect(() => {
    void window.api.listSshConfigHosts().then(setHosts)
  }, [])

  // 已登记的别名不再提供勾选（登记也不会重复，这里直接标出来）
  const addedAliases = new Set(
    servers.flatMap((n) => (n.server.target.kind === 'config' ? [n.server.target.alias] : []))
  )
  const manualTarget = manualTargetOf(fields)
  // 新登记的服务器没有记住的密码：填了就用它测试；勾着「记住密码」才在添加时记下
  const typedPassword: PasswordChange = password === '' ? undefined : password
  const savedPassword: PasswordChange = remember ? typedPassword : undefined

  let disabledReason: string | null = null
  if (source === 'config') {
    if (picked.size === 0) disabledReason = '请勾选要添加的主机'
  } else {
    disabledReason = manualTargetError(manualTarget)
  }

  // 测试连接只针对一台：手填的那台，或只勾了一台的 SSH 配置主机
  const testInput: ServerTestInput | null =
    source === 'manual'
      ? disabledReason === null
        ? { target: manualTarget, serverId: null, name, password: typedPassword, direct }
        : null
      : picked.size === 1
        ? {
            target: { kind: 'config', alias: [...picked][0]! },
            serverId: null,
            name: '',
            password: undefined,
            direct
          }
        : null
  const test = useConnectionTest(testInput)
  const testDisabledReason =
    testInput !== null ? null : source === 'manual' ? disabledReason : '勾选一台主机后可以测试连接'

  const submit = (): void => {
    if (disabledReason !== null) return
    if (source === 'config') {
      const aliases = (hosts ?? []).map((h) => h.alias).filter((alias) => picked.has(alias))
      void addServers(
        aliases.map((alias) => ({ name: alias, target: { kind: 'config', alias }, direct }))
      )
      return
    }
    void addServers([{ name: name.trim(), target: manualTarget, password: savedPassword, direct }])
  }

  const toggle = (alias: string, on: boolean): void => {
    const next = new Set(picked)
    if (on) next.add(alias)
    else next.delete(alias)
    setPicked(next)
  }

  return (
    <>
      <FormDialogShell
        message="添加服务器："
        buttons={[
          {
            label: '添加',
            disabled: disabledReason !== null,
            title: disabledReason ?? undefined,
            onClick: submit
          }
        ]}
        onCancel={close}
        footerStart={<TestConnection test={test} disabledReason={testDisabledReason} />}
      >
        <SegmentedControl
          value={source}
          onValueChange={(next) => setSource(next as 'config' | 'manual')}
          items={[
            { value: 'config', label: 'SSH 配置' },
            { value: 'manual', label: '手动填写' }
          ]}
        />
        {source === 'config' ? (
          <SshConfigHostList
            hosts={hosts}
            picked={picked}
            addedAliases={addedAliases}
            onToggle={toggle}
          />
        ) : (
          <>
            <FieldRow label="名称">
              <Input
                value={name}
                placeholder={manualTarget.host === '' ? '可选' : serverTargetLabel(manualTarget)}
                onChange={(e) => setName(e.target.value)}
              />
            </FieldRow>
            <ManualTargetFields fields={fields} onChange={setFields} autoFocus />
            <PasswordField
              value={password}
              onChange={setPassword}
              remember={remember}
              onRememberChange={setRemember}
              unavailableReason={unavailableReason}
              placeholder="可选"
            />
          </>
        )}
        <DirectField checked={direct} onChange={setDirect} />
      </FormDialogShell>
      {test.failureDialogOpen && test.result?.status === 'failed' && (
        <TestFailureDialog message={test.result.message} onClose={test.closeFailureDialog} />
      )}
    </>
  )
}

/** `~/.ssh/config` 里的主机：别名 + 实际连接信息（按 `ssh -G`），已添加的置灰。 */
function SshConfigHostList({
  hosts,
  picked,
  addedAliases,
  onToggle
}: {
  hosts: SshConfigHost[] | null
  picked: ReadonlySet<string>
  addedAliases: ReadonlySet<string>
  onToggle: (alias: string, on: boolean) => void
}): React.JSX.Element {
  if (hosts === null) {
    return <div className="py-2 text-[13px] text-muted-foreground">正在读取 ~/.ssh/config…</div>
  }
  if (hosts.length === 0) {
    return (
      <div className="py-2 text-[13px] text-muted-foreground">
        ~/.ssh/config 里没有可直接连接的主机
      </div>
    )
  }
  return (
    <div className="max-h-64 overflow-y-auto rounded border border-[color:var(--border-input)] p-1">
      {hosts.map((host) => {
        const added = addedAliases.has(host.alias)
        const detail = serverTargetLabel({
          kind: 'manual',
          host: host.hostName,
          user: host.user,
          port: host.port
        })
        return (
          <label
            key={host.alias}
            className={
              added
                ? 'flex h-8 select-none items-center gap-2 rounded px-2 text-[13px] opacity-50'
                : 'flex h-8 cursor-pointer select-none items-center gap-2 rounded px-2 text-[13px] hover:bg-[var(--bg-row-hover)]'
            }
          >
            <Checkbox
              checked={added || picked.has(host.alias)}
              disabled={added}
              onCheckedChange={(on) => onToggle(host.alias, on)}
            />
            <span className="shrink-0 text-foreground">{host.alias}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted-foreground">
              {detail}
            </span>
            {added && <span className="shrink-0 text-[12px] text-muted-foreground">已添加</span>}
          </label>
        )
      })}
    </div>
  )
}

function EditServerForm({ node }: { node: ServerNode }): React.JSX.Element {
  const close = useApp((s) => s.closeServerDialog)
  const updateServer = useApp((s) => s.updateServer)
  const servers = useApp((s) => s.servers)
  const unavailableReason = usePasswordUnavailableReason()
  const { server } = node
  const [name, setName] = useState(server.name)
  const [fields, setFields] = useState<ManualFields>(() => manualFieldsOf(server.target))
  const [password, setPassword] = useState('')
  // 勾选状态如实反映是否已记住：默认不勾，已记住的勾着（否则直接保存会把它删掉）
  const [remember, setRemember] = useState(node.hasPassword)
  const [direct, setDirect] = useState(server.direct)

  const target: ServerTarget =
    server.target.kind === 'config' ? server.target : manualTargetOf(fields)
  const disabledReason =
    (target.kind === 'manual' ? manualTargetError(target) : null) ??
    (servers.some((n) => n.server.id !== server.id && sameServerTarget(n.server.target, target))
      ? '已有连接目标相同的服务器'
      : null)
  // 保存：勾着「记住密码」时，填了新密码即换成它、没填则沿用记住的；取消勾选即删掉记住的。
  // 测试：填了就用填的；没填时勾着才用记住的。
  const typedPassword: PasswordChange = password === '' ? undefined : password
  const savedPassword: PasswordChange = remember ? typedPassword : null
  const testPassword: PasswordChange = typedPassword ?? (remember ? undefined : null)

  const test = useConnectionTest(
    disabledReason === null
      ? { target, serverId: server.id, name, password: testPassword, direct }
      : null
  )

  const submit = (): void => {
    if (disabledReason !== null) return
    void updateServer(server.id, { name: name.trim(), target, password: savedPassword, direct })
  }

  return (
    <>
      <FormDialogShell
        message="编辑服务器："
        buttons={[
          {
            label: '保存',
            disabled: disabledReason !== null,
            title: disabledReason ?? undefined,
            onClick: submit
          }
        ]}
        onCancel={close}
        footerStart={<TestConnection test={test} disabledReason={disabledReason} />}
      >
        <FieldRow label="名称">
          <Input
            value={name}
            autoFocus
            placeholder={serverTargetLabel(target)}
            onChange={(e) => setName(e.target.value)}
          />
        </FieldRow>
        {server.target.kind === 'config' ? (
          <FieldRow label="SSH 配置中的主机">
            <div className="select-text font-mono text-[13px] text-foreground">
              {server.target.alias}
            </div>
          </FieldRow>
        ) : (
          <ManualTargetFields fields={fields} onChange={setFields} />
        )}
        <PasswordField
          value={password}
          onChange={setPassword}
          remember={remember}
          onRememberChange={setRemember}
          unavailableReason={unavailableReason}
          placeholder={node.hasPassword && remember ? '已记住，留空则不修改' : '可选'}
        />
        <DirectField checked={direct} onChange={setDirect} />
      </FormDialogShell>
      {test.failureDialogOpen && test.result?.status === 'failed' && (
        <TestFailureDialog message={test.result.message} onClose={test.closeFailureDialog} />
      )}
    </>
  )
}
