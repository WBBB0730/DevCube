import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron'

/** 系统文件夹选择器；取消返回 null。 */
export async function pickDirectory(
  defaultPath?: string,
  parent?: BrowserWindow | null
): Promise<string | null> {
  const opts: OpenDialogOptions = {
    properties: ['openDirectory'],
    ...(defaultPath ? { defaultPath } : {})
  }
  const result =
    parent && !parent.isDestroyed()
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0] ?? null
}
