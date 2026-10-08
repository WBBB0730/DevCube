// 连接类表单（服务器对话框、数据源对话框）共用的部件：地址 + 端口、密码 +「记住密码」、「绕开代理直连」、
// 「测试连接」与连接目标重复时的确认；对应的 Hook 在 lib/connection-test。
import { Check, LoaderCircle, X } from 'lucide-react'
import { CHOICE_ROW, Checkbox } from '@renderer/components/ui/checkbox'
import { ErrorDialog, FieldRow, FormDialogShell } from '@renderer/components/ui/form-dialog'
import { Input } from '@renderer/components/ui/input'
import { PasswordInput } from '@renderer/components/ui/password-input'
import { supportsDirectRoute } from '@shared/connection'
import type { useConnectionTest } from '@renderer/lib/connection-test'

/** 地址 + 端口一行（端口 80px，按文本存，提交时用 portOfText 解析）。 */
export function HostPortFields({
  host,
  port,
  hostPlaceholder,
  autoFocus,
  onChange
}: {
  host: string
  port: string
  hostPlaceholder: string
  autoFocus?: boolean
  onChange: (patch: { host?: string; port?: string }) => void
}): React.JSX.Element {
  return (
    <div className="flex gap-2">
      <div className="min-w-0 flex-1">
        <FieldRow label="地址">
          <Input
            value={host}
            autoFocus={autoFocus}
            placeholder={hostPlaceholder}
            className="font-mono"
            onChange={(e) => onChange({ host: e.target.value })}
          />
        </FieldRow>
      </div>
      <div className="w-20 shrink-0">
        <FieldRow label="端口">
          <Input
            value={port}
            inputMode="numeric"
            className="font-mono"
            onChange={(e) => onChange({ port: e.target.value })}
          />
        </FieldRow>
      </div>
    </div>
  )
}

/**
 * 密码字段 +「记住密码」勾选（同 SSH 提问弹窗）：勾着保存才记下，连接时自动填入；取消勾选保存即删掉
 * 记住的密码。系统没有可用钥匙串时整项不可用并说明原因。
 */
export function PasswordField({
  value,
  onChange,
  remember,
  onRememberChange,
  unavailableReason,
  placeholder
}: {
  value: string
  onChange: (value: string) => void
  remember: boolean
  onRememberChange: (remember: boolean) => void
  unavailableReason: string | null
  placeholder: string
}): React.JSX.Element {
  return (
    <>
      <FieldRow label="密码">
        <PasswordInput
          value={value}
          disabled={unavailableReason !== null}
          placeholder={unavailableReason === null ? placeholder : '无法记住密码'}
          onChange={(e) => onChange(e.target.value)}
        />
        {unavailableReason !== null && (
          <div className="mt-1 text-[12px] text-muted-foreground">{unavailableReason}</div>
        )}
      </FieldRow>
      {unavailableReason === null && (
        <label className={CHOICE_ROW}>
          <Checkbox checked={remember} onCheckedChange={onRememberChange} />
          <span>记住密码</span>
        </label>
      )}
    </>
  )
}

/** 「绕开代理直连」（ADR-0039）：只在 macOS / Windows 出现——Linux 上普通进程绕不开 TUN。 */
export function DirectField({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element | null {
  if (!supportsDirectRoute(window.electron.process.platform)) return null
  return (
    <label className={CHOICE_ROW}>
      <Checkbox checked={checked} onCheckedChange={onChange} />
      <span>绕开代理直连</span>
    </label>
  )
}

/**
 * 底栏左侧的「测试连接」：文字按钮（`--link` 色），无底色、无内边距，与正文左缘对齐；
 * 进行中转圈，不能测时置灰、hover 说明原因（不屏蔽指针事件，提示才出得来）。
 * 结果紧跟在按钮右侧同一行，不撑高对话框：成功「连接成功」；失败「连接失败」（hover 看报错），
 * 同时另弹错误框（TestFailureDialog）。
 */
export function TestConnection({
  test,
  disabledReason
}: {
  test: ReturnType<typeof useConnectionTest>
  disabledReason: string | null
}): React.JSX.Element {
  const { testing, result, start } = test
  return (
    <>
      <button
        type="button"
        disabled={testing || disabledReason !== null}
        title={disabledReason ?? undefined}
        onClick={start}
        className="inline-flex items-center gap-1.5 text-[13px] text-[color:var(--link)] hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-50"
      >
        {testing && <LoaderCircle className="size-3.5 animate-spin" />}
        测试连接
      </button>
      {result?.status === 'ok' && (
        <span className="flex items-center gap-1 text-[13px] text-[color:var(--status-success)]">
          <Check className="size-3.5" />
          连接成功
        </span>
      )}
      {result?.status === 'failed' && (
        <span
          title={result.message}
          className="flex cursor-default items-center gap-1 text-[13px] text-[color:var(--status-failed)]"
        >
          <X className="size-3.5" />
          连接失败
        </span>
      )}
    </>
  )
}

/** 测试失败：弹错误框给出连接的报错，关掉即不显示。写在表单对话框的 children 里，叠在它之上。 */
export function TestFailureDialog({
  test
}: {
  test: ReturnType<typeof useConnectionTest>
}): React.JSX.Element | null {
  const { failureDialogOpen, result, closeFailureDialog } = test
  if (!failureDialogOpen || result?.status !== 'failed') return null
  return <ErrorDialog title="连接失败" message={result.message} onClose={closeFailureDialog} />
}

/**
 * 连接目标与已登记的重复：允许（同一个库或同一台服务器可以登记多份），只在提交时再问一次。
 * 写在表单对话框的 children 里，叠在它之上；回车即确认，Esc、点遮罩只关它自己。
 */
export function DuplicateTargetConfirm({
  message,
  confirmLabel,
  onConfirm,
  onCancel
}: {
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <FormDialogShell
      message={message}
      buttons={[{ label: confirmLabel, onClick: onConfirm }]}
      onCancel={onCancel}
      dismissOnOutsidePress
    />
  )
}
