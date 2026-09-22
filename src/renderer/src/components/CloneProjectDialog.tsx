// 「从 Git 仓库克隆」对话框（左树「+」菜单第三项）：项目无关，故挂在 App 根上而非 Git Tab 内。
// 两态共用一个外壳——填写态（地址 / 位置 / 目录名 / 子模块）与克隆态（进度条 + 取消）；
// 失败回到填写态保留输入，成功后由 store 走与其余三条登记路径同一套收尾。
import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { FieldRow, FormDialogShell } from '@renderer/components/ui/form-dialog'
import { Input } from '@renderer/components/ui/input'
import { useApp } from '@renderer/store'
import {
  isCloneDirNameInvalid,
  isLikelyRepoUrl,
  normalizeRepoUrl,
  repoDirNameFromUrl,
  resolveClonePath,
  type GitCloneProgress,
  type GitCloneTargetState
} from '@shared/git-clone'

/** 常规图标钮（28px），与 Input（h-7）同行居中；与 ConfigDialog 的目录选择钮同款。 */
const INPUT_ICON_BTN =
  'flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]'

const TARGET_OCCUPIED = '目标目录已存在且非空'

export function CloneProjectDialog(): React.JSX.Element {
  const close = useApp((s) => s.setCloneDialogOpen)
  const cloneProject = useApp((s) => s.cloneProject)

  const [url, setUrl] = useState('')
  const [parentDir, setParentDir] = useState('')
  /** null = 未手动编辑，跟随地址派生 */
  const [nameEdited, setNameEdited] = useState<string | null>(null)
  const [recurseSubmodules, setRecurseSubmodules] = useState(false)
  /** 目标目录探测结果，连同它对应的路径——路径变了旧结果即作废，不会误判新路径 */
  const [probe, setProbe] = useState<{ path: string; state: GitCloneTargetState } | null>(null)
  const [progress, setProgress] = useState<GitCloneProgress | null>(null)
  const [cloning, setCloning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cloneUrl = normalizeRepoUrl(url)
  const name = nameEdited ?? repoDirNameFromUrl(url)
  const nameInvalid = isCloneDirNameInvalid(name)
  const path = parentDir === '' ? '' : resolveClonePath(parentDir, nameInvalid ? '…' : name)
  const target = probe?.path === path ? probe.state : null

  // 首帧预填：上次用的父目录 + 剪贴板里的仓库地址（不是地址就留空，不污染输入）
  useEffect(() => {
    void window.api.getAppPrefs().then((prefs) => {
      setParentDir((current) => current || (prefs.lastProjectParentDir ?? ''))
    })
    void window.api.readClipboardText().then((text) => {
      if (isLikelyRepoUrl(text)) setUrl((current) => current || text.trim())
    })
  }, [])

  // 目标目录探测：位置 / 目录名变化即重探（防抖；结果按路径认领，晚到的不盖新输入）
  useEffect(() => {
    if (parentDir === '' || nameInvalid) return
    const timer = setTimeout(() => {
      void window.api.checkCloneTarget(parentDir, name).then((state) => setProbe({ path, state }))
    }, 150)
    return () => clearTimeout(timer)
  }, [path, parentDir, name, nameInvalid])

  useEffect(() => window.api.onProjectCloneProgress(setProgress), [])

  const pickParent = (): void => {
    void window.api.pickDirectory(parentDir || undefined).then((picked) => {
      if (picked !== null) setParentDir(picked)
    })
  }

  let disabledReason: string | null = null
  if (url.trim() === '') disabledReason = '请输入仓库地址'
  else if (parentDir === '') disabledReason = '请选择存放位置'
  else if (nameInvalid) disabledReason = '请输入合法的目录名'
  else if (target === 'occupied') disabledReason = TARGET_OCCUPIED

  const start = (): void => {
    if (disabledReason !== null) return
    setError(null)
    setProgress(null)
    setCloning(true)
    void cloneProject({ url: cloneUrl, parentDir, name: name.trim(), recurseSubmodules }).then(
      (result) => {
        // 取消与成功都收口关窗；失败回到填写态，输入原样留着供改了重试
        if (result.status === 'error') {
          setCloning(false)
          setError(result.message)
          return
        }
        close(false)
      }
    )
  }

  if (cloning) {
    return (
      <FormDialogShell
        message={
          <div className="flex items-baseline gap-1.5">
            <span className="shrink-0">正在克隆</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={cloneUrl}>
              {cloneUrl}
            </span>
          </div>
        }
        buttons={[]}
        dismissible={false}
        cancelLabel="取消"
        onCancel={() => void window.api.cancelProjectClone()}
      >
        <CloneProgressBar progress={progress} />
      </FormDialogShell>
    )
  }

  return (
    <FormDialogShell
      message="从 Git 仓库克隆并添加为项目："
      buttons={[
        {
          label: '克隆',
          disabled: disabledReason !== null,
          title: disabledReason ?? undefined,
          onClick: start
        }
      ]}
      onCancel={() => close(false)}
    >
      <FieldRow label="仓库地址">
        <Input
          value={url}
          autoFocus
          placeholder="https://github.com/owner/repo.git"
          className="font-mono"
          onChange={(e) => setUrl(e.target.value)}
        />
      </FieldRow>
      <FieldRow label="位置">
        <div className="flex items-center gap-1.5">
          <Input
            value={parentDir}
            placeholder="选择存放位置"
            className="min-w-0 flex-1 font-mono"
            onChange={(e) => setParentDir(e.target.value)}
          />
          <button type="button" title="选择目录" className={INPUT_ICON_BTN} onClick={pickParent}>
            <FolderOpen className="size-4" />
          </button>
        </div>
      </FieldRow>
      <FieldRow label="目录名">
        <Input
          value={name}
          placeholder="目录名"
          className="font-mono"
          onChange={(e) => setNameEdited(e.target.value)}
        />
      </FieldRow>
      <FieldRow label="路径">
        <div className="select-text break-all font-mono text-[12px] text-muted-foreground">
          {path === '' ? '—' : path}
        </div>
        {target === 'occupied' && (
          <div className="mt-1 text-[12px] text-[color:var(--destructive)]">{TARGET_OCCUPIED}</div>
        )}
      </FieldRow>
      <label className="flex cursor-pointer select-none items-center gap-2 text-[13px] text-foreground">
        <Checkbox checked={recurseSubmodules} onCheckedChange={setRecurseSubmodules} />
        <span>包含子模块</span>
      </label>
      {error !== null && (
        <div className="select-text whitespace-pre-wrap break-all text-[12px] text-[color:var(--destructive)]">
          {error}
        </div>
      )}
    </FormDialogShell>
  )
}

/** 克隆进度：阶段名 + 百分比 + 进度条；阶段未报百分比时轨道空着，只显示阶段文字。 */
function CloneProgressBar({ progress }: { progress: GitCloneProgress | null }): React.JSX.Element {
  const percent = progress?.percent ?? null
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[12px] text-muted-foreground">
        <span>{progress?.phase ?? '准备中'}</span>
        {percent !== null && <span className="font-mono">{percent}%</span>}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-row-hover)]">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-150"
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
    </div>
  )
}
