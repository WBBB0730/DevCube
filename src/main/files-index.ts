// 每项目文件名索引（ADR-0027）：rg --files 一次枚举全项目文件（尊重 gitignore，
// 非仓库不启用，与旧 check-ignore 语义一致），主进程按项目缓存扁平名单；
// 树顶过滤按键只做内存匹配，名单随文件监听的 files:changed 作废。

import { spawn } from 'node:child_process'
import path from 'node:path'
import { rgPath } from '@vscode/ripgrep'
import { normalizePath } from '../shared/files-path'
import { isIdeIgnoredEntryName } from '../shared/files-tree-filter'

// 打包后 rg 二进制在 asar 外（electron-builder asarUnpack），require.resolve
// 仍给出 asar 内虚拟路径，spawn 需要真实文件路径；开发环境无此段则原样。
// 文件名索引与内容搜索（content-search.ts）共用。
export const rgBin = rgPath.replace('app.asar', 'app.asar.unpacked')

/** 逻辑路径（/）→ 系统路径。 */
function toSys(logical: string): string {
  return path.normalize(logical.split('/').join(path.sep))
}

/** 项目根（规范化逻辑路径）→ 构建中 / 已完成的名单。失败不缓存，下次重建。 */
const indexByRoot = new Map<string, Promise<string[]>>()

export function invalidateFilesIndex(projectPath: string): void {
  indexByRoot.delete(normalizePath(projectPath))
}

/** 取（或构建）项目的文件名单：相对项目根、`/` 分隔、已滤 IDE 忽略名。 */
export function getFilesIndex(projectPath: string): Promise<string[]> {
  const root = normalizePath(projectPath)
  let pending = indexByRoot.get(root)
  if (!pending) {
    pending = buildFilesIndex(root)
    pending.catch(() => indexByRoot.delete(root))
    indexByRoot.set(root, pending)
  }
  return pending
}

function buildFilesIndex(rootLogical: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    // --hidden：树展示本就包含隐藏条目；.git 用 glob 提前剪枝（不然 --hidden 会扫进去），
    // 其余 IDE 忽略名条目量小，事后按路径段过滤即可。
    const child = spawn(rgBin, ['--files', '--hidden', '--no-messages', '-g', '!**/.git'], {
      cwd: toSys(rootLogical),
      windowsHide: true
    })
    const chunks: Buffer[] = []
    child.stdout.on('data', (c: Buffer) => chunks.push(c))
    child.on('error', reject)
    child.on('close', (code) => {
      // 0 = 有文件；1 = 空项目；其它 = 失败
      if (code !== 0 && code !== 1) {
        reject(new Error(`rg --files 退出码 ${code}`))
        return
      }
      const files: string[] = []
      // 先 concat 再 toString，避免多字节字符被 chunk 边界拆断
      for (const line of Buffer.concat(chunks).toString('utf8').split(/\r?\n/)) {
        if (!line) continue
        const rel = line.split('\\').join('/')
        if (rel.split('/').some(isIdeIgnoredEntryName)) continue
        files.push(rel)
      }
      resolve(files)
    })
  })
}
