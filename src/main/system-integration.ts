import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { resolveReleaseEdition } from '../shared/release-edition'
import {
  OPEN_WITH_FEATURE_IDS,
  isOpenWithFeatureId,
  type SystemIntegrationApplyResult,
  type SystemIntegrationFeature,
  type SystemIntegrationFeatureId,
  type SystemIntegrationState
} from '../shared/system-integration'
import { probeOpenWith, setOpenWithDefault } from './default-opener'
import {
  DEV_OPENER_APP_ID,
  devElectronAppPath,
  devOpenerAppPath,
  ensureDevOpenerApp
} from './dev-opener-app'
import { candidateAppPaths } from './open-in-app'
import {
  hasCodexHandler,
  readCodexConfig,
  removeCodexHandler,
  upsertCodexHandler,
  writeCodexConfig,
  type CodexHandlerSpec
} from './codex-open-in'
import {
  installCliShim,
  isCliShimInstalled,
  uninstallCliShim,
  type CliShimOptions
} from './cli-shim'
import {
  compressQuickActionShellCommand,
  installQuickAction,
  isQuickActionInstalled,
  quickActionShellCommand,
  uninstallQuickAction
} from './quick-action'
import {
  installWindowsContextMenu,
  isWindowsContextMenuInstalled,
  uninstallWindowsContextMenu
} from './windows-context-menu'
import {
  installWindowsCompressMenu,
  isCompressMenuDllBundled,
  isWindowsCompressMenuInstalled,
  syncWindowsCompressMenu,
  uninstallWindowsCompressMenu
} from './windows-compress-menu'

/** 系统集成编排：按平台列出功能、探测状态、执行安装 / 移除。状态全部实时探测不落盘。 */

/** 各入口共用的注册身份：打包走 Release Edition，Dev 以「DevCube Dev」独立分线不抢注。 */
export type IntegrationProfile = {
  /** 入口显示名（菜单文案「在 <productName> 中打开」/ Codex label） */
  productName: string
  /** CLI 命令名 / Codex handler id（devcube / devcube-beta / devcube-dev） */
  name: string
  /** macOS 唤起：open(1) 参数——打包 `-b <bundleId>`；Dev `-a <electron App 路径>`（运行中的 dev 实例收 open-file；未运行则仅拉起空 Electron） */
  macOpenArgs: string[]
  /** deep link scheme（与主进程 open-url 解析同源：Release Edition 的 name）；Dev 不注册协议，经 open -a 直接投递 */
  deepLinkScheme: string
  /** Windows 唤起命令——打包 [exe]（便携版为便携 exe 本身）；Dev [electron.exe, 项目入口]（第二实例把路径转发给运行中的 dev 实例） */
  windowsLaunch: string[]
  /** macOS 文件打开方式的实体 .app：打包 = 正在运行的应用本体；Dev = 数据目录里生成的「DevCube Dev.app」小壳 */
  macAppPath: string
  /** 上述实体的 bundle id（打包 Edition appId；Dev 小壳 com.wbbb.devcube.dev） */
  macBundleId: string
  /** macOS 正在运行的 Electron.app（Dev 小壳把文件转发到它） */
  macElectronApp: string
  /** 入口图标（png；Codex 必填、快速操作嵌入 workflow） */
  iconPath: string
}

function integrationProfile(): IntegrationProfile {
  const macElectronApp = process.platform === 'darwin' ? devElectronAppPath() : process.execPath
  const edition = resolveReleaseEdition(app.getVersion())
  if (app.isPackaged) {
    return {
      productName: edition.productName,
      name: edition.executableName,
      macOpenArgs: ['-b', edition.appId],
      deepLinkScheme: edition.name,
      // 便携版取便携 exe 本身：运行时解压出的那份在临时目录里，应用退出即删（electron-builder portable.nsi）
      windowsLaunch: [process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath],
      macAppPath: macElectronApp,
      macBundleId: edition.appId,
      macElectronApp,
      iconPath: join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'icon.png')
    }
  }
  // Dev 无安装身份：mac 以 electron App bundle 路径经 `open -a` 唤起，win 以 electron.exe + 项目入口；
  // 文件打开方式另有生成的「DevCube Dev.app」小壳作实体（dev-opener-app）
  return {
    productName: 'DevCube Dev',
    name: 'devcube-dev',
    macOpenArgs: ['-a', macElectronApp],
    deepLinkScheme: edition.name,
    windowsLaunch: [process.execPath, app.getAppPath()],
    macAppPath: devOpenerAppPath(),
    macBundleId: DEV_OPENER_APP_ID,
    macElectronApp,
    iconPath: join(app.getAppPath(), 'resources', 'icon.png')
  }
}

/** Windows 压缩右键扩展的 DLL（scripts/build-win-shell.ts 产物）：打包在 resources 下，Dev 在仓库 build/win 下 */
function compressMenuDll(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'compress-menu.dll')
    : join(app.getAppPath(), 'build', 'win', 'compress-menu.dll')
}

function cliShimOptions(profile: IntegrationProfile): CliShimOptions {
  return {
    cliName: profile.name,
    productName: profile.productName,
    openArgs: profile.macOpenArgs,
    scriptDir: join(app.getPath('userData'), 'bin')
  }
}

/** Codex 桌面端（随 ChatGPT 分发）是否在装：只认 .app / .exe，CLI 不算（同「打开于」口径）。 */
async function isCodexDesktopInstalled(): Promise<boolean> {
  const paths = candidateAppPaths('codex', process.platform, process.env, homedir())
  for (const p of paths) {
    try {
      await access(p)
      return true
    } catch {
      // continue
    }
  }
  return false
}

function codexHandlerSpec(profile: IntegrationProfile): CodexHandlerSpec {
  const base = { id: profile.name, label: profile.productName, icon: profile.iconPath }
  if (process.platform === 'darwin') {
    return { ...base, command: '/usr/bin/open', args: profile.macOpenArgs }
  }
  const [command, ...args] = profile.windowsLaunch
  return { ...base, command, ...(args.length > 0 ? { args } : {}) }
}

/** 当前平台可呈现的功能列表（linux 只有「文件打开方式」：目录打开方式由 desktop entry 声明、CLI 由 deb 自带）。 */
function platformFeatureIds(): SystemIntegrationFeatureId[] {
  const openWith = [...OPEN_WITH_FEATURE_IDS]
  if (process.platform === 'darwin') {
    return ['quickAction', 'quickActionCompress', 'cliShim', 'codexOpenIn', ...openWith]
  }
  if (process.platform === 'win32') {
    return ['windowsContextMenu', 'windowsCompressMenu', 'codexOpenIn', ...openWith]
  }
  return openWith
}

async function probeFeature(
  id: SystemIntegrationFeatureId,
  profile: IntegrationProfile
): Promise<SystemIntegrationFeature> {
  if (isOpenWithFeatureId(id)) {
    const probe = await probeOpenWith(id, profile)
    return { id, mode: 'default', ...probe }
  }
  switch (id) {
    case 'quickAction':
      return {
        id,
        available: true,
        enabled: await isQuickActionInstalled('open', profile.productName)
      }
    case 'quickActionCompress':
      return {
        id,
        available: true,
        enabled: await isQuickActionInstalled('compress', profile.productName)
      }
    case 'cliShim':
      return { id, available: true, enabled: await isCliShimInstalled(cliShimOptions(profile)) }
    case 'windowsContextMenu':
      return {
        id,
        available: true,
        enabled: await isWindowsContextMenuInstalled(profile.productName)
      }
    case 'windowsCompressMenu': {
      const enabled = await isWindowsCompressMenuInstalled(profile)
      // 没带上扩展 DLL 的构建（如未编译的开发环境）不能安装；已装的仍可移除
      const available = enabled || (await isCompressMenuDllBundled(compressMenuDll()))
      return {
        id,
        available,
        enabled,
        ...(available ? {} : { unavailableReason: '此构建未包含右键扩展组件' })
      }
    }
    case 'codexOpenIn': {
      const installed = await isCodexDesktopInstalled()
      const enabled = hasCodexHandler(await readCodexConfig(), profile.name)
      // 已注册但 Codex 已卸载时仍可取消注册
      const available = installed || enabled
      return {
        id,
        available,
        enabled,
        ...(available ? {} : { unavailableReason: '未检测到 Codex (ChatGPT) 桌面端' })
      }
    }
  }
}

export async function getSystemIntegrationState(): Promise<SystemIntegrationState> {
  const profile = integrationProfile()
  const features = await Promise.all(platformFeatureIds().map((id) => probeFeature(id, profile)))
  return {
    productName: profile.productName,
    cliName: profile.name,
    // Codex 未装且未注册则不列出；已注册但应用已卸时仍列出以便移除
    features: features.filter((f) => f.available)
  }
}

async function applyCodexOpenIn(profile: IntegrationProfile, enable: boolean): Promise<void> {
  const source = await readCodexConfig()
  const edit = enable
    ? upsertCodexHandler(source, codexHandlerSpec(profile))
    : removeCodexHandler(source, profile.name)
  if (!edit.ok) throw new Error(edit.error)
  if (edit.changed) await writeCodexConfig(edit.text)
}

export async function applySystemIntegration(
  id: SystemIntegrationFeatureId,
  enable: boolean
): Promise<SystemIntegrationApplyResult> {
  const profile = integrationProfile()
  try {
    if (isOpenWithFeatureId(id)) {
      if (!enable) throw new Error('默认打开方式只能设置，不能从这里取消')
      // Dev：小壳启动时已同步，这里兜底（指纹一致即跳过）
      if (!app.isPackaged && process.platform === 'darwin') {
        await ensureDevOpenerApp(profile.macElectronApp)
      }
      await setOpenWithDefault(id, profile)
      return { ok: true, state: await getSystemIntegrationState() }
    }
    switch (id) {
      case 'quickAction':
        if (enable)
          await installQuickAction(
            'open',
            profile.productName,
            quickActionShellCommand(profile.macOpenArgs),
            { iconSource: profile.iconPath }
          )
        else await uninstallQuickAction('open', profile.productName)
        break
      case 'quickActionCompress':
        if (enable)
          await installQuickAction(
            'compress',
            profile.productName,
            compressQuickActionShellCommand(profile.macOpenArgs, profile.deepLinkScheme),
            { iconSource: profile.iconPath }
          )
        else await uninstallQuickAction('compress', profile.productName)
        break
      case 'cliShim':
        if (enable) await installCliShim(cliShimOptions(profile))
        else await uninstallCliShim(cliShimOptions(profile))
        break
      case 'windowsContextMenu':
        if (enable) await installWindowsContextMenu(profile.productName, profile.windowsLaunch)
        else await uninstallWindowsContextMenu(profile.productName)
        break
      case 'windowsCompressMenu':
        if (enable) {
          await installWindowsCompressMenu(profile, compressMenuDll(), profile.windowsLaunch)
        } else await uninstallWindowsCompressMenu(profile)
        break
      case 'codexOpenIn':
        await applyCodexOpenIn(profile, enable)
        break
    }
    return { ok: true, state: await getSystemIntegrationState() }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message, state: await getSystemIntegrationState() }
  }
}

/** 启动时对齐已开启的入口（目前只有 Windows 压缩右键扩展需要：DLL 换了版本或唤起命令变了就重新登记）。 */
export async function syncSystemIntegration(): Promise<void> {
  if (process.platform !== 'win32') return
  const profile = integrationProfile()
  await syncWindowsCompressMenu(profile, compressMenuDll(), profile.windowsLaunch)
}
