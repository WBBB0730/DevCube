/** 发行身份：由 semver 版本派生正式版 / beta 的安装身份字段。 */

type ReleaseChannel = 'stable' | 'beta'

export type ReleaseEdition = {
  channel: ReleaseChannel
  /** GitHub Release 是否标为 Pre-release */
  prerelease: boolean
  appId: string
  productName: string
  executableName: string
  /** npm `name` / 制品名里的 ${name} */
  name: string
  /** electron-builder `directories.buildResources` */
  buildResources: string
  /** 应用图标（相对仓库根；macOS / Linux 保留安全边距） */
  icon: string
  /** Windows 安装包 / 快捷方式图标（已裁掉透明边距） */
  winIcon: string
}

const STABLE: ReleaseEdition = {
  channel: 'stable',
  prerelease: false,
  appId: 'com.wbbb.devcube',
  productName: 'DevCube',
  executableName: 'devcube',
  name: 'devcube',
  buildResources: 'build',
  icon: 'build/icon.png',
  winIcon: 'build/icon-win.png'
}

const BETA: ReleaseEdition = {
  channel: 'beta',
  prerelease: true,
  appId: 'com.wbbb.devcube.beta',
  productName: 'DevCube Beta',
  executableName: 'devcube-beta',
  name: 'devcube-beta',
  buildResources: 'build/beta',
  icon: 'build/beta/icon.png',
  winIcon: 'build/beta/icon-win.png'
}

/** 只接受正式版与 beta / beta.N；其它 prerelease 必须阻止发版。 */
function resolveReleaseChannel(version: string): ReleaseChannel {
  const withoutBuild = version.split('+', 1)[0]!
  const dash = withoutBuild.indexOf('-')
  if (dash < 0) return 'stable'

  const prerelease = withoutBuild.slice(dash + 1)
  if (/^beta(?:\.(?:0|[1-9]\d*))?$/.test(prerelease)) return 'beta'
  throw new Error(`Unsupported release version: ${version}`)
}

export function resolveReleaseEdition(version: string): ReleaseEdition {
  return resolveReleaseChannel(version) === 'beta' ? BETA : STABLE
}
