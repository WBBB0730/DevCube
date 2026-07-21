/** 应用内更新策略（形态 / 身份过滤 / 顶栏按钮）。实现细节见 docs/prd/in-app-update.md、ADR-0014。 */

import { resolveReleaseEdition, type ReleaseEdition } from './release-edition'

/** 包装形态：决定能否静默下载安装。 */
export type UpdatePackaging = 'dev' | 'macApp' | 'nsis' | 'portable'

/** 更新流水线对外可观察阶段（供关于页与顶栏）。 */
/** idle = 尚未检查；upToDate = 已检查且无适用更新。 */
export type AppUpdatePhase =
  | 'idle'
  | 'checking'
  | 'upToDate'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error'

export type UpdateCandidate = {
  version: string
  /** GitHub Release 是否标为 Pre-release */
  prerelease: boolean
}

export type UpdateButtonAction = 'quitAndInstall' | 'openRelease'

export const GITHUB_REPO_URL = 'https://github.com/WBBB0730/DevCube'

/** 指向某一版 GitHub Release 页（tag 带或不带 v 前缀均可）。 */
export function githubReleaseUrl(version: string): string {
  const tag = version.startsWith('v') ? version : `v${version}`
  return `${GITHUB_REPO_URL}/releases/tag/${tag}`
}

/**
 * 解析当前包装形态。
 * Windows Portable 由 electron-builder 注入的 PORTABLE_EXECUTABLE_DIR 判别。
 */
export function resolveUpdatePackaging(input: {
  isPackaged: boolean
  platform: NodeJS.Platform
  portableExecutableDir?: string | undefined
}): UpdatePackaging {
  if (!input.isPackaged) return 'dev'
  if (input.platform === 'win32') {
    return input.portableExecutableDir ? 'portable' : 'nsis'
  }
  if (input.platform === 'darwin') return 'macApp'
  return 'dev'
}

/** 该形态是否走静默下载 + quitAndInstall。 */
export function canAutoDownload(packaging: UpdatePackaging): boolean {
  return packaging === 'macApp' || packaging === 'nsis'
}

/**
 * 候选是否属于当前 Release Edition（身份封闭）。
 * 正式：非 Pre-release 且版本解析为正式；Beta：Pre-release 且版本解析为 beta。
 */
export function isUpdateAllowedForEdition(
  edition: ReleaseEdition,
  candidate: UpdateCandidate
): boolean {
  if (edition.channel === 'stable') {
    if (candidate.prerelease) return false
  } else if (!candidate.prerelease) {
    return false
  }

  try {
    return resolveReleaseEdition(candidate.version).channel === edition.channel
  } catch {
    return false
  }
}

/** 顶栏更新按钮是否显示。 */
export function shouldShowUpdateButton(packaging: UpdatePackaging, phase: AppUpdatePhase): boolean {
  if (packaging === 'dev') return false
  if (packaging === 'portable') return phase === 'available'
  return phase === 'ready'
}

/** 顶栏更新按钮点击语义。 */
export function updateButtonAction(packaging: UpdatePackaging): UpdateButtonAction {
  return packaging === 'portable' ? 'openRelease' : 'quitAndInstall'
}
