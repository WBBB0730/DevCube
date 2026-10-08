// 选择服务器上的目录（服务器上的配置的工作目录，docs/prd/ssh-server.md）：叠在配置对话框上的小对话框。沿用这台服务器的
// 文件连接（同 Files Tab，docs/prd/server-files.md）：还没连上就开始连接，要回答的提问照常弹出；关掉对话框不断开。
// 树同 Files 的文件树（根为 `/`，只列目录），顶上是「前往路径」；打开时定位到工作目录里填的目录（没填为家目录）。
// 点目录即选中并开合，点根行即选中根；「选择」交回选中的目录（写法见 remoteCwdFromPicked）。Esc 即取消，只关它自己；
// 有「前往路径」输入，点遮罩不关。
// 加载态同数据源的目录树：根还没读到时树区居中「正在读取…」，展开的目录还没读到时在子级位置出一行「正在读取…」。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Folder, FolderOpen } from 'lucide-react'
import { BarInput } from '@renderer/components/ui/bar-input'
import { Button } from '@renderer/components/ui/button'
import { ConnectPlaceholder } from '@renderer/components/ui/connect-placeholder'
import { Dialog } from '@renderer/components/ui/dialog'
import { DialogFooter } from '@renderer/components/ui/form-dialog'
import {
  TREE_ICON,
  TREE_ROW_H,
  TreeHint,
  TreeNoticeRow,
  TreeRow
} from '@renderer/components/ui/tree'
import { TREE_SCROLL, TreePanelBar, TreeRootRow } from '@renderer/components/ui/tree-panel'
import { ipcErrorMessage } from '@renderer/lib/ipc-error'
import { useServerFilesState } from '@renderer/lib/server-files-state'
import { typeToInput } from '@renderer/lib/type-to-input'
import { useTreeVirtualReveal } from '@renderer/lib/use-tree-virtual-reveal'
import { cn } from '@renderer/lib/utils'
import type { FilesDirEntry } from '@shared/files'
import { joinLogicalPath } from '@shared/files-path'
import { flattenFilesTree, type FilesTreeRow } from '@shared/files-tree-flatten'
import { remoteCwdFromPicked, resolveRemoteInput } from '@shared/server-files'

const ROOT = '/'

const rowKey = (row: FilesTreeRow): string | undefined => (row.notice ? undefined : row.path)

/** 从根到 dir 的每一级目录（含根与 dir 自身）。 */
function dirChain(dir: string): string[] {
  const chain = [ROOT]
  let current = ROOT
  for (const name of dir.split('/').filter(Boolean)) {
    current = joinLogicalPath(current, name)
    chain.push(current)
  }
  return chain
}

export function RemoteDirPickerDialog({
  serverId,
  serverName,
  value,
  onPick,
  onClose
}: {
  serverId: string
  serverName: string
  /** 工作目录里现在填的（打开时定位到它；没填或找不到时为家目录） */
  value: string
  /** 选中的目录，写法同工作目录（见 remoteCwdFromPicked） */
  onPick: (cwd: string) => void
  onClose: () => void
}): React.JSX.Element {
  const state = useServerFilesState(serverId)
  const home = state.phase === 'connected' ? state.home : null

  const [childrenByDir, setChildrenByDir] = useState<Record<string, FilesDirEntry[]>>({})
  const childrenRef = useRef(childrenByDir)
  const [notices, setNotices] = useState<Record<string, string>>({})
  const noticesRef = useRef(notices)
  /** 正在读的目录：树里在它的子级位置出「正在读取…」 */
  const [loadingDirs, setLoadingDirs] = useState<ReadonlySet<string>>(() => new Set())
  /** 进行中的读取：同一个目录同时只读一次 */
  const loadsRef = useRef(new Map<string, Promise<void>>())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([ROOT]))
  const expandedRef = useRef(expanded)
  const [selected, setSelected] = useState<string | null>(null)
  const [goQuery, setGoQuery] = useState('')
  const [goError, setGoError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const rows = useMemo(
    () => flattenFilesTree(ROOT, childrenByDir, expanded, notices, loadingDirs),
    [childrenByDir, expanded, notices, loadingDirs]
  )
  const { scrollRef, virtualizer, scrollToRow } = useTreeVirtualReveal({
    rows,
    rowHeight: TREE_ROW_H,
    rowKey,
    getItemKey: (i) => rows[i].path,
    follow: selected
  })

  const commitExpanded = useCallback((next: ReadonlySet<string>): void => {
    expandedRef.current = next
    setExpanded(next)
  }, [])

  /**
   * 读目录（只留子目录）并缓存；读不出来（没有权限等）时记下原因、按空目录缓存，树里在子级位置出提示行。
   * 读的过程中记在 loadingDirs 里；同一个目录正在读时，等那一次。
   */
  const ensureLoaded = useCallback(
    (dir: string): Promise<void> => {
      if (dir in childrenRef.current) return Promise.resolve()
      const pending = loadsRef.current.get(dir)
      if (pending !== undefined) return pending
      const load = (async () => {
        setLoadingDirs((prev) => new Set(prev).add(dir))
        let entries: FilesDirEntry[] = []
        let notice: string | null = null
        try {
          entries = (await window.api.serverFilesListDir(serverId, dir)).filter(
            (e) => e.isDirectory
          )
        } catch (e) {
          notice = ipcErrorMessage(e)
        }
        loadsRef.current.delete(dir)
        childrenRef.current = { ...childrenRef.current, [dir]: entries }
        setChildrenByDir(childrenRef.current)
        if (notice !== null) {
          noticesRef.current = { ...noticesRef.current, [dir]: notice }
          setNotices(noticesRef.current)
        }
        setLoadingDirs((prev) => {
          const next = new Set(prev)
          next.delete(dir)
          return next
        })
      })()
      loadsRef.current.set(dir, load)
      return load
    },
    [serverId]
  )

  /**
   * 开合目录：展开即开，还没读到时先出「正在读取…」；读不出来的收起时丢掉缓存与提示，再展开会重读（同 Files 的文件树）。
   */
  const toggle = useCallback(
    async (dir: string): Promise<void> => {
      const willOpen = !expandedRef.current.has(dir)
      if (!willOpen && dir in noticesRef.current) {
        const nextChildren = { ...childrenRef.current }
        delete nextChildren[dir]
        childrenRef.current = nextChildren
        setChildrenByDir(nextChildren)
        const nextNotices = { ...noticesRef.current }
        delete nextNotices[dir]
        noticesRef.current = nextNotices
        setNotices(nextNotices)
      }
      const next = new Set(expandedRef.current)
      if (willOpen) next.add(dir)
      else next.delete(dir)
      commitExpanded(next)
      if (willOpen) await ensureLoaded(dir)
    },
    [ensureLoaded, commitExpanded]
  )

  /** 展开到目录（连同它自己）、选中并滚到：先展开，各级逐个读，目标行出现即滚到（见 useTreeVirtualReveal）。 */
  const reveal = useCallback(
    async (dir: string): Promise<void> => {
      const chain = dirChain(dir)
      commitExpanded(new Set([...expandedRef.current, ...chain]))
      setSelected(dir)
      // 已是选中项时不会跟随定位，再滚一次
      scrollToRow(dir)
      for (const d of chain) await ensureLoaded(d)
    },
    [ensureLoaded, commitExpanded, scrollToRow]
  )

  // 打开即连接（已在连接或已连上时什么都不做）
  useEffect(() => {
    void window.api.connectServerFiles(serverId)
  }, [serverId])

  // 第一次连上：定位到工作目录里填的目录（没填、写法不对、不存在或不是目录时为家目录），焦点给树（打字转进「前往路径」）
  const startedRef = useRef(false)
  useEffect(() => {
    if (home === null || startedRef.current) return
    startedRef.current = true
    // 根先读起来，与查工作目录同时进行
    void ensureLoaded(ROOT)
    void (async () => {
      const wanted = resolveRemoteInput(value, home) ?? home
      const stat =
        wanted === home
          ? null
          : await window.api.serverFilesStat(serverId, wanted).catch(() => null)
      await reveal(stat?.isDirectory ? wanted : home)
      scrollRef.current?.focus({ preventScroll: true })
    })()
  }, [home, value, serverId, ensureLoaded, reveal, scrollRef])

  /** 改「前往路径」的输入：出错原因随之撤掉。 */
  const changeGoQuery = useCallback((query: string): void => {
    setGoQuery(query)
    setGoError(null)
  }, [])

  /** 「前往路径」：目录即展开、选中并定位，焦点交还树；输入不对、不存在或不是目录时就地提示（焦点留在输入框）。 */
  const goToPath = async (): Promise<void> => {
    if (home === null) return
    const target = resolveRemoteInput(goQuery, home)
    if (target === null) {
      setGoError('请输入以 / 或 ~ 开头的路径')
      return
    }
    try {
      const stat = await window.api.serverFilesStat(serverId, target)
      if (stat === null) {
        setGoError('路径不存在')
        return
      }
      if (!stat.isDirectory) {
        setGoError('不是目录')
        return
      }
      changeGoQuery('')
      scrollRef.current?.focus({ preventScroll: true })
      await reveal(target)
    } catch (e) {
      setGoError(ipcErrorMessage(e))
    }
  }

  const pick = (): void => {
    if (home === null || selected === null) return
    onPick(remoteCwdFromPicked(home, selected))
    onClose()
  }

  return (
    <Dialog onClose={onClose}>
      <div className="space-y-3 px-4 py-4">
        <div className="select-text text-[13px] leading-relaxed text-foreground">
          选择 “{serverName}” 上的目录：
        </div>
        <div className="flex h-80 flex-col overflow-hidden rounded border border-[color:var(--border-input)] bg-panel">
          {home === null ? (
            <ConnectPlaceholder
              phase={state.phase === 'disconnected' ? 'failed' : 'connecting'}
              message={state.phase === 'disconnected' ? state.message : undefined}
              actionLabel="重新连接"
              onAction={() => void window.api.connectServerFiles(serverId)}
            />
          ) : (
            <>
              <TreePanelBar>
                <BarInput
                  ref={inputRef}
                  value={goQuery}
                  onChange={changeGoQuery}
                  onSubmit={() => void goToPath()}
                  escapeFocusRef={scrollRef}
                  title="前往路径…"
                  placeholder="前往路径…"
                />
              </TreePanelBar>
              {goError !== null && (
                <div className="shrink-0 px-3 pt-1.5 text-xs text-[var(--status-failed)]">
                  {goError}
                </div>
              )}
              <TreeRootRow
                title={ROOT}
                icon={<FolderOpen className={TREE_ICON} />}
                name={
                  // 选中时名称转主色，同选中的树行
                  <span style={{ color: selected === ROOT ? 'var(--fg-primary)' : undefined }}>
                    {ROOT}
                  </span>
                }
                className={cn('cursor-pointer', selected === ROOT && 'bg-[var(--selection-row)]')}
                onClick={() => setSelected(ROOT)}
              />
              <div
                ref={scrollRef}
                tabIndex={0}
                className={TREE_SCROLL}
                onKeyDown={(e) =>
                  typeToInput(e, {
                    query: goQuery,
                    inputRef,
                    onChange: changeGoQuery,
                    onClear: () => changeGoQuery('')
                  })
                }
              >
                {!(ROOT in childrenByDir) ? (
                  <TreeHint loading>正在读取…</TreeHint>
                ) : (
                  <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                    {virtualizer.getVirtualItems().map((vi) => {
                      const row = rows[vi.index]
                      return (
                        <div
                          key={vi.key}
                          className="absolute left-0 top-0 w-full"
                          style={{ transform: `translateY(${vi.start}px)` }}
                        >
                          {row.notice ? (
                            <TreeNoticeRow
                              depth={row.depth}
                              message={row.name}
                              loading={row.loading}
                            />
                          ) : (
                            <TreeRow
                              depth={row.depth}
                              expanded={expanded.has(row.path)}
                              icon={<Folder className={TREE_ICON} />}
                              name={row.name}
                              selected={selected === row.path}
                              onClick={() => {
                                setSelected(row.path)
                                void toggle(row.path)
                              }}
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          取消
        </Button>
        <Button disabled={home === null || selected === null} onClick={pick}>
          选择
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
