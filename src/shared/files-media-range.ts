/** 闭区间字节范围（HTTP Range / Content-Range 语义）。 */
export type ByteRange = { start: number; end: number }

/**
 * 解析 `Range` 请求头（仅支持单个 `bytes=` 区间，与 Chromium `<video>`/`<audio>` 一致）。
 * - 无头 / 空 → `'all'`（整文件）
 * - 合法区间 → `{ start, end }`（end 含）
 * - 无法满足 / 不支持（多段等）→ `null`（应回 416）
 */
export function parseBytesRange(
  rangeHeader: string | null | undefined,
  size: number
): ByteRange | 'all' | null {
  if (size <= 0) return 'all'
  if (!rangeHeader) return 'all'
  const trimmed = rangeHeader.trim()
  if (!trimmed) return 'all'
  // 多段 Range 不实现
  if (trimmed.includes(',')) return null
  const m = /^bytes=(\d*)-(\d*)$/i.exec(trimmed)
  if (!m) return null
  const startStr = m[1]!
  const endStr = m[2]!
  if (startStr === '' && endStr === '') return null

  if (startStr === '') {
    // bytes=-N：末尾 N 字节
    const suffix = Number(endStr)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    const start = Math.max(0, size - suffix)
    return { start, end: size - 1 }
  }

  const start = Number(startStr)
  if (!Number.isFinite(start) || start < 0 || start >= size) return null
  const end = endStr === '' ? size - 1 : Number(endStr)
  if (!Number.isFinite(end) || end < start) return null
  return { start, end: Math.min(end, size - 1) }
}
