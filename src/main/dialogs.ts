import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron'

/** 系统打开面板；取消返回 null。 */
async function pickPath(
  properties: OpenDialogOptions['properties'],
  defaultPath: string | undefined,
  parent: BrowserWindow | null | undefined
): Promise<string | null> {
  const opts: OpenDialogOptions = { properties, ...(defaultPath ? { defaultPath } : {}) }
  const result =
    parent && !parent.isDestroyed()
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0] ?? null
}

/** 系统文件夹选择器；取消返回 null。 */
export function pickDirectory(
  defaultPath?: string,
  parent?: BrowserWindow | null
): Promise<string | null> {
  return pickPath(['openDirectory'], defaultPath, parent)
}

/** 系统文件选择器（显示隐藏文件：私钥常在 `~/.ssh` 这类隐藏目录里）；取消返回 null。 */
export function pickFile(
  defaultPath?: string,
  parent?: BrowserWindow | null
): Promise<string | null> {
  return pickPath(['openFile', 'showHiddenFiles'], defaultPath, parent)
}
