/**
 * WebStorm / IntelliJ「Editor → File Types → Ignored Files and Folders」默认掩码。
 * 与 `.gitignore` 无关：Project 树默认不展示这些名字，但仍可看到 node_modules 等。
 *
 * 默认串：
 * `*.hprof;*.pyc;*.pyo;*.rbc;*.yarb;*~;.DS_Store;.git;.hg;.svn;CVS;__pycache__;_svn;vssver.scc;vssver2.scc`
 */
const EXACT_NAMES = new Set([
  '.DS_Store',
  '.git',
  '.hg',
  '.svn',
  'CVS',
  '__pycache__',
  '_svn',
  'vssver.scc',
  'vssver2.scc'
])

const EXTENSIONS = ['.hprof', '.pyc', '.pyo', '.rbc', '.yarb'] as const

/** 条目名（非路径）是否应按 IDE 默认忽略规则从 Files 树隐藏。 */
export function isIdeIgnoredEntryName(name: string): boolean {
  if (!name || name === '.' || name === '..') return true
  if (EXACT_NAMES.has(name)) return true
  // macOS 偶发大小写变体
  if (name.toLowerCase() === '.ds_store') return true
  if (name.endsWith('~')) return true
  const lower = name.toLowerCase()
  return EXTENSIONS.some((ext) => lower.endsWith(ext))
}
