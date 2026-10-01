/**
 * 工作台 Tab 现场（每条目激活 Tab、终端组的 Tab 壳、当前条目与选中）。
 * 条目 = 左树的 Project、Server 或 Data Source（见 tree-entry.ts）。术语见 CONTEXT.md / ADR-0008。
 */

import { dataSourceEntryKey } from './tree-entry'

/**
 * 落盘的终端组 Tab 壳（无进程 / 无连接）：本地 Terminal、SSH Terminal 与另开的 Data Source Tab 同组、
 * 同样按条目持久化与拖拽排序。id 即 Tab 键（`terminal:<uuid>` / `ssh:<uuid>` / `db-tab:<uuid>`）。
 */
export interface TerminalShell {
  id: string
  name: string
  /** SSH Terminal 所连服务器 */
  serverId?: string
  /** Data Source Tab 所连数据源 */
  dataSourceId?: string
}

/** 跨重启的工作台 UI 快照。 */
export interface WorkspaceUiState {
  /** 当前条目键（Project 路径、`server:<id>` 或 `datasource:<id>`） */
  currentEntryKey: string | null
  selectedKey: string | null
  /** 每条目激活的 Tab 键；缺省条目走默认激活 */
  activeTabByEntry: Record<string, string | null>
  /** 每条目终端壳列表（数组序 = Tab 序） */
  terminalsByEntry: Record<string, TerminalShell[]>
}

export const DEFAULT_WORKSPACE_UI: WorkspaceUiState = {
  currentEntryKey: null,
  selectedKey: null,
  activeTabByEntry: {},
  terminalsByEntry: {}
}

/** 渲染端终端 Tab 形状（与 store 对齐，供合并纯函数使用）。 */
export interface TerminalTabLike {
  key: string
  ownerKey: string
  name: string
  serverId?: string
  dataSourceId?: string
}

/** 终端默认名的编号规则：第一个就叫 base，之后「base (2) / base (3) / …」。 */
export function numberedTerminalName(base: string, seq: number): string {
  return seq === 1 ? base : `${base} (${seq})`
}

/** 本地终端默认名的底：「终端 / 终端 (2) / …」。 */
export const LOCAL_TERMINAL_NAME = '终端'

/** 名字按 base 的编号规则算第几个（base 即 1）；不是这一系列的默认名返回 null。 */
function terminalNameSeq(name: string, base: string): number | null {
  if (name === base) return 1
  const prefix = `${base} (`
  if (!name.startsWith(prefix) || !name.endsWith(')')) return null
  const seq = Number(name.slice(prefix.length, -1))
  return Number.isInteger(seq) && seq > 1 ? seq : null
}

/** 下一个默认名：取已有同系列默认名的最大序号 +1（用户改过的名字不参与）。 */
export function nextNumberedTerminalName(existingNames: readonly string[], base: string): string {
  let max = 0
  for (const name of existingNames) max = Math.max(max, terminalNameSeq(name, base) ?? 0)
  return numberedTerminalName(base, max + 1)
}

/**
 * 某条目下终端组新 Tab 的默认名，按同一处（同条目、连同一个对象）的同系列编号：本地终端「终端 / 终端 (2) / …」；
 * SSH Terminal 以服务器名为底、Data Source Tab 以数据源名为底「prod / prod (2) / …」。
 * Data Source Tab 开在数据源条目自己下面时，常驻的那个算第 1 个（占着不带编号的名字），另开的从「prod (2)」起。
 */
export function nextTerminalName(
  terminals: readonly TerminalTabLike[],
  tab: Pick<TerminalTabLike, 'ownerKey' | 'serverId' | 'dataSourceId'>,
  base: string
): string {
  const names = terminals
    .filter(
      (t) =>
        t.ownerKey === tab.ownerKey &&
        t.serverId === tab.serverId &&
        t.dataSourceId === tab.dataSourceId
    )
    .map((t) => t.name)
  const underOwnEntry =
    tab.dataSourceId !== undefined && tab.ownerKey === dataSourceEntryKey(tab.dataSourceId)
  return nextNumberedTerminalName(underOwnEntry ? [base, ...names] : names, base)
}

/** 服务器改名时 SSH Terminal 的默认名跟着改（序号保留）；用户改过的名字不动，返回 null。 */
export function renamedTerminalName(name: string, oldBase: string, newBase: string): string | null {
  const seq = terminalNameSeq(name, oldBase)
  return seq === null ? null : numberedTerminalName(newBase, seq)
}

/**
 * 活会话优先合并终端 Tab：盘上的名字/顺序为骨架；主进程仍活着的 key 必须出现；
 * 仅盘上有的壳保留（待懒 spawn）；仅活着的（无盘记录）按活列表顺序追加并给回落名
 * （SSH Terminal 用服务器名，本地终端按序号）。
 */
export function mergeTerminalTabs(
  live: readonly { key: string; ownerKey: string; serverId?: string }[],
  shellsByEntry: Record<string, TerminalShell[]>,
  serverName: (serverId: string) => string | undefined = () => undefined
): TerminalTabLike[] {
  const liveByEntry = new Map<string, { key: string; ownerKey: string; serverId?: string }[]>()
  for (const t of live) {
    const list = liveByEntry.get(t.ownerKey) ?? []
    list.push(t)
    liveByEntry.set(t.ownerKey, list)
  }

  const ownerKeys = new Set<string>([...Object.keys(shellsByEntry), ...liveByEntry.keys()])

  const out: TerminalTabLike[] = []
  for (const ownerKey of ownerKeys) {
    const shells = shellsByEntry[ownerKey] ?? []
    const liveList = liveByEntry.get(ownerKey) ?? []
    const seen = new Set<string>()

    for (const s of shells) {
      seen.add(s.id)
      out.push(tabOf(s.id, ownerKey, s.name, s.serverId, s.dataSourceId))
    }
    let seq = shells.length
    for (const t of liveList) {
      if (seen.has(t.key)) continue
      seq += 1
      const name =
        t.serverId === undefined
          ? numberedTerminalName(LOCAL_TERMINAL_NAME, seq)
          : (serverName(t.serverId) ?? numberedTerminalName(LOCAL_TERMINAL_NAME, seq))
      out.push(tabOf(t.key, ownerKey, name, t.serverId))
      seen.add(t.key)
    }
  }
  return out
}

function tabOf(
  key: string,
  ownerKey: string,
  name: string,
  serverId?: string,
  dataSourceId?: string
): TerminalTabLike {
  return {
    key,
    ownerKey,
    name,
    ...(serverId === undefined ? {} : { serverId }),
    ...(dataSourceId === undefined ? {} : { dataSourceId })
  }
}

/** 从终端 Tab 列表导出落盘壳表（按条目分组、保留相对序）。 */
export function terminalsToShellsByEntry(
  terminals: readonly TerminalTabLike[]
): Record<string, TerminalShell[]> {
  const out: Record<string, TerminalShell[]> = {}
  for (const t of terminals) {
    const list = out[t.ownerKey] ?? (out[t.ownerKey] = [])
    const { key, name, serverId, dataSourceId } = t
    list.push({
      id: key,
      name,
      ...(serverId === undefined ? {} : { serverId }),
      ...(dataSourceId === undefined ? {} : { dataSourceId })
    })
  }
  return out
}

/**
 * 校验左树选中：配置键仍存在则保留，否则 null（条目行）。
 * selectedKey 为配置会话键（与 configKey 一致）。
 */
export function resolvePersistedSelectedKey(
  selectedKey: string | null | undefined,
  configKeys: ReadonlySet<string>
): string | null {
  if (selectedKey == null || selectedKey === '') return null
  return configKeys.has(selectedKey) ? selectedKey : null
}

/** 当前条目仍在左树中才保留。 */
export function resolvePersistedEntryKey(
  key: string | null | undefined,
  entryKeys: ReadonlySet<string>
): string | null {
  if (key == null || key === '') return null
  return entryKeys.has(key) ? key : null
}

/**
 * 读档迁移：条目化之前的档案用 currentProjectPath / activeTabByProject / terminalsByProject
 * 存同样的内容（那时条目只有 Project，键即路径），原样搬到新字段名下。
 */
export function migrateLegacyWorkspaceUi(
  raw: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined
  const out = { ...raw }
  const renames: ReadonlyArray<readonly [legacy: string, current: keyof WorkspaceUiState]> = [
    ['currentProjectPath', 'currentEntryKey'],
    ['activeTabByProject', 'activeTabByEntry'],
    ['terminalsByProject', 'terminalsByEntry']
  ]
  for (const [legacy, current] of renames) {
    if (!(current in out) && legacy in out) out[current] = out[legacy]
    delete out[legacy]
  }
  return out
}
