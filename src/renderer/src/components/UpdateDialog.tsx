// 更新弹窗：顶栏更新钮、「关于」页「立即更新」与开发版绿色预览钮共用——列出当前版本之后、到新版本为止的
// 更新日志，确认后才执行更新动作（docs/prd/changelog.md）。日志是 Markdown：原始 HTML 不渲染（库默认），
// 链接一律拦截默认跳转，http/https/mailto 交给系统浏览器（同 Files 的 Markdown 预览）。
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FormDialogShell } from '@renderer/components/ui/form-dialog'
import type { UpdateButtonAction } from '@shared/app-update'
import type { ChangelogEntry } from '@shared/changelog'
import { isExternalLink } from '@shared/external-link'

// 日志只是几行短句：按弹窗正文排紧凑列表，不套文章排版（prose）
const MARKDOWN_COMPONENTS: Components = {
  ul: ({ children }) => (
    <ul className="list-disc space-y-0.5 pl-4 marker:text-[color:var(--fg-disabled)]">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal space-y-0.5 pl-5 marker:text-[color:var(--fg-disabled)]">
      {children}
    </ol>
  ),
  p: ({ children }) => <p className="mt-1 first:mt-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  code: ({ children }) => (
    <code className="rounded bg-[var(--bg-deepest)] px-1 font-mono text-[12px]">{children}</code>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-[color:var(--link)] hover:underline"
      onClick={(e) => {
        e.preventDefault()
        if (href !== undefined && isExternalLink(href)) void window.api.openExternal(href)
      }}
    >
      {children}
    </a>
  )
}

/**
 * 日志滚动区：伸进面板右内边距并常留滚动条位（8px）——滚动条贴面板右缘、与日期隔 8px，
 * 有无滚动条时日期都与标题 / 按钮右缘对齐。上下渐变用通用滚动渐隐遮罩（main.css），让出滚动条。
 */
function ChangelogScroller({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="scroll-fade-y relative -mr-4 [--scroll-fade-color:var(--bg-elevated)] [--scroll-fade-gutter:8px]">
      <div className="scroll-fade-scroller max-h-[min(360px,50vh)] select-text overflow-y-auto pr-2 text-[13px] leading-relaxed text-foreground [scrollbar-gutter:stable]">
        {children}
      </div>
    </div>
  )
}

export function UpdateDialog({
  productName,
  currentVersion,
  targetVersion,
  changelog,
  action,
  onConfirm,
  onCancel
}: {
  productName: string
  currentVersion: string
  targetVersion: string
  /** 新→旧；没写日志时为空 */
  changelog: ChangelogEntry[]
  /** 确认后执行的动作，决定主按钮文案：能自动安装的重启安装，便携 / 开发版去 GitHub 下载 */
  action: UpdateButtonAction
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <FormDialogShell
      className="w-[480px]"
      message={
        <>
          <div className="text-[14px] font-semibold text-[color:var(--fg-primary)]">
            {productName} {targetVersion} 可用
          </div>
          <div className="text-[12px] text-muted-foreground">当前版本 {currentVersion}</div>
        </>
      }
      buttons={[
        { label: action === 'quitAndInstall' ? '重启并更新' : '前往下载', onClick: onConfirm }
      ]}
      onCancel={onCancel}
    >
      <ChangelogScroller>
        {changelog.length === 0 ? (
          <div>无更新日志</div>
        ) : (
          <div className="space-y-3">
            {changelog.map((entry) => (
              <section key={entry.version}>
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <span className="text-[14px] font-semibold text-[color:var(--fg-primary)]">
                    {entry.version}
                  </span>
                  {entry.date !== null && (
                    <span className="text-[12px] text-muted-foreground">{entry.date}</span>
                  )}
                </div>
                <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                  {entry.body}
                </Markdown>
              </section>
            ))}
          </div>
        )}
      </ChangelogScroller>
    </FormDialogShell>
  )
}
