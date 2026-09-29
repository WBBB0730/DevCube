// 内置 SSH 连接的提问（docs/prd/ssh-connection.md「提问弹窗」）：主机指纹、密码、私钥口令、服务器的交互式提问
// 都经这里交给渲染端弹窗（渲染端排队，一次显示一个）。连接中途结束时，还没回答的提问随之撤下。

import { randomUUID } from 'node:crypto'
import type { SshPrompt, SshPromptRequest, SshPromptResponse } from '../shared/ssh-connect'

/** 提问怎么交给用户：由 ipc 绑定到主窗口（发请求 / 让过期的弹窗消失 / 通知记住了新密码）。 */
export interface SshPromptSink {
  request(request: SshPromptRequest): void
  dismiss(id: string): void
  passwordSaved(): void
}

/** 用户的回答（取消时 askSshPrompt 给 null）。 */
export interface SshPromptAnswer {
  answers: string[]
  remember: boolean
}

let sink: SshPromptSink | null = null
const pending = new Map<string, (answer: SshPromptAnswer | null) => void>()

export function setSshPromptSink(next: SshPromptSink): void {
  sink = next
}

/** 问用户；signal 中止（连接结束）时撤下弹窗、按取消处理。 */
export function askSshPrompt(
  destination: string,
  prompt: SshPrompt,
  signal: AbortSignal
): Promise<SshPromptAnswer | null> {
  return new Promise((resolve) => {
    if (sink === null || signal.aborted) {
      resolve(null)
      return
    }
    const id = randomUUID()
    const onAbort = (): void => {
      if (!pending.delete(id)) return
      sink?.dismiss(id)
      resolve(null)
    }
    pending.set(id, (answer) => {
      signal.removeEventListener('abort', onAbort)
      resolve(answer)
    })
    signal.addEventListener('abort', onAbort, { once: true })
    sink.request({ id, destination, prompt })
  })
}

export function respondSshPrompt(response: SshPromptResponse): void {
  const resolve = pending.get(response.id)
  if (resolve === undefined) return
  pending.delete(response.id)
  resolve(
    response.answers === null ? null : { answers: response.answers, remember: response.remember }
  )
}

/** 记住了新密码：左树与服务器对话框里的「已记住」要跟着变。 */
export function notifyPasswordSaved(): void {
  sink?.passwordSaved()
}
