// Files 树条目操作弹窗（新建文件 / 新建文件夹 / 重命名 / 删除确认）：走通用小对话框外壳
// （ui/form-dialog，与 Git 对话框族同款）——WebStorm 式提示语 + 输入 + 底部按钮条。
// onSubmit 抛错时弹窗保持打开并就地展示错误；提交中锁死弹窗（含 Esc / 遮罩 / 取消）。
import { useEffect, useRef, useState } from 'react'
import { FormDialogShell } from '@renderer/components/ui/form-dialog'
import { Input } from '@renderer/components/ui/input'

export type FilesEntryDialogRequest =
  | { kind: 'create-file'; dir: string }
  | { kind: 'create-dir'; dir: string }
  | { kind: 'rename'; path: string; isDirectory: boolean }
  | { kind: 'trash'; path: string; isDirectory: boolean }

function baseName(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1)
}

/** Electron invoke 抛错带 "Error invoking remote method 'x': Error: " 前缀，剥掉只留正文。 */
function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '')
}

/** WebStorm 式提示语：完整语句说明目标与动作（B 类外壳无标题栏，提示语即说明）。 */
function messageFor(request: FilesEntryDialogRequest): string {
  switch (request.kind) {
    case 'create-file':
      return `在 “${baseName(request.dir)}” 下新建文件：`
    case 'create-dir':
      return `在 “${baseName(request.dir)}” 下新建文件夹：`
    case 'rename':
      return `将 “${baseName(request.path)}” 重命名为：`
    case 'trash':
      return `将把${request.isDirectory ? '文件夹' : '文件'} “${baseName(request.path)}” 移到回收站。`
  }
}

const PRIMARY_LABEL: Record<FilesEntryDialogRequest['kind'], string> = {
  'create-file': '创建',
  'create-dir': '创建',
  rename: '重命名',
  trash: '删除'
}

export function FilesEntryDialog({
  request,
  onClose,
  onSubmit
}: {
  request: FilesEntryDialogRequest
  onClose: () => void
  /** 确认：新建 / 重命名传输入名，删除传空串；成功由调用方关闭，抛错则留在弹窗展示 */
  onSubmit: (name: string) => Promise<void>
}): React.JSX.Element {
  const isTrash = request.kind === 'trash'
  const initial = request.kind === 'rename' ? baseName(request.path) : ''
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const mountedRequest = useRef(request)

  // 挂载即聚焦；重命名文件预选中主名（不含扩展名），对齐 WebStorm。调用方按请求 key 重挂载。
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    const req = mountedRequest.current
    if (req.kind === 'rename' && !req.isDirectory) {
      const dot = input.value.lastIndexOf('.')
      input.setSelectionRange(0, dot > 0 ? dot : input.value.length)
    } else {
      input.select()
    }
  }, [])

  const submit = (): void => {
    if (busy) return
    const trimmed = name.trim()
    if (!isTrash && trimmed === '') return
    setBusy(true)
    setError(null)
    onSubmit(trimmed).catch((e: unknown) => {
      setError(errorText(e))
      setBusy(false)
    })
  }

  return (
    <FormDialogShell
      message={messageFor(request)}
      buttons={[
        {
          label: PRIMARY_LABEL[request.kind],
          disabled: busy || (!isTrash && name.trim() === ''),
          onClick: submit
        }
      ]}
      onCancel={busy ? () => undefined : onClose}
      cancelDisabled={busy}
    >
      {!isTrash && (
        <Input
          ref={inputRef}
          value={name}
          disabled={busy}
          placeholder={request.kind === 'create-dir' ? '文件夹名' : '文件名'}
          onChange={(e) => setName(e.target.value)}
        />
      )}
      {error !== null && <p className="text-xs text-[var(--status-failed)]">{error}</p>}
    </FormDialogShell>
  )
}
