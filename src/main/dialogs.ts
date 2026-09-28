import { BrowserWindow, dialog, type OpenDialogOptions, type SaveDialogOptions } from 'electron'

/** 系统打开面板（单选）；取消返回 null。 */
async function pickPath(
  properties: OpenDialogOptions['properties'],
  defaultPath: string | undefined,
  parent: BrowserWindow | null | undefined
): Promise<string | null> {
  return (await pickPaths(properties, defaultPath, parent))[0] ?? null
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

/** 系统打开面板（可多选）；取消返回空数组。 */
export async function pickPaths(
  properties: OpenDialogOptions['properties'],
  defaultPath: string | undefined,
  parent: BrowserWindow | null | undefined
): Promise<string[]> {
  const opts: OpenDialogOptions = { properties, ...(defaultPath ? { defaultPath } : {}) }
  const result =
    parent && !parent.isDestroyed()
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts)
  return result.canceled ? [] : result.filePaths
}

/** 系统保存面板（同名时由系统询问是否替换）；取消返回 null。 */
export async function pickSavePath(
  defaultPath: string,
  parent: BrowserWindow | null | undefined
): Promise<string | null> {
  const opts: SaveDialogOptions = { defaultPath }
  const result =
    parent && !parent.isDestroyed()
      ? await dialog.showSaveDialog(parent, opts)
      : await dialog.showSaveDialog(opts)
  return result.canceled || !result.filePath ? null : result.filePath
}
