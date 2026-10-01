// 「添加服务器 / 编辑服务器」对话框（左树「+」菜单「添加服务器…」、服务器行菜单「编辑」）：
// 服务器不绑定任何项目，故挂在 App 根上。添加有两种来源——从 `~/.ssh/config` 勾选（可多选），
// 或手填地址 / 用户名 / 端口 / 私钥 / 密码；DevCube 只写自己的配置，不改 `~/.ssh/config`（ADR-0038）。
// 每台服务器可单独打开「绕开代理直连」（ADR-0039）。
import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { FieldRow, FormDialogShell } from '@renderer/components/ui/form-dialog'
import { INPUT_ICON_BTN, Input } from '@renderer/components/ui/input'
import { SegmentedControl } from '@renderer/components/ui/segmented-control'
import {
  DirectField,
  DuplicateTargetConfirm,
  HostPortFields,
  PasswordField,
  TestConnection,
  TestFailureDialog
} from '@renderer/components/ConnectionForm'
import {
  useConnectionTest,
  usePasswordUnavailableReason,
  type ConnectionTestApi
} from '@renderer/lib/connection-test'
import { useApp } from '@renderer/store'
import { passwordChangesOf, portOfText } from '@shared/connection'
import {
  DEFAULT_SSH_PORT,
  manualTargetError,
  sameServerTarget,
  serverTargetLabel,
  type ServerNode,
  type ServerTarget,
  type ServerTestInput,
  type SshConfigHost
} from '@shared/server'

type ManualTarget = Extract<ServerTarget, { kind: 'manual' }>

const SERVER_TEST: ConnectionTestApi<ServerTestInput> = {
  test: (input) => window.api.testServerConnection(input),
  cancel: () => window.api.cancelServerTest()
}

/** node 缺省为添加，否则编辑它。 */
export function ServerDialog({ node }: { node?: ServerNode }): React.JSX.Element {
  return node ? <EditServerForm node={node} /> : <AddServerForm />
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
    port: portOfText(fields.port),
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
      <HostPortFields
        host={fields.host}
        port={fields.port}
        hostPlaceholder="example.com 或 10.0.0.8"
        autoFocus={autoFocus}
        onChange={set}
      />
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

function AddServerForm(): React.JSX.Element {
  const close = useApp((s) => s.closeConnectionDialog)
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

  // 已登记的别名照样可以勾选（允许重复登记），列表里标出「已添加」，提交时再确认一次
  const addedAliases = new Set(
    servers.flatMap((n) => (n.server.target.kind === 'config' ? [n.server.target.alias] : []))
  )
  const manualTarget = manualTargetOf(fields)
  const passwords = passwordChangesOf(password, remember, false)

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
        ? { target: manualTarget, serverId: null, name, password: passwords.test, direct }
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
  const test = useConnectionTest(testInput, SERVER_TEST)
  const testDisabledReason =
    testInput !== null ? null : source === 'manual' ? disabledReason : '勾选一台主机后可以测试连接'

  const pickedAliases = (hosts ?? []).map((h) => h.alias).filter((alias) => picked.has(alias))
  // 与已登记的重复：勾选的主机里已添加过的，或手填的目标与某台已登记的相同（允许，提交时再确认一次）
  const duplicateMessage =
    disabledReason !== null
      ? null
      : source === 'config'
        ? duplicateAliasesMessage(pickedAliases.filter((alias) => addedAliases.has(alias)))
        : duplicateServerMessage(servers, manualTarget, null, '添加')
  const [confirmingDuplicate, setConfirmingDuplicate] = useState(false)

  const save = (): void => {
    if (source === 'config') {
      void addServers(
        pickedAliases.map((alias) => ({ name: alias, target: { kind: 'config', alias }, direct }))
      )
      return
    }
    void addServers([
      { name: name.trim(), target: manualTarget, password: passwords.saved, direct }
    ])
  }

  const submit = (): void => {
    if (disabledReason !== null) return
    if (duplicateMessage !== null) setConfirmingDuplicate(true)
    else save()
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
      <TestFailureDialog test={test} />
      {confirmingDuplicate && duplicateMessage !== null && (
        <DuplicateTargetConfirm
          message={duplicateMessage}
          confirmLabel="添加"
          onConfirm={() => {
            setConfirmingDuplicate(false)
            save()
          }}
          onCancel={() => setConfirmingDuplicate(false)}
        />
      )}
    </>
  )
}

/** 勾选的主机里已添加过的：「“a”、“b” 已经添加过。仍要再添加一次吗？」；没有则为 null。 */
function duplicateAliasesMessage(aliases: string[]): string | null {
  if (aliases.length === 0) return null
  return `${aliases.map((alias) => `“${alias}”`).join('、')} 已经添加过。仍要再添加一次吗？`
}

/** 手填的目标与某台已登记的服务器（编辑时不算自己）相同：确认提示；没有则为 null。 */
function duplicateServerMessage(
  servers: ServerNode[],
  target: ServerTarget,
  selfId: string | null,
  action: string
): string | null {
  const duplicate = servers.find(
    (n) => n.server.id !== selfId && sameServerTarget(n.server.target, target)
  )
  return duplicate === undefined
    ? null
    : `“${duplicate.server.name}” 连接的是同一台服务器。仍要${action}吗？`
}

/** `~/.ssh/config` 里的主机：别名 + 实际连接信息（按 `ssh -G`），已添加的标出来（仍可再勾选）。 */
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
            className="flex h-8 cursor-pointer select-none items-center gap-2 rounded px-2 text-[13px] hover:bg-[var(--bg-row-hover)]"
          >
            <Checkbox
              checked={picked.has(host.alias)}
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
  const close = useApp((s) => s.closeConnectionDialog)
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
  const disabledReason = target.kind === 'manual' ? manualTargetError(target) : null
  // 目标改成与别的已登记服务器相同：允许，保存时再确认一次（目标没改不问）
  const duplicateMessage =
    disabledReason === null && !sameServerTarget(server.target, target)
      ? duplicateServerMessage(servers, target, server.id, '保存')
      : null
  const [confirmingDuplicate, setConfirmingDuplicate] = useState(false)
  const passwords = passwordChangesOf(password, remember, true)

  const test = useConnectionTest(
    disabledReason === null
      ? { target, serverId: server.id, name, password: passwords.test, direct }
      : null,
    SERVER_TEST
  )

  const save = (): void => {
    void updateServer(server.id, { name: name.trim(), target, password: passwords.saved, direct })
  }

  const submit = (): void => {
    if (disabledReason !== null) return
    if (duplicateMessage !== null) setConfirmingDuplicate(true)
    else save()
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
      <TestFailureDialog test={test} />
      {confirmingDuplicate && duplicateMessage !== null && (
        <DuplicateTargetConfirm
          message={duplicateMessage}
          confirmLabel="保存"
          onConfirm={() => {
            setConfirmingDuplicate(false)
            save()
          }}
          onCancel={() => setConfirmingDuplicate(false)}
        />
      )}
    </>
  )
}
