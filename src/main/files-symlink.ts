// 本机 Files 的符号链接处理（docs/prd/symlinks.md，ADR-0059）：列目录时按目标的类型显示并给出指向，
// 打开断链时报「链接目标不存在」，移动 / 复制按真实路径判断是否落进自己里面。用户的文件，用 original-fs（ADR-0051）。
import type { Stats } from 'node:fs'
import { promises as fs } from 'original-fs'
import { normalizePath, remapPathPrefix } from '../shared/files-path'
import type { FilesDirEntry } from '../shared/files'
import { isSelfOrInside } from '../shared/files-tree-ops'
import { toSysPath } from './sys-path'

/** 目标不存在、沿途有一段不是文件夹、链接绕成了圈：都算断链 */
const BROKEN_LINK_CODES = new Set(['ENOENT', 'ENOTDIR', 'ELOOP'])

function isBrokenLinkError(e: unknown): boolean {
  return BROKEN_LINK_CODES.has((e as NodeJS.ErrnoException).code ?? '')
}

/** 条目本身是不是符号链接（不跟随）；不存在时为否。 */
export function isSymlinkPath(sys: string): Promise<boolean> {
  return fs.lstat(sys).then(
    (st) => st.isSymbolicLink(),
    () => false
  )
}

/** Files 根的两种写法：登记的路径与真实路径（根经过符号链接时不同，如 /tmp → /private/tmp） */
export interface FilesRootAlias {
  logical: string
  real: string
}

/** 根的真实路径与登记的路径不同时给出两者，相同或取不到为 null（规范化逻辑路径）。 */
export async function filesRootAlias(rootLogical: string): Promise<FilesRootAlias | null> {
  const real = await fs.realpath(toSysPath(rootLogical)).then(normalizePath, () => null)
  return real === null || real === rootLogical ? null : { logical: rootLogical, real }
}

/**
 * 符号链接条目：按目标的类型显示，指向取目标的真实路径（在根下时换回根的写法）；断链取链接里写的原文。
 */
export async function symlinkEntry(
  name: string,
  logical: string,
  alias: FilesRootAlias | null
): Promise<FilesDirEntry> {
  const sys = toSysPath(logical)
  try {
    const [st, real] = await Promise.all([fs.stat(sys), fs.realpath(sys)])
    return {
      name,
      path: logical,
      isDirectory: st.isDirectory(),
      // 落在根的真实路径下的换回根的写法：指向与树上的路径一致，才能转到它
      symlink: {
        target:
          alias === null
            ? normalizePath(real)
            : remapPathPrefix(normalizePath(real), alias.real, alias.logical),
        broken: false
      }
    }
  } catch (e) {
    const target = await fs.readlink(sys).catch(() => null)
    // 读不出原文：链接刚被删掉等，按普通文件交给下一次列目录
    if (target === null) return { name, path: logical, isDirectory: false }
    return {
      name,
      path: logical,
      isDirectory: false,
      symlink: { target, broken: isBrokenLinkError(e) }
    }
  }
}

/** 跟随符号链接取文件信息；断链报「链接目标不存在」，其余错误原样抛出。 */
export async function statTarget(sys: string): Promise<Stats> {
  try {
    return await fs.stat(sys)
  } catch (e) {
    if (isBrokenLinkError(e) && (await isSymlinkPath(sys))) throw new Error('链接目标不存在')
    throw e
  }
}

/**
 * 按真实路径看，destSys 是不是 sourceSys 自身或在它里面（sourceSys 是文件夹、不是链接时）：经符号链接把文件夹
 * 移动 / 复制进它自己里面，路径上看不出来（ADR-0059）。链接本身移动 / 复制的是链接，不算；取不到真实路径时不算。
 */
export async function realSelfOrInside(sourceSys: string, destSys: string): Promise<boolean> {
  const st = await fs.lstat(sourceSys).catch(() => null)
  if (st === null || !st.isDirectory()) return false
  try {
    const [source, dest] = await Promise.all([fs.realpath(sourceSys), fs.realpath(destSys)])
    return isSelfOrInside(normalizePath(source), normalizePath(dest))
  } catch {
    return false
  }
}
