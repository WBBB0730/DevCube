import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app, shell } from 'electron'
import {
  FILES_OPEN_WITH_EXTS,
  FILES_OPEN_WITH_MIME,
  type FilesOpenWithCategory
} from '../shared/files-kind'
import type { OpenWithFeatureId } from '../shared/system-integration'
import { resolveReleaseEdition } from '../shared/release-edition'
import type { IntegrationProfile } from './system-integration'
import {
  openWithCapabilitiesArgs,
  openWithProgId,
  openWithUserChoiceQueryArgs,
  parseRegQueryValue
} from './default-opener-windows'

/**
 * 「文件打开方式」：把 DevCube 设为图片 / PDF / PPT / 音视频的默认打开程序（docs/prd/file-preview-window.md）。
 * - macOS：随包的 Swift 小助手调 NSWorkspace 官方接口，一键生效、不弹确认框。
 * - Windows：系统不允许程序改默认——注册为候选（HKCU Capabilities）后打开系统「默认应用」页由用户点选。
 * - Linux：xdg-mime default。
 * 状态全部实时探测、不落盘。Dev 身份同其他入口一样以「DevCube Dev」分线：macOS 指向生成的
 * 「DevCube Dev.app」小壳（dev-opener-app，把文件转给运行中的 dev 实例），Windows 以 electron.exe + 项目入口
 * 为打开命令；Linux 没有 desktop 文件，Dev 不可用。
 */

const execFileAsync = promisify(execFile)

export const OPEN_WITH_CATEGORY: Record<OpenWithFeatureId, FilesOpenWithCategory> = {
  openWithImage: 'image',
  openWithPdf: 'pdf',
  openWithPptx: 'pptx',
  openWithAudio: 'audio',
  openWithVideo: 'video'
}

function exts(id: OpenWithFeatureId): readonly string[] {
  return FILES_OPEN_WITH_EXTS[OPEN_WITH_CATEGORY[id]]
}

// —— macOS ——

export function macHelperPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'default-app-helper')
    : join(app.getAppPath(), 'build', 'mac', 'default-app-helper')
}

async function macHelperAvailable(): Promise<boolean> {
  try {
    await access(macHelperPath())
    return true
  } catch {
    return false
  }
}

export type MacDefaultApp = { bundleId: string; path: string }

/** 解析助手 `get` 输出：每行 `<ext>\t<bundleId>\t<path>`（无默认时后两段为空） */
export function parseHelperGetOutput(stdout: string): Map<string, MacDefaultApp> {
  const out = new Map<string, MacDefaultApp>()
  for (const line of stdout.split('\n')) {
    const [ext, bundleId, path] = line.split('\t')
    if (ext === undefined || bundleId === undefined) continue
    out.set(ext, { bundleId: bundleId.trim(), path: (path ?? '').trim() })
  }
  return out
}

/** 是否已是默认：按 bundle id 比（用户搬动 / 多份拷贝仍算；Dev 小壳有自己的 bundle id）。 */
export function isMacDefaultApp(current: MacDefaultApp | undefined, bundleId: string): boolean {
  return current !== undefined && current.bundleId === bundleId
}

async function macIsDefault(id: OpenWithFeatureId, profile: IntegrationProfile): Promise<boolean> {
  const { stdout } = await execFileAsync(macHelperPath(), ['get', ...exts(id)])
  const byExt = parseHelperGetOutput(stdout)
  return exts(id).every((ext) => isMacDefaultApp(byExt.get(ext), profile.macBundleId))
}

async function macSetDefault(id: OpenWithFeatureId, profile: IntegrationProfile): Promise<void> {
  await execFileAsync(macHelperPath(), ['set', profile.macAppPath, ...exts(id)])
}

// —— Windows ——

async function reg(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('reg', args, { windowsHide: true })
  return stdout
}

async function winIsDefault(id: OpenWithFeatureId, appName: string): Promise<boolean> {
  const progId = openWithProgId(appName, OPEN_WITH_CATEGORY[id])
  for (const ext of exts(id)) {
    const current = await reg(openWithUserChoiceQueryArgs(ext))
      .then((out) => parseRegQueryValue(out, 'ProgId'))
      .catch(() => null)
    if (current !== progId) return false
  }
  return true
}

async function winRegisterAndOpenSettings(appName: string, launch: string[]): Promise<void> {
  for (const args of openWithCapabilitiesArgs(appName, launch, FILES_OPEN_WITH_EXTS)) {
    await reg(args)
  }
  // Win11 支持深链到某个应用的默认项页；旧系统落到「默认应用」总页
  await shell.openExternal(
    `ms-settings:defaultapps?registeredAppUser=${encodeURIComponent(appName)}`
  )
}

// —— Linux ——

function linuxDesktopFile(): string {
  return `${resolveReleaseEdition(app.getVersion()).executableName}.desktop`
}

async function linuxIsDefault(id: OpenWithFeatureId): Promise<boolean> {
  const desktop = linuxDesktopFile()
  for (const mime of FILES_OPEN_WITH_MIME[OPEN_WITH_CATEGORY[id]]) {
    const { stdout } = await execFileAsync('xdg-mime', ['query', 'default', mime]).catch(() => ({
      stdout: ''
    }))
    if (stdout.trim() !== desktop) return false
  }
  return true
}

async function linuxSetDefault(id: OpenWithFeatureId): Promise<void> {
  await execFileAsync('xdg-mime', [
    'default',
    linuxDesktopFile(),
    ...FILES_OPEN_WITH_MIME[OPEN_WITH_CATEGORY[id]]
  ])
}

// —— 编排 ——

export type OpenWithProbe = {
  available: boolean
  enabled: boolean
  unavailableReason?: string
}

export async function probeOpenWith(
  id: OpenWithFeatureId,
  profile: IntegrationProfile
): Promise<OpenWithProbe> {
  if (process.platform === 'darwin') {
    if (!(await macHelperAvailable())) {
      return {
        available: false,
        enabled: false,
        unavailableReason: app.isPackaged
          ? '缺少设默认小助手（打包时未编译）'
          : '缺少设默认小助手：先运行 pnpm build:mac-helper'
      }
    }
    return { available: true, enabled: await macIsDefault(id, profile).catch(() => false) }
  }
  if (process.platform === 'win32') {
    return { available: true, enabled: await winIsDefault(id, profile.productName) }
  }
  if (!app.isPackaged) {
    return { available: false, enabled: false, unavailableReason: 'Dev 身份没有 desktop 文件' }
  }
  return { available: true, enabled: await linuxIsDefault(id) }
}

/** 「设为默认」：macOS / Linux 直接生效；Windows 注册候选并打开系统设置页（生效与否由用户点选决定）。 */
export async function setOpenWithDefault(
  id: OpenWithFeatureId,
  profile: IntegrationProfile
): Promise<void> {
  if (process.platform === 'darwin') return macSetDefault(id, profile)
  if (process.platform === 'win32')
    return winRegisterAndOpenSettings(profile.productName, profile.windowsLaunch)
  return linuxSetDefault(id)
}
