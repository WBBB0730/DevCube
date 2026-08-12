import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolveReleaseEdition } from '../shared/release-edition'

const DEVELOPMENT_USER_DATA_DIRECTORY = 'DevCube Dev'

type UserDataApp = {
  isPackaged: boolean
  getVersion(): string
  getPath(name: 'appData'): string
  setPath(name: 'userData' | 'sessionData', path: string): void
}

/**
 * 为 Stable、Beta 与 Dev 显式固定各自的数据目录。
 * 必须在 app.ready、Store 初始化和 Chromium Session 创建之前调用。
 */
export function configureUserData(app: UserDataApp): void {
  const directory = app.isPackaged
    ? resolveReleaseEdition(app.getVersion()).userDataDirectory
    : DEVELOPMENT_USER_DATA_DIRECTORY
  const dataPath = join(app.getPath('appData'), directory)

  // Electron 官方要求 setPath 的目标目录已存在且为绝对路径。
  mkdirSync(dataPath, { recursive: true })
  app.setPath('userData', dataPath)
  app.setPath('sessionData', dataPath)
}
