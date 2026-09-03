// 解析用户登录 shell 的环境变量 —— GUI 启动（Dock / Finder）的应用拿不到用户终端里的
// PATH 等变量，git 的钩子、git-lfs、凭据助手都要靠这份环境才找得到。
// 移植自 VS Code src/vs/platform/shell/node/shellEnv.ts（逐函数对齐，只剥 vscode 内部依赖：
// 日志、配置服务、取消令牌、本地化；`--force-*-user-env` 参数与 VSCODE_CLI 跳过项没有对应物——
// DevCube 的 CLI 经 open(1) 唤起，进程环境与 Dock 启动无异）。getSystemShell 取自 base/node/shell.ts。

import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { userInfo } from 'os'
import { basename } from 'path'

/** 解析 shell 环境的最长等待（VS Code 默认 10 秒；其 `application.shellEnvironmentResolutionTimeout` 设置项无对应物）。 */
const MAX_SHELL_RESOLVE_TIME = 10000

class CancellationError extends Error {
  constructor() {
    super('Canceled')
    this.name = this.message
  }
}

function isCancellationError(error: unknown): boolean {
  return error instanceof CancellationError
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

let unixShellEnvPromise: Promise<typeof process.env> | undefined = undefined

/**
 * 通过起一个 shell 解析 shell 环境。这次 spawn 会被缓存，后续调用复用同一结果。
 *
 * 以下情况会 reject：
 * - 超过 `MAX_SHELL_RESOLVE_TIME` 超时
 * - 起 shell 解析环境时的其他任何错误
 */
export async function getResolvedShellEnv(): Promise<typeof process.env> {
  // Windows 跳过
  if (process.platform === 'win32') {
    return {}
  }

  // 其余（macOS、Linux）解析
  else {
    // 只调用一次并缓存 promise，后续调用复用——
    // 这一步开销大（要起进程）。
    if (!unixShellEnvPromise) {
      unixShellEnvPromise = new Promise<NodeJS.ProcessEnv>((resolve, reject) => {
        const cts = new AbortController()

        // 超过时限就放弃解析 shell 环境
        const timeout = setTimeout(() => {
          cts.abort()
          reject(new Error('无法在合理时间内解析你的 shell 环境。请检查 shell 配置后重启。'))
        }, MAX_SHELL_RESOLVE_TIME)

        // 解析 shell 环境并处理错误
        void (async () => {
          try {
            resolve(await doResolveUnixShellEnv(cts.signal))
          } catch (error) {
            if (!isCancellationError(error) && !cts.signal.aborted) {
              reject(new Error(`无法解析你的 shell 环境：${toErrorMessage(error)}`))
            } else {
              resolve({})
            }
          } finally {
            clearTimeout(timeout)
          }
        })()
      })
    }

    return unixShellEnvPromise
  }
}

async function doResolveUnixShellEnv(signal: AbortSignal): Promise<typeof process.env> {
  const runAsNode = process.env['ELECTRON_RUN_AS_NODE']

  const noAttach = process.env['ELECTRON_NO_ATTACH_CONSOLE']

  const mark = randomUUID().replace(/-/g, '').substr(0, 12)
  const regex = new RegExp(mark + '({.*})' + mark)

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_NO_ATTACH_CONSOLE: '1',
    DEVCUBE_RESOLVING_ENVIRONMENT: '1'
  }

  const systemShellUnix = getSystemShellUnixLike(env)

  return new Promise<typeof process.env>((resolve, reject) => {
    if (signal.aborted) {
      return reject(new CancellationError())
    }

    // 处理常见的非 POSIX shell
    const name = basename(systemShellUnix)
    let command: string, shellArgs: Array<string>
    const extraArgs = ''
    if (/^(?:pwsh|powershell)(?:-preview)?$/.test(name)) {
      // 旧版 PowerShell 有时会去掉双引号，所以用「双单引号」——单引号字符串里转义单引号的写法。
      command = `& '${process.execPath}' ${extraArgs} -p '''${mark}'' + JSON.stringify(process.env) + ''${mark}'''`
      shellArgs = ['-Login', '-Command']
    } else if (name === 'nu') {
      // nushell 要在带引号的路径前加 ^ 才当作命令
      command = `^'${process.execPath}' ${extraArgs} -p '"${mark}" + JSON.stringify(process.env) + "${mark}"'`
      shellArgs = ['-i', '-l', '-c']
    } else if (name === 'xonsh') {
      // #200374：原生实现更短
      command = `import os, json; print("${mark}", json.dumps(dict(os.environ)), "${mark}")`
      shellArgs = ['-i', '-l', '-c']
    } else {
      command = `'${process.execPath}' ${extraArgs} -p '"${mark}" + JSON.stringify(process.env) + "${mark}"'`

      if (name === 'tcsh' || name === 'csh') {
        shellArgs = ['-ic']
      } else {
        shellArgs = ['-i', '-l', '-c']
      }
    }

    const child = spawn(systemShellUnix, [...shellArgs, command], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env
    })

    signal.addEventListener('abort', () => {
      child.kill()

      return reject(new CancellationError())
    })

    child.on('error', (err) => {
      reject(err)
    })

    const buffers: Buffer[] = []
    child.stdout.on('data', (b) => buffers.push(b))

    const stderr: Buffer[] = []
    child.stderr.on('data', (b) => stderr.push(b))

    child.on('close', (code, signal) => {
      const raw = Buffer.concat(buffers).toString('utf8')

      if (code || signal) {
        return reject(new Error(`起的 shell 以意外状态退出（code ${code}, signal ${signal}）`))
      }

      const match = regex.exec(raw)
      const rawStripped = match ? match[1] : '{}'

      try {
        const env = JSON.parse(rawStripped)

        if (runAsNode) {
          env['ELECTRON_RUN_AS_NODE'] = runAsNode
        } else {
          delete env['ELECTRON_RUN_AS_NODE']
        }

        if (noAttach) {
          env['ELECTRON_NO_ATTACH_CONSOLE'] = noAttach
        } else {
          delete env['ELECTRON_NO_ATTACH_CONSOLE']
        }

        delete env['DEVCUBE_RESOLVING_ENVIRONMENT']

        // https://github.com/microsoft/vscode/issues/22593#issuecomment-336050758
        delete env['XDG_RUNTIME_DIR']

        resolve(env)
      } catch (err) {
        reject(err)
      }
    })
  })
}

// —— 系统 shell 探测（移植自 base/node/shell.ts，只保留本机 unix 分支） ——

let _TERMINAL_DEFAULT_SHELL_UNIX_LIKE: string | null = null
function getSystemShellUnixLike(env: NodeJS.ProcessEnv): string {
  if (!_TERMINAL_DEFAULT_SHELL_UNIX_LIKE) {
    let unixLikeTerminal: string | undefined | null
    unixLikeTerminal = env['SHELL']

    if (!unixLikeTerminal) {
      try {
        // $SHELL 可能未设置，这个 API 读 /etc/passwd。见 https://github.com/github/codespaces/issues/1639
        // Node 文档："用户没有 username 或 homedir 时抛 SystemError。"
        unixLikeTerminal = userInfo().shell
      } catch {
        /* 无法读取 passwd：走下面的默认值 */
      }
    }

    if (!unixLikeTerminal) {
      unixLikeTerminal = 'sh'
    }

    // 有些系统把 $SHELL 设成 /bin/false，会让终端起不来
    if (unixLikeTerminal === '/bin/false') {
      unixLikeTerminal = '/bin/bash'
    }
    _TERMINAL_DEFAULT_SHELL_UNIX_LIKE = unixLikeTerminal
  }
  return _TERMINAL_DEFAULT_SHELL_UNIX_LIKE
}
