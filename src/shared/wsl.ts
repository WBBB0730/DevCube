/** WSL 项目的连接（docs/prd/wsl-project.md、ADR-0055）：状态与「闲置后断开」偏好，main / renderer 共用。 */

/** 一个发行版的连接状态；failed 带上给用户看的原因。 */
export type WslConnectionState =
  | { status: 'disconnected' }
  | { status: 'connecting' }
  | { status: 'connected' }
  | { status: 'failed'; reason: string }

/** 推给渲染端的连接状态变化（发行版名按首次见到的写法）。 */
export interface WslStateEvent {
  distro: string
  state: WslConnectionState
}

/** 「闲置后断开 WSL」的可选值（分钟）；null 为从不。 */
export type WslIdleMinutes = 5 | 10 | 15 | 30 | null

export const WSL_IDLE_MINUTES_OPTIONS: readonly WslIdleMinutes[] = [5, 10, 15, 30, null]

export const DEFAULT_WSL_IDLE_MINUTES: WslIdleMinutes = 15

export function isWslIdleMinutes(value: unknown): value is WslIdleMinutes {
  return (WSL_IDLE_MINUTES_OPTIONS as readonly unknown[]).includes(value)
}
