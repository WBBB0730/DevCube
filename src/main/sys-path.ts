import path from 'node:path'

/**
 * 规范化逻辑路径（`/` 分隔，见 shared/files-path）→ 本机系统路径：
 * Windows 上还原反斜杠（盘符路径与 UNC 的 `\\主机\共享\…` 都是），macOS / Linux 上不变。
 */
export function toSysPath(logical: string): string {
  return path.normalize(logical.split('/').join(path.sep))
}

/**
 * 本机系统路径 → `/` 分隔（toSysPath 的反向，只换分隔符、不规范化）：交给 git 的路径（WSL 发行版里的 git 只认 `/`）、
 * 下拉里显示的相对路径、与 git 给出的路径比较。
 */
export function toSlashPath(sys: string): string {
  return sys.split(path.sep).join('/')
}
