/**
 * Windows「文件打开方式」注册表投影（docs/prd/file-preview-window.md）。
 * Win8 起默认程序选择由系统用用户级签名锁住，程序不可改；正规路线是把应用注册为候选
 * （HKCU\Software\<App>\Capabilities + RegisteredApplications），再由用户在系统「默认应用」页点选。
 * 纯函数只产出 reg.exe 参数与解析输出，执行由 default-opener 负责。
 */

export function openWithProgId(appName: string, category: string): string {
  return `${appName.replace(/\s+/g, '')}.${category}`
}

/** 该扩展名当前用户选择的 ProgId 所在键 */
export function openWithUserChoiceKey(ext: string): string {
  return `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.${ext}\\UserChoice`
}

export function openWithUserChoiceQueryArgs(ext: string): string[] {
  return ['query', openWithUserChoiceKey(ext), '/v', 'ProgId']
}

/**
 * 解析 `reg query … /v <name>` 的输出，取该值；找不到返回 null。
 * 行形如：`    ProgId    REG_SZ    DevCube.image`
 */
export function parseRegQueryValue(stdout: string, name: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.trim().match(/^(\S+)\s+REG_\w+\s+(.*)$/)
    if (m && m[1] === name) return m[2].trim()
  }
  return null
}

/**
 * 注册为候选所需的全部 `reg add` 参数组：
 * - 每类一个 ProgId（打开命令 = launch 数组 + "%1"，打包 [exe]、Dev [electron.exe, 项目入口]；图标取 launch[0]）
 * - Capabilities（应用名 / 说明 / FileAssociations 各扩展名 → ProgId）
 * - RegisteredApplications 指向 Capabilities
 */
export function openWithCapabilitiesArgs(
  appName: string,
  launch: readonly string[],
  extsByCategory: Record<string, readonly string[]>
): string[][] {
  const command = [...launch, '%1'].map((part) => `"${part}"`).join(' ')
  const appKey = `HKCU\\Software\\${appName}`
  const capabilities = `${appKey}\\Capabilities`
  const out: string[][] = [
    ['add', capabilities, '/v', 'ApplicationName', '/d', appName, '/f'],
    ['add', capabilities, '/v', 'ApplicationDescription', '/d', `${appName} 预览窗口`, '/f'],
    [
      'add',
      'HKCU\\Software\\RegisteredApplications',
      '/v',
      appName,
      '/d',
      `Software\\${appName}\\Capabilities`,
      '/f'
    ]
  ]
  for (const [category, exts] of Object.entries(extsByCategory)) {
    const progId = openWithProgId(appName, category)
    const progKey = `HKCU\\Software\\Classes\\${progId}`
    out.push(
      ['add', progKey, '/ve', '/d', `${appName} ${category}`, '/f'],
      ['add', `${progKey}\\DefaultIcon`, '/ve', '/d', `"${launch[0]}",0`, '/f'],
      ['add', `${progKey}\\shell\\open\\command`, '/ve', '/d', command, '/f']
    )
    for (const ext of exts) {
      out.push(['add', `${capabilities}\\FileAssociations`, '/v', `.${ext}`, '/d', progId, '/f'])
    }
  }
  return out
}
