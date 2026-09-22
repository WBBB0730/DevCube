import { useEffect, useMemo, useState } from 'react'
import { FolderPlus, FolderSymlink } from 'lucide-react'
import { AppTitleBar } from '@renderer/components/AppTitleBar'
import { SettingsDialog } from '@renderer/components/SettingsDialog'
import { FilesPane, type FilesPaneHost } from '@renderer/components/files/FilesPane'
import { FILES_ALL_TYPES } from '@renderer/components/files/PreviewTreeControls'
import { useFiles } from '@renderer/files-store'
import { useApp } from '@renderer/store'
import type { AppUpdateState } from '@shared/app-update-state'
import { normalizePath } from '@shared/files-path'
import type { FilesTypeCategory } from '@shared/files-type-filter'
import { parentLogicalPath, type PreviewLaunch } from '@shared/preview-window'

/**
 * Preview Window（预览窗口）的渲染层壳（docs/prd/file-preview-window.md）：
 * 顶栏 = 标题 + 「添加为项目 / 转到项目」+ 与主窗口完全一致的更新 / 设置钮与设置弹窗；正文就是 Files 面板本身（preview 宿主）。
 * 根由这里持有——「上一级」/「作为根目录」换根时面板按根重挂（key），初始文件沿用当前打开的文件
 * （主窗口「在新窗口中打开」项目时没有初始文件，正文空态）；
 * 类型筛选集合也在这里，跨换根保留。工作台 store 只读 bootstrap 树，不写回。
 */
export function PreviewWindow({ launch }: { launch: PreviewLaunch }): React.JSX.Element {
  const [root, setRoot] = useState(launch.root)
  const [openPath, setOpenPath] = useState<string | null>(launch.file)
  const [typeFilter, setTypeFilter] = useState<ReadonlySet<FilesTypeCategory>>(FILES_ALL_TYPES)
  // 当前根是否已是登记项目：首屏取 bootstrap 树；「添加为项目」成功后本地记下
  const [registeredRoots, setRegisteredRoots] = useState<ReadonlySet<string>>(
    () => new Set(useApp.getState().tree.map((n) => normalizePath(n.project.path)))
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [update, setUpdate] = useState<AppUpdateState | null>(null)

  const name = (openPath ?? root).slice((openPath ?? root).lastIndexOf('/') + 1)
  useEffect(() => {
    document.title = name
  }, [name])

  // 更新状态：主进程广播到全部窗口；首屏主动拉一次
  useEffect(() => {
    const off = window.api.onAppUpdateState(setUpdate)
    void window.api.getAppUpdateState().then(setUpdate)
    return off
  }, [])

  // 主进程只转发 ⌥⌘F（筛选框聚焦）；Cmd/Ctrl+W 在主进程直接关窗
  useEffect(
    () =>
      window.api.onAppShortcut((s) => {
        if (s.id === 'focusFilesFilter') useFiles.getState().bumpFilesFilterFocus(root)
      }),
    [root]
  )

  // 「添加为项目 / 转到项目」（顶栏与树空白区菜单各一份）：对当前根走 External Open 的目录语义
  const projectRegistered = registeredRoots.has(root)
  const addProject = (): void => {
    void window.api.previewAddProject(root).then(() => {
      setRegisteredRoots((prev) => new Set(prev).add(root))
    })
  }

  const parent = parentLogicalPath(root)
  // 换根（上一级 / 作为根目录）：主进程换授权与监听成功后再切；当前文件不在新根内则新面板不带文件
  const changeRoot = (next: string): void => {
    void window.api.previewSetRoot(next).then((ok) => {
      if (ok) setRoot(next)
    })
  }
  const host = useMemo<FilesPaneHost>(
    () => ({
      kind: 'preview',
      initialFile: openPath !== null && openPath.startsWith(root + '/') ? openPath : null,
      onAscend: parent === null ? null : () => changeRoot(parent),
      onSetRoot: changeRoot,
      onOpenPathChange: setOpenPath,
      onAddProject: addProject,
      projectRegistered,
      typeFilter,
      onTypeFilterChange: setTypeFilter
    }),
    // initialFile 只在换根重挂时读取；打开文件变化不应触发面板重建
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
    [root, parent, typeFilter, projectRegistered]
  )

  return (
    <div className="flex h-full flex-col">
      <AppTitleBar
        title={name}
        actions={[
          {
            key: 'add-project',
            title: projectRegistered ? '转到项目' : '添加为项目',
            icon: projectRegistered ? (
              <FolderSymlink className="size-4" />
            ) : (
              <FolderPlus className="size-4" />
            ),
            onClick: addProject
          }
        ]}
        update={update}
        onOpenSettings={() => setSettingsOpen(true)}
        onUpdateClick={() => void window.api.performAppUpdateAction()}
      />
      <div className="min-h-0 flex-1">
        <FilesPane key={root} rootPath={root} visible host={host} />
      </div>
      {settingsOpen && (
        <SettingsDialog
          update={update}
          onClose={() => setSettingsOpen(false)}
          onCheckUpdate={async (force) => {
            // 状态只经 IPC 推送，避免 invoke 返回值与 push 竞态盖掉更新结果。
            await window.api.checkAppUpdates(force)
          }}
          onInstallUpdate={() => void window.api.performAppUpdateAction()}
          onOpenRepo={() => {
            if (update) void window.api.openExternal(update.repoUrl)
          }}
        />
      )}
    </div>
  )
}
