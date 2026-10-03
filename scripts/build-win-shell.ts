/**
 * 编译 Windows「用 DevCube 压缩」右键扩展（build/win/CompressMenu.cpp → build/win/compress-menu.dll，ADR-0049）。
 * 打包 Windows 前运行（`pnpm build:win` / release 工作流）；产物由 electron-builder extraResources 带进 resources。
 * 非 Windows 平台直接跳过。需要 Visual Studio 的 C++ 工具（MSVC x64 与 Windows SDK）：经 vswhere 找到安装位置，
 * 在 vcvars64 环境里调 cl。只出 x64（与 Windows 发布目标一致）。
 */
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'build/win/CompressMenu.cpp')
const def = resolve(root, 'build/win/CompressMenu.def')
const output = resolve(root, 'build/win/compress-menu.dll')

if (process.platform !== 'win32') {
  console.log('[win-shell] skipped: not Windows')
  process.exit(0)
}
for (const file of [source, def]) if (!existsSync(file)) throw new Error(`missing ${file}`)

const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
const vswhere = join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
if (!existsSync(vswhere))
  throw new Error(`missing ${vswhere}（需要安装 Visual Studio 或其生成工具）`)
const vsPath = execFileSync(
  vswhere,
  [
    '-latest',
    '-products',
    '*',
    '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property',
    'installationPath'
  ],
  { encoding: 'utf8' }
).trim()
if (vsPath === '') throw new Error('未找到带 MSVC x64 工具的 Visual Studio')
const vcvars = join(vsPath, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')

// 中间产物（.obj / .lib / .exp）放临时目录，不落进仓库
const work = mkdtempSync(join(tmpdir(), 'devcube-win-shell-'))
try {
  const cl = [
    'cl',
    '/nologo',
    '/O2',
    '/EHsc',
    '/std:c++17',
    '/utf-8',
    '/W4',
    '/LD',
    '/MT',
    '/DUNICODE',
    '/D_UNICODE',
    `/Fo"${work}\\\\"`,
    `"${source}"`,
    '/link',
    `/DEF:"${def}"`,
    `/OUT:"${output}"`,
    `/IMPLIB:"${join(work, 'compress-menu.lib')}"`,
    'ole32.lib',
    'shell32.lib',
    'shlwapi.lib',
    'advapi32.lib',
    'user32.lib',
    // WRL 的 Module 用到 RoOriginateError，按微软「用 WRL 创建经典 COM 组件」的要求链接
    'runtimeobject.lib'
  ].join(' ')
  // execSync 在 Windows 上经 cmd.exe 执行整条命令：先载入 vcvars64 的环境，再在同一个 shell 里调 cl
  execSync(`call "${vcvars}" >nul && ${cl}`, { stdio: 'inherit' })
} finally {
  rmSync(work, { recursive: true, force: true })
}
console.log(`[win-shell] built ${output}`)
