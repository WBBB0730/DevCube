// 「添加数据源 / 编辑数据源」对话框（左树「+」菜单「添加数据源…」、数据源行菜单「编辑」）：
// 数据源不绑定任何项目，故挂在 App 根上（ADR-0043）。可以粘贴连接串自动拆成各项；加密默认自动处理，
// 只有连接串写明了要求时才显示出来（可清除）；Redis 的协议不能协商加密，单独有「TLS」勾选。
import { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { CHOICE_ROW, Checkbox } from '@renderer/components/ui/checkbox'
import { FieldRow, FormDialogShell } from '@renderer/components/ui/form-dialog'
import { INPUT_ICON_BTN, Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
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
  DATA_SOURCE_KIND_LABELS,
  DATA_SOURCE_KINDS,
  DEFAULT_DATA_SOURCE_PORTS,
  SSL_MODE_LABELS,
  dataSourceTargetError,
  defaultDataSourceName,
  parseDataSourceUrl,
  sameDataSourceTarget,
  type DataSourceKind,
  type DataSourceNode,
  type DataSourceTarget,
  type DataSourceTestInput,
  type SslMode
} from '@shared/data-source'

const DATA_SOURCE_TEST: ConnectionTestApi<DataSourceTestInput> = {
  test: (input) => window.api.testDataSourceConnection(input),
  cancel: () => window.api.cancelDataSourceTest()
}

/** 表单状态：端口按文本存，提交时再解析；各类型的字段都留着，切换类型不丢已填的内容。 */
interface Fields {
  kind: DataSourceKind
  host: string
  port: string
  user: string
  database: string
  file: string
  sslMode: SslMode | null
  tls: boolean
  direct: boolean
}

function defaultPortText(kind: DataSourceKind): string {
  return kind === 'sqlite' ? '' : String(DEFAULT_DATA_SOURCE_PORTS[kind])
}

function fieldsOf(target: DataSourceTarget | null): Fields {
  const kind = target?.kind ?? 'postgresql'
  const base: Fields = {
    kind,
    host: '',
    port: defaultPortText(kind),
    user: '',
    database: '',
    file: '',
    sslMode: null,
    tls: false,
    direct: false
  }
  if (target === null) return base
  if (target.kind === 'sqlite') return { ...base, file: target.file }
  const { host, port, user, database, direct } = target
  const network = { ...base, host, port: String(port), user, database, direct }
  return target.kind === 'redis'
    ? { ...network, tls: target.tls }
    : { ...network, sslMode: target.sslMode }
}

function targetOf(f: Fields): DataSourceTarget {
  if (f.kind === 'sqlite') return { kind: 'sqlite', file: f.file.trim() }
  const network = {
    host: f.host.trim(),
    port: portOfText(f.port),
    user: f.user.trim(),
    database: f.database.trim(),
    direct: f.direct
  }
  return f.kind === 'redis'
    ? { kind: 'redis', tls: f.tls, ...network }
    : { kind: f.kind, sslMode: f.sslMode, ...network }
}

/** 换类型：端口还是上一类型的默认值（或没填）时换成新类型的默认端口，用户改过的不动。 */
function withKind(f: Fields, kind: DataSourceKind): Fields {
  const portUntouched = f.port === '' || f.port === defaultPortText(f.kind)
  return { ...f, kind, port: portUntouched ? defaultPortText(kind) : f.port }
}

/** node 缺省为添加，否则编辑它。 */
export function DataSourceDialog({ node: editing }: { node?: DataSourceNode }): React.JSX.Element {
  const dataSources = useApp((s) => s.dataSources)
  const close = useApp((s) => s.closeConnectionDialog)
  const addDataSource = useApp((s) => s.addDataSource)
  const updateDataSource = useApp((s) => s.updateDataSource)
  const unavailableReason = usePasswordUnavailableReason()
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [name, setName] = useState(editing?.dataSource.name ?? '')
  const [fields, setFields] = useState<Fields>(() => fieldsOf(editing?.dataSource.target ?? null))
  const [password, setPassword] = useState('')
  // 编辑时勾选状态如实反映是否已记住（否则直接保存会把它删掉）
  const [remember, setRemember] = useState(editing?.hasPassword ?? false)
  const set = (patch: Partial<Fields>): void => setFields((f) => ({ ...f, ...patch }))

  const target = targetOf(fields)
  const disabledReason = dataSourceTargetError(target)
  const submitLabel = editing === undefined ? '添加' : '保存'
  // 连接目标与已登记的数据源相同：允许重复，提交时再确认一次（编辑时目标没改不问）
  const duplicateMessage =
    disabledReason === null &&
    (editing === undefined || !sameDataSourceTarget(editing.dataSource.target, target))
      ? duplicateDataSourceMessage(dataSources, target, editing?.dataSource.id ?? null, submitLabel)
      : null
  const [confirmingDuplicate, setConfirmingDuplicate] = useState(false)

  const passwords = passwordChangesOf(password, remember, editing !== undefined)
  const test = useConnectionTest(
    disabledReason === null
      ? { target, dataSourceId: editing?.dataSource.id ?? null, password: passwords.test }
      : null,
    DATA_SOURCE_TEST
  )

  const applyUrl = (text: string): void => {
    setUrl(text)
    if (text.trim() === '') {
      setUrlError(null)
      return
    }
    const parsed = parseDataSourceUrl(text)
    if ('error' in parsed) {
      setUrlError(parsed.error)
      return
    }
    setUrlError(null)
    setFields((f) => ({ ...fieldsOf(parsed.target), direct: f.direct }))
    if (parsed.password !== null) setPassword(parsed.password)
  }

  const save = (): void => {
    const input = { name: name.trim(), target, password: passwords.saved }
    void (editing === undefined
      ? addDataSource(input)
      : updateDataSource(editing.dataSource.id, input))
  }

  const submit = (): void => {
    if (disabledReason !== null) return
    if (duplicateMessage !== null) setConfirmingDuplicate(true)
    else save()
  }

  const pickFile = (): void => {
    void window.api.pickSqliteFile().then((picked) => {
      if (picked !== null) set({ file: picked })
    })
  }

  return (
    <FormDialogShell
      message={editing === undefined ? '添加数据源：' : '编辑数据源：'}
      buttons={[
        {
          label: submitLabel,
          disabled: disabledReason !== null,
          title: disabledReason ?? undefined,
          onClick: submit
        }
      ]}
      onCancel={close}
      footerStart={<TestConnection test={test} disabledReason={disabledReason} />}
    >
      <FieldRow label="连接串">
        <Input
          value={url}
          autoFocus={editing === undefined}
          placeholder="postgres://…"
          className="font-mono"
          onChange={(e) => applyUrl(e.target.value)}
        />
        {urlError !== null && (
          <div className="mt-1 text-[12px] text-[color:var(--status-failed)]">{urlError}</div>
        )}
      </FieldRow>
      <FieldRow label="类型">
        <Select
          value={fields.kind}
          onValueChange={(v) => {
            if (v != null) setFields((f) => withKind(f, v as DataSourceKind))
          }}
          items={DATA_SOURCE_KINDS.map((kind) => ({
            value: kind,
            label: DATA_SOURCE_KIND_LABELS[kind]
          }))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATA_SOURCE_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {DATA_SOURCE_KIND_LABELS[kind]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>
      <FieldRow label="名称">
        <Input
          value={name}
          autoFocus={editing !== undefined}
          placeholder={disabledReason === null ? defaultDataSourceName(target) : '可选'}
          onChange={(e) => setName(e.target.value)}
        />
      </FieldRow>
      {fields.kind === 'sqlite' ? (
        <FieldRow label="文件">
          <div className="flex items-center gap-1.5">
            <Input
              value={fields.file}
              className="min-w-0 flex-1 font-mono"
              onChange={(e) => set({ file: e.target.value })}
            />
            <button type="button" title="选择文件" className={INPUT_ICON_BTN} onClick={pickFile}>
              <FolderOpen className="size-4" />
            </button>
          </div>
        </FieldRow>
      ) : (
        <>
          <HostPortFields
            host={fields.host}
            port={fields.port}
            hostPlaceholder="db.example.com 或 127.0.0.1"
            onChange={set}
          />
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <FieldRow label="用户名">
                <Input
                  value={fields.user}
                  placeholder="可选"
                  className="font-mono"
                  onChange={(e) => set({ user: e.target.value })}
                />
              </FieldRow>
            </div>
            <div className="min-w-0 flex-1">
              <FieldRow label={fields.kind === 'redis' ? '库编号' : '默认库'}>
                <Input
                  value={fields.database}
                  placeholder={fields.kind === 'redis' ? '0' : '可选'}
                  className="font-mono"
                  onChange={(e) => set({ database: e.target.value })}
                />
              </FieldRow>
            </div>
          </div>
          <PasswordField
            value={password}
            onChange={setPassword}
            remember={remember}
            onRememberChange={setRemember}
            unavailableReason={unavailableReason}
            placeholder={editing?.hasPassword && remember ? '已记住，留空则不修改' : '可选'}
          />
          {fields.kind === 'redis' ? (
            <label className={CHOICE_ROW}>
              <Checkbox checked={fields.tls} onCheckedChange={(tls) => set({ tls })} />
              <span>TLS 加密</span>
            </label>
          ) : (
            fields.sslMode !== null && (
              <FieldRow label="加密要求">
                <div className="flex items-center gap-2 text-[13px] text-foreground">
                  <span title="来自连接串">{SSL_MODE_LABELS[fields.sslMode]}</span>
                  <button
                    type="button"
                    className="text-[color:var(--link)] hover:underline"
                    onClick={() => set({ sslMode: null })}
                  >
                    清除
                  </button>
                </div>
              </FieldRow>
            )
          )}
          <DirectField checked={fields.direct} onChange={(direct) => set({ direct })} />
        </>
      )}
      <TestFailureDialog test={test} />
      {confirmingDuplicate && duplicateMessage !== null && (
        <DuplicateTargetConfirm
          message={duplicateMessage}
          confirmLabel={submitLabel}
          onConfirm={() => {
            setConfirmingDuplicate(false)
            save()
          }}
          onCancel={() => setConfirmingDuplicate(false)}
        />
      )}
    </FormDialogShell>
  )
}

/** 连接目标与某个已登记的数据源（编辑时不算自己）相同：确认提示；没有则为 null。 */
function duplicateDataSourceMessage(
  dataSources: DataSourceNode[],
  target: DataSourceTarget,
  selfId: string | null,
  action: string
): string | null {
  const duplicate = dataSources.find(
    (n) => n.dataSource.id !== selfId && sameDataSourceTarget(n.dataSource.target, target)
  )
  return duplicate === undefined
    ? null
    : `“${duplicate.dataSource.name}” 连接的是同一个库。仍要${action}吗？`
}
