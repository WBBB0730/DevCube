// 工具栏「添加远程」（仓库没有远程时，「在浏览器中打开」那颗钮换成它；docs/prd/git-remote-github.md）：远程名固定 origin，
// 顶部分段按钮二选一——「已有仓库」填地址（登录 GitHub 后可从自己的仓库里选），添加后立即获取；「新建仓库」在当前
// GitHub 账号或它能新建仓库的组织下建一个空仓库，再把它添加为 origin（空仓库无可获取）。没登录时「新建仓库」里只有登录入口；
// 凭证是申请 read:org 之前登录拿到的（列不出组织）时，「所有者」旁多一个「重新登录」。
// 添加走 runAction（进行中遮罩 / 错误框由 GitDialogs 统一呈现）；新建失败弹错误框，表单原样保留。
import { useEffect, useState } from 'react'
import {
  defaultGitHubRepoName,
  gitHubRepoNameError,
  gitHubRepoUrl,
  type GitHubOrgsResult
} from '@shared/github'
import { repoRootOf, runActionsThenReloadConfig } from '@renderer/git-store'
import { useGitHub } from '@renderer/github-store'
import { GitHubLoginDialog } from '@renderer/components/GitHubLoginDialog'
import { RepoUrlInput } from '@renderer/components/RepoUrlInput'
import { Button } from '@renderer/components/ui/button'
import { CHOICE_ROW, Checkbox } from '@renderer/components/ui/checkbox'
import { ErrorDialog, FieldRow, FormDialogShell } from '@renderer/components/ui/form-dialog'
import { Input } from '@renderer/components/ui/input'
import { SegmentedControl } from '@renderer/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'

/** 工具栏添加的远程固定叫这个（要别的名字走仓库设置）。 */
const REMOTE_NAME = 'origin'

type Mode = 'existing' | 'create'

export function GitAddRemoteDialog({
  repoPath,
  onClose
}: {
  repoPath: string
  onClose: () => void
}): React.JSX.Element {
  const login = useGitHub((s) => s.account?.login ?? null)
  const [mode, setMode] = useState<Mode>('existing')
  /** 可选的组织，连同读它时的账号（换了账号旧结果即作废）；打开就读，切到「新建仓库」时已就绪 */
  const [orgs, setOrgs] = useState<{ login: string; result: GitHubOrgsResult } | null>(null)
  /** 登录等待框关一次加一：重新登录后账号没变也要重读组织 */
  const [loginRound, setLoginRound] = useState(0)
  /** 选中的所有者；null 为当前账号 */
  const [org, setOrg] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [name, setName] = useState(() =>
    defaultGitHubRepoName(repoRootOf(repoPath).split('/').pop() ?? '')
  )
  const [description, setDescription] = useState('')
  const [isPrivate, setIsPrivate] = useState(true)
  /** 正在 GitHub 上新建：防连点 */
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)

  useEffect(() => {
    if (login === null) return
    let alive = true
    void window.api.githubOrgs().then((result) => {
      if (alive) setOrgs({ login, result })
    })
    return () => {
      alive = false
    }
  }, [login, loginRound])

  // 读不出组织（出错或缺授权）时只有当前账号可选
  const orgResult = orgs !== null && orgs.login === login ? orgs.result : null
  const orgList = orgResult?.status === 'ok' ? orgResult.orgs : []
  const orgScopeMissing = orgResult?.status === 'ok' && orgResult.orgScopeMissing
  // 选中的组织不在了（换账号、重新读到的列表里没有它）：回到当前账号
  const owner = org !== null && orgList.includes(org) ? org : null

  const add = async (remoteUrl: string, fetchAfter: boolean): Promise<boolean> =>
    runActionsThenReloadConfig(repoPath, [
      {
        action: {
          kind: 'add-remote',
          name: REMOTE_NAME,
          url: remoteUrl,
          pushUrl: null,
          fetchAfter
        },
        label: '正在添加远程…'
      }
    ])

  const create = async (): Promise<void> => {
    setCreating(true)
    const result = await window.api.githubCreateRepo({
      org: owner,
      name: name.trim(),
      description: description.trim(),
      isPrivate
    })
    if (result.status === 'error') {
      setCreating(false)
      setCreateError(result.message)
      return
    }
    useGitHub.getState().addRepo(result.repo)
    const prefs = await window.api.getAppPrefs()
    // 仓库已经建好：不论添加成败都收起（失败由错误框说明，再添加时可从自己的仓库里选到它）
    onClose()
    void add(gitHubRepoUrl(result.repo, prefs.githubRepoProtocol), false)
  }

  const nameError = gitHubRepoNameError(name.trim())
  const disabledReason =
    mode === 'existing'
      ? url.trim() === ''
        ? '请输入远程地址'
        : null
      : login === null
        ? '请先登录 GitHub'
        : nameError

  return (
    <FormDialogShell
      message={`添加远程 “${REMOTE_NAME}”：`}
      buttons={[
        {
          label: mode === 'existing' ? '添加' : '新建',
          disabled: disabledReason !== null || creating,
          title: disabledReason ?? undefined,
          onClick: () => {
            if (mode === 'create') void create()
            else
              void add(url.trim(), true).then((ok) => {
                if (ok) onClose()
              })
          }
        }
      ]}
      onCancel={onClose}
    >
      <SegmentedControl
        value={mode}
        onValueChange={(next) => setMode(next as Mode)}
        items={[
          { value: 'existing', label: '已有仓库' },
          { value: 'create', label: '新建仓库' }
        ]}
      />
      {mode === 'existing' ? (
        <FieldRow label="远程地址">
          <RepoUrlInput
            value={url}
            autoFocus
            placeholder="https://github.com/owner/repo.git"
            onChange={setUrl}
          />
        </FieldRow>
      ) : login !== null ? (
        <>
          <FieldRow label="所有者">
            <div className="flex items-center gap-2">
              <Select
                value={owner ?? login}
                onValueChange={(v) => {
                  if (v != null) setOrg(v === login ? null : v)
                }}
                items={[login, ...orgList].map((o) => ({ value: o, label: o }))}
              >
                <SelectTrigger className="min-w-0 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[login, ...orgList].map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {orgScopeMissing && (
                <button
                  type="button"
                  title="重新登录 GitHub 后可选择组织"
                  className="shrink-0 text-[13px] text-[color:var(--link)] hover:underline"
                  onClick={() => setLoginOpen(true)}
                >
                  重新登录
                </button>
              )}
            </div>
          </FieldRow>
          <FieldRow label="仓库名">
            <Input
              value={name}
              autoFocus
              spellCheck={false}
              className="font-mono"
              onChange={(e) => setName(e.target.value)}
            />
          </FieldRow>
          <FieldRow label="描述">
            <Input
              value={description}
              placeholder="可留空"
              onChange={(e) => setDescription(e.target.value)}
            />
          </FieldRow>
          <label className={CHOICE_ROW}>
            <Checkbox checked={isPrivate} onCheckedChange={setIsPrivate} />
            私有仓库
          </label>
        </>
      ) : (
        // 同设置「账号」栏未登录时的那一行
        <div className="flex min-h-7 items-center gap-2 text-[13px] text-foreground">
          <span>未登录 GitHub</span>
          <Button type="button" size="sm" variant="secondary" onClick={() => setLoginOpen(true)}>
            登录
          </Button>
        </div>
      )}
      {loginOpen && (
        <GitHubLoginDialog
          onClose={() => {
            setLoginOpen(false)
            setLoginRound((n) => n + 1)
          }}
        />
      )}
      {createError !== null && (
        <ErrorDialog
          title="无法新建仓库"
          message={createError}
          onClose={() => setCreateError(null)}
        />
      )}
    </FormDialogShell>
  )
}
