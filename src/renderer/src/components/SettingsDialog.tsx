import { useEffect, useState } from 'react'
import type { AppUpdateState } from '@shared/app-update-state'
import { APP_SHORTCUT_LIST } from '@shared/app-shortcut-list'
import {
  OPEN_WITH_FEATURE_IDS,
  type OpenWithFeatureId,
  type SystemIntegrationFeature,
  type SystemIntegrationFeatureId,
  type SystemIntegrationState
} from '@shared/system-integration'
import { FILES_OPEN_WITH_EXTS } from '@shared/files-kind'
import type { AppPrefs, WindowsShell, WindowsShellOption } from '@shared/types'
import { DEFAULT_APP_PREFS } from '@shared/types'
import { THEME_MODES, type ThemeMode } from '@shared/theme'
import { GIT_DEFAULTS } from '@shared/git'
import { Check, Info, LoaderCircle, TriangleAlert } from 'lucide-react'
import { SettingsModal } from '@renderer/components/SettingsModal'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { DialogMask, DialogPanel } from '@renderer/components/ui/form-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { SegmentedControl } from '@renderer/components/ui/segmented-control'
import { shortcutLabel } from '@renderer/lib/shortcut-label'
import { cn } from '@renderer/lib/utils'
import { useApp } from '@renderer/store'

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

const THEME_LABELS: Record<ThemeMode, string> = {
  dark: '深色',
  light: '浅色'
}

/** 「文件打开方式」各子项的类型名 */
const OPEN_WITH_LABEL: Record<OpenWithFeatureId, string> = {
  openWithImage: '图片',
  openWithPdf: 'PDF',
  openWithPptx: 'PPT',
  openWithXlsx: 'Excel',
  openWithAudio: '音频',
  openWithVideo: '视频'
}

/** 完整扩展名只在 `Info` 图标的 hover 里给：日常用不着，摊在版面上是噪声。 */
function extList(category: keyof typeof FILES_OPEN_WITH_EXTS): string {
  return FILES_OPEN_WITH_EXTS[category].map((e) => `.${e}`).join(' ')
}

/** 入口行（安装 / 移除），与「文件打开方式」一行同级并列。 */
const ENTRY_FEATURE_IDS = ['quickAction', 'cliShim', 'codexOpenIn', 'windowsContextMenu'] as const

/** 一行的文案：名字必有；说明、名字后的 `Info` hover、按钮 hover 各按需。 */
type IntegrationRowCopy = { label: string; desc?: string; info?: string; buttonHint?: string }

/** 系统集成各行文案（统一「在 X 中添加 / 安装 Y」句式；入口详情见 docs/prd/system-integration.md）。 */
function integrationCopy(
  state: SystemIntegrationState,
  platform: string
): Record<SystemIntegrationFeatureId, IntegrationRowCopy> {
  // Windows 点「设为默认」只能注册候选再跳系统页；这层落差挂按钮 hover，不占版面
  const buttonHint =
    platform === 'win32'
      ? `Windows 不允许程序直接改默认程序：将注册为候选并打开系统「默认应用」页，在其中选择 ${state.productName}`
      : undefined
  return {
    openWithImage: { label: OPEN_WITH_LABEL.openWithImage, info: extList('image'), buttonHint },
    openWithPdf: { label: OPEN_WITH_LABEL.openWithPdf, info: extList('pdf'), buttonHint },
    openWithPptx: { label: OPEN_WITH_LABEL.openWithPptx, info: extList('pptx'), buttonHint },
    openWithXlsx: { label: OPEN_WITH_LABEL.openWithXlsx, info: extList('xlsx'), buttonHint },
    openWithAudio: { label: OPEN_WITH_LABEL.openWithAudio, info: extList('audio'), buttonHint },
    openWithVideo: { label: OPEN_WITH_LABEL.openWithVideo, info: extList('video'), buttonHint },
    quickAction: {
      label: 'Finder',
      desc: `在 Finder 的「快速操作」中添加「在 ${state.productName} 中打开」`
    },
    cliShim: {
      label: 'CLI',
      desc: `在 /usr/local/bin 中安装 ${state.cliName} 命令（可能请求管理员授权）`
    },
    codexOpenIn: {
      label: 'Codex',
      desc: `在 Codex 的「打开方式」中添加「在 ${state.productName} 中打开」（重启 Codex 后生效）`
    },
    windowsContextMenu: {
      label: '资源管理器',
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
  const setTheme = useApp((s) => s.setTheme)
  const gitAutoFetch = useApp((s) => s.gitAutoFetch)
  const setGitAutoFetch = useApp((s) => s.setGitAutoFetch)
  const platform = window.electron.process.platform
  const isWin = platform === 'win32'
  // 偏好全平台可见（主题）；其中「默认终端」仅 Windows。系统集成全平台可见（Linux 只有「文件打开方式」）。
  const sections = SECTIONS

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

  // shell 选项只有 Windows 用得上，非 win32 不去探测。
  useEffect(() => {
    if (section !== 'prefs') return
    void window.api.getAppPrefs().then(setPrefs)
    if (isWin) void window.api.getWindowsShellOptions().then(setShellOptions)
  }, [section, isWin])

  // 系统集成状态全部实时探测（文件 / 注册表 / TOML），每次切入都重查。
  useEffect(() => {
    if (section !== 'integration') return
    void window.api.getSystemIntegration().then(setIntegration)
  }, [section])

  // install 型是开关；default 型（文件打开方式）只有「设为默认」单向动作
  const toggleIntegration = async (feature: SystemIntegrationFeature): Promise<void> => {
    setIntegrationBusy(feature.id)
    setIntegrationError(null)
    const enable = feature.mode === 'default' ? true : !feature.enabled
    const result = await window.api.applySystemIntegration(feature.id, enable)
    setIntegration(result.state)
    if (!result.ok) setIntegrationError(result.error)
    setIntegrationBusy(null)
  }

  const renderIntegrationRow = (
    f: SystemIntegrationFeature,
    copy: IntegrationRowCopy
  ): React.JSX.Element => (
    <div key={f.id} className="flex min-h-7 items-center justify-between gap-4">
      <div className="min-w-0 space-y-0.5">
        <div className="text-[color:var(--fg-primary)]">{copy.label}</div>
        {copy.desc && <div className="text-[12px] text-[color:var(--fg-muted)]">{copy.desc}</div>}
      </div>
      <Button
        type="button"
        size="sm"
        className="relative shrink-0"
        variant={f.enabled ? 'ghost' : 'default'}
        disabled={!f.available || integrationBusy !== null}
        title={f.available ? undefined : f.unavailableReason}
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

  /**
   * 类型子项一行一个：**`Info` 紧跟类型名成一块、该块定宽**，按钮列随之对齐并贴左——
   * 名字与动作分踞两端会把行拉空，聚在左侧读起来才是一组。按钮仍写着动词：「设为默认」改的是
   * 系统级关联、且系统没有「取消默认」这个反向动作，不能退化成只写类型名、点下去就生效的开关；
   * 完整动作在 hover 里补全。
   */
  const renderOpenWithRow = (
    f: SystemIntegrationFeature,
    copy: IntegrationRowCopy
  ): React.JSX.Element => (
    <div key={f.id} className="flex min-h-7 items-center gap-2">
      {/* 名字与 ⓘ 同处一个定宽块：ⓘ 贴着名字，按钮列仍对齐 */}
      <span className="flex w-16 shrink-0 items-center gap-1 text-foreground">
        {copy.label}
        {copy.info && (
          // 完整扩展名收进 hover：行里只留类型名
          <span
            title={copy.info}
            className="inline-flex cursor-default text-[color:var(--fg-disabled)] transition-colors hover:text-[color:var(--fg-icon)]"
          >
            <Info className="size-3.5" />
          </span>
        )}
      </span>
      {f.enabled ? (
        // 已是默认：没有反向动作，不摆一颗按不动的按钮，改用带勾灰字
        <div
          title="已是默认打开程序"
          className="flex h-7 shrink-0 items-center gap-1 px-1 text-[12px] text-[color:var(--fg-muted)]"
        >
          <Check className="size-3.5" />
          默认
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          className="relative shrink-0"
          disabled={!f.available || integrationBusy !== null}
          title={
            f.available
              ? (copy.buttonHint ?? `把 ${copy.label}文件的默认打开程序设置为本应用`)
              : f.unavailableReason
          }
          onClick={() => void toggleIntegration(f)}
        >
          <span className={integrationBusy === f.id ? 'invisible' : undefined}>设置</span>
          {integrationBusy === f.id && (
            <LoaderCircle className="absolute inset-0 m-auto size-3.5 animate-spin" />
          )}
        </Button>
      )}
    </div>
  )

  const setWindowsShell = (windowsShell: WindowsShell): void => {
    const opt = shellOptions?.find((o) => o.id === windowsShell)
    if (opt && !opt.available) return
    const next = { ...(prefs ?? DEFAULT_APP_PREFS), windowsShell }
    setPrefs(next)
    void window.api.setAppPrefs({ windowsShell }).then(setPrefs)
  }

  // 主题落盘与原生侧同步走 store（渲染层的 JS 侧色源也订阅它），这里只更新本页显示值。
  const changeTheme = (theme: ThemeMode): void => {
    setPrefs({ ...(prefs ?? DEFAULT_APP_PREFS), theme })
    void setTheme(theme)
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

          {section === 'prefs' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="text-[color:var(--fg-primary)]">主题</div>
                {prefs ? (
                  <SegmentedControl
                    value={prefs.theme}
                    onValueChange={(v) => changeTheme(v as ThemeMode)}
                    items={THEME_MODES.map((m) => ({ value: m, label: THEME_LABELS[m] }))}
                  />
                ) : (
                  <div className="text-[color:var(--fg-muted)]">正在加载…</div>
                )}
              </div>

              <div className="space-y-2">
                <div className="text-[color:var(--fg-primary)]">Git</div>
                <label className="flex cursor-pointer select-none items-center gap-1.5 text-foreground">
                  <Checkbox
                    checked={gitAutoFetch}
                    onCheckedChange={(checked) => void setGitAutoFetch(checked)}
                  />
                  自动获取远程更新
                </label>
                <div className="text-[12px] text-[color:var(--fg-muted)]">
                  Git 标签页切到前台时，以及每 {GIT_DEFAULTS.autoFetchIntervalMs / 60_000}{' '}
                  分钟，对当前项目执行一次刷新（fetch）
                </div>
              </div>

              {isWin && (
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
            </div>
          )}

          {section === 'integration' && integration && (
            <div className="space-y-3">
              {(() => {
                const copy = integrationCopy(integration, platform)
                const find = (
                  id: SystemIntegrationFeatureId
                ): SystemIntegrationFeature | undefined =>
                  integration.features.find((f) => f.id === id)
                const openWith = OPEN_WITH_FEATURE_IDS.map(find).filter((f) => f !== undefined)
                return (
                  <>
                    {ENTRY_FEATURE_IDS.map(find).map((f) =>
                      f ? renderIntegrationRow(f, copy[f.id]) : null
                    )}
                    {openWith.length > 0 && (
                      <div className="space-y-2">
                        <div className="min-w-0 space-y-0.5">
                          <div className="text-[color:var(--fg-primary)]">文件打开方式</div>
                          <div className="text-[12px] text-[color:var(--fg-muted)]">
                            {`把 ${integration.productName} 设为这些类型文件的默认打开程序`}
                          </div>
                        </div>
                        <div className="space-y-1">
                          {openWith.map((f) => renderOpenWithRow(f, copy[f.id]))}
                        </div>
                      </div>
                    )}
                  </>
                )
              })()}
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
