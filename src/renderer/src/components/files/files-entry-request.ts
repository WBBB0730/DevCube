// Files 树条目操作的请求（新建 / 重命名 / 删除）：树菜单与键盘发出，FilesEntryDialog 弹窗确认，FilesPane 执行。
import type { FilesEntryRef } from '@shared/files'
import { wslDistroOf } from '@shared/wsl-path'

export type FilesEntryDialogRequest =
  | { kind: 'create-file'; dir: string }
  | { kind: 'create-dir'; dir: string }
  | { kind: 'rename'; path: string; isDirectory: boolean }
  /** 本机：移到回收站（可恢复） */
  | { kind: 'trash'; entries: FilesEntryRef[] }
  /** 服务器上，或 WSL 发行版里（distro）：没有回收站，删了即不可恢复 */
  | { kind: 'delete'; entries: FilesEntryRef[]; distro?: string }

export type FilesRemovalRequest = Extract<FilesEntryDialogRequest, { kind: 'trash' | 'delete' }>

/** 删除请求：服务器上与 WSL 发行版里没有回收站，删了即不可恢复，其余移到回收站（树菜单与删除键共用） */
export function removalRequest(
  entries: FilesEntryRef[],
  where: { remote: boolean; root: string }
): FilesRemovalRequest {
  const distro = where.remote ? null : wslDistroOf(where.root)
  return where.remote || distro !== null
    ? { kind: 'delete', entries, distro: distro ?? undefined }
    : { kind: 'trash', entries }
}
