import { useEffect, useState } from 'react'
import type { AppUpdateState } from '@shared/app-update-state'
import { APP_SHORTCUT_LIST } from '@shared/app-shortcut-list'
import type { AppPrefs, WindowsShell, WindowsShellOption } from '@shared/types'
import { DEFAULT_APP_PREFS } from '@shared/types'
import { SettingsModal } from '@renderer/components/SettingsModal'
import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { shortcutLabel } from '@renderer/lib/shortcut-label'
import { cn } from '@renderer/lib/utils'

type SectionId = 'about' | 'prefs' | 'keymap'

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'about', label: '关于' },
  { id: 'prefs', label: '偏好' },
  { id: 'keymap', label: '快捷键' }
]

const WINDOWS_SHELL_LABELS: Record<WindowsShell, string> = {
  'git-bash': 'Git Bash',
  powershell: 'PowerShell',
  cmd: '命令提示符 (cmd)'
}

type Props = {
  update: AppUpdateState | null
  onClose: () => void
  /** @param force 手动按钮传 true，绕过进入关于的冷却 */
  onCheckUpdate: (force?: boolean) => Promise<void>
  onInstallUpdate: () => void
  onOpenRepo: () => void
}

function phaseLabel(state: AppUpdateState): string {
  switch (state.phase) {
    case 'checking':
      return '正在检查更新'
    case 'upToDate':
      return '已是最新'
    case 'available':
      return `发现新版本 ${state.availableVersion ?? ''}`
    case 'downloading':
      return `正在下载 ${state.availableVersion ?? ''}…`
    case 'ready':
      return `已下载 ${state.availableVersion ?? ''}，可重启安装`
    case 'error':
      return state.lastError ? `下载失败：${state.lastError}` : '下载失败'
  }
}

/** WebStorm 风设置弹层：左树 + 右内容 + 底栏。 */
export function SettingsDialog({
  update,
  onClose,
  onCheckUpdate,
  onInstallUpdate,
  onOpenRepo
}: Props): React.JSX.Element {
  const [section, setSection] = useState<SectionId>('about')
  const [prefs, setPrefs] = useState<AppPrefs | null>(null)
  const [shellOptions, setShellOptions] = useState<WindowsShellOption[] | null>(null)
  const isWin = window.electron.process.platform === 'win32'
  // 偏好目前仅 Windows「默认终端」；非 Windows 不挂空说明页。
  const sections = isWin ? SECTIONS : SECTIONS.filter((s) => s.id !== 'prefs')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 进入关于自动检查（受主进程 5 分钟冷却；后台 jitter / 周期仍独立）。
  useEffect(() => {
    if (section !== 'about') return
    void onCheckUpdate(false)
    // 只在切入关于时触发；onCheckUpdate 恒为「invoke 检查」，不必进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [section])

  useEffect(() => {
    if (section !== 'prefs') return
    void Promise.all([window.api.getAppPrefs(), window.api.getWindowsShellOptions()]).then(
      ([nextPrefs, options]) => {
        setPrefs(nextPrefs)
        setShellOptions(options)
      }
    )
  }, [section])

  const setWindowsShell = (windowsShell: WindowsShell): void => {
    const opt = shellOptions?.find((o) => o.id === windowsShell)
    if (opt && !opt.available) return
    const next = { ...(prefs ?? DEFAULT_APP_PREFS), windowsShell }
    setPrefs(next)
    void window.api.setAppPrefs({ windowsShell }).then(setPrefs)
  }

  const canAutoInstall =
    update != null && (update.packaging === 'macApp' || update.packaging === 'nsis')
  const downloadInProgress =
    canAutoInstall && (update.phase === 'available' || update.phase === 'downloading')
  const checkBusy = update?.phase === 'checking' || downloadInProgress
  /** 可自动更新已下完，或仅打开 Release 形态（便携 / 未包装开发）有新版本 →「立即更新」。 */
  const showInstallAction =
    (canAutoInstall && update.phase === 'ready') ||
    ((update?.packaging === 'portable' || update?.packaging === 'dev') &&
      update.phase === 'available')

  return (
    <SettingsModal
      title="设置"
      onClose={onClose}
      className="h-[min(640px,90vh)] w-[min(860px,94vw)]"
    >
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col border-r border-[color:var(--separator)]">
          <nav className="flex min-h-0 flex-1 flex-col gap-px overflow-auto p-2">
            {sections.map((s) => (
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
                {showInstallAction ? (
                  <Button type="button" size="sm" onClick={onInstallUpdate}>
                    立即更新
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    disabled={checkBusy || !update.checksEnabled}
                    onClick={() => void onCheckUpdate(true)}
                  >
                    检查更新
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

          {section === 'prefs' && isWin && (
            <div className="space-y-2">
              <div className="text-[color:var(--fg-primary)]">默认终端</div>
              {prefs && shellOptions ? (
                <Select
                  value={prefs.windowsShell}
                  onValueChange={(v) => {
                    if (v != null) setWindowsShell(v as WindowsShell)
                  }}
                  items={shellOptions.map((o) => ({
                    value: o.id,
                    label: WINDOWS_SHELL_LABELS[o.id]
                  }))}
                >
                  <SelectTrigger className="w-[280px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {shellOptions.map((o) => (
                      <SelectItem key={o.id} value={o.id} disabled={!o.available}>
                        {WINDOWS_SHELL_LABELS[o.id]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="text-[color:var(--fg-muted)]">正在加载…</div>
              )}
            </div>
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
