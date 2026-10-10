/**
 * 准备 WSL 小助手（ADR-0055）：交叉编译 build/wsl 的 Go 程序为 Linux x86_64 静态程序，
 * 并取与 @vscode/ripgrep 同版本的 Linux x64 版 rg（静态链接），一起放到 build/wsl/out。
 * 打包 Windows 前运行（`pnpm build:win` / release 工作流）；产物只由 electron-builder 的 win.extraResources 带进 resources/wsl，
 * Mac 与 Linux 安装包不带。只出 x86_64（与 Windows 发布目标 x64 对应）。需要 Go 工具链。
 */
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'build/wsl')
const out = resolve(source, 'out')
mkdirSync(out, { recursive: true })

execFileSync('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', join(out, 'devcube-wsl'), '.'], {
  cwd: source,
  stdio: 'inherit',
  env: { ...process.env, GOOS: 'linux', GOARCH: 'amd64', CGO_ENABLED: '0' }
})

// rg 的 Linux 版是 @vscode/ripgrep 按平台拆出的独立包，本机只装了自身平台那一个；按同一版本从 npm 取包解出 bin/rg
const { version } = JSON.parse(
  readFileSync(resolve(root, 'node_modules/@vscode/ripgrep/package.json'), 'utf8')
) as { version: string }
const work = mkdtempSync(join(tmpdir(), 'devcube-wsl-rg-'))
try {
  execFileSync('npm', ['pack', `@vscode/ripgrep-linux-x64@${version}`, '--silent'], {
    cwd: work,
    stdio: ['ignore', 'ignore', 'inherit'],
    shell: process.platform === 'win32'
  })
  const tarball = readdirSync(work).find((name) => name.endsWith('.tgz'))
  if (!tarball) throw new Error('未取到 @vscode/ripgrep-linux-x64')
  execFileSync('tar', ['-xzf', tarball], { cwd: work, stdio: 'inherit' })
  copyFileSync(join(work, 'package', 'bin', 'rg'), join(out, 'rg'))
  chmodSync(join(out, 'rg'), 0o755)
} finally {
  rmSync(work, { recursive: true, force: true })
}
console.log(`[wsl-helper] built ${out}（rg ${version}）`)
