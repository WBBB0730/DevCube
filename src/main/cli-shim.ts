import { chmod, mkdir, readlink, symlink, unlink, writeFile } from 'node:fs/promises'
import { posix } from 'node:path'
import { exec as sudoExec } from '@vscode/sudo-prompt'

/**
 * macOS `devcube` 命令：userData/bin 下生成一行式脚本（经 LaunchServices 按 bundle id
 * 唤起，与应用安装位置解耦），软链到 /usr/local/bin；目录不可写时经 sudo-prompt 提权
 * （VS Code 同款做法）。仅 macOS，取舍见 ADR-0025。
 */

export const CLI_LINK_DIR = '/usr/local/bin'

export const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`

/** 经 open(1) 把路径参数转发给应用（打包 `-b <bundleId>`；Dev `-a <electron App 路径>`）。 */
export function openForwardCommand(openArgs: string[]): string {
  return `exec /usr/bin/open ${openArgs.map(shellQuote).join(' ')} "$@"`
}

export function cliScriptContent(productName: string, openArgs: string[]): string {
  return `#!/bin/sh
# ${productName} CLI：经 LaunchServices 唤起桌面应用（与安装位置无关）。
${openForwardCommand(openArgs)}
`
}

// 仅 macOS 使用；用 posix.join 使 Windows CI 上的单测也得到 darwin 形态路径（同 open-in-app）
export function cliLinkPath(cliName: string): string {
  return posix.join(CLI_LINK_DIR, cliName)
}

function sudoRun(command: string, promptName: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    sudoExec(command, { name: promptName }, (error) => {
      if (error) reject(error)
      else resolvePromise()
    })
  })
}

/** 现有软链指向的目标；不存在 / 非软链为 null。 */
async function linkTarget(linkPath: string): Promise<string | null> {
  try {
    return await readlink(linkPath)
  } catch {
    return null
  }
}

export type CliShimOptions = {
  cliName: string
  productName: string
  /** open(1) 唤起参数（见 openForwardCommand） */
  openArgs: string[]
  /** 脚本所在目录（userData/bin） */
  scriptDir: string
}

export function cliScriptPath(opts: Pick<CliShimOptions, 'cliName' | 'scriptDir'>): string {
  return posix.join(opts.scriptDir, opts.cliName)
}

export async function isCliShimInstalled(opts: CliShimOptions): Promise<boolean> {
  return (await linkTarget(cliLinkPath(opts.cliName))) === cliScriptPath(opts)
}

export async function installCliShim(opts: CliShimOptions): Promise<void> {
  const scriptPath = cliScriptPath(opts)
  await mkdir(opts.scriptDir, { recursive: true })
  await writeFile(scriptPath, cliScriptContent(opts.productName, opts.openArgs))
  await chmod(scriptPath, 0o755)

  const linkPath = cliLinkPath(opts.cliName)
  try {
    await unlink(linkPath).catch(() => undefined)
    await symlink(scriptPath, linkPath)
  } catch {
    // /usr/local/bin 缺失或不可写（Apple Silicon 默认 root 属主）：提权建目录 + 强制软链
    await sudoRun(
      `/bin/mkdir -p ${shellQuote(CLI_LINK_DIR)} && /bin/ln -sf ${shellQuote(scriptPath)} ${shellQuote(linkPath)}`,
      opts.productName
    )
  }
}

export async function uninstallCliShim(opts: CliShimOptions): Promise<void> {
  const linkPath = cliLinkPath(opts.cliName)
  // 只动指向我们脚本的软链；用户自建的同名命令不碰
  if ((await linkTarget(linkPath)) !== cliScriptPath(opts)) return
  try {
    await unlink(linkPath)
  } catch {
    await sudoRun(`/bin/rm -f ${shellQuote(linkPath)}`, opts.productName)
  }
}
