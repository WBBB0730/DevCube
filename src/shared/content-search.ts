/** Content Search（内容搜索）共享类型与纯逻辑（术语见 CONTEXT.md；引擎 rg --json）。 */

export interface ContentSearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  /** 文件掩码（gitignore 风格 glob，逗号分隔多个；空 = 不过滤） */
  fileMask: string
}

export const DEFAULT_CONTENT_SEARCH_OPTIONS: ContentSearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  fileMask: ''
}

/** 结果封顶：到限即停（对齐 IDE「结果过多请细化」的做法）。 */
export const CONTENT_SEARCH_MAX_MATCHES = 10000

/** 展示文本上限与截断窗口（超长行如压缩产物；命中靠后时窗口前移）。 */
const DISPLAY_MAX = 300
const DISPLAY_LEAD = 40

export interface ContentSearchMatch {
  /** 相对项目根路径（`/` 分隔） */
  rel: string
  /** 1 起行号 */
  line: number
  /** 展示用行文本（去行尾换行与首缩进、超长按首个命中开窗截断） */
  text: string
  /** 展示文本内的命中区间 [start, end)，UTF-16 字符坐标 */
  ranges: [number, number][]
  /** 首个命中在原始行内的字符区间（打开文件后选中用） */
  col: number
  endCol: number
}

export type ContentSearchEvent =
  | { kind: 'matches'; seq: number; matches: ContentSearchMatch[] }
  | { kind: 'done'; seq: number; limitHit: boolean; error: string | null }

/**
 * 组装 rg 搜索参数（不含 cwd）。gitignore / 隐藏文件口径与文件名索引一致
 * （ADR-0027；IDE 忽略名由调用方按路径段后滤）。
 * 末尾显式给搜索路径 `.`：spawn 下 stdin 是管道而非 TTY，不给路径 rg 会
 * 转而等待从 stdin 读入待搜内容、永不返回（输出路径因此带 `./` 前缀，
 * 由调用方归一时剥掉）。
 */
export function buildRgSearchArgs(query: string, options: ContentSearchOptions): string[] {
  const args = ['--json', '--hidden', '-g', '!**/.git']
  args.push(options.caseSensitive ? '-s' : '-i')
  if (options.wholeWord) args.push('-w')
  if (!options.regex) args.push('-F')
  for (const mask of options.fileMask.split(',')) {
    const m = mask.trim()
    if (m) args.push('-g', m)
  }
  args.push('--', query, '.')
  return args
}

/** rg --json 的 submatch 字节偏移 → UTF-16 字符偏移（偏移需升序）。 */
function byteToCharIndexes(text: string, byteOffsets: number[]): number[] {
  const out: number[] = []
  let bytePos = 0
  let charPos = 0
  let i = 0
  for (const cp of text) {
    while (i < byteOffsets.length && byteOffsets[i] <= bytePos) {
      out.push(charPos)
      i++
    }
    const code = cp.codePointAt(0) ?? 0
    bytePos += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
    charPos += cp.length
  }
  while (i < byteOffsets.length) {
    out.push(charPos)
    i++
  }
  return out
}

interface RgMatchEvent {
  type?: string
  data?: {
    path?: { text?: string }
    lines?: { text?: string }
    line_number?: number
    submatches?: { start: number; end: number }[]
  }
}

/**
 * 解析 rg --json 的一行输出：match 事件 → ContentSearchMatch，其余（begin /
 * end / summary、二进制或非 UTF-8 的 base64 形态、坏行）→ null。
 * 路径原样保留（相对 cwd；Windows 反斜杠由调用方归一）。
 */
export function parseRgMatchLine(jsonLine: string): ContentSearchMatch | null {
  let ev: RgMatchEvent
  try {
    ev = JSON.parse(jsonLine) as RgMatchEvent
  } catch {
    return null
  }
  if (ev.type !== 'match' || !ev.data) return null
  const rel = ev.data.path?.text
  const rawLine = ev.data.lines?.text
  const line = ev.data.line_number
  const submatches = ev.data.submatches
  if (!rel || rawLine === undefined || !line || !submatches?.length) return null

  const original = rawLine.replace(/\r?\n$/, '')
  const byteOffsets = submatches.flatMap((s) => [s.start, s.end])
  const charOffsets = byteToCharIndexes(original, byteOffsets)
  const charRanges: [number, number][] = []
  for (let i = 0; i < submatches.length; i++) {
    const start = charOffsets[i * 2]
    const end = Math.min(charOffsets[i * 2 + 1], original.length)
    if (end > start) charRanges.push([start, end])
  }
  if (charRanges.length === 0) return null

  // 展示文本：去首缩进；首个命中超出窗口时前移窗口并加省略号
  const leadTrim = original.length - original.trimStart().length
  const trimmed = original.slice(leadTrim)
  const firstStart = charRanges[0][0] - leadTrim
  const windowStart = firstStart > DISPLAY_MAX - DISPLAY_LEAD ? firstStart - DISPLAY_LEAD : 0
  const prefix = windowStart > 0 ? '…' : ''
  const text = prefix + trimmed.slice(windowStart, windowStart + DISPLAY_MAX)
  const shift = leadTrim + windowStart - prefix.length
  const ranges: [number, number][] = []
  for (const [s, e] of charRanges) {
    const ds = Math.max(s - shift, prefix.length)
    const de = Math.min(e - shift, text.length)
    if (de > ds) ranges.push([ds, de])
  }

  return { rel, line, text, ranges, col: charRanges[0][0], endCol: charRanges[0][1] }
}
