/** 主进程 → 渲染层的更新状态快照（IPC 载荷）。 */

import type { AppUpdatePhase, UpdateButtonAction, UpdatePackaging } from './app-update'

export type AppUpdateState = {
  phase: AppUpdatePhase
  packaging: UpdatePackaging
  /** 当前应用版本（app.getVersion） */
  currentVersion: string
  /** 显示名（DevCube / DevCube Beta） */
  productName: string
  /** 正式 / beta */
  channel: 'stable' | 'beta'
  /** 候选 / 已下载版本；无则为 null */
  availableVersion: string | null
  /** 顶栏是否显示更新按钮 */
  showButton: boolean
  /** 顶栏按钮点击语义；无按钮时仍给出默认，便于关于页分支 */
  buttonAction: UpdateButtonAction
  /** 是否启用检查（未包装开发 / 便携 / 可自动更新为 true；如 Linux 包装占位为 false） */
  checksEnabled: boolean
  /** 最近一次检查/下载错误文案；无则为 null */
  lastError: string | null
  /** 关于页仓库链接 */
  repoUrl: string
  /** 关于页 / 便携按钮用的 Release URL；无候选则为仓库 releases 页 */
  releaseUrl: string
}
