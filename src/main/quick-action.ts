import { execFile } from 'node:child_process'
import { access, copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { promisify } from 'node:util'
import { openForwardCommand } from './cli-shim'

/**
 * macOS Finder「快速操作」投影：往 ~/Library/Services 写一个 Automator 服务
 * （Info.plist NSServices 收 public.folder + 「运行 Shell 脚本」`open -b <bundleId>`），
 * 移除即删整个 .workflow 目录。不用 FinderSync 的取舍见 ADR-0025。
 */

const xmlEscape = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export function quickActionDirName(productName: string): string {
  return `在 ${productName} 中打开.workflow`
}

export function quickActionShellCommand(openArgs: string[]): string {
  return openForwardCommand(openArgs)
}

export function quickActionInfoPlist(
  menuLabel: string,
  iconName = 'NSTouchBarFolderTemplate'
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSBackgroundColorName</key>
			<string>background</string>
			<key>NSIconName</key>
			<string>${xmlEscape(iconName)}</string>
			<key>NSMenuItem</key>
			<dict>
				<key>default</key>
				<string>${xmlEscape(menuLabel)}</string>
			</dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
			<key>NSRequiredContext</key>
			<dict>
				<key>NSApplicationIdentifier</key>
				<string>com.apple.finder</string>
			</dict>
			<key>NSSendFileTypes</key>
			<array>
				<string>public.folder</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
`
}

export function quickActionDocumentWflow(shellCommand: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key>
	<string>528</string>
	<key>AMApplicationVersion</key>
	<string>2.10</string>
	<key>AMDocumentVersion</key>
	<string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>container</key>
					<string>List</string>
					<key>optional</key>
					<true/>
					<key>types</key>
					<array>
						<string>com.apple.cocoa.path</string>
					</array>
				</dict>
				<key>AMActionVersion</key>
				<string>2.0.3</string>
				<key>AMApplication</key>
				<array>
					<string>Automator</string>
				</array>
				<key>AMParameterProperties</key>
				<dict>
					<key>COMMAND_STRING</key>
					<dict/>
					<key>CheckedForUserDefaultShell</key>
					<dict/>
					<key>inputMethod</key>
					<dict/>
					<key>shell</key>
					<dict/>
					<key>source</key>
					<dict/>
				</dict>
				<key>AMProvides</key>
				<dict>
					<key>container</key>
					<string>List</string>
					<key>types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>ActionBundlePath</key>
				<string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key>
				<string>运行 Shell 脚本</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key>
					<string>${xmlEscape(shellCommand)}</string>
					<key>CheckedForUserDefaultShell</key>
					<true/>
					<key>inputMethod</key>
					<integer>1</integer>
					<key>shell</key>
					<string>/bin/zsh</string>
					<key>source</key>
					<string></string>
				</dict>
				<key>BundleIdentifier</key>
				<string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key>
				<string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key>
				<false/>
				<key>CanShowWhenRun</key>
				<true/>
				<key>Category</key>
				<array>
					<string>AMCategoryUtilities</string>
				</array>
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>InputUUID</key>
				<string>9B2C57A4-3F0E-4A6C-8B01-0DE7C0BE0001</string>
				<key>Keywords</key>
				<array>
					<string>Shell</string>
				</array>
				<key>OutputUUID</key>
				<string>9B2C57A4-3F0E-4A6C-8B01-0DE7C0BE0002</string>
				<key>UUID</key>
				<string>9B2C57A4-3F0E-4A6C-8B01-0DE7C0BE0003</string>
				<key>UnlocalizedApplications</key>
				<array>
					<string>Automator</string>
				</array>
			</dict>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>applicationBundleIDsByPath</key>
		<dict/>
		<key>applicationPaths</key>
		<array/>
		<key>inputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject.folder</string>
		<key>outputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>presentationMode</key>
		<integer>15</integer>
		<key>processesInput</key>
		<integer>0</integer>
		<key>serviceInputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject.folder</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>systemImageName</key>
		<string>NSFolder</string>
		<key>useAutomaticInputType</key>
		<false/>
		<key>workflowTypeIdentifier</key>
		<string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
</plist>
`
}

// —— IO ——

const execFileAsync = promisify(execFile)

export function servicesDir(home: string = homedir()): string {
  return join(home, 'Library', 'Services')
}

export function quickActionPath(productName: string, dir: string = servicesDir()): string {
  return join(dir, quickActionDirName(productName))
}

/** 让 pbs（服务注册器）立即重扫 ~/Library/Services，装卸后菜单即时生效。失败不致命。 */
async function refreshServicesRegistry(): Promise<void> {
  await execFileAsync('/System/Library/CoreServices/pbs', ['-update']).catch(() => undefined)
}

/**
 * 重启 pbs 常驻代理（按需拉起，杀掉无感知）：全新服务名的启用位写入后，
 * 旧代理的内存态不会自行刷新，重启后菜单立即生效（本机实证）。未在跑则无事。
 */
async function restartServicesAgent(): Promise<void> {
  await execFileAsync('/usr/bin/killall', ['pbs']).catch(() => undefined)
}

/** pbs 偏好域里该服务的标识（无 CFBundleIdentifier 的 workflow 前缀为 "(null)"）。 */
export function quickActionServiceKey(productName: string): string {
  return `(null) - 在 ${productName} 中打开 - runWorkflowAsService`
}

/**
 * Finder 右键菜单的启用位：第三方服务默认关闭，手动开关写的是 pbs 偏好域
 * `NSServicesStatus.<key>.presentation_modes`（本机对系统手动启用产物逐字段实证；
 * FinderOrdering 只管排序）。照抄系统写法，装完即启用，免去用户去系统设置手动开。
 * 经 defaults export/import 读改写（走 cfprefsd 正规通道，类型经 plutil JSON 往返保真）；
 * 域里出现 JSON 装不下的类型时放弃代写（仍可手动启用）。
 */
async function setFinderEnableBits(productName: string, enable: boolean): Promise<void> {
  const key = quickActionServiceKey(productName)
  const tmp = join(tmpdir(), `devcube-pbs-${process.pid}.plist`)
  try {
    await execFileAsync('defaults', ['export', 'pbs', tmp])
    await execFileAsync('plutil', ['-convert', 'json', tmp])
    const root = JSON.parse(await readFile(tmp, 'utf8')) as Record<
      string,
      Record<string, unknown> | undefined
    >
    const ordering = (root['FinderOrdering'] ??= {})
    const status = (root['NSServicesStatus'] ??= {})
    if (enable) {
      ordering[`SERVICE-${key}`] ??= 999 // 已有则保留用户排过的顺序；999 = 排在末尾
      status[key] = {
        presentation_modes: {
          ContextMenu: true,
          FinderPreview: true,
          ServicesMenu: true,
          TouchBar: false
        }
      }
    } else {
      delete ordering[`SERVICE-${key}`]
      delete status[key]
    }
    await writeFile(tmp, JSON.stringify(root))
    await execFileAsync('plutil', ['-convert', 'xml1', tmp])
    await execFileAsync('defaults', ['import', 'pbs', tmp])
  } catch {
    // 代写失败不致命：快速操作仍可在系统设置 → 扩展 → 访达里手动启用
  } finally {
    await rm(tmp, { force: true })
  }
}

export type QuickActionInstallOptions = {
  /** 应用图标（.icns）；存在则嵌入 workflow 作为菜单图标 */
  iconSource?: string
  dir?: string
}

export async function installQuickAction(
  productName: string,
  openArgs: string[],
  opts: QuickActionInstallOptions = {}
): Promise<void> {
  const root = quickActionPath(productName, opts.dir)
  const contents = join(root, 'Contents')
  const resources = join(contents, 'Resources')
  await mkdir(contents, { recursive: true })

  let iconName = 'NSTouchBarFolderTemplate'
  if (opts.iconSource !== undefined) {
    const readable = await access(opts.iconSource).then(
      () => true,
      () => false
    )
    if (readable) {
      await mkdir(resources, { recursive: true })
      await copyFile(opts.iconSource, join(resources, `icon${extname(opts.iconSource)}`))
      iconName = 'icon' // NSIconName 引用 bundle 内图像的主文件名（无扩展名）
    }
  }

  await writeFile(
    join(contents, 'Info.plist'),
    quickActionInfoPlist(`在 ${productName} 中打开`, iconName)
  )
  await writeFile(
    join(contents, 'document.wflow'),
    quickActionDocumentWflow(quickActionShellCommand(openArgs))
  )
  await refreshServicesRegistry()
  await setFinderEnableBits(productName, true)
  await restartServicesAgent()
}

export async function uninstallQuickAction(
  productName: string,
  dir: string = servicesDir()
): Promise<void> {
  await rm(quickActionPath(productName, dir), { recursive: true, force: true })
  await refreshServicesRegistry()
  await setFinderEnableBits(productName, false)
  await restartServicesAgent()
}

export async function isQuickActionInstalled(
  productName: string,
  dir: string = servicesDir()
): Promise<boolean> {
  try {
    return (await readdir(join(quickActionPath(productName, dir), 'Contents'))).includes(
      'document.wflow'
    )
  } catch {
    return false
  }
}
