// 连接类表单（服务器对话框、数据源对话框）共用的 Hook：「记住密码」是否可用、测试连接的状态。
import { useCallback, useEffect, useState } from 'react'
import type { ConnectionTestResult } from '@shared/connection'

/** 测试连接的调用：同一时刻只测一个，新测试会取消旧的；cancel 取消进行中的测试。应为模块级常量。 */
export interface ConnectionTestApi<I> {
  test: (input: I) => Promise<ConnectionTestResult>
  cancel: () => Promise<void>
}

/** 「记住密码」为什么不可用（没有可用的系统钥匙串）；可用或尚未查到时为 null。 */
export function usePasswordUnavailableReason(): string | null {
  const [reason, setReason] = useState<string | null>(null)
  useEffect(() => {
    void window.api.getPasswordUnavailableReason().then(setReason)
  }, [])
  return reason
}

/**
 * 测试连接：结果只对发起测试时的表单内容有效——内容一改、或又开始测试，旧结果就不再显示。
 * 失败时另弹错误框；closeFailureDialog 只关错误框，结果留着。
 * 对话框关闭时取消还在进行的测试（其间弹出的 ssh 提问随之撤下）。
 */
export function useConnectionTest<I>(
  input: I | null,
  api: ConnectionTestApi<I>
): {
  testing: boolean
  result: Exclude<ConnectionTestResult, { status: 'canceled' }> | null
  failureDialogOpen: boolean
  start: () => void
  closeFailureDialog: () => void
} {
  const signature = input === null ? null : JSON.stringify(input)
  const [testing, setTesting] = useState(false)
  const [done, setDone] = useState<{
    signature: string
    result: Exclude<ConnectionTestResult, { status: 'canceled' }>
    failureDialogOpen: boolean
  } | null>(null)

  useEffect(() => () => void api.cancel(), [api])
  const closeFailureDialog = useCallback(
    () => setDone((d) => (d === null ? d : { ...d, failureDialogOpen: false })),
    []
  )

  const start = (): void => {
    if (input === null || signature === null) return
    setTesting(true)
    void api.test(input).then((result) => {
      // 被新一次测试取代：旧结果作废，转圈交给新测试
      if (result.status === 'canceled') return
      setTesting(false)
      setDone({ signature, result, failureDialogOpen: result.status === 'failed' })
    })
  }

  const current = !testing && done !== null && done.signature === signature ? done : null
  return {
    testing,
    result: current?.result ?? null,
    failureDialogOpen: current?.failureDialogOpen === true,
    start,
    closeFailureDialog
  }
}
