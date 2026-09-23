import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix, resolve } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import { FILES_OPEN_WITH_EXTS } from '../shared/files-kind'
import { macHelperPath } from './default-opener'

/**
 * Dev 身份的「文件打开方式」实体（docs/prd/file-preview-window.md）。
 * LaunchServices 只把**声明了文档类型**的应用列进「打开方式」，设默认对未声明的应用也静默无效；
 * dev 跑的 node_modules 里的 Electron.app 什么都没声明。于是同快速操作的思路：用系统自带的
 * `osacompile` 在 Dev 数据目录生成一个「DevCube Dev.app」AppleScript 小壳，Info.plist 声明「文件打开方式」各类文件，
 * `on open` 把收到的文件用 `open -a <Electron.app>` 转给运行中的 dev 实例（未运行则只拉起空 Electron，
 * 与快速操作同一口径）。零依赖、整目录可删（注册经设默认助手调 LSRegisterURL，Dev 下需先 `pnpm build:mac-helper`）。打包身份自己就声明了文档类型，不需要这层。
 * 与打包身份「安装即出现在打开方式、点按钮才成默认」对齐：dev **启动时**就同步小壳（指纹不变则跳过），
 * 「设为默认」只负责设默认。
 * 实证（macOS 15）：小壳必须放在用户目录下的常规位置（临时目录里的应用 LaunchServices 不列为候选）并重签。
 */

const execFileAsync = promisify(execFile)

export const DEV_OPENER_APP_ID = 'com.wbbb.devcube.dev'
export const DEV_OPENER_APP_NAME = 'DevCube Dev'

/** Info.plist 里的自定义键：记录生成时的指纹，启动同步据此判断要不要重建 */
const FINGERPRINT_KEY = 'DevCubeOpenerFingerprint'

// 仅 macOS 使用；用 posix.join 使 Windows CI 上的单测也得到 darwin 形态路径（同 cli-shim）
export function devOpenerAppPath(userData: string = app.getPath('userData')): string {
  return posix.join(userData, `${DEV_OPENER_APP_NAME}.app`)
}

/** dev 正在运行的 Electron.app（execPath 在 <App>.app/Contents/MacOS/ 之下，上三级即 .app） */
export function devElectronAppPath(): string {
  return resolve(process.execPath, '..', '..', '..')
}

/** 生成物指纹：脚本（含 Electron 路径）+ plist 补丁；任一变化即重建 */
export function devOpenerFingerprint(electronAppPath: string): string {
  return createHash('sha1')
    .update(devOpenerScript(electronAppPath))
    .update(JSON.stringify(devOpenerPlistPatch()))
    .digest('hex')
}

/** AppleScript 源：收到文件 → `open -a <electronApp> <files…>`；直接双击 → 只拉起 Electron。 */
export function devOpenerScript(electronAppPath: string): string {
  const quoted = `quoted form of ${JSON.stringify(electronAppPath)}`
  return [
    'on open theFiles',
    '  set argsText to ""',
    '  repeat with f in theFiles',
    '    set argsText to argsText & " " & quoted form of POSIX path of f',
    '  end repeat',
    `  do shell script "/usr/bin/open -a " & ${quoted} & argsText`,
    'end open',
    'on run',
    `  do shell script "/usr/bin/open -a " & ${quoted}`,
    'end run',
    ''
  ].join('\n')
}

/** 写进 Info.plist 的键：身份 + 各类文档声明（角色 Viewer、优先级 Alternate，与打包声明一致）。 */
export function devOpenerPlistPatch(
  extsByCategory: Record<string, readonly string[]> = FILES_OPEN_WITH_EXTS
): Record<string, unknown> {
  return {
    CFBundleIdentifier: DEV_OPENER_APP_ID,
    CFBundleName: DEV_OPENER_APP_NAME,
    CFBundleDisplayName: DEV_OPENER_APP_NAME,
    CFBundleDocumentTypes: Object.entries(extsByCategory).map(([category, exts]) => ({
      CFBundleTypeName: `${DEV_OPENER_APP_NAME} ${category}`,
      CFBundleTypeRole: 'Viewer',
      LSHandlerRank: 'Alternate',
      CFBundleTypeExtensions: [...exts]
    }))
  }
}

async function currentFingerprint(appPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('plutil', [
      '-extract',
      FINGERPRINT_KEY,
      'raw',
      '-o',
      '-',
      join(appPath, 'Contents', 'Info.plist')
    ])
    return stdout.trim()
  } catch {
    return null
  }
}

/**
 * 同步小壳：不存在或指纹变了（Electron 路径 / 声明类型）才重建并向 LaunchServices 注册，否则直接返回。
 * 重建约一秒；dev 启动时后台调用，「设为默认」前再调一次兜底。
 */
export async function ensureDevOpenerApp(electronAppPath: string): Promise<string> {
  const appPath = devOpenerAppPath()
  const fingerprint = devOpenerFingerprint(electronAppPath)
  if ((await currentFingerprint(appPath)) === fingerprint) return appPath
  const tmp = await mkdtemp(join(tmpdir(), 'devcube-opener-'))
  try {
    const script = join(tmp, 'opener.applescript')
    await writeFile(script, devOpenerScript(electronAppPath), 'utf8')
    await rm(appPath, { recursive: true, force: true })
    await execFileAsync('osacompile', ['-o', appPath, script])

    // Info.plist：plutil 转 JSON 改完再转回，避免手写 plist 或引入解析依赖
    const plist = join(appPath, 'Contents', 'Info.plist')
    const { stdout } = await execFileAsync('plutil', ['-convert', 'json', '-o', '-', plist])
    const merged = {
      ...(JSON.parse(stdout) as Record<string, unknown>),
      ...devOpenerPlistPatch(),
      [FINGERPRINT_KEY]: fingerprint
    }
    const jsonPath = join(tmp, 'Info.json')
    await writeFile(jsonPath, JSON.stringify(merged), 'utf8')
    await execFileAsync('plutil', ['-convert', 'xml1', '-o', plist, jsonPath])
    // 改过 Info.plist 后 osacompile 带的 Apple 签名即失效（plist 在封印内），LaunchServices 不把签名坏掉的
    // 应用列为候选；ad-hoc 重签即可（本机生成、无 quarantine，不需要开发者证书）
    await execFileAsync('codesign', ['--force', '--sign', '-', appPath])
    // 注册走公开接口 LSRegisterURL（由设默认助手代调），不用 Support 目录下的 lsregister
    await execFileAsync(macHelperPath(), ['register', appPath])
    return appPath
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}
