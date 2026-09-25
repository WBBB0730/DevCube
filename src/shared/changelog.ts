/**
 * 更新日志（仓库根 CHANGELOG.md，手写）：一个正式版本一段，Beta 共用同号正式版那段。
 * 应用内更新弹窗、开发版本地预览与发版脚本共用这里的解析与挑段落；见 docs/prd/changelog.md、ADR-0035。
 */

import { fromMarkdown } from 'mdast-util-from-markdown'
import { toString } from 'mdast-util-to-string'
import { gt, inc, lte, parse, rcompare, valid } from 'semver'

export type ChangelogEntry = {
  /** 正式版号（X.Y.Z） */
  version: string
  /** 标题里的发布日期（YYYY-MM-DD）；没写为 null */
  date: string | null
  /** 该段正文的 Markdown 原文（不含标题） */
  body: string
}

/** 本地预览挑出的目标版本与段落（开发版顶栏绿色按钮）。 */
export type ChangelogPreview = {
  targetVersion: string
  changelog: ChangelogEntry[]
}

/** Keep a Changelog 式标题 `[1.2.3] - 2026-01-01`（方括号与日期可省）；只认正式版号。 */
const VERSION_HEADING = /^\[?(\d+\.\d+\.\d+)\]?(?:\s+-\s+(\d{4}-\d{2}-\d{2}))?$/

/**
 * 按二级标题切段：标题是正式版号的才算版本段，其余（非版本号、带 -beta 的标题等）忽略；
 * 正文取到下一个一 / 二级标题为止。同一版本写了多段只取第一段。
 */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  const nodes = fromMarkdown(markdown).children
  const entries: ChangelogEntry[] = []
  nodes.forEach((node, i) => {
    if (node.type !== 'heading' || node.depth !== 2) return
    const match = VERSION_HEADING.exec(toString(node).trim())
    if (match === null) return
    const version = match[1]!
    if (valid(version) === null || entries.some((e) => e.version === version)) return

    const next = nodes.slice(i + 1).find((n) => n.type === 'heading' && n.depth <= 2)
    const start = node.position?.end.offset ?? 0
    const end = next?.position?.start.offset ?? markdown.length
    entries.push({ version, date: match[2] ?? null, body: markdown.slice(start, end).trim() })
  })
  return entries
}

/** 版本对应的日志段版本号：去掉 prerelease / build（Beta 共用同号正式版那段）；非法版本为 null。 */
export function changelogVersionOf(version: string): string | null {
  const parsed = parse(version)
  return parsed === null ? null : `${parsed.major}.${parsed.minor}.${parsed.patch}`
}

/** 当前版本之后、到目标版本为止的各段（新→旧）；没写日志的版本自然缺席。 */
export function pickChangelogEntries(
  entries: ChangelogEntry[],
  currentVersion: string,
  targetVersion: string
): ChangelogEntry[] {
  const from = changelogVersionOf(currentVersion)
  const to = changelogVersionOf(targetVersion)
  if (from === null || to === null) return []
  return entries
    .filter((e) => gt(e.version, from) && lte(e.version, to))
    .sort((a, b) => rcompare(a.version, b.version))
}

/** 某次发版对应的那一段（Beta tag 取同号正式版）；没写为 null。 */
export function findChangelogEntry(
  entries: ChangelogEntry[],
  version: string
): ChangelogEntry | null {
  const target = changelogVersionOf(version)
  return entries.find((e) => e.version === target) ?? null
}

/**
 * 本地预览：比当前版本新的全部段落（新→旧），目标版本取其中最新一段；
 * 一段都没写时目标按当前版本 +1 补丁号，用来预览「没写日志」时的弹窗。
 */
export function previewChangelog(
  entries: ChangelogEntry[],
  currentVersion: string
): ChangelogPreview {
  const from = changelogVersionOf(currentVersion)
  if (from === null) throw new Error(`Invalid version: ${currentVersion}`)
  const changelog = entries
    .filter((e) => gt(e.version, from))
    .sort((a, b) => rcompare(a.version, b.version))
  return { targetVersion: changelog[0]?.version ?? inc(from, 'patch')!, changelog }
}
