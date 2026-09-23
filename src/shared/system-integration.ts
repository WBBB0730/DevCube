/** 系统集成（External Open 入口）的开关状态；全部实时探测、不落盘。术语见 CONTEXT.md。 */

export const SYSTEM_INTEGRATION_FEATURE_IDS = [
  'quickAction',
  'cliShim',
  'codexOpenIn',
  'windowsContextMenu',
  'openWithImage',
  'openWithPdf',
  'openWithPptx',
  'openWithXlsx',
  'openWithAudio',
  'openWithVideo'
] as const

/** 「文件打开方式」各类型子项（docs/prd/file-preview-window.md）：设为默认而非安装 / 移除 */
export const OPEN_WITH_FEATURE_IDS = [
  'openWithImage',
  'openWithPdf',
  'openWithPptx',
  'openWithXlsx',
  'openWithAudio',
  'openWithVideo'
] as const
export type OpenWithFeatureId = (typeof OPEN_WITH_FEATURE_IDS)[number]

export function isOpenWithFeatureId(id: SystemIntegrationFeatureId): id is OpenWithFeatureId {
  return (OPEN_WITH_FEATURE_IDS as readonly string[]).includes(id)
}

export type SystemIntegrationFeatureId = (typeof SYSTEM_INTEGRATION_FEATURE_IDS)[number]

export interface SystemIntegrationFeature {
  id: SystemIntegrationFeatureId
  available: boolean
  /** install 型：已安装；default 型：已是默认打开方式 */
  enabled: boolean
  /**
   * install：安装 / 移除开关（默认）。
   * default：「设为默认」单向动作——macOS / Linux 直接生效；Windows 只能注册候选再由用户在系统「默认应用」页点选。
   */
  mode?: 'install' | 'default'
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
