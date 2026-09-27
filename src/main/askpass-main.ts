// askpass 小助手（独立入口，打包成 out/main/askpass.js）：ssh 按 SSH_ASKPASS 执行启动脚本，
// 脚本以 Node 身份（ELECTRON_RUN_AS_NODE）运行本文件，参数是 ssh 的提问原文。
// 把「连接令牌 + 提问」经本地套接字交给 DevCube 主进程，拿回答案打印到 stdout；
// 取消或出错以非零码退出，ssh 即视为用户放弃（ADR-0038，参照 VS Code git 扩展的 askpass-main）。
// 这里跑在一个裸 Node 进程里：不得引入 electron 或其他主进程模块。

import { connect } from 'node:net'

const prompt = process.argv[2] ?? ''
const handle = process.env.DEVCUBE_ASKPASS_HANDLE
const token = process.env.DEVCUBE_ASKPASS_TOKEN

function fail(): void {
  process.exitCode = 1
}

if (!handle || !token) {
  fail()
} else {
  const socket = connect(handle)
  let buffer = ''
  let answered = false
  socket.setEncoding('utf8')
  socket.on('connect', () => socket.write(`${JSON.stringify({ token, prompt })}\n`))
  socket.on('data', (chunk: string) => {
    buffer += chunk
    const newline = buffer.indexOf('\n')
    if (newline < 0 || answered) return
    answered = true
    socket.end()
    try {
      const { answer } = JSON.parse(buffer.slice(0, newline)) as { answer: unknown }
      if (typeof answer === 'string') process.stdout.write(`${answer}\n`)
      else fail()
    } catch {
      fail()
    }
  })
  socket.on('error', fail)
  socket.on('close', () => {
    if (!answered) fail()
  })
}
