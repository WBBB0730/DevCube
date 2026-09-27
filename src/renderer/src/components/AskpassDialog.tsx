// ssh 提问弹窗（ADR-0038）：ssh 的所有提问都交给 DevCube 回答，这里一次答一个。
// 首次连接确认主机指纹给「继续连接 / 取消」；密码、私钥口令、验证码给遮挡输入，
// 密码提问可勾「记住密码」（默认不勾，密码错误后重问时沿用上一次的勾选）。ssh 的提问原文照登，便于核对指纹等细节。
// 它可能叠在别的对话框上（如服务器对话框里测试连接时）：Esc 在捕获阶段先由它收下，
// 只取消这一次提问，不连带关掉下面的对话框；点遮罩不收口，只认明确的按钮。
import { useCallback, useEffect, useState } from 'react'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { FormDialogShell } from '@renderer/components/ui/form-dialog'
import { PasswordInput } from '@renderer/components/ui/password-input'
import { useApp } from '@renderer/store'
import type { AskpassRequest } from '@shared/server'

export function AskpassDialog({ request }: { request: AskpassRequest }): React.JSX.Element {
  const answer = useApp((s) => s.answerAskpass)
  const [value, setValue] = useState('')
  const [remember, setRemember] = useState(request.rememberDefault)

  const respond = (text: string | null): void =>
    answer({ id: request.id, answer: text, remember: remember && request.canRemember })

  // 取消 = 主机指纹确认明确回答 no，其余提问放弃作答；ssh 随即放弃连接
  const cancel = useCallback(
    () =>
      answer({ id: request.id, answer: request.kind === 'confirm' ? 'no' : null, remember: false }),
    [answer, request.id, request.kind]
  )
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      cancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [cancel])

  const promptBlock = (
    <div className="max-h-48 overflow-y-auto select-text whitespace-pre-wrap break-all rounded bg-[var(--bg-panel)] px-2.5 py-2 font-mono text-[12px] text-foreground">
      {request.prompt.trim()}
    </div>
  )

  if (request.kind === 'confirm') {
    return (
      <FormDialogShell
        message={`连接 ${request.serverName}：首次连接，请核对主机指纹`}
        buttons={[{ label: '继续连接', onClick: () => respond('yes') }]}
        onCancel={cancel}
        dismissible={false}
        className="w-[520px]"
      >
        {promptBlock}
      </FormDialogShell>
    )
  }

  return (
    <FormDialogShell
      message={`连接 ${request.serverName}：`}
      buttons={[{ label: '确定', disabled: value === '', onClick: () => respond(value) }]}
      onCancel={cancel}
      dismissible={false}
    >
      {promptBlock}
      {request.savedRejected && (
        <div className="text-[12px] text-[color:var(--destructive)]">
          密码被服务器拒绝，请重新输入
        </div>
      )}
      <PasswordInput value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
      {request.canRemember && (
        <label className="flex cursor-pointer select-none items-center gap-2 text-[13px] text-foreground">
          <Checkbox checked={remember} onCheckedChange={setRemember} />
          <span>记住密码</span>
        </label>
      )}
    </FormDialogShell>
  )
}
