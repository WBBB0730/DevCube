import { useEffect, useState } from 'react'
import type { AppUpdateState } from '@shared/app-update-state'
import { APP_SHORTCUT_LIST } from '@shared/app-shortcut-list'
import { SettingsModal } from '@renderer/components/SettingsModal'
import { Button } from '@renderer/components/ui/button'
import { shortcutLabel } from '@renderer/lib/shortcut-label'
import { cn } from '@renderer/lib/utils'

type SectionId = 'about' | 'keymap'

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'about', label: '关于' },
  { id: 'keymap', label: '快捷键' }
]

type Props = {
  update: AppUpdateState | null
  onClose: () => void
  onCheckUpdate: () => Promise<void>
  onOpenRelease: () => void
  onOpenRepo: () => void
}

function phaseLabel(state: AppUpdateState): string {
  switch (state.phase) {
    case 'idle':
      return '尚未检查'
    case 'checking':
      return '正在检查…'
    case 'upToDate':
      return '已是最新'
    case 'available':
      return state.packaging === 'portable'
        ? `发现新版本 ${state.availableVersion ?? ''}（请前往 Release 下载）`
        : `发现新版本 ${state.availableVersion ?? ''}`
    case 'downloading':
      return `正在下载 ${state.availableVersion ?? ''}…`
    case 'ready':
      return `已下载 ${state.availableVersion ?? ''}，可重启安装`
    case 'error':
      return state.lastError ? `检查失败：${state.lastError}` : '检查失败'
  }
}

/** WebStorm 风设置弹层：左树 + 右内容 + 底栏。 */
export function SettingsDialog({
  update,
  onClose,
  onCheckUpdate,
  onOpenRelease,
  onOpenRepo
}: Props): React.JSX.Element {
  const [section, setSection] = useState<SectionId>('about')
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const check = async (): Promise<void> => {
    setChecking(true)
    try {
      await onCheckUpdate()
    } finally {
      setChecking(false)
    }
  }

  return (
    <SettingsModal
      title="设置"
      onClose={onClose}
      className="h-[min(640px,90vh)] w-[min(860px,94vw)]"
    >
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col border-r border-[color:var(--separator)]">
          <nav className="flex min-h-0 flex-1 flex-col gap-px overflow-auto p-2">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                className={cn(
                  'flex h-8 w-full items-center rounded px-2 text-left text-[13px]',
                  section === s.id
                    ? 'bg-[color:var(--selection-row)] text-[color:var(--fg-primary)]'
                    : 'text-foreground hover:bg-row-hover'
                )}
              >
                {s.label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 overflow-auto p-4 text-[13px]">
          {section === 'about' && update && (
            <div className="space-y-3">
              <div className="text-[15px] text-[color:var(--fg-primary)]">{update.productName}</div>
              <div className="text-[color:var(--fg-muted)]">
                版本 {update.currentVersion}
                {update.channel === 'beta' ? ' · Beta' : ' · 正式版'}
              </div>
              <div>{phaseLabel(update)}</div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={checking || update.packaging === 'dev'}
                  onClick={() => void check()}
                >
                  {checking ? '检查中…' : '检查更新'}
                </Button>
                {(update.packaging === 'portable' || update.showButton) && (
                  <Button type="button" size="sm" variant="ghost" onClick={onOpenRelease}>
                    打开 GitHub Release
                  </Button>
                )}
              </div>
              <button
                type="button"
                className="text-[#548AF7] hover:underline"
                onClick={onOpenRepo}
              >
                {update.repoUrl}
              </button>
            </div>
          )}

          {section === 'about' && !update && (
            <div className="text-[color:var(--fg-muted)]">正在加载…</div>
          )}

          {section === 'keymap' && (
            <div className="space-y-1">
              {APP_SHORTCUT_LIST.map((row) => {
                const keys = row.formatKeys
                  ? row.formatKeys(window.electron.process.platform)
                  : row.chord
                    ? shortcutLabel(row.chord)
                    : ''
                return (
                  <div
                    key={row.label}
                    className="flex h-8 items-center justify-between gap-4 rounded px-2 hover:bg-row-hover"
                  >
                    <span>{row.label}</span>
                    <span className="font-mono text-[12px] font-semibold text-[color:var(--fg-muted)]">
                      {keys}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

        </main>
      </div>
    </SettingsModal>
  )
}
