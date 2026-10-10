import path from 'node:path'

/**
 * 规范化逻辑路径（`/` 分隔，见 shared/files-path）→ 本机系统路径：
 * Windows 上还原反斜杠（盘符路径与 UNC 的 `\\主机\共享\…` 都是），macOS / Linux 上不变。
 */
export function toSysPath(logical: string): string {
  return path.normalize(logical.split('/').join(path.sep))
}
