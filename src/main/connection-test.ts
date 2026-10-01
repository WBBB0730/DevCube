// 测试连接的执行（服务器、数据源的对话框共用；docs/prd/ssh-server.md、docs/prd/database.md）：同一时刻只测一个——新测试
// 取消旧的，旧的以 canceled 收口；整次最多 TEST_CONNECTION_TIMEOUT_MS（含用户回答提问的时间），到点报「连接超时」。

import { TEST_CONNECTION_TIMEOUT_MS, type ConnectionTestResult } from '../shared/connection'

export interface ConnectionTester {
  /** 测试一次：test 收到的信号在新测试开始、被取消或超时时中止；test 出错时由 describe 转成说明文字。 */
  run: (
    test: (signal: AbortSignal) => Promise<void>,
    describe: (error: unknown) => string
  ) => Promise<ConnectionTestResult>
  /** 取消进行中的测试（对话框关闭时）。 */
  cancel: () => void
}

/** 一类连接（服务器、数据源）的测试连接，各自同一时刻只测一个。 */
export function createConnectionTester(): ConnectionTester {
  /** 进行中的测试；一开始就登记，准备阶段被取消也不会漏 */
  let active: AbortController | null = null
  return {
    run: async (test, describe) => {
      active?.abort()
      const controller = new AbortController()
      active = controller
      const timeout = AbortSignal.timeout(TEST_CONNECTION_TIMEOUT_MS)
      try {
        await test(AbortSignal.any([controller.signal, timeout]))
        return { status: 'ok' }
      } catch (error) {
        if (controller.signal.aborted) return { status: 'canceled' }
        if (timeout.aborted) return { status: 'failed', message: '连接超时' }
        return { status: 'failed', message: describe(error) }
      } finally {
        if (active === controller) active = null
      }
    },
    cancel: () => active?.abort()
  }
}
