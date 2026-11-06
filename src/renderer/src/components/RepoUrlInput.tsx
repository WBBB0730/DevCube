// 仓库地址输入框（docs/prd/git-remote-github.md）：克隆的「仓库地址」、初始化的「远程地址」、仓库设置里添加 / 编辑远程的
// 「Fetch URL」「Push URL」与工具栏「添加远程」共用。等宽输入；登录 GitHub 后右边多一颗 GitHub 标志的图标钮（同「位置」旁的选择目录钮），
// 点开是当前账号能访问的仓库（最近推送的在前，可筛选），选中即按设置里的地址形式（HTTPS / SSH）填进输入框、焦点回到输入框
// （回车即提交所在的对话框）；没选就收起时焦点照常回到钮上。地址不做拼写检查。
import { useMemo, useRef, useState } from 'react'
import { gitHubRepoUrl, type GitHubRepo } from '@shared/github'
import { useGitHub } from '@renderer/github-store'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger
} from '@renderer/components/ui/combobox'
import { GitHubMark } from '@renderer/components/ui/github-mark'
import { INPUT_ICON_BTN, Input } from '@renderer/components/ui/input'

/** 还没读到仓库时的空列表（稳定引用）。 */
const NO_REPOS: GitHubRepo[] = []
/** 改筛选文字时，列表在这么久内读到过就不重读（筛选只在已读到的列表里过滤，重读与筛选文字无关）。 */
const FILTER_RELOAD_AGE_MS = 10_000

export function RepoUrlInput({
  value,
  onChange,
  autoFocus,
  placeholder
}: {
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
  placeholder?: string
}): React.JSX.Element {
  const signedIn = useGitHub((s) => s.account !== null)
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-center gap-1.5">
      <Input
        ref={inputRef}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        spellCheck={false}
        className="min-w-0 flex-1 font-mono"
        onChange={(e) => onChange(e.target.value)}
      />
      {signedIn && <GitHubRepoPicker inputRef={inputRef} onPick={onChange} />}
    </div>
  )
}

/**
 * 「从 GitHub 选择仓库」：每次打开都重读列表，改筛选文字时列表若已读到超过 10 秒也重读（正在读时不再叠读；读到之前显示
 * 上次的），选中即交出按设置的地址形式取的地址。
 */
function GitHubRepoPicker({
  inputRef,
  onPick
}: {
  /** 选中后焦点回到的输入框 */
  inputRef: React.RefObject<HTMLInputElement | null>
  onPick: (url: string) => void
}): React.JSX.Element {
  const repos = useGitHub((s) => s.repos)
  const loadRepos = useGitHub((s) => s.loadRepos)
  const [open, setOpen] = useState(false)
  /** 这次收起是因为选中了一项（选中先于收起） */
  const pickedRef = useRef(false)
  const list = repos?.status === 'ok' ? repos.repos : NO_REPOS
  const names = useMemo(() => list.map((r) => r.fullName), [list])
  const hint =
    repos === null || repos.status === 'loading'
      ? '正在加载…'
      : repos.status === 'error'
        ? repos.message
        : list.length === 0
          ? '没有仓库'
          : '没有匹配的仓库'

  const pick = (name: string | null): void => {
    const repo = list.find((r) => r.fullName === name)
    if (repo === undefined) return
    pickedRef.current = true
    void window.api
      .getAppPrefs()
      .then((prefs) => onPick(gitHubRepoUrl(repo, prefs.githubRepoProtocol)))
  }

  return (
    <Combobox
      items={names}
      value={null}
      onValueChange={pick}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) void loadRepos()
      }}
      onInputValueChange={(_, details) => {
        if (details.reason === 'input-change') void loadRepos(FILTER_RELOAD_AGE_MS)
      }}
    >
      <ComboboxTrigger chevron={false} title="从 GitHub 选择仓库" className={INPUT_ICON_BTN}>
        <GitHubMark className="size-4" />
      </ComboboxTrigger>
      {/* 定宽：列表读到前后弹层不变宽变窄 */}
      <ComboboxContent
        align="end"
        className="w-80"
        finalFocus={() => {
          const picked = pickedRef.current
          pickedRef.current = false
          return picked ? inputRef.current : true
        }}
      >
        <ComboboxInput placeholder="筛选仓库…" />
        <ComboboxEmpty>{hint}</ComboboxEmpty>
        <ComboboxList>
          {(name: string) => (
            <ComboboxItem key={name} value={name} title={name} indicator={false}>
              {name}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
