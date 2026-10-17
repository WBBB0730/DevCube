// 「从 Git 仓库克隆」对话框（左树「+」菜单第三项）：项目无关，故挂在 App 根上而非 Git Tab 内。
// 两态原地切换——填写态（地址 / 位置 / 目录名 / 子模块）与克隆态（即克隆这个 Task 的进度弹窗，可隐藏、取消；
// docs/prd/task-progress.md）。两态都按任务登记处里的克隆 Task 呈现：失败回到填写态、报错就地显示，
// 输入原样保留（找回一个隐藏后失败的克隆时按它带着的原输入填回）；成功后由 store 走与其余三条登记路径同一套收尾。
import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { CHOICE_ROW, Checkbox } from '@renderer/components/ui/checkbox'
import { FieldRow, FormDialogShell } from '@renderer/components/ui/form-dialog'
import { INPUT_ICON_BTN, Input } from '@renderer/components/ui/input'
import { TaskProgressDialog } from '@renderer/components/tasks/TaskProgressDialog'
import { useApp } from '@renderer/store'
import { cloneTaskOf, useTasks } from '@renderer/task-store'
import {
  isCloneDirNameInvalid,
  isLikelyRepoUrl,
  normalizeRepoUrl,
  repoDirNameFromUrl,
  resolveClonePath,
  type GitCloneTargetState
} from '@shared/git-clone'

const TARGET_OCCUPIED = '目标目录已存在且非空'

export function CloneProjectDialog(): React.JSX.Element | null {
  const close = useApp((s) => s.setCloneDialogOpen)
  const cloneProject = useApp((s) => s.cloneProject)
  /** 克隆这个 Task（同一时刻至多一个）：进行中即克隆态，失败即带着报错的填写态 */
  const task = useTasks((s) => cloneTaskOf(s.tasks))
  /** 打开时已有的克隆：找回的就按它带着的原输入填，不再预填剪贴板与上次的位置 */
  const [initialTask] = useState(task)

  const [url, setUrl] = useState(initialTask?.input.url ?? '')
  const [parentDir, setParentDir] = useState(initialTask?.input.parentDir ?? '')
  /** null = 未手动编辑，跟随地址派生 */
  const [nameEdited, setNameEdited] = useState<string | null>(() =>
    initialTask === undefined ||
    initialTask.input.name === repoDirNameFromUrl(initialTask.input.url)
      ? null
      : initialTask.input.name
  )
  const [recurseSubmodules, setRecurseSubmodules] = useState(
    initialTask?.input.recurseSubmodules ?? false
  )
  /** 目标目录探测结果，连同它对应的路径——路径变了旧结果即作废，不会误判新路径 */
  const [probe, setProbe] = useState<{ path: string; state: GitCloneTargetState } | null>(null)
  /** 点了「克隆」、克隆的 Task 还没出现：防连点 */
  const [starting, setStarting] = useState(false)
  /** 正在显示进度的那个 Task：它成功或取消后从登记处消失、对话框随即关掉，这之间不画，免得闪出填写态 */
  const [shownId, setShownId] = useState<string | null>(null)

  const cloneUrl = normalizeRepoUrl(url)
  const name = nameEdited ?? repoDirNameFromUrl(url)
  const nameInvalid = isCloneDirNameInvalid(name)
  const path = parentDir === '' ? '' : resolveClonePath(parentDir, nameInvalid ? '…' : name)
  const target = probe?.path === path ? probe.state : null

  // 首帧预填：上次用的父目录 + 剪贴板里的仓库地址（不是地址就留空，不污染输入）
  useEffect(() => {
    if (initialTask !== undefined) return
    void window.api.getAppPrefs().then((prefs) => {
      setParentDir((current) => current || (prefs.lastProjectParentDir ?? ''))
    })
    void window.api.readClipboardText().then((text) => {
      if (isLikelyRepoUrl(text)) setUrl((current) => current || text.trim())
    })
  }, [initialTask])

  // 目标目录探测：位置 / 目录名变化即重探（防抖；结果按路径认领，晚到的不盖新输入）
  useEffect(() => {
    if (parentDir === '' || nameInvalid) return
    const timer = setTimeout(() => {
      void window.api.checkCloneTarget(parentDir, name).then((state) => setProbe({ path, state }))
    }, 150)
    return () => clearTimeout(timer)
  }, [path, parentDir, name, nameInvalid])

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

  const busy = starting && task === undefined
  // 克隆态：取消与成功都由 store 收口关窗；失败回到填写态，输入原样留着供改了重试
  const running = task !== undefined && task.status !== 'failed' ? task : null
  if (running !== null && shownId !== running.id) setShownId(running.id)
  if (task?.status === 'failed' && shownId !== null) setShownId(null)
  if (task === undefined && shownId !== null) return null
  const error = task?.status === 'failed' ? task.errors.filter((e) => e !== '').join('\n') : null

  const start = (): void => {
    if (disabledReason !== null || busy) return
    setStarting(true)
    // 上一个失败的克隆由主进程在开始新的时一并关掉
    void cloneProject({ url: cloneUrl, parentDir, name: name.trim(), recurseSubmodules }).then(
      (result) => {
        if (result.status === 'error') setStarting(false)
      }
    )
  }

  if (running !== null) {
    return (
      <TaskProgressDialog
        task={running}
        appearDelay={0}
        onHide={() => {
          void window.api.hideTask(running.id)
          close(false)
        }}
      />
    )
  }

  return (
    <FormDialogShell
      message="从 Git 仓库克隆并添加为项目："
      buttons={[
        {
          label: '克隆',
          disabled: disabledReason !== null || busy,
          title: disabledReason ?? undefined,
          onClick: start
        }
      ]}
      onCancel={() => {
        if (task?.status === 'failed') void window.api.dismissTask(task.id)
        close(false)
      }}
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
      <label className={CHOICE_ROW}>
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
