import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

/**
 * Windows 资源管理器「用 DevCube 压缩」（ADR-0049）：原生经典右键扩展，多选时一次交付全部路径。
 * DLL 随应用分发，开启时复制到用户目录下的固定位置（文件名带内容指纹：资源管理器加载后一直占着 DLL，
 * 新版本写成新文件再改指注册表，应用升级与便携版的临时目录都不受影响），再经 reg.exe 在 HKCU 注册——
 * CLSID → DLL（InprocServer32），`*\shell` 与 `Directory\shell` 下的动词经 ExplorerCommandHandler 指向它、
 * MultiSelectModel=Player；DLL 从 CLSID 键下读菜单文案、图标与唤起命令（同一个 DLL 服务各个 Edition）。
 * 由设置开关统一管理；真卸载时 NSIS 兜底清理（build/installer.nsh）。
 */

const execFileAsync = promisify(execFile)

/** 各 Edition 的 CLSID（Dev 单独一个），正式版与 Beta 并装互不覆盖（ADR-0012）。 */
const CLSID_BY_NAME: Record<string, string> = {
  devcube: '{2F9E3C1A-D961-4B87-A825-B0E95AE437BD}',
  'devcube-beta': '{A2EA501F-C651-46D1-9C8F-B0007A2A4F64}',
  'devcube-dev': '{BD772AFE-A816-40BB-AA5D-3A03C8C48C5A}'
}

export interface CompressMenuIdentity {
  /** 菜单文案「用 <productName> 压缩」，也是动词键名的前缀 */
  productName: string
  /** Edition 的 name（devcube / devcube-beta / devcube-dev）：定 CLSID 与用户目录 */
  name: string
}

export function compressMenuClsid(name: string): string {
  const clsid = CLSID_BY_NAME[name]
  if (clsid === undefined) throw new Error(`未知的应用身份：${name}`)
  return clsid
}

export function compressMenuKeys(identity: CompressMenuIdentity): {
  fileVerb: string
  dirVerb: string
  clsidKey: string
} {
  const verb = `${identity.productName}.Compress`
  return {
    fileVerb: `HKCU\\Software\\Classes\\*\\shell\\${verb}`,
    dirVerb: `HKCU\\Software\\Classes\\Directory\\shell\\${verb}`,
    clsidKey: `HKCU\\Software\\Classes\\CLSID\\${compressMenuClsid(identity.name)}`
  }
}

/** 唤起命令：各段带引号（同「在 DevCube 中打开」）；DLL 在其后追加 `--compress <路径…>`。 */
export function compressMenuCommand(launch: string[]): string {
  return launch.map((part) => `"${part}"`).join(' ')
}

/** 安装所需的全部 `reg add` 参数组。 */
export function compressMenuAddArgs(
  identity: CompressMenuIdentity,
  dllPath: string,
  launch: string[]
): string[][] {
  const { fileVerb, dirVerb, clsidKey } = compressMenuKeys(identity)
  const clsid = compressMenuClsid(identity.name)
  return [
    ['add', clsidKey, '/ve', '/d', `${identity.productName} 压缩`, '/f'],
    ['add', clsidKey, '/v', 'Title', '/d', `用 ${identity.productName} 压缩`, '/f'],
    ['add', clsidKey, '/v', 'Icon', '/d', launch[0], '/f'],
    ['add', clsidKey, '/v', 'Command', '/d', compressMenuCommand(launch), '/f'],
    ['add', `${clsidKey}\\InprocServer32`, '/ve', '/d', dllPath, '/f'],
    ['add', `${clsidKey}\\InprocServer32`, '/v', 'ThreadingModel', '/d', 'Apartment', '/f'],
    ...[fileVerb, dirVerb].flatMap((key) => [
      ['add', key, '/v', 'ExplorerCommandHandler', '/d', clsid, '/f'],
      ['add', key, '/v', 'MultiSelectModel', '/d', 'Player', '/f']
    ])
  ]
}

export function compressMenuDeleteArgs(identity: CompressMenuIdentity): string[][] {
  const { fileVerb, dirVerb, clsidKey } = compressMenuKeys(identity)
  return [fileVerb, dirVerb, clsidKey].map((key) => ['delete', key, '/f'])
}

/** 复制到用户目录后的 DLL 文件名：带内容指纹，内容不变就复用同一个文件。 */
export function compressMenuDllName(content: Buffer): string {
  return `compress-menu-${createHash('sha256').update(content).digest('hex').slice(0, 12)}.dll`
}

async function reg(args: string[]): Promise<void> {
  await execFileAsync('reg', args, { windowsHide: true })
}

/** 读一个字符串值（valueName 为 null 读默认值）；键或值不存在为 null。 */
async function readRegString(key: string, valueName: string | null): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'reg',
      ['query', key, ...(valueName === null ? ['/ve'] : ['/v', valueName])],
      { windowsHide: true }
    )
    // 「    名称    REG_SZ    值」；默认值的名称随系统语言变，只认类型分隔
    const line = stdout.split(/\r?\n/).find((l) => /\sREG_SZ\s/.test(l))
    return line === undefined ? null : (line.split(/\s{4}REG_SZ\s{4}/)[1] ?? null)
  } catch {
    return null
  }
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  )
}

/** DLL 的落脚目录：%LOCALAPPDATA%\<name>\shell（不随漫游配置同步）。 */
function shellDir(identity: CompressMenuIdentity): string {
  const local = process.env.LOCALAPPDATA
  if (local === undefined || local === '') throw new Error('找不到本地应用数据目录（LOCALAPPDATA）')
  return join(local, identity.name, 'shell')
}

export function isCompressMenuDllBundled(bundledDll: string): Promise<boolean> {
  return exists(bundledDll)
}

/** 删掉旧版本的 DLL 副本；资源管理器还占着的删不掉，下次再试。 */
async function removeStaleDlls(dir: string, keep: string): Promise<void> {
  const names = await readdir(dir).catch(() => [])
  await Promise.all(
    names
      .filter((n) => n.startsWith('compress-menu-') && n.endsWith('.dll') && n !== keep)
      .map((n) => rm(join(dir, n), { force: true }).catch(() => undefined))
  )
}

export async function installWindowsCompressMenu(
  identity: CompressMenuIdentity,
  bundledDll: string,
  launch: string[]
): Promise<void> {
  const content = await readFile(bundledDll)
  const dir = shellDir(identity)
  const name = compressMenuDllName(content)
  const dllPath = join(dir, name)
  await mkdir(dir, { recursive: true })
  if (!(await exists(dllPath))) await copyFile(bundledDll, dllPath)
  for (const args of compressMenuAddArgs(identity, dllPath, launch)) await reg(args)
  await removeStaleDlls(dir, name)
}

export async function uninstallWindowsCompressMenu(identity: CompressMenuIdentity): Promise<void> {
  for (const args of compressMenuDeleteArgs(identity)) {
    await reg(args).catch(() => undefined) // 键不存在时 reg delete 报错，忽略
  }
  await removeStaleDlls(shellDir(identity), '')
}

export async function isWindowsCompressMenuInstalled(
  identity: CompressMenuIdentity
): Promise<boolean> {
  try {
    await reg(['query', compressMenuKeys(identity).dirVerb, '/v', 'ExplorerCommandHandler'])
    return true
  } catch {
    return false
  }
}

/**
 * 启动时对齐：已开启时，随包的 DLL 换了版本、或唤起命令变了（便携 exe 被挪了位置等）就重新登记；
 * 都没变则什么也不写。
 */
export async function syncWindowsCompressMenu(
  identity: CompressMenuIdentity,
  bundledDll: string,
  launch: string[]
): Promise<void> {
  if (!(await isWindowsCompressMenuInstalled(identity)) || !(await exists(bundledDll))) return
  const { clsidKey } = compressMenuKeys(identity)
  const dllName = compressMenuDllName(await readFile(bundledDll))
  const registeredDll = await readRegString(`${clsidKey}\\InprocServer32`, null)
  const registeredCommand = await readRegString(clsidKey, 'Command')
  const upToDate =
    registeredDll !== null &&
    registeredDll.endsWith(`\\${dllName}`) &&
    (await exists(registeredDll)) &&
    registeredCommand === compressMenuCommand(launch)
  if (!upToDate) await installWindowsCompressMenu(identity, bundledDll, launch)
}
