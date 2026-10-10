// GitHub 设备授权登录的等待框（docs/prd/github-checks.md）：打开即发起登录，拿到代码后显示并注明已复制（主进程已复制）；
// 验证页由用户点「打开 GitHub」再开，不自动跳走——先让人看清代码（GitHub 不支持带代码预填）。用户在网页上授权完即关闭；
// 取消或关闭即取消登录；失败换成错误框，确定后一并关闭。
import { useEffect, useState } from 'react'
import type { GitHubLoginCode } from '@shared/github'
import { ErrorDialog, FormDialogShell } from '@renderer/components/ui/form-dialog'

export function GitHubLoginDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [code, setCode] = useState<GitHubLoginCode | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 只在打开时发起一次（onClose 换引用不重来）；卸载即取消，已结束的取消无害
  useEffect(() => {
    let alive = true
    const off = window.api.onGitHubLoginCode((next) => {
      if (alive) setCode(next)
    })
    void window.api.githubLogin().then((result) => {
      if (!alive) return
      if (result.status === 'ok') onClose()
      else if (result.status === 'error') setError(result.message)
    })
    return () => {
      alive = false
      off()
      void window.api.githubLoginCancel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [])

  if (error !== null) return <ErrorDialog title="登录失败" message={error} onClose={onClose} />

  return (
    <FormDialogShell
      message={
        code === null ? (
          '正在连接 GitHub…'
        ) : (
          <>
            在 GitHub 页面中输入此代码
            <span className="text-muted-foreground">（已复制）</span>
          </>
        )
      }
      buttons={[
        {
          label: '打开 GitHub',
          disabled: code === null,
          onClick: () => {
            if (code !== null) void window.api.openExternal(code.verificationUri)
          }
        }
      ]}
      onCancel={onClose}
    >
      {code !== null && (
        <div className="select-text py-2 text-center font-mono text-[24px] tracking-[0.15em] text-foreground">
          {code.userCode}
        </div>
      )}
    </FormDialogShell>
  )
}
