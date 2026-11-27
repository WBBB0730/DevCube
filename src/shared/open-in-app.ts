/** 项目「打开于」外部桌面工具（字母序：Claude / Codex / Cursor / T3 Code）。 */

export const OPEN_IN_APP_IDS = ['claude', 'codex', 'cursor', 't3code'] as const
export type OpenInAppId = (typeof OPEN_IN_APP_IDS)[number]

export type OpenInAppResult = { ok: true } | { ok: false; error: string }

export const OPEN_IN_APP_LABELS: Record<OpenInAppId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  t3code: 'T3 Code'
}

/** Codex Desktop：官方 `codex://threads/new?path=` deep link。 */
export function buildCodexNewThreadUrl(projectPath: string): string {
  return `codex://threads/new?path=${encodeURIComponent(projectPath)}`
}

/** Claude Desktop Code 标签：官方 `claude://code/new?folder=` deep link。 */
export function buildClaudeCodeNewSessionUrl(projectPath: string): string {
  return `claude://code/new?folder=${encodeURIComponent(projectPath)}`
}

export function unavailableReasonFor(id: OpenInAppId): string {
  return `未检测到 ${OPEN_IN_APP_LABELS[id]}`
}

export function isOpenInAppId(value: unknown): value is OpenInAppId {
  return typeof value === 'string' && (OPEN_IN_APP_IDS as readonly string[]).includes(value)
}
