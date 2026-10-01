import { useState } from 'react'
import { FolderOpen, Plus, Trash2 } from 'lucide-react'
import { ConfigDialogFrame, Field } from '@renderer/components/ConfigDialogFrame'
import { DataSourceConfigDialog } from '@renderer/components/DataSourceConfigDialog'
import { INPUT_ICON_BTN, Input } from '@renderer/components/ui/input'
import { useApp } from '@renderer/store'
import type { CommandRunConfig, EditableRunConfig, RemoteRunConfig } from '@shared/types'
import { entryKindOfKey, serverIdOfEntryKey } from '@shared/tree-entry'

type EnvRow = [string, string]

/** 新建 / 编辑配置：按所属条目分派——数据源上的配置为 SQL（Redis 为命令）表单，其余为命令配置表单。 */
export function ConfigDialog({
  ownerKey,
  config
}: {
  /** 所属条目：Project 路径、`server:<id>` 或 `datasource:<id>` */
  ownerKey: string
  config?: EditableRunConfig
}): React.JSX.Element {
  if (entryKindOfKey(ownerKey) === 'dataSource') {
    return (
      <DataSourceConfigDialog
        ownerKey={ownerKey}
        config={config?.kind === 'dataSource' ? config : undefined}
      />
    )
  }
  return (
    <CommandConfigDialog
      ownerKey={ownerKey}
      config={config?.kind === 'dataSource' ? undefined : config}
    />
  )
}

/** 命令配置（本机或服务器上）。 */
function CommandConfigDialog({
  ownerKey,
  config
}: {
  /** 所属条目：Project 路径或 `server:<id>` */
  ownerKey: string
  config?: CommandRunConfig | RemoteRunConfig
}): React.JSX.Element {
  const close = useApp((s) => s.closeDialog)
  const save = useApp((s) => s.saveCommandConfig)
  // 服务器上的命令型：在服务器上执行，工作目录是服务器上的目录（不能用本机的目录选择器）
  const serverId = serverIdOfEntryKey(ownerKey)

  const [name, setName] = useState(config?.name ?? '')
  const [command, setCommand] = useState(config?.command ?? '')
  const [cwd, setCwd] = useState(config?.cwd ?? '')
  const [envRows, setEnvRows] = useState<EnvRow[]>(Object.entries(config?.env ?? {}) as EnvRow[])

  const valid = name.trim() !== '' && command.trim() !== ''

  const updateRow = (index: number, col: 0 | 1, value: string): void => {
    setEnvRows((rows) =>
      rows.map((row, i) => (i === index ? (col === 0 ? [value, row[1]] : [row[0], value]) : row))
    )
  }

  const submit = (): void => {
    if (!valid) return
    const env = Object.fromEntries(
      envRows.filter(([k]) => k.trim() !== '').map(([k, v]) => [k.trim(), v])
    )
    const fields = {
      name: name.trim(),
      command: command.trim(),
      cwd: cwd.trim() || undefined,
      env: Object.keys(env).length ? env : undefined
    }
    save(
      serverId === null
        ? { kind: 'command', projectPath: ownerKey, ...fields }
        : { kind: 'remote', serverId, ...fields },
      config?.id
    )
  }

  return (
    <ConfigDialogFrame
      title={config ? '编辑命令配置' : '新建命令配置'}
      className="w-[440px]"
      valid={valid}
      onClose={close}
      onSubmit={submit}
    >
      <Field label="名称">
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label="命令">
        <Input value={command} onChange={(e) => setCommand(e.target.value)} className="font-mono" />
      </Field>
      <Field label="工作目录">
        {serverId === null ? (
          <div className="flex items-center gap-1.5">
            <Input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="相对项目根，留空即项目根"
              className="min-w-0 flex-1 font-mono"
            />
            <button
              type="button"
              title="选择目录"
              className={INPUT_ICON_BTN}
              onClick={() => {
                void window.api.pickConfigCwd(ownerKey, cwd.trim() || undefined).then((picked) => {
                  if (picked !== null) setCwd(picked)
                })
              }}
            >
              <FolderOpen className="size-4" />
            </button>
          </div>
        ) : (
          <Input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="服务器上的目录，留空即登录后的目录"
            className="font-mono"
          />
        )}
      </Field>
      <Field label="环境变量">
        <div className="space-y-1.5">
          {envRows.map((row, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                value={row[0]}
                onChange={(e) => updateRow(i, 0, e.target.value)}
                placeholder="KEY"
                className="font-mono"
              />
              <Input
                value={row[1]}
                onChange={(e) => updateRow(i, 1, e.target.value)}
                placeholder="value"
                className="font-mono"
              />
              <button
                type="button"
                title="删除变量"
                className={INPUT_ICON_BTN}
                onClick={() => setEnvRows((rows) => rows.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-[color:var(--fg-icon)]"
            onClick={() => setEnvRows((rows) => [...rows, ['', '']])}
          >
            <Plus className="size-3" /> 添加变量
          </button>
        </div>
      </Field>
    </ConfigDialogFrame>
  )
}
