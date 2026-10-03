// 压缩窗口（docs/prd/compress.md）：一次压缩一个独立的小窗口。顶栏只有标题（可拖拽）；正文是名称、位置、
// 按内容出现的勾选框与一行预览；底栏「取消」+「压缩」。点「压缩」后按钮本身显示进度，「取消」与 Esc 都是关窗
// （关窗即取消，主进程删掉写了一半的临时文件）；成功由主进程关窗，失败弹错误框、窗口回到可编辑状态。
// 窗口尺寸固定、建好即显示：标题、默认名称与位置由主进程经查询串带来，上次的勾选取启动快照里的偏好。
// 第一次统计回来之前窗口里只转圈；回来后名称、位置、勾选框、预览、按钮一起出现，不一部分先出、一部分后跳。
// 勾选框出现过就不再消失（各次统计的内容特征取并集），之后改勾选重新统计时只有预览行转圈。
import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, LoaderCircle } from 'lucide-react'
import { AppTitleBar } from '@renderer/components/AppTitleBar'
import { Button } from '@renderer/components/ui/button'
import { CHOICE_ROW, Checkbox } from '@renderer/components/ui/checkbox'
import {
  ErrorDialog,
  FieldRow,
  FormDialogShell,
  InfoIcon
} from '@renderer/components/ui/form-dialog'
import { INPUT_ICON_BTN, Input } from '@renderer/components/ui/input'
import {
  ARCHIVE_EXT,
  archiveNameError,
  visibleCompressOptions,
  type CompressLaunch,
  type CompressOptionKey,
  type CompressOptions,
  type CompressScanResult
} from '@shared/compress'
import { formatBytes } from '@shared/server-status'

const OPTION_LABELS: { key: CompressOptionKey; label: string; info?: string }[] = [
  { key: 'excludeIgnored', label: '排除被 Git 忽略的文件' },
  { key: 'excludeGit', label: '排除 .git' },
  {
    key: 'excludeMacJunk',
    label: '排除 Mac 专属文件',
    info: 'Mac 生成的 .DS_Store、._ 开头的附属文件、__MACOSX 文件夹'
  }
]

function optionsKey(options: CompressOptions): string {
  return `${options.excludeIgnored}|${options.excludeGit}|${options.excludeMacJunk}`
}

export function CompressWindow({ launch }: { launch: CompressLaunch }): React.JSX.Element {
  const platform = window.electron.process.platform
  const [name, setName] = useState(launch.name)
  const [dir, setDir] = useState(launch.dir)
  const [options, setOptions] = useState<CompressOptions>(
    () => window.api.getBootstrap().appPrefs.compressOptions
  )
  /** 预览结果连同它对应的勾选——勾选变了旧结果即作废，不会把旧数字当成新的 */
  const [scan, setScan] = useState<{ key: string; result: CompressScanResult } | null>(null)
  /** 各次统计的内容特征取并集：勾选框出现过就不再消失，改勾选重新统计时不忽隐忽现；null = 第一次统计还没回来 */
  const [flags, setFlags] = useState<CompressScanResult['flags'] | null>(null)
  /** 统计失败的那组勾选（预览行留空，原因在错误框里） */
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const [packing, setPacking] = useState(false)
  const [percent, setPercent] = useState<number | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  /** 错误框：读不了内容（预览时）与压缩失败分两种标题 */
  const [error, setError] = useState<{ title: string; message: string } | null>(null)
  const title = `压缩「${launch.subject}」`

  useEffect(() => {
    document.title = title
  }, [title])

  // 勾选变化即重新预览（主进程按「排除被 Git 忽略的文件」两种取法各缓存一份清单，其余只在内存里过滤）
  useEffect(() => {
    let stale = false
    const key = optionsKey(options)
    void window.api.compressScan(options).then((response) => {
      if (stale) return
      if (!response.ok) {
        setFailedKey(key)
        setError({ title: '无法读取', message: response.message })
        // 第一次就读不了也要让窗口内容出来（可以取消、换勾选重试）
        setFlags((prev) => prev ?? { hasRepo: false, hasDotGit: false, hasMacJunk: false })
        return
      }
      setScan({ key, result: response })
      setFlags((prev) =>
        prev === null
          ? response.flags
          : {
              hasRepo: prev.hasRepo || response.flags.hasRepo,
              hasDotGit: prev.hasDotGit || response.flags.hasDotGit,
              hasMacJunk: prev.hasMacJunk || response.flags.hasMacJunk
            }
      )
    })
    return () => {
      stale = true
    }
  }, [options])

  useEffect(() => window.api.onCompressProgress(setPercent), [])

  const ready = flags !== null
  const visible = flags === null ? null : visibleCompressOptions(flags, platform)
  const currentKey = optionsKey(options)
  const preview = scan !== null && scan.key === currentKey ? scan.result.preview : null

  // 改勾选重新统计时「压缩」不等统计完成，用的是当前的勾选
  const disabledReason = dir.trim() === '' ? '请选择位置' : archiveNameError(name, platform)

  const start = useCallback((): void => {
    setConfirmReplace(false)
    setPacking(true)
    setPercent(null)
    void window.api.setAppPrefs({ compressOptions: options })
    void window.api.compressStart({ dir, name, options }).then((result) => {
      // 成功由主进程关窗；取消只会发生在关窗时
      if (result.status === 'error') {
        setPacking(false)
        setError({ title: '压缩失败', message: result.message })
      }
    })
  }, [dir, name, options])

  const submit = useCallback((): void => {
    if (!ready || disabledReason !== null || packing) return
    void window.api.compressTargetExists(dir, name).then((exists) => {
      if (exists) setConfirmReplace(true)
      else start()
    })
  }, [ready, disabledReason, packing, dir, name, start])

  // Esc 关窗（错误框、替换确认开着时由它们自己收下）；回车压缩（排除输入法合成与按住不放的连续回车）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (error !== null || confirmReplace) return
      if (e.key === 'Escape') {
        window.close()
        return
      }
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || e.repeat) return
      if (e.target instanceof HTMLButtonElement) return
      e.preventDefault()
      submit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [error, confirmReplace, submit])

  const pickDir = (): void => {
    void window.api.compressPickDir(dir).then((picked) => {
      if (picked !== null) setDir(picked)
    })
  }

  const toggle = (key: CompressOptionKey, checked: boolean): void => {
    setOptions((prev) => ({ ...prev, [key]: checked }))
  }

  const shownOptions = visible === null ? [] : OPTION_LABELS.filter((o) => visible[o.key])

  if (!ready) {
    return (
      <div className="flex h-full flex-col bg-elevated">
        <AppTitleBar title={title} />
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-elevated">
      <AppTitleBar title={title} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4">
        <FieldRow label="名称">
          <div className="flex items-center gap-1.5">
            <Input
              value={name}
              autoFocus
              disabled={packing}
              className="min-w-0 flex-1"
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.target.select()}
            />
            <span className="shrink-0 text-[13px] text-muted-foreground">{ARCHIVE_EXT}</span>
          </div>
        </FieldRow>
        <FieldRow label="位置">
          <div className="flex items-center gap-1.5">
            <Input
              value={dir}
              disabled={packing}
              className="min-w-0 flex-1 font-mono"
              onChange={(e) => setDir(e.target.value)}
            />
            <button
              type="button"
              title="选择文件夹"
              disabled={packing}
              className={INPUT_ICON_BTN}
              onClick={pickDir}
            >
              <FolderOpen className="size-4" />
            </button>
          </div>
        </FieldRow>
        {/* 勾选框按内容出现：这块占住余下的高度（窗口尺寸按三个都出现时定好），出现几个都不改变窗口尺寸 */}
        <div className="min-h-0 flex-1 space-y-2">
          {shownOptions.map((o) => (
            <label key={o.key} className={CHOICE_ROW}>
              <Checkbox
                checked={options[o.key]}
                disabled={packing}
                onCheckedChange={(checked) => toggle(o.key, checked)}
              />
              <span>{o.label}</span>
              {o.info !== undefined && <InfoIcon text={o.info} />}
            </label>
          ))}
        </div>
        <div className="flex h-[18px] items-center gap-1.5 text-[12px] text-muted-foreground">
          {preview !== null ? (
            `将装入 ${preview.files.toLocaleString()} 个文件，共 ${formatBytes(preview.bytes)}`
          ) : failedKey === currentKey ? null : (
            <>
              <LoaderCircle className="size-3 animate-spin" />
              正在统计…
            </>
          )}
        </div>
      </div>
      <div className="flex justify-end gap-2 px-4 pb-4">
        <Button variant="ghost" onClick={() => window.close()}>
          取消
        </Button>
        <Button
          className="relative"
          disabled={disabledReason !== null || packing}
          title={disabledReason ?? undefined}
          onClick={submit}
        >
          {packing ? (
            <>
              <LoaderCircle className="size-3.5 animate-spin" />
              {percent === null ? '压缩中' : `${percent}%`}
            </>
          ) : (
            '压缩'
          )}
        </Button>
      </div>

      {confirmReplace && (
        <FormDialogShell
          message={
            <>
              <b className="break-all font-semibold text-foreground">
                {name.trim()}
                {ARCHIVE_EXT}
              </b>{' '}
              已存在，要替换它吗？
            </>
          }
          buttons={[{ label: '替换', destructive: true, autoFocus: true, onClick: start }]}
          onCancel={() => setConfirmReplace(false)}
        />
      )}
      {error !== null && (
        <ErrorDialog title={error.title} message={error.message} onClose={() => setError(null)} />
      )}
    </div>
  )
}
