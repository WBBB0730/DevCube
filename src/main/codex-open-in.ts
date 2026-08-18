import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse } from 'smol-toml'

/**
 * Codex 桌面端（ChatGPT）「Open in」注册：外科手术式增删 `~/.codex/config.toml` 里
 * `[desktop.custom_file_handlers.<id>]` 自己的块——其余字节原样保留（含注释与格式），
 * 写盘前整体解析校验，绝不重写整个文件。取舍见 ADR-0025。
 */

export type CodexHandlerSpec = {
  /** handler id（表头末段）：edition name，如 devcube / devcube-beta */
  id: string
  /** Open in 菜单显示名：edition productName */
  label: string
  /**
   * 菜单图标（绝对路径 / file: / data: URL）。当前桌面端 settings-store 的 schema 把
   * icon 定为必填（min 1）——缺失时整个 custom_file_handlers 键被丢弃
   * （日志 `Dropping invalid desktop setting key=custom_file_handlers`，本机实证）。
   */
  icon: string
  command: string
  args?: string[]
}

export type CodexConfigEdit =
  { ok: true; text: string; changed: boolean } | { ok: false; error: string }

const headerFor = (id: string): string => `[desktop.custom_file_handlers.${id}]`

/** TOML 基本字符串：JSON 的 `\"` `\\` `\uXXXX` 转义与 TOML 兼容（Windows 路径反斜杠安全）。 */
const tomlString = (value: string): string => JSON.stringify(value)

export function codexHandlerBlock(spec: CodexHandlerSpec): string {
  const lines = [
    headerFor(spec.id),
    `label = ${tomlString(spec.label)}`,
    `icon = ${tomlString(spec.icon)}`,
    `command = ${tomlString(spec.command)}`
  ]
  if (spec.args !== undefined && spec.args.length > 0) {
    lines.push(`args = [${spec.args.map(tomlString).join(', ')}]`)
  }
  return lines.join('\n') + '\n'
}

/** 按表头行定位并整块移除（含块前紧邻空行，避免反复增删累积空行）。 */
function removeBlock(source: string, id: string): { text: string; removed: boolean } {
  const lines = source.split('\n')
  const start = lines.findIndex((line) => line.trim() === headerFor(id))
  if (start < 0) return { text: source, removed: false }
  let end = start + 1
  while (end < lines.length && !lines[end].trim().startsWith('[')) end++
  let from = start
  while (from > 0 && lines[from - 1].trim() === '') from--
  return { text: [...lines.slice(0, from), ...lines.slice(end)].join('\n'), removed: true }
}

function parseable(text: string): boolean {
  try {
    parse(text)
    return true
  } catch {
    return false
  }
}

/** 解析成功且存在我们的 handler 表才算已注册（探测不落盘，状态永远来自文件本身）。 */
export function hasCodexHandler(source: string | null, id: string): boolean {
  if (source == null) return false
  try {
    const root = parse(source) as Record<string, unknown>
    const desktop = root['desktop'] as Record<string, unknown> | undefined
    const handlers = desktop?.['custom_file_handlers'] as Record<string, unknown> | undefined
    return handlers?.[id] !== undefined
  } catch {
    return false
  }
}

export function upsertCodexHandler(source: string | null, spec: CodexHandlerSpec): CodexConfigEdit {
  const base = source ?? ''
  if (base.trim() !== '' && !parseable(base)) {
    return { ok: false, error: '~/.codex/config.toml 存在语法错误，已拒绝修改；请先手动修复' }
  }
  const { text: without } = removeBlock(base, spec.id)
  const body = without.replace(/\n+$/, '')
  const next = (body === '' ? '' : body + '\n\n') + codexHandlerBlock(spec)
  if (!parseable(next)) {
    // 用户以其他写法（如 inline table）定义过同名结构，追加表头会构成重复定义
    return {
      ok: false,
      error: 'config.toml 已有冲突的 desktop.custom_file_handlers 定义，请手动合并'
    }
  }
  return { ok: true, text: next, changed: next !== base }
}

export function removeCodexHandler(source: string | null, id: string): CodexConfigEdit {
  const base = source ?? ''
  const { text, removed } = removeBlock(base, id)
  if (!removed) return { ok: true, text: base, changed: false }
  if (!parseable(base)) {
    return { ok: false, error: '~/.codex/config.toml 存在语法错误，已拒绝修改；请先手动修复' }
  }
  return { ok: true, text, changed: true }
}

// —— IO ——

export function codexConfigPath(home: string = homedir()): string {
  return join(home, '.codex', 'config.toml')
}

export async function readCodexConfig(path: string = codexConfigPath()): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

export async function writeCodexConfig(
  text: string,
  path: string = codexConfigPath()
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text, 'utf8')
}
