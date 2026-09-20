// 渲染层导航守卫（Electron 安全清单「限制导航 / 限制开窗」）：应用是单页壳，主框架除重载自己外
// 不允许任何导航；新开窗口一律拒绝，校验过的外链交系统浏览器。挂在 web-contents-created 上，
// 覆盖之后创建的每一个 webContents 而不只主窗。想开浏览器必须显式走 target=_blank 或 IPC openExternal。
import { app, shell } from 'electron'
import { isExternalLink } from '../shared/external-link'

export function installWebContentsGuard(): void {
  app.on('web-contents-created', (_event, contents) => {
    // 同 URL 即重载（dev 下 Vite 整页热重载靠它）；链接点击、location 赋值等其余导航全拦
    contents.on('will-navigate', (event) => {
      if (event.url !== contents.getURL()) event.preventDefault()
    })
    contents.setWindowOpenHandler(({ url }) => {
      if (isExternalLink(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })
}
