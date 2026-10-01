// 服务器上的文件在正文区的几样东西（docs/prd/server-files.md）：打开时的下载进度（可取消）；
// 不在此打开的占位——较大的文件（图片、PDF 等可「仍然打开」）与不能预览的二进制；文本文件的保存栏（手动保存）。
import { LoaderCircle } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { LoadingHint } from '@renderer/components/ui/centered-hint'
import { shortcutTitle } from '@renderer/lib/shortcut-label'
import { useShowAfter } from '@renderer/lib/use-show-after'
import { formatBytes } from '@shared/server-status'
import { SHORTCUT } from '@shared/shortcut-label'

/** 打开得快时不闪：超过这个时长还没打开才盖上 */
const OPENING_DELAY_MS = 150

/**
 * 打开服务器上的文件时盖在正文区上的一层（盖住旧文件）：还没开始下载（查大小、判断类型）时是「正在加载…」，
 * 同看图换图的样式；开始下载后换成进度与「取消」，取消后回到原来的正文。
 * 从正文进入打开中才计时；盖上之后打开中换了文件照样盖着（调用方不按文件重挂）。
 */
export function ServerOpenProgress({
  path,
  progress,
  onCancel
}: {
  path: string
  /** 下载进度；还没开始下载为 null */
  progress: { doneBytes: number; totalBytes: number } | null
  onCancel: () => void
}): React.JSX.Element | null {
  const shown = useShowAfter(OPENING_DELAY_MS)
  if (!shown) return null
  if (progress === null)
    return <LoadingHint delay={0} className="absolute inset-0 z-10 bg-deepest" />
  const { doneBytes, totalBytes } = progress
  const name = path.slice(path.lastIndexOf('/') + 1)
  const ratio = totalBytes > 0 ? Math.min(1, doneBytes / totalBytes) : 0
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-deepest px-6 text-sm text-muted-foreground">
      <p className="max-w-full truncate">正在打开 “{name}”</p>
      <div className="h-1 w-60 overflow-hidden rounded-full bg-[var(--bg-row-hover)]">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <p className="text-xs tabular-nums">
        {formatBytes(doneBytes)} / {formatBytes(totalBytes)}
      </p>
      <Button variant="secondary" onClick={onCancel}>
        取消
      </Button>
    </div>
  )
}

/**
 * 服务器上的文件不在此打开时的占位：较大的（canForce 时有「仍然打开」）或不能预览的二进制；
 * 都给「下载」与「在 SSH 终端中打开」两个出口（断开时要连接的两个置灰，SSH 终端自己连）。
 */
export function ServerFilePlaceholder({
  reason,
  size,
  connected,
  onOpenAnyway,
  onDownload,
  onOpenInSshTerminal
}: {
  reason: 'too-large' | 'unsupported'
  size: number
  connected: boolean
  /** 「仍然打开」：只有图片、PDF 等超过预览上限的才有 */
  onOpenAnyway: (() => void) | null
  onDownload: () => void
  onOpenInSshTerminal: () => void
}): React.JSX.Element {
  const title =
    reason === 'unsupported'
      ? '无法在此编辑此文件'
      : onOpenAnyway !== null
        ? '文件较大，预览前需要先下载'
        : '文件较大，不在此打开'
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-sm text-muted-foreground">
      <p>{title}</p>
      <p className="text-xs">{formatBytes(size)}</p>
      <div className="flex items-center gap-2">
        {onOpenAnyway !== null && (
          <Button variant="secondary" disabled={!connected} onClick={onOpenAnyway}>
            仍然打开
          </Button>
        )}
        <Button variant="secondary" disabled={!connected} onClick={onDownload}>
          下载
        </Button>
        <Button variant="secondary" onClick={onOpenInSshTerminal}>
          在 SSH 终端中打开
        </Button>
      </div>
    </div>
  )
}

/** 服务器上的文本文件的保存状态（手动保存，docs/prd/server-files.md）。 */
export type ServerSaveState =
  | { kind: 'clean' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'failed'; message: string }
  /** 服务器上的文件在编辑期间被别处改过（gone = 已被删除） */
  | { kind: 'conflict'; gone: boolean }
  | { kind: 'offline'; dirty: boolean }

const BAR_BTN = 'h-6 px-2 text-[12px]'

/** 未保存标记：主色小圆点 */
function DirtyDot(): React.JSX.Element {
  return <span className="size-1.5 shrink-0 rounded-full bg-primary" />
}

/**
 * 保存栏：面包屑工具栏之下、编辑器之上的一条（服务器上的文本文件才有，常驻免得编辑器上下跳）。
 * 左边是状态，右边是对应的动作；冲突也在这里处理，不弹框打断输入。
 */
export function ServerSaveBar({
  state,
  onSave,
  onDiscard,
  onReload,
  onOverwrite
}: {
  state: ServerSaveState
  onSave: () => void
  /** 放弃修改：重新读服务器上的版本 */
  onDiscard: () => void
  /** 冲突时「重新载入」（已删除时为「放弃修改」）：丢掉编辑器里的修改，换成服务器上的版本 */
  onReload: () => void
  /** 冲突时「覆盖保存」（已删除时为「保存」，即重新创建）：以编辑器内容写回 */
  onOverwrite: () => void
}): React.JSX.Element {
  const saveHint = shortcutTitle('保存', SHORTCUT.save)
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--separator)] bg-panel px-3 text-[12px]">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {state.kind === 'clean' && <span className="text-muted-foreground">已保存</span>}
        {state.kind === 'dirty' && (
          <>
            <DirtyDot />
            <span className="text-foreground">有未保存的修改</span>
          </>
        )}
        {state.kind === 'saving' && (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" />
            正在保存…
          </span>
        )}
        {state.kind === 'failed' && (
          <span className="truncate text-[var(--status-failed)]" title={state.message}>
            保存失败：{state.message}
          </span>
        )}
        {state.kind === 'conflict' && (
          <span className="truncate text-[var(--status-failed)]">
            服务器上的文件已被{state.gone ? '删除' : '修改'}，编辑器里还有未保存的修改
          </span>
        )}
        {state.kind === 'offline' && (
          <>
            {state.dirty && <DirtyDot />}
            <span className="truncate text-muted-foreground">连接已断开，重新连接后才能保存</span>
          </>
        )}
      </div>
      {/* 连接已断开时不出按钮：重新连接后才能保存 */}
      {state.kind === 'offline' ? null : state.kind === 'conflict' ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="secondary" className={BAR_BTN} onClick={onReload}>
            {state.gone ? '放弃修改' : '重新载入'}
          </Button>
          <Button
            variant={state.gone ? 'default' : 'destructiveSoft'}
            className={BAR_BTN}
            onClick={onOverwrite}
          >
            {state.gone ? '保存' : '覆盖保存'}
          </Button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-1.5">
          {(state.kind === 'dirty' || state.kind === 'failed') && (
            <Button variant="secondary" className={BAR_BTN} onClick={onDiscard}>
              放弃修改
            </Button>
          )}
          <Button
            className={BAR_BTN}
            title={saveHint}
            disabled={state.kind !== 'dirty' && state.kind !== 'failed'}
            onClick={onSave}
          >
            {state.kind === 'failed' ? '重试' : '保存'}
          </Button>
        </div>
      )}
    </div>
  )
}
