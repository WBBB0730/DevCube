import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/**
 * Windows 资源管理器右键菜单投影：HKCU 下按 ProductName 增删
 * `Directory\shell` 与 `Directory\Background\shell`，经系统自带 reg.exe 执行。
 * 由设置开关统一管理（NSIS / portable 同一机制）；真卸载时 NSIS 兜底清理（ADR-0025）。
 */

const execFileAsync = promisify(execFile)

export function contextMenuKeys(productName: string): { dirKey: string; bgKey: string } {
  return {
    dirKey: `HKCU\\Software\\Classes\\Directory\\shell\\${productName}`,
    bgKey: `HKCU\\Software\\Classes\\Directory\\Background\\shell\\${productName}`
  }
}

/**
 * 安装所需的全部 `reg add` 参数组（%V 同时覆盖选中文件夹与目录空白处）。
 * launch：唤起命令（打包 [exe]；Dev [electron.exe, 项目入口]），%V 追加在末尾。
 */
export function contextMenuAddArgs(productName: string, launch: string[]): string[][] {
  const label = `在 ${productName} 中打开`
  const command = [...launch, '%V'].map((part) => `"${part}"`).join(' ')
  const { dirKey, bgKey } = contextMenuKeys(productName)
  return [dirKey, bgKey].flatMap((key) => [
    ['add', key, '/ve', '/d', label, '/f'],
    ['add', key, '/v', 'Icon', '/d', launch[0], '/f'],
    ['add', `${key}\\command`, '/ve', '/d', command, '/f']
  ])
}

export function contextMenuDeleteArgs(productName: string): string[][] {
  const { dirKey, bgKey } = contextMenuKeys(productName)
  return [
    ['delete', dirKey, '/f'],
    ['delete', bgKey, '/f']
  ]
}

async function reg(args: string[]): Promise<void> {
  await execFileAsync('reg', args, { windowsHide: true })
}

export async function installWindowsContextMenu(
  productName: string,
  launch: string[]
): Promise<void> {
  for (const args of contextMenuAddArgs(productName, launch)) await reg(args)
}

export async function uninstallWindowsContextMenu(productName: string): Promise<void> {
  for (const args of contextMenuDeleteArgs(productName)) {
    await reg(args).catch(() => undefined) // 键不存在时 reg delete 报错，忽略
  }
}

export async function isWindowsContextMenuInstalled(productName: string): Promise<boolean> {
  try {
    await reg(['query', contextMenuKeys(productName).dirKey])
    return true
  } catch {
    return false
  }
}
