/**
 * Files 文件树的移动 / 复制（docs/prd/files-tree-move-copy.md）：主进程与渲染层共用的纯逻辑。
 * 路径一律是规范化的逻辑路径（`/` 分隔）。
 */
import { childPathPrefix, logicalParentPath, normalizePath } from './files-path'
import { numberedName } from './numbered-name'

/**
 * 去掉被包含的条目（同时选中了文件夹和它里面的条目时，选了文件夹就已包含里面的），并去重；保持原顺序。
 * 逐个往上查祖先，不两两比对：全选一棵大树时也不慢。
 */
export function topLevelPaths(paths: readonly string[]): string[] {
  const set = new Set(paths)
  const seen = new Set<string>()
  return paths.filter((p) => {
    if (seen.has(p)) return false
    seen.add(p)
    for (let up = logicalParentPath(p); ; up = logicalParentPath(up)) {
      if (set.has(up)) return false
      if (logicalParentPath(up) === up) return true
    }
  })
}

/** 落点是被拖条目自身或它里面：移动与复制都不行 */
export function isSelfOrInside(source: string, destDir: string): boolean {
  return destDir === source || destDir.startsWith(childPathPrefix(source))
}

/** 移动的落点成立：不能落到自身或它里面，落回原本所在的文件夹等于没动 */
export function moveDropAllowed(source: string, destDir: string): boolean {
  return !isSelfOrInside(source, destDir) && logicalParentPath(source) !== destDir
}

/** 复制的落点成立：不能复制进自身或它里面；复制回原处可以（自动编号避开） */
export function copyDropAllowed(source: string, destDir: string): boolean {
  return !isSelfOrInside(source, destDir)
}

/**
 * 原处复制的避让名（seq 从 2 起）：文件编号加在扩展名之前（`a (2).txt`），文件夹与没有扩展名的
 * （含 `.env` 这类点开头的名字）编在整个名字之后。编号格式全应用统一，见 numberedName。
 */
export function copyNameCandidate(name: string, isDirectory: boolean, seq: number): string {
  const dot = isDirectory ? -1 : name.lastIndexOf('.')
  if (dot <= 0) return numberedName(name, seq)
  return numberedName(name.slice(0, dot), seq) + name.slice(dot)
}

/** 两组路径是否为同一批条目（不计顺序与重复）：判断剪贴板里是否仍是刚剪切的那一批 */
export function samePathSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a.map(normalizePath))
  const right = new Set(b.map(normalizePath))
  return left.size === right.size && [...left].every((p) => right.has(p))
}

/** 拖进来的条目是否都在这棵树的根内：是即移动（按住复制键为复制），否则复制进来 */
export function allUnderRoot(paths: readonly string[], root: string): boolean {
  const prefix = childPathPrefix(normalizePath(root))
  return paths.length > 0 && paths.every((p) => normalizePath(p).startsWith(prefix))
}
