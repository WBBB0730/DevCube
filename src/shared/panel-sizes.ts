/**
 * 记住尺寸的可拖面板（docs/prd/resizable-panels.md、ADR-0053）：键 → 尺寸，全局各一份（不按项目）。
 * 侧栏宽与 Git 详情高存像素；两处分栏存所在面板组的百分比（单位与限位见渲染端 lib/remembered-panel）。
 * 没有某个键 = 没拖过，用默认尺寸。
 */
export const PANEL_SIZE_KEYS = [
  /** 左侧项目树宽 */
  'projectTree',
  /** 右侧树宽：文件树、数据源目录、Redis 键列表共用 */
  'treePanel',
  /** Git 详情区高 */
  'gitDetailsHeight',
  /** Git 详情左栏（摘要 / 提交表单）占比 */
  'gitDetailsSplit',
  /** 内容搜索预览区占比 */
  'contentSearchSplit'
] as const

export type PanelSizeKey = (typeof PANEL_SIZE_KEYS)[number]

export type PanelSizes = Partial<Record<PanelSizeKey, number>>

/** 尺寸改动：数值即记下，null 即清掉（双击分隔线回默认）。 */
export type PanelSizesPatch = Partial<Record<PanelSizeKey, number | null>>

function isSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** 只留已知键里的有限正数（老档案或脏值不进来）。 */
export function normalizePanelSizes(raw: unknown): PanelSizes {
  const out: PanelSizes = {}
  if (raw === null || typeof raw !== 'object') return out
  const record = raw as Record<string, unknown>
  for (const key of PANEL_SIZE_KEYS) {
    const value = record[key]
    if (isSize(value)) out[key] = value
  }
  return out
}

export function applyPanelSizesPatch(sizes: PanelSizes, patch: PanelSizesPatch): PanelSizes {
  const next: PanelSizes = { ...sizes }
  for (const key of PANEL_SIZE_KEYS) {
    if (!(key in patch)) continue
    const value = patch[key]
    if (isSize(value)) next[key] = value
    else delete next[key]
  }
  return next
}
