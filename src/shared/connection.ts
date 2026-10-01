// 服务器（Server）与数据源（Data Source）的连接共用的规则：表单对记住的密码的处理、端口的解析与校验、
// 绕开代理直连在哪些平台提供、连接与测试连接的时限、网络错误的中文原因。

/**
 * 表单对记住的密码的处理（保存与测试连接共用同一种写法）：
 * undefined = 不动，沿用记住的；null = 不要记住的密码（清除）；字符串 = 换成这个。
 */
export type PasswordChange = string | null | undefined

/**
 * 表单里的密码框与「记住密码」勾选换成的处理：saved 交给添加 / 编辑，test 用于测试连接。
 * 保存：勾着时填了新密码即换成它、没填则沿用记住的；不勾时，编辑即删掉记住的，添加即不记。
 * 测试：填了就用填的；没填时，编辑中且勾着才用记住的。
 */
export function passwordChangesOf(
  typed: string,
  remember: boolean,
  editing: boolean
): { saved: PasswordChange; test: PasswordChange } {
  const change = typed === '' ? undefined : typed
  return {
    saved: remember ? change : editing ? null : undefined,
    test: change ?? (editing && remember ? undefined : null)
  }
}

/** 表单里按文本存的端口换成端口号，交给 portError 校验：没填为 NaN。 */
export function portOfText(text: string): number {
  return text.trim() === '' ? Number.NaN : Number(text.trim())
}

/** 端口校验：可以提交时为 null。 */
export function portError(port: number): string | null {
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? null : '端口应为 1–65535 的整数'
}

/** 绕开代理直连只在 macOS / Windows 提供：Linux 按目标地址选路，普通进程绕不开 TUN（ADR-0039）。 */
export function supportsDirectRoute(platform: string): boolean {
  return platform === 'darwin' || platform === 'win32'
}

/** 连接超时：地址填错时不必干等系统的一分多钟。SSH 的 ConnectTimeout 未设置时用它。 */
export const CONNECT_TIMEOUT_MS = 15_000

/** 测试连接的总时限：含查直连路线、用户回答提问（确认指纹、输口令）的时间；到时报「连接超时」。 */
export const TEST_CONNECTION_TIMEOUT_MS = 120_000

/** 测试连接的结果：被新一次测试取代、被取消时为 canceled。 */
export type ConnectionTestResult =
  { status: 'ok' } | { status: 'failed'; message: string } | { status: 'canceled' }

const NETWORK_REASONS: Record<string, string> = {
  ECONNREFUSED: '连接被拒绝',
  ETIMEDOUT: '连接超时',
  ENOTFOUND: '找不到主机',
  EAI_AGAIN: '找不到主机',
  EAI_NONAME: '找不到主机',
  ENETUNREACH: '网络不可达',
  EHOSTUNREACH: '网络不可达',
  ECONNRESET: '连接被服务器重置',
  EPIPE: '连接被服务器重置'
}

/** Node 网络错误码的中文原因；不是网络错误时为 undefined。 */
export function networkErrorReason(code: string | undefined): string | undefined {
  return code === undefined ? undefined : NETWORK_REASONS[code]
}
