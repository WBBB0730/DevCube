/**
 * 编译 macOS「设为默认打开方式」小助手（build/mac/DefaultAppHelper.swift → build/mac/default-app-helper）。
 * 打包 mac 前运行（`pnpm build:mac` / release 工作流）；产物由 electron-builder extraResources 带进
 * Contents/Resources 并随应用签名公证。非 macOS 平台直接跳过。需要 Xcode 命令行工具（swiftc）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'build/mac/DefaultAppHelper.swift')
const output = resolve(root, 'build/mac/default-app-helper')

if (process.platform !== 'darwin') {
  console.log('[mac-helper] skipped: not macOS')
  process.exit(0)
}
if (!existsSync(source)) throw new Error(`missing ${source}`)
mkdirSync(dirname(output), { recursive: true })
// 最低 macOS 12：NSWorkspace.setDefaultApplication(at:toOpen:) 自 12.0 起可用；目标架构随打包目标（arm64）
execFileSync('xcrun', ['swiftc', '-O', '-target', 'arm64-apple-macos12.0', '-o', output, source], {
  stdio: 'inherit'
})
console.log(`[mac-helper] built ${output}`)
