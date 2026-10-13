/**
 * Windows「文件打开方式」注册表投影（docs/prd/file-preview-window.md、ADR-0031）。
 * Win8 起默认程序选择由系统用用户级签名锁住，程序不可改；正规路线是把应用注册为候选
 * （各扩展名 OpenWithProgids + HKCU\Software\<App>\Capabilities + RegisteredApplications），
 * 再由用户在系统「默认应用」页点选。安装包不写这些（electron-builder 的文件关联会顺手改掉默认），
 * 由应用自己登记：安装版每次启动对齐，便携版与 Dev 在设置里点按钮时登记。
 * 纯函数只产出 .reg 文本、reg.exe 参数与解析输出，执行由 default-opener 负责。
 */

export function openWithProgId(appName: string, category: string): string {
  return `${appName.replace(/\s+/g, '')}.${category}`
}

const FILE_EXTS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts'

/** 一次读出全部扩展名的用户选择（各 `FileExts\.<ext>\UserChoice` 的 ProgId） */
export function openWithUserChoiceQueryArgs(): string[] {
  return ['query', FILE_EXTS_KEY, '/s', '/v', 'ProgId']
}

/**
 * 解析 `reg query …\FileExts /s /v ProgId` 的输出：扩展名（小写、无点）→ ProgId。
 * 输出按键分段：一行键路径，其下若干行 `    ProgId    REG_SZ    DevCube.image`；只认 `\UserChoice` 键。
 */
export function parseUserChoiceProgIds(stdout: string): Map<string, string> {
  const out = new Map<string, string>()
  let ext: string | null = null
  for (const line of stdout.split(/\r?\n/).map((l) => l.trimEnd())) {
    const key = line.match(/\\FileExts\\\.([^\\]+)\\UserChoice$/i)
    if (key) {
      ext = key[1].toLowerCase()
      continue
    }
    if (line.startsWith('HKEY_')) {
      ext = null
      continue
    }
    const value = line.trim().match(/^ProgId\s+REG_\w+\s+(.*)$/)
    if (ext !== null && value) out.set(ext, value[1].trim())
  }
  return out
}

/** .reg 字符串值的转义：反斜杠与双引号 */
function regString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * 注册为候选的 .reg 文本（交给 `reg import`，一次写完）：
 * - 每类一个 ProgId（打开命令 = launch 数组 + "%1"，打包 [exe]、Dev [electron.exe, 项目入口]；图标取 launch[0]）
 * - 各扩展名的 OpenWithProgids 挂上该 ProgId（资源管理器「打开方式」据此列出）
 * - Capabilities（应用名 / 说明 / FileAssociations 各扩展名 → ProgId；先整键删掉再写，去掉旧版本多出的扩展名）
 * - RegisteredApplications 指向 Capabilities（系统「默认应用」页据此列出）
 */
export function openWithRegFile(
  appName: string,
  launch: readonly string[],
  extsByCategory: Record<string, readonly string[]>
): string {
  const command = [...launch, '%1'].map((part) => `"${part}"`).join(' ')
  const classes = 'HKEY_CURRENT_USER\\Software\\Classes'
  const capabilities = `HKEY_CURRENT_USER\\Software\\${appName}\\Capabilities`
  const lines = ['Windows Registry Editor Version 5.00', '']
  const section = (key: string, values: string[]): void => {
    lines.push(`[${key}]`, ...values, '')
  }
  const associations: string[] = []
  for (const [category, exts] of Object.entries(extsByCategory)) {
    const progId = openWithProgId(appName, category)
    section(`${classes}\\${progId}`, [`@=${regString(`${appName} ${category}`)}`])
    section(`${classes}\\${progId}\\DefaultIcon`, [`@=${regString(`"${launch[0]}",0`)}`])
    section(`${classes}\\${progId}\\shell\\open\\command`, [`@=${regString(command)}`])
    for (const ext of exts) {
      section(`${classes}\\.${ext}\\OpenWithProgids`, [`${regString(progId)}=hex(0):`])
      associations.push(`${regString(`.${ext}`)}=${regString(progId)}`)
    }
  }
  section(capabilities, [
    `"ApplicationName"=${regString(appName)}`,
    `"ApplicationDescription"=${regString(`${appName} 预览窗口`)}`
  ])
  lines.push(`[-${capabilities}\\FileAssociations]`, '')
  section(`${capabilities}\\FileAssociations`, associations)
  section('HKEY_CURRENT_USER\\Software\\RegisteredApplications', [
    `${regString(appName)}=${regString(`Software\\${appName}\\Capabilities`)}`
  ])
  return lines.join('\r\n')
}
