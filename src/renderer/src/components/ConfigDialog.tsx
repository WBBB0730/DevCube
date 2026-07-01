import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { useApp } from '@renderer/store'

type EnvRow = [string, string]

export function ConfigDialog(): React.JSX.Element {
  const dialog = useApp((s) => s.dialog)
  const close = useApp((s) => s.closeDialog)
  const save = useApp((s) => s.saveCommandConfig)
  const config = dialog.config

  const [name, setName] = useState(config?.name ?? '')
  const [command, setCommand] = useState(config?.command ?? '')
  const [cwd, setCwd] = useState(config?.cwd ?? '')
  const [envRows, setEnvRows] = useState<EnvRow[]>(Object.entries(config?.env ?? {}) as EnvRow[])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const valid = name.trim() !== '' && command.trim() !== ''

  const updateRow = (index: number, col: 0 | 1, value: string): void => {
    setEnvRows((rows) =>
      rows.map((row, i) => (i === index ? (col === 0 ? [value, row[1]] : [row[0], value]) : row))
    )
  }

  const submit = (): void => {
    if (!valid || !dialog.projectPath) return
    const env = Object.fromEntries(
      envRows.filter(([k]) => k.trim() !== '').map(([k, v]) => [k.trim(), v])
    )
    save(
      {
        projectPath: dialog.projectPath,
        name: name.trim(),
        command: command.trim(),
        cwd: cwd.trim() || undefined,
        env: Object.keys(env).length ? env : undefined
      },
      config?.id
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={close}
    >
      <div
        className="w-[440px] rounded border border-[color:var(--border-input)] bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b px-4 py-2.5 text-[13px] text-[color:var(--fg-dialog-title)]">
          {config ? '编辑命令配置' : '新建命令配置'}
        </div>
        <div className="space-y-3 px-4 py-3">
          <Field label="名称">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如 dev server"
              autoFocus
            />
          </Field>
          <Field label="命令">
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="例如 docker compose up"
              className="font-mono"
            />
          </Field>
          <Field label="工作目录">
            <Input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="相对项目根，留空即项目根"
              className="font-mono"
            />
          </Field>
          <Field label="环境变量">
            <div className="space-y-1.5">
              {envRows.map((row, i) => (
                <div key={i} className="flex gap-1.5">
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
                    className="flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-[var(--bg-row-hover)]"
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
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-2.5">
          <Button variant="ghost" onClick={close}>
            取消
          </Button>
          <Button onClick={submit} disabled={!valid}>
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
