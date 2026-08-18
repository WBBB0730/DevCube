import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import { resolveReleaseEdition } from '../shared/release-edition'
import type {
  SystemIntegrationApplyResult,
  SystemIntegrationFeature,
  SystemIntegrationFeatureId,
  SystemIntegrationState
} from '../shared/system-integration'
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
import { installQuickAction, isQuickActionInstalled, uninstallQuickAction } from './quick-action'
import {
  installWindowsContextMenu,
  isWindowsContextMenuInstalled,
  uninstallWindowsContextMenu
} from './windows-context-menu'

/** 系统集成编排：按平台列出功能、探测状态、执行安装 / 移除。状态全部实时探测不落盘。 */

/** 各入口共用的注册身份：打包走 Release Edition，Dev 以「DevCube Dev」独立分线不抢注。 */
type IntegrationProfile = {
  /** 入口显示名（菜单文案「在 <productName> 中打开」/ Codex label） */
  productName: string
  /** CLI 命令名 / Codex handler id（devcube / devcube-beta / devcube-dev） */
  name: string
  /** macOS 唤起：open(1) 参数——打包 `-b <bundleId>`；Dev `-a <electron App 路径>`（运行中的 dev 实例收 open-file；未运行则仅拉起空 Electron） */
  macOpenArgs: string[]
  /** Windows 唤起命令——打包 [exe]；Dev [electron.exe, 项目入口]（第二实例把路径转发给运行中的 dev 实例） */
  windowsLaunch: string[]
  /** 入口图标（png；Codex 必填、快速操作嵌入 workflow） */
  iconPath: string
}

function integrationProfile(): IntegrationProfile {
  if (app.isPackaged) {
    const e = resolveReleaseEdition(app.getVersion())
    return {
      productName: e.productName,
      name: e.executableName,
      macOpenArgs: ['-b', e.appId],
      windowsLaunch: [process.execPath],
      iconPath: join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'icon.png')
    }
  }
  // Dev 无安装身份：mac 以 electron App bundle 路径经 `open -a` 唤起，win 以 electron.exe + 项目入口
  const devElectronApp =
    process.platform === 'darwin' ? resolve(process.execPath, '..', '..', '..') : process.execPath
  return {
    productName: 'DevCube Dev',
    name: 'devcube-dev',
    macOpenArgs: ['-a', devElectronApp],
    windowsLaunch: [process.execPath, app.getAppPath()],
    iconPath: join(app.getAppPath(), 'resources', 'icon.png')
  }
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

/** 当前平台可呈现的功能列表（linux 无：打开方式由 desktop entry 声明、CLI 由 deb 自带）。 */
function platformFeatureIds(): SystemIntegrationFeatureId[] {
  if (process.platform === 'darwin') return ['quickAction', 'cliShim', 'codexOpenIn']
  if (process.platform === 'win32') return ['windowsContextMenu', 'codexOpenIn']
  return []
}

async function probeFeature(
  id: SystemIntegrationFeatureId,
  profile: IntegrationProfile
): Promise<SystemIntegrationFeature> {
  switch (id) {
    case 'quickAction':
      return { id, available: true, enabled: await isQuickActionInstalled(profile.productName) }
    case 'cliShim':
      return { id, available: true, enabled: await isCliShimInstalled(cliShimOptions(profile)) }
    case 'windowsContextMenu':
      return {
        id,
        available: true,
        enabled: await isWindowsContextMenuInstalled(profile.productName)
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
  return {
    productName: profile.productName,
    cliName: profile.name,
    features: await Promise.all(platformFeatureIds().map((id) => probeFeature(id, profile)))
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
    switch (id) {
      case 'quickAction':
        if (enable)
          await installQuickAction(profile.productName, profile.macOpenArgs, {
            iconSource: profile.iconPath
          })
        else await uninstallQuickAction(profile.productName)
        break
      case 'cliShim':
        if (enable) await installCliShim(cliShimOptions(profile))
        else await uninstallCliShim(cliShimOptions(profile))
        break
      case 'windowsContextMenu':
        if (enable) await installWindowsContextMenu(profile.productName, profile.windowsLaunch)
        else await uninstallWindowsContextMenu(profile.productName)
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
