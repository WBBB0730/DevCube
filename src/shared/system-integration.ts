/** 系统集成（External Open 入口）的开关状态；全部实时探测、不落盘。术语见 CONTEXT.md。 */

export const SYSTEM_INTEGRATION_FEATURE_IDS = [
  'quickAction',
  'cliShim',
  'codexOpenIn',
  'windowsContextMenu'
] as const

export type SystemIntegrationFeatureId = (typeof SYSTEM_INTEGRATION_FEATURE_IDS)[number]

export interface SystemIntegrationFeature {
  id: SystemIntegrationFeatureId
  available: boolean
  enabled: boolean
  /** 不可用时的说明（置灰 hover / 行内展示） */
  unavailableReason?: string
}

export interface SystemIntegrationState {
  /** Edition 展示名（入口文案「在 <productName> 中打开」） */
  productName: string
  /** macOS CLI 命令名（devcube / devcube-beta） */
  cliName: string
  /** 当前平台可呈现的功能（按平台过滤后的列表） */
  features: SystemIntegrationFeature[]
}

export type SystemIntegrationApplyResult =
  | { ok: true; state: SystemIntegrationState }
  | { ok: false; error: string; state: SystemIntegrationState }

export function isSystemIntegrationFeatureId(value: unknown): value is SystemIntegrationFeatureId {
  return (
    typeof value === 'string' &&
    (SYSTEM_INTEGRATION_FEATURE_IDS as readonly string[]).includes(value)
  )
}
