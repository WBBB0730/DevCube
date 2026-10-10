import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type CancellationToken,
  type MessageConnection
} from 'vscode-jsonrpc/node'
import type { WslConnectionState } from '../shared/wsl'
import { WslConnections, type WslHelperProcess } from './wsl-connection'

interface ExecParams {
  file: string
  args: string[]
  cwd: string
  env?: Record<string, string>
  stdin?: string
  stream?: string
}

type ExecHandler = (
  p: ExecParams,
  token: CancellationToken,
  notify: (fd: 'stdout' | 'stderr', text: string) => void
) => unknown

/** 内存里的假小助手：另一端用同一个 JSON-RPC 库应答（协议同 build/wsl/server.go）。 */
function fakeHelper(
  options: {
    exec?: ExecHandler
    initialize?: boolean
    stderr?: string
    onServer?: (server: MessageConnection) => void
  } = {}
): WslHelperProcess & { crash(): void } {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let finish: (reason: string | null) => void = () => {}
  const exited = new Promise<string | null>((resolve) => (finish = resolve))
  const server = createMessageConnection(
    new StreamMessageReader(stdin),
    new StreamMessageWriter(stdout)
  )
  // initialize: false 即一直不应答（模拟卡住或没起来）
  server.onRequest('initialize', () =>
    options.initialize === false
      ? new Promise(() => {})
      : {
          executable: '/mnt/c/DevCube/resources/wsl/devcube-wsl',
          shell: '/bin/bash',
          runDir: '/tmp/devcube-wsl-runs-1'
        }
  )
  server.onRequest('exec', (p: ExecParams, token) =>
    (options.exec ?? (() => ({ code: 0 })))(p, token, (fd, text) => {
      void server.sendNotification('exec/data', {
        stream: p.stream,
        fd,
        data: Buffer.from(text).toString('base64')
      })
    })
  )
  options.onServer?.(server)
  server.listen()
  const end = (): void => {
    server.dispose()
    finish(null)
  }
  if (options.stderr !== undefined) {
    stderr.write(options.stderr)
    setTimeout(end, 0)
  }
  return { stdin, stdout, stderr, exited, kill: end, crash: end }
}

interface Setup {
  connections: WslConnections
  spawned: Array<ReturnType<typeof fakeHelper>>
  states: WslConnectionState[]
}

function setup(
  options: {
    preflight?: string | null
    helpers?: Array<ReturnType<typeof fakeHelper>>
    timeoutMs?: number
  } = {}
): Setup {
  const spawned: Array<ReturnType<typeof fakeHelper>> = []
  const states: WslConnectionState[] = []
  const connections = new WslConnections({
    preflight: async () => options.preflight ?? null,
    spawnHelper: () => {
      const helper = options.helpers?.[spawned.length] ?? fakeHelper()
      spawned.push(helper)
      return helper
    },
    timeoutMs: options.timeoutMs ?? 5000
  })
  connections.onState((_, state) => states.push(state))
  return { connections, spawned, states }
}

describe('WslConnections', () => {
  it('连上后复用同一个小助手；并发连接只起一个', async () => {
    const { connections, spawned, states } = setup()
    const [a, b] = await Promise.all([connections.connect('Ubuntu'), connections.connect('ubuntu')])
    expect(a.executable).toBe('/mnt/c/DevCube/resources/wsl/devcube-wsl')
    expect(b).toEqual(a)
    expect(spawned).toHaveLength(1)
    expect(states).toEqual([{ status: 'connecting' }, { status: 'connected' }])
    expect(connections.state('UBUNTU')).toEqual({ status: 'connected' })
  })

  it('连接前检查不通过：失败并保持原因，exec 不再起进程，重新连接才重试', async () => {
    const { connections, spawned } = setup({ preflight: '未找到发行版 Ubuntu' })
    await expect(connections.connect('Ubuntu')).rejects.toThrow('未找到发行版 Ubuntu')
    expect(connections.state('Ubuntu')).toEqual({ status: 'failed', reason: '未找到发行版 Ubuntu' })
    const r = await connections.exec('Ubuntu', 'git', ['status'], { cwd: '/home/me' })
    expect(r.code).toBe(-1)
    expect(r.error?.message).toBe('未找到发行版 Ubuntu')
    expect(spawned).toHaveLength(0)
    await expect(connections.reconnect('Ubuntu')).rejects.toThrow('未找到发行版 Ubuntu')
  })

  it('小助手没起来：带上 wsl.exe 的报错', async () => {
    const { connections } = setup({
      helpers: [
        fakeHelper({
          initialize: false,
          stderr: 'line1\n./devcube-wsl: No such file or directory\n'
        })
      ]
    })
    await expect(connections.connect('Ubuntu')).rejects.toThrow(
      'WSL 启动失败：line1 ./devcube-wsl: No such file or directory'
    )
  })

  it('初始化超时', async () => {
    const { connections } = setup({ helpers: [fakeHelper({ initialize: false })], timeoutMs: 50 })
    await expect(connections.connect('Ubuntu')).rejects.toThrow('连接 Ubuntu 超时')
  })

  it('exec 透传参数、解码输出；找不到可执行文件时 error.code 为 ENOENT', async () => {
    let seen: ExecParams | null = null
    const helper = fakeHelper({
      exec: (p) => {
        seen = p
        if (p.file === 'nope') return { code: -1, error: '未找到 nope', notFound: true }
        return {
          code: 2,
          stdout: Buffer.from('out').toString('base64'),
          stderr: Buffer.from('err').toString('base64')
        }
      }
    })
    const { connections } = setup({ helpers: [helper] })
    const r = await connections.exec('Ubuntu', 'git', ['log'], {
      cwd: '/home/me/web',
      env: { GIT_EDITOR: 'true' },
      input: Buffer.from('in')
    })
    expect(seen).toMatchObject({
      file: 'git',
      args: ['log'],
      cwd: '/home/me/web',
      env: { GIT_EDITOR: 'true' },
      stdin: Buffer.from('in').toString('base64')
    })
    expect(r.code).toBe(2)
    expect(r.stdout.toString()).toBe('out')
    expect(r.stderr.toString()).toBe('err')
    expect(r.error).toBeNull()
    const missing = await connections.exec('Ubuntu', 'nope', [], { cwd: '/' })
    expect((missing.error as NodeJS.ErrnoException).code).toBe('ENOENT')
  })

  it('流式输出按块回调', async () => {
    const helper = fakeHelper({
      exec: (_, __, notify) => {
        notify('stdout', 'a')
        notify('stderr', 'b')
        return { code: 0 }
      }
    })
    const { connections } = setup({ helpers: [helper] })
    const chunks: string[] = []
    await connections.exec('Ubuntu', 'rg', [], {
      cwd: '/',
      onData: (fd, chunk) => chunks.push(`${fd}:${chunk.toString()}`)
    })
    expect(chunks).toEqual(['stdout:a', 'stderr:b'])
  })

  it('取消即通知小助手结束命令', async () => {
    const helper = fakeHelper({
      exec: (_, token) =>
        new Promise((resolve) => token.onCancellationRequested(() => resolve({ code: -1 })))
    })
    const { connections } = setup({ helpers: [helper] })
    const controller = new AbortController()
    const pending = connections.exec('Ubuntu', 'git', ['clone'], {
      cwd: '/',
      signal: controller.signal
    })
    await new Promise((r) => setTimeout(r, 20))
    controller.abort()
    expect((await pending).code).toBe(-1)
  })

  it('意外断开后标为未连接，下次用到时重新连', async () => {
    const first = fakeHelper()
    const { connections, spawned, states } = setup({ helpers: [first, fakeHelper()] })
    await connections.connect('Ubuntu')
    first.crash()
    await new Promise((r) => setTimeout(r, 0))
    expect(connections.state('Ubuntu')).toEqual({ status: 'disconnected' })
    expect((await connections.exec('Ubuntu', 'true', [], { cwd: '/' })).code).toBe(0)
    expect(spawned).toHaveLength(2)
    expect(states.at(-1)).toEqual({ status: 'connected' })
  })

  it('结束运行会话：转给小助手；没连上或小助手报错时返回 false', async () => {
    const killed: unknown[] = []
    const forgotten: unknown[] = []
    const helper = fakeHelper({
      onServer: (server) => {
        server.onRequest('killRun', (p: { id: string; signal: string }) => {
          if (p.id === 'missing') throw new Error('未登记')
          killed.push(p)
        })
        server.onNotification('forgetRun', (p: unknown) => {
          forgotten.push(p)
        })
      }
    })
    const { connections } = setup({ helpers: [helper] })
    expect(await connections.killRun('Ubuntu', 'run-1', 'SIGTERM')).toBe(false)
    await connections.connect('Ubuntu')
    expect(await connections.killRun('Ubuntu', 'run-1', 'SIGTERM')).toBe(true)
    expect(await connections.killRun('Ubuntu', 'missing', 'SIGKILL')).toBe(false)
    connections.forgetRun('Ubuntu', 'run-1')
    await new Promise((r) => setTimeout(r, 10))
    expect(killed).toEqual([{ id: 'run-1', signal: 'SIGTERM' }])
    expect(forgotten).toEqual([{ id: 'run-1' }])
  })

  it('监听要先连上；取消后不再回调。读目录、读文件', async () => {
    let server: MessageConnection | null = null
    let watchId = ''
    const helper = fakeHelper({
      onServer: (conn) => {
        server = conn
        conn.onRequest('watch', (p: { id: string }) => {
          watchId = p.id
        })
        conn.onRequest('unwatch', () => null)
        conn.onRequest('readDir', (p: { path: string }): { names: string[]; notFound?: boolean } =>
          p.path === '/missing' ? { names: [], notFound: true } : { names: ['package.json'] }
        )
        conn.onRequest('readFile', (p: { path: string }): { data?: string; notFound?: boolean } =>
          p.path.endsWith('package.json')
            ? { data: Buffer.from('{}').toString('base64') }
            : { notFound: true }
        )
      }
    })
    const { connections } = setup({ helpers: [helper] })
    await expect(connections.watch('Ubuntu', '/home/me/web', () => {})).rejects.toThrow(
      '尚未连接到 Ubuntu'
    )
    await connections.connect('Ubuntu')
    let calls = 0
    const unwatch = await connections.watch('Ubuntu', '/home/me/web', () => calls++)
    await unwatch()
    void server!.sendNotification('watch/events', {
      id: watchId,
      events: [{ path: '/home/me/web/a', type: 'create' }]
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(calls).toBe(0)
    expect(await connections.readDir('Ubuntu', '/home/me/web')).toEqual({
      names: ['package.json'],
      notFound: false
    })
    expect((await connections.readDir('Ubuntu', '/missing')).notFound).toBe(true)
    expect((await connections.readFile('Ubuntu', '/home/me/web/package.json'))?.toString()).toBe(
      '{}'
    )
    expect(await connections.readFile('Ubuntu', '/home/me/web/pubspec.yaml')).toBeNull()
  })

  it('监听事件与出错按订阅回调', async () => {
    let server: MessageConnection | null = null
    let watchId = ''
    const helper = fakeHelper({
      onServer: (conn) => {
        server = conn
        conn.onRequest('watch', (p: { id: string }) => {
          watchId = p.id
        })
      }
    })
    const { connections } = setup({ helpers: [helper] })
    await connections.connect('Ubuntu')
    const got: string[] = []
    await connections.watch('Ubuntu', '/home/me/web', (err, events) =>
      got.push(err ? `error:${err.message}` : events.map((e) => `${e.type}:${e.path}`).join(','))
    )
    void server!.sendNotification('watch/events', {
      id: watchId,
      events: [{ path: '/home/me/web/a.ts', type: 'update' }]
    })
    void server!.sendNotification('watch/error', { id: watchId, message: '超出上限' })
    await new Promise((r) => setTimeout(r, 10))
    expect(got).toEqual(['update:/home/me/web/a.ts', 'error:超出上限'])
  })

  it('连接中被断开：不算失败，回到未连接', async () => {
    const { connections } = setup({ helpers: [fakeHelper({ initialize: false })] })
    const pending = connections.connect('Ubuntu')
    await new Promise((r) => setTimeout(r, 10))
    connections.disconnect('Ubuntu')
    await expect(pending).rejects.toThrow('与 Ubuntu 的连接已断开')
    expect(connections.state('Ubuntu')).toEqual({ status: 'disconnected' })
  })
})
