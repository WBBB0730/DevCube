import { useEffect, useState } from 'react'
import type { AppUpdateState } from '@shared/app-update-state'
import { APP_SHORTCUT_LIST } from '@shared/app-shortcut-list'
import type {
  SystemIntegrationFeature,
  SystemIntegrationFeatureId,
  SystemIntegrationState
} from '@shared/system-integration'
import type { AppPrefs, WindowsShell, WindowsShellOption } from '@shared/types'
import { DEFAULT_APP_PREFS } from '@shared/types'
import { LoaderCircle, TriangleAlert } from 'lucide-react'
import { SettingsModal } from '@renderer/components/SettingsModal'
import { Button } from '@renderer/components/ui/button'
import { DialogMask, DialogPanel } from '@renderer/components/ui/form-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { shortcutLabel } from '@renderer/lib/shortcut-label'
import { cn } from '@renderer/lib/utils'

type SectionId = 'about' | 'prefs' | 'integration' | 'keymap'

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'about', label: '关于' },
  { id: 'prefs', label: '偏好' },
  { id: 'integration', label: '系统集成' },
  { id: 'keymap', label: '快捷键' }
]

const WINDOWS_SHELL_LABELS: Record<WindowsShell, string> = {
  'git-bash': 'Git Bash',
  powershell: 'PowerShell',
  cmd: '命令提示符 (cmd)'
}

/** 系统集成各行文案（统一「在 X 中添加 / 安装 Y」句式；入口详情见 docs/prd/system-integration.md）。 */
function integrationCopy(
  state: SystemIntegrationState
): Record<SystemIntegrationFeatureId, { label: string; desc: string }> {
  return {
    quickAction: {
      label: 'Finder 快速操作',
      desc: `在 Finder 的快速操作菜单中添加「在 ${state.productName} 中打开」`
    },
    cliShim: {
      label: '命令行工具',
      desc: `在 /usr/local/bin 中安装 ${state.cliName} 命令；可能请求管理员授权`
    },
    codexOpenIn: {
      label: 'Codex Open in 菜单',
      desc: `在 Codex (ChatGPT) 的 Open in 菜单中添加 ${state.productName}；重启 ChatGPT 后生效`
    },
    windowsContextMenu: {
      label: '资源管理器右键菜单',
      desc: `在资源管理器的右键菜单中添加「在 ${state.productName} 中打开」`
    }
  }
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
  const [integration, setIntegration] = useState<SystemIntegrationState | null>(null)
  const [integrationBusy, setIntegrationBusy] = useState<SystemIntegrationFeatureId | null>(null)
  const [integrationError, setIntegrationError] = useState<string | null>(null)
  const platform = window.electron.process.platform
  const isWin = platform === 'win32'
  // 偏好目前仅 Windows「默认终端」；系统集成仅 macOS / Windows（Linux 无可开关项）。
  const sections = SECTIONS.filter((s) =>
    s.id === 'prefs' ? isWin : s.id === 'integration' ? isWin || platform === 'darwin' : true
  )

  // Esc 分层关闭：先收错误框，再关设置。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (integrationError !== null) setIntegrationError(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, integrationError])

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

  // 系统集成状态全部实时探测（文件 / 注册表 / TOML），每次切入都重查。
  useEffect(() => {
    if (section !== 'integration') return
    void window.api.getSystemIntegration().then(setIntegration)
  }, [section])

  const toggleIntegration = async (feature: SystemIntegrationFeature): Promise<void> => {
    setIntegrationBusy(feature.id)
    setIntegrationError(null)
    const result = await window.api.applySystemIntegration(feature.id, !feature.enabled)
    setIntegration(result.state)
    if (!result.ok) setIntegrationError(result.error)
    setIntegrationBusy(null)
  }

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
                {update.packaging === 'dev'
                  ? ' · Dev'
                  : update.channel === 'beta'
                    ? ' · Beta'
                    : ' · 正式版'}
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
                className="text-[color:var(--link)] hover:underline"
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

          {section === 'integration' && integration && (
            <div className="space-y-4">
              {integration.features.map((f) => {
                const copy = integrationCopy(integration)[f.id]
                return (
                  <div key={f.id} className="flex items-center justify-between gap-4">
                    <div className="min-w-0 space-y-0.5">
                      <div className="text-[color:var(--fg-primary)]">{copy.label}</div>
                      <div className="text-[12px] text-[color:var(--fg-muted)]">{copy.desc}</div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="relative"
                      variant={f.enabled ? 'ghost' : 'default'}
                      disabled={!f.available || integrationBusy !== null}
                      {...(f.available ? {} : { title: f.unavailableReason })}
                      onClick={() => void toggleIntegration(f)}
                    >
                      {/* loading 时文字隐形占位保宽，spinner 居中叠加，按钮不跳宽 */}
                      <span className={integrationBusy === f.id ? 'invisible' : undefined}>
                        {f.enabled ? '移除' : '安装'}
                      </span>
                      {integrationBusy === f.id && (
                        <LoaderCircle className="absolute inset-0 m-auto size-3.5 animate-spin" />
                      )}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}

          {section === 'integration' && !integration && (
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

      {/* 提示类信息不内联进界面：失败走「操作失败」错误框（Git 同款样式） */}
      {integrationError !== null && (
        <DialogMask onClick={() => setIntegrationError(null)}>
          <DialogPanel>
            <div className="space-y-3 px-4 py-4">
              <div className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                <TriangleAlert className="size-4 shrink-0 text-[color:var(--status-failed)]" />
                操作失败
              </div>
              <pre className="max-h-64 select-text overflow-auto whitespace-pre-wrap break-all rounded border border-[color:var(--border-input)] bg-[var(--bg-deepest)] p-2.5 font-mono text-[12px] leading-relaxed text-muted-foreground">
                {integrationError}
              </pre>
            </div>
            <div className="flex justify-end gap-2 border-t px-4 py-2.5">
              <Button onClick={() => setIntegrationError(null)}>知道了</Button>
            </div>
          </DialogPanel>
        </DialogMask>
      )}
    </SettingsModal>
  )
}
