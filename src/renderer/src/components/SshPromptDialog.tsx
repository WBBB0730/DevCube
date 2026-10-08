// 内置 SSH 连接的提问弹窗（docs/prd/ssh-connection.md「提问弹窗」，ADR-0041）：一次答一个，文案照 WebStorm。
// 首行 muted 写明正在连接哪台主机（经跳板机时为那一跳）。主机未知：核对指纹后「连接」；主机密钥已更改：醒目警告，
// 「更新并连接」为危险样式；密码与私钥口令为遮挡输入，可勾「记住密码」/「记住口令」；服务器的交互式提问逐项作答。
// 它可能叠在别的对话框上（如服务器对话框里测试连接时）：Esc 只取消这一次提问；点遮罩不收口，只认明确的按钮。
import { useState } from 'react'
import { CHOICE_ROW, Checkbox } from '@renderer/components/ui/checkbox'
import { FormDialogShell } from '@renderer/components/ui/form-dialog'
import { Input } from '@renderer/components/ui/input'
import { PasswordInput } from '@renderer/components/ui/password-input'
import { useApp } from '@renderer/store'
import type { SshPrompt, SshPromptRequest } from '@shared/ssh-connect'

const FINGERPRINT =
  'select-text break-all rounded bg-[var(--bg-panel)] px-2.5 py-2 font-mono text-[12px] text-foreground'

export function SshPromptDialog({ request }: { request: SshPromptRequest }): React.JSX.Element {
  const answer = useApp((s) => s.answerSshPrompt)
  const cancel = (): void => answer({ id: request.id, answers: null, remember: false })
  const respond = (answers: string[], remember = false): void =>
    answer({ id: request.id, answers, remember })
  const heading = (
    <div className="mb-1 text-[12px] text-muted-foreground">
      SSH：正在连接到 {request.destination}
    </div>
  )
  const { prompt } = request

  if (prompt.kind === 'host-unknown') {
    return (
      <FormDialogShell
        message={
          <>
            {heading}
            无法确定主机 &apos;{prompt.host}&apos; 的真实性。{prompt.keyType} 密钥指纹为：
          </>
        }
        buttons={[{ label: '连接', onClick: () => respond([]) }]}
        onCancel={cancel}
        className="w-[520px]"
      >
        <div className={FINGERPRINT}>{prompt.fingerprint}</div>
        <div className="text-[13px] text-foreground">确定要继续连接吗？</div>
      </FormDialogShell>
    )
  }

  if (prompt.kind === 'host-changed') {
    return (
      <FormDialogShell
        message={
          <>
            {heading}
            <span className="font-semibold text-[color:var(--destructive)]">
              警告：远程主机标识已更改！
            </span>
            可能有人在做坏事！此刻可能有人在偷听您（中间人攻击）！也可能是主机密钥刚被更改。远程主机发送的{' '}
            {prompt.keyType} 密钥的指纹为：
          </>
        }
        buttons={[{ label: '更新并连接', destructive: true, onClick: () => respond([]) }]}
        onCancel={cancel}
        className="w-[520px]"
      >
        <div className={FINGERPRINT}>{prompt.fingerprint}</div>
        <div className="select-text text-[13px] text-foreground">
          是否要更新 {prompt.knownHostsFile} 中的密钥并恢复连接？
        </div>
      </FormDialogShell>
    )
  }

  if (prompt.kind === 'challenge') {
    return <ChallengeForm heading={heading} prompt={prompt} onAnswer={respond} onCancel={cancel} />
  }

  return <SecretForm heading={heading} prompt={prompt} onAnswer={respond} onCancel={cancel} />
}

/** 密码与私钥口令：遮挡输入 + 记住勾选（钥匙串不可用、测试连接时不出现）。 */
function SecretForm({
  heading,
  prompt,
  onAnswer,
  onCancel
}: {
  heading: React.ReactNode
  prompt: Extract<SshPrompt, { kind: 'password' | 'passphrase' }>
  onAnswer: (answers: string[], remember: boolean) => void
  onCancel: () => void
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const [remember, setRemember] = useState(
    prompt.kind === 'password' ? prompt.rememberDefault : false
  )
  const password = prompt.kind === 'password'
  return (
    <FormDialogShell
      message={
        <>
          {heading}
          {password ? (
            '密码：'
          ) : (
            <span className="break-all">文件的私钥口令：{prompt.keyFile}</span>
          )}
        </>
      }
      buttons={[
        {
          label: '确定',
          disabled: value === '',
          onClick: () => onAnswer([value], remember && prompt.canRemember)
        }
      ]}
      onCancel={onCancel}
    >
      {prompt.rejected && (
        <div className="text-[12px] text-[color:var(--destructive)]">
          {password ? '密码被服务器拒绝，请重新输入' : '口令不正确，请重新输入'}
        </div>
      )}
      <PasswordInput value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
      {prompt.canRemember && (
        <label className={CHOICE_ROW}>
          <Checkbox checked={remember} onCheckedChange={setRemember} />
          <span>{password ? '记住密码' : '记住口令'}</span>
        </label>
      )}
    </FormDialogShell>
  )
}

/** 服务器的交互式提问（验证码、多步认证）：原样显示标题与说明，每项一个输入框，不回显的遮挡。 */
function ChallengeForm({
  heading,
  prompt,
  onAnswer,
  onCancel
}: {
  heading: React.ReactNode
  prompt: Extract<SshPrompt, { kind: 'challenge' }>
  onAnswer: (answers: string[]) => void
  onCancel: () => void
}): React.JSX.Element {
  const [values, setValues] = useState(() => prompt.prompts.map(() => ''))
  const title = prompt.name.trim()
  const instructions = prompt.instructions.trim()
  return (
    <FormDialogShell
      message={
        <>
          {heading}
          {title === '' ? '服务器要求验证：' : title}
        </>
      }
      buttons={[{ label: '确定', onClick: () => onAnswer(values) }]}
      onCancel={onCancel}
    >
      {instructions !== '' && (
        <div className="max-h-48 select-text overflow-y-auto whitespace-pre-wrap break-words text-[13px] text-foreground">
          {instructions}
        </div>
      )}
      {prompt.prompts.map((item, i) => {
        const props = {
          value: values[i],
          autoFocus: i === 0,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            setValues((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
        }
        return (
          <div key={i}>
            <div className="mb-1 select-text whitespace-pre-wrap text-[12px] text-muted-foreground">
              {item.prompt.trim()}
            </div>
            {item.echo ? <Input {...props} /> : <PasswordInput {...props} />}
          </div>
        )
      })}
    </FormDialogShell>
  )
}
