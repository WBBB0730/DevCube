// Files 树条目操作弹窗（新建文件 / 新建文件夹 / 重命名 / 删除确认）：外壳对齐 FilesPane
// 磁盘冲突弹窗（fixed 遮罩 + bg-panel 卡片）。onSubmit 抛错时弹窗保持打开并就地展示错误。
import { useEffect, useRef, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'

export type FilesEntryDialogRequest =
  | { kind: 'create-file'; dir: string }
  | { kind: 'create-dir'; dir: string }
  | { kind: 'rename'; path: string; isDirectory: boolean }
  | { kind: 'trash'; path: string; isDirectory: boolean }

const TITLE: Record<FilesEntryDialogRequest['kind'], string> = {
  'create-file': '新建文件',
  'create-dir': '新建文件夹',
  rename: '重命名',
  trash: '删除'
}

function baseName(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1)
}

/** Electron invoke 抛错带 "Error invoking remote method 'x': Error: " 前缀，剥掉只留正文。 */
function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '')
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

  const submit = async (): Promise<void> => {
    if (busy) return
    const trimmed = name.trim()
    if (!isTrash && trimmed === '') return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(trimmed)
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="w-[440px] rounded border border-[color:var(--border-input)] bg-panel p-4 shadow-xl">
        <h2 className="text-sm text-[color:var(--fg-dialog-title)]">{TITLE[request.kind]}</h2>
        {isTrash ? (
          <p className="mt-2 text-[13px] text-muted-foreground">
            将把{request.isDirectory ? '文件夹' : '文件'}“{baseName(request.path)}
            ”移到回收站。
          </p>
        ) : (
          <form
            className="mt-3"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <Input
              ref={inputRef}
              value={name}
              disabled={busy}
              placeholder={request.kind === 'create-dir' ? '文件夹名' : '文件名'}
              onChange={(e) => setName(e.target.value)}
            />
          </form>
        )}
        {error !== null && <p className="mt-2 text-xs text-[var(--status-failed)]">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            variant={isTrash ? 'destructive' : 'default'}
            autoFocus={isTrash}
            disabled={busy || (!isTrash && name.trim() === '')}
            onClick={() => void submit()}
          >
            {isTrash ? '删除' : '确定'}
          </Button>
        </div>
      </div>
    </div>
  )
}
