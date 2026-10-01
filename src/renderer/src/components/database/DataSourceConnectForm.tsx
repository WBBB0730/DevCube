// 数据源没连上时的正文（Data Source Tab 与数据源上的配置的运行会话共用）：未连接 / 连接中 / 失败页同服务器的状态、文件 Tab；
// 要密码时（没记住，或给的密码被拒）直接在页面里出密码框，不另弹窗。连接中也由这里显示，免得密码框的输入、「记住密码」的
// 勾选与上一次给没给密码随「连接中」卸载而丢失——被拒后重问时要靠它们。
import { useEffect, useRef, useState } from 'react'
import { CHOICE_ROW, Checkbox } from '@renderer/components/ui/checkbox'
import { ConnectPlaceholder } from '@renderer/components/ui/connect-placeholder'
import { PasswordInput } from '@renderer/components/ui/password-input'
import { usePasswordUnavailableReason } from '@renderer/lib/connection-test'
import type {
  DataSourceConnectPassword,
  DataSourceNode,
  DataSourceSessionState
} from '@shared/data-source'
import { rememberPasswordDefault } from '@shared/ssh-connect'

export function DataSourceConnectForm({
  node,
  state,
  visible,
  onConnect
}: {
  node: DataSourceNode
  /** 未连接、连接中，或连不上（带原因与是否密码被拒） */
  state: Exclude<DataSourceSessionState, { phase: 'connected' }>
  /** 所在的页面显示着：切过来时聚焦密码框 */
  visible: boolean
  /** 点「连接 / 重新连接」：出了密码框时交上填的密码与「记住密码」的勾选，否则为 null（用记住的） */
  onConnect: (password: DataSourceConnectPassword | null) => void
}): React.JSX.Element {
  const unavailableReason = usePasswordUnavailableReason()
  const [password, setPassword] = useState('')
  // 「记住密码」的勾选：勾过就沿用上一次的（密码被拒后重问时不重置）；还没勾过时按是否已记住（同 SSH 提问弹窗）
  const [remember, setRemember] = useState<boolean | null>(null)
  // 本页上一次点「连接」时给没给密码（填了，或用记住的）。还没点过为 null：那次连接是自动发起的（新开 Tab、运行配置），
  // 没填密码，记住了就用记住的
  const [gavePassword, setGavePassword] = useState<boolean | null>(null)
  // 点「连接」时的状态：主进程回话之前（状态还是点的时候那一个）按连接中显示，免得拿刚点下的「给没给密码」去套旧状态，
  // 闪一下「密码被拒绝」
  const [submittedOn, setSubmittedOn] = useState<typeof state | null>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const { dataSource, hasPassword } = node
  const failed = state.phase === 'disconnected' ? state : null
  const rejected = failed?.passwordRejected === true
  // SQLite 没有密码；其余类型没记住密码、或密码被拒时，未连接页出密码框
  const askPassword =
    dataSource.target.kind !== 'sqlite' &&
    (state.phase === 'idle' || failed !== null) &&
    (!hasPassword || rejected)

  // 切到这页、或密码框刚出来时聚焦它：面板切走只是隐藏，隐藏时挂上的输入框 autoFocus 不生效
  useEffect(() => {
    if (visible && askPassword) passwordRef.current?.focus()
  }, [visible, askPassword])

  if (state.phase === 'connecting' || state === submittedOn) {
    return <ConnectPlaceholder phase="connecting" />
  }

  // 被拒分两种：给了密码（填的或记住的）被拒才提示被拒；根本没给（没记住、也没填）只是要求输入密码
  const denied = rejected && (gavePassword ?? hasPassword)
  const checked = rememberPasswordDefault(remember, hasPassword)
  const connect = (): void => {
    setSubmittedOn(state)
    setGavePassword(askPassword ? password !== '' : hasPassword)
    if (askPassword) {
      setRemember(checked)
      setPassword('')
    }
    onConnect(
      askPassword ? { value: password, remember: checked && unavailableReason === null } : null
    )
  }

  return (
    <ConnectPlaceholder
      form
      phase={failed !== null && !rejected ? 'failed' : 'idle'}
      message={
        failed === null
          ? `尚未连接到 ${dataSource.name}`
          : rejected
            ? `${dataSource.name} 要求输入密码`
            : failed.message
      }
      actionLabel={failed === null || (rejected && !denied) ? '连接' : '重新连接'}
      onAction={connect}
    >
      {askPassword && (
        <div className="flex w-64 flex-col gap-2">
          {denied && <div className="text-[12px] text-[color:var(--destructive)]">密码被拒绝</div>}
          <PasswordInput
            ref={passwordRef}
            value={password}
            placeholder="密码"
            onChange={(e) => setPassword(e.target.value)}
          />
          {unavailableReason === null && (
            <label className={CHOICE_ROW}>
              <Checkbox checked={checked} onCheckedChange={setRemember} />
              <span>记住密码</span>
            </label>
          )}
        </div>
      )}
    </ConnectPlaceholder>
  )
}
