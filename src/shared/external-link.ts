/**
 * 可交给系统浏览器 / 邮件客户端打开的链接：只放行 http / https / mailto，杜绝 file:// 等其他协议。
 * 主进程 IPC openExternal、开窗守卫与渲染层预览共用这一份白名单。
 */
export function isExternalLink(url: string): boolean {
  return /^(https?|mailto):/i.test(url)
}
