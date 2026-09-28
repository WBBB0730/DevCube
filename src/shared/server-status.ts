// 服务器状态（Status Tab）：远端脚本、输出流解析与数值计算的纯函数（见 docs/prd/server-status.md）。
// 远端只用服务器自带的 sh 读 Linux 的 /proc 与 df，什么都不装；主进程解析输出、算出速率后推给渲染端。

/** 基本系统信息：连上后读一次。读不到的项为空串 / null。 */
export interface ServerSystemInfo {
  hostname: string
  /** `/etc/os-release` 的 PRETTY_NAME，如「Ubuntu 22.04.4 LTS」 */
  os: string
  /** `uname -sr`，如「Linux 5.15.0-105-generic」 */
  kernel: string
  /** `uname -m`，如「x86_64」 */
  arch: string
  cores: number | null
  /** CPU 型号（`/proc/cpuinfo` 的 model name；部分 ARM 机器没有） */
  cpuModel: string
  /** 默认路由所在网卡，如「eth0」；没有默认路由为 null */
  iface: string | null
  /** 该网卡的 IPv4 地址（云服务器上多为内网地址） */
  ip: string
  /** 开机时间（epoch 秒，`/proc/stat` 的 btime，按服务器时钟） */
  bootTime: number | null
  /**
   * 连接地址：DevCube 连过去用的主机名或 IP（`ssh -G` 的 hostname）。云服务器的公网 IP 在网关上转发，
   * 服务器自己读不到，所以由主进程按本机的 ssh 配置补上，不在服务器上读。
   */
  address: string
}

/** 一个硬盘分区的用量（字节）。 */
export interface ServerDiskUsage {
  mount: string
  /** 来源设备，如「/dev/vda1」 */
  device: string
  used: number
  available: number
}

/** 进程排行里的一个进程。CPU 占用率按单核计（同 top，多核进程可超过 100%）。 */
export interface ServerProcess {
  pid: number
  /** 用户名；没有对应用户名时为 uid 数字，读不到为「?」 */
  user: string
  /** 程序名（命令行首个词的文件名；内核线程等没有命令行的用内核记录的名字） */
  name: string
  cpuPercent: number
  /** 常驻内存（字节） */
  memory: number
}

/** 一帧算好的状态（字节为单位）。速率要两帧相减，第一帧为 null。 */
export interface ServerStatusSample {
  cpuPercent: number | null
  memory: { total: number; used: number }
  swap: { total: number; used: number }
  load: [number, number, number]
  uptimeSeconds: number
  /** 默认路由所在网卡：收发速度（字节 / 秒）与开机以来的累计量；没有默认路由为 null */
  network: {
    rxPerSecond: number | null
    txPerSecond: number | null
    rxTotal: number
    txTotal: number
  } | null
  disks: ServerDiskUsage[]
  /** 系统盘（`/` 所在分区）的读写速度（字节 / 秒）；读不到（如根在 overlay 上）为 null，第一帧速度为 null */
  diskIo: { readPerSecond: number | null; writePerSecond: number | null } | null
  /** CPU 前 10 与内存前 10 的并集（按需在界面上排序取前 10）；第一帧为空 */
  processes: ServerProcess[]
}

/** 曲线上的一个点：CPU / 内存为百分比，网络与系统盘读写为字节 / 秒；没有数值为 null。 */
export interface StatusPoint {
  /** 本机收到这一帧的时间（epoch ms） */
  time: number
  cpu: number | null
  memory: number | null
  rx: number | null
  tx: number | null
  diskRead: number | null
  diskWrite: number | null
}

/** 一台服务器的状态连接所处阶段。 */
export type ServerStatusState =
  | { phase: 'idle' }
  | { phase: 'connecting' }
  | {
      phase: 'connected'
      info: ServerSystemInfo
      sample: ServerStatusSample | null
      /** 最近 5 分钟的曲线点（按时间先后） */
      history: StatusPoint[]
    }
  | { phase: 'unsupported' }
  | { phase: 'disconnected'; message: string }

/** 主进程 → 渲染端：某台服务器的状态有变化（每帧一次）。 */
export interface ServerStatusEvent {
  serverId: string
  state: ServerStatusState
}

/** 两帧之间的刷新间隔。 */
export const STATUS_INTERVAL_MS = 2000

/** 曲线保留的时长。 */
export const STATUS_HISTORY_WINDOW_MS = 5 * 60_000

/** 进程排行的条数。 */
export const STATUS_PROCESS_COUNT = 10

/**
 * 在服务器上执行的脚本（经 `sh -c` 执行，不依赖登录 shell 的语法）。不是 Linux（没有 /proc/stat）就输出
 * 「不支持」标记后退出；否则先输出一次基本信息，再**每从标准输入读到一行就输出一帧**——主进程不写，
 * 它就卡在 read 上，不占 CPU。各段以 `@@` 开头的标记行分隔，登录时 rc 文件打印的杂项落在帧外、被忽略。
 *
 * 进程排行在服务器上算好再传回：每帧读全部 `/proc/<pid>/stat` 的 utime + stime（时钟嘀嗒），与上一帧相减，
 * 只输出 CPU 前 10 与常驻内存前 10 的并集（@@ps：「增量 常驻页数 pid 内核记录的名字」），再用一次 `ps`
 * 补上它们的用户名与命令行（@@psinfo：「pid 用户 命令行」）。`ps` 的 %CPU 是进程一生的平均值，反映不了当下；
 * `top` 的输出格式会被用户自己的 toprc 改掉，都不用来算 CPU。
 *
 * 系统盘读写：按 `/proc/self/mountinfo` 里 `/` 的设备号（major:minor）取 `/proc/diskstats` 那一行。
 *
 * 不含连续两个反斜杠：外层单引号包裹后，fish 这类登录 shell 也能原样转交给 sh。
 */
export const STATUS_SCRIPT = [
  '[ -r /proc/stat ] || { echo @@unsupported; exit 0; }',
  `IF=$(awk '$2 == "00000000" { print $1; exit }' /proc/net/route 2>/dev/null)`,
  `RD=$(awk '$5 == "/" { print $3; exit }' /proc/self/mountinfo 2>/dev/null)`,
  'echo @@info',
  'echo "host $(cat /proc/sys/kernel/hostname 2>/dev/null)"',
  'echo "kernel $(uname -sr 2>/dev/null)"',
  'echo "arch $(uname -m 2>/dev/null)"',
  'echo "os $( (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") )"',
  `echo "cores $(grep -c '^processor' /proc/cpuinfo 2>/dev/null)"`,
  `echo "cpu $(awk -F': ' '/^model name/ { print $2; exit }' /proc/cpuinfo 2>/dev/null)"`,
  'echo "iface $IF"',
  `echo "ip $(ip -o -4 addr show dev "$IF" 2>/dev/null | awk '{ split($4, a, "/"); print a[1]; exit }')"`,
  'echo "pagesize $(getconf PAGESIZE 2>/dev/null)"',
  'echo "clk $(getconf CLK_TCK 2>/dev/null)"',
  `echo "btime $(awk '/^btime/ { print $2 }' /proc/stat)"`,
  'echo @@ready',
  'P=',
  'while read -r _; do',
  '  echo @@sample',
  '  echo @@stat; head -n 1 /proc/stat',
  `  echo @@mem; grep -E '^(MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree):' /proc/meminfo`,
  '  echo @@load; cat /proc/loadavg',
  '  echo @@uptime; cat /proc/uptime',
  `  echo @@net; awk -F: -v i="$IF" '{ n = $1; gsub(/ /, "", n) } n == i' /proc/net/dev`,
  '  echo @@df; df -kP 2>/dev/null',
  `  echo @@io; awk -v d="$RD" '($1 ":" $2) == d' /proc/diskstats 2>/dev/null`,
  '  echo @@ps',
  `  N=$(awk '{ n = $0; sub(/^[0-9]+ [(]/, "", n); sub(/[)] [^)]*$/, "", n); c = $0; sub(/^.*[)] /, "", c); split(c, f, " "); print $1, f[12] + f[13], f[22], n }' /proc/[0-9]*/stat 2>/dev/null)`,
  `  T=$(printf '%s\\n@@prev\\n%s\\n' "$N" "$P" | awk 'NF == 0 { next } $0 == "@@prev" { p = 1; next } !p { t[$1] = $2; r[$1] = $3; s = $0; sub(/^[^ ]+ [^ ]+ [^ ]+ /, "", s); n[$1] = s; next } { o[$1] = $2 } END { for (k in t) if (k in o) print t[k] - o[k], r[k], k, n[k] }')`,
  `  S=$({ printf '%s\\n' "$T" | sort -k1,1nr -k2,2nr | head -n ${STATUS_PROCESS_COUNT}; printf '%s\\n' "$T" | sort -k2,2nr | head -n ${STATUS_PROCESS_COUNT}; } | awk 'NF && !seen[$3]++')`,
  `  printf '%s\\n' "$S"`,
  '  echo @@psinfo',
  `  [ -n "$S" ] && ps -o pid=,user:32=,args= -p "$(printf '%s\\n' "$S" | awk '{ printf "%s%s", (NR > 1 ? "," : ""), $3 }')" 2>/dev/null`,
  '  P=$N',
  '  echo @@end',
  'done'
].join('\n')

/** 基本信息之外、主进程换算要用的两个常数。 */
export interface StatusScale {
  /** 内存页大小（字节） */
  pageSize: number
  /** 每秒时钟嘀嗒数 */
  clockTicks: number
}

/** 输出流里的一件事：不支持 / 基本信息读完 / 一帧读完（按段分好的原始行）。 */
export type StatusStreamEvent =
  | { type: 'unsupported' }
  | { type: 'info'; info: ServerSystemInfo; scale: StatusScale }
  | { type: 'frame'; sections: Map<string, string[]> }

const positiveInteger = (value: string | undefined, fallback: number | null): number | null => {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

function parseInfo(lines: string[]): { info: ServerSystemInfo; scale: StatusScale } {
  const values = new Map<string, string>()
  for (const line of lines) {
    const space = line.indexOf(' ')
    const key = space < 0 ? line : line.slice(0, space)
    values.set(key, space < 0 ? '' : line.slice(space + 1).trim())
  }
  const iface = values.get('iface') ?? ''
  return {
    info: {
      hostname: values.get('host') ?? '',
      os: values.get('os') ?? '',
      kernel: values.get('kernel') ?? '',
      arch: values.get('arch') ?? '',
      cores: positiveInteger(values.get('cores'), null),
      cpuModel: values.get('cpu') ?? '',
      iface: iface === '' ? null : iface,
      ip: values.get('ip') ?? '',
      bootTime: positiveInteger(values.get('btime'), null),
      // 由主进程按本机的 ssh 配置补上
      address: ''
    },
    // getconf 缺席时取 Linux 上几乎通用的默认值
    scale: {
      pageSize: positiveInteger(values.get('pagesize'), 4096)!,
      clockTicks: positiveInteger(values.get('clk'), 100)!
    }
  }
}

/**
 * 按行解析远端脚本的输出流：chunk 可在任意位置断开，不完整的末行留到下次。
 * 返回本次 chunk 里读完的事件（按出现顺序）。
 */
export function createStatusStreamParser(): (chunk: string) => StatusStreamEvent[] {
  let rest = ''
  // 当前所在块：帧外 / 基本信息 / 帧内某段
  let block:
    | { kind: 'none' }
    | { kind: 'info'; lines: string[] }
    | {
        kind: 'frame'
        sections: Map<string, string[]>
        current: string[] | null
      } = { kind: 'none' }

  return (chunk) => {
    const events: StatusStreamEvent[] = []
    const lines = (rest + chunk).split('\n')
    rest = lines.pop() ?? ''
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '')
      if (line === '@@unsupported') {
        events.push({ type: 'unsupported' })
        block = { kind: 'none' }
      } else if (line === '@@info') {
        block = { kind: 'info', lines: [] }
      } else if (line === '@@ready') {
        if (block.kind === 'info') events.push({ type: 'info', ...parseInfo(block.lines) })
        block = { kind: 'none' }
      } else if (line === '@@sample') {
        block = { kind: 'frame', sections: new Map(), current: null }
      } else if (line === '@@end') {
        if (block.kind === 'frame') events.push({ type: 'frame', sections: block.sections })
        block = { kind: 'none' }
      } else if (block.kind === 'frame' && line.startsWith('@@')) {
        const section: string[] = []
        block.sections.set(line.slice(2), section)
        block.current = section
      } else if (block.kind === 'frame') {
        block.current?.push(line)
      } else if (block.kind === 'info') {
        block.lines.push(line)
      }
    }
    return events
  }
}

/** 一帧的原始计数：CPU jiffies、字节数、开机秒数。速率要与上一帧相减。 */
export interface StatusFrame {
  cpu: { idle: number; total: number } | null
  memory: { total: number; used: number }
  swap: { total: number; used: number }
  load: [number, number, number]
  uptimeSeconds: number
  /** 默认网卡开机以来的收发字节 */
  net: { rx: number; tx: number } | null
  disks: ServerDiskUsage[]
  /** 系统盘开机以来的读写字节 */
  diskIo: { read: number; write: number } | null
  /** 服务器上已挑好的进程：cpuTicks 为与上一帧相比的时钟嘀嗒增量 */
  processes: { pid: number; user: string; name: string; cpuTicks: number; memory: number }[]
}

const numbersOf = (line: string | undefined): number[] =>
  (line ?? '')
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((n) => Number.isFinite(n))

/** `/proc/stat` 首行：总量为 user…steal 八项（guest 已含在 user / nice 里），空闲为 idle + iowait。 */
function parseCpu(line: string | undefined): StatusFrame['cpu'] {
  if (!line?.startsWith('cpu ')) return null
  const values = numbersOf(line.slice(4))
  if (values.length < 4) return null
  const total = values.slice(0, 8).reduce((a, b) => a + b, 0)
  return { idle: values[3]! + (values[4] ?? 0), total }
}

/** `/proc/meminfo`（kB）：已用内存 = 总量 − 可用（老内核没有 MemAvailable 时用 Free + Buffers + Cached）。 */
function parseMemory(lines: string[]): Pick<StatusFrame, 'memory' | 'swap'> {
  const kb = new Map<string, number>()
  for (const line of lines) {
    const match = /^(\w+):\s+(\d+)/.exec(line)
    if (match) kb.set(match[1]!, Number(match[2]))
  }
  const get = (key: string): number => (kb.get(key) ?? 0) * 1024
  const total = get('MemTotal')
  const available = kb.has('MemAvailable')
    ? get('MemAvailable')
    : get('MemFree') + get('Buffers') + get('Cached')
  const swapTotal = get('SwapTotal')
  return {
    memory: { total, used: Math.max(0, total - available) },
    swap: { total: swapTotal, used: Math.max(0, swapTotal - get('SwapFree')) }
  }
}

/**
 * `/proc/net/dev` 里默认网卡那一行：冒号后第 1 与第 9 列为收发字节
 * （老内核数值大时冒号后不留空格，所以按冒号切，不按空白切）。
 */
function parseNet(lines: string[], iface: string | null): StatusFrame['net'] {
  if (iface === null) return null
  for (const line of lines) {
    const colon = line.indexOf(':')
    if (colon < 0 || line.slice(0, colon).trim() !== iface) continue
    const values = numbersOf(line.slice(colon + 1))
    if (values.length < 9) return null
    return { rx: values[0]!, tx: values[8]! }
  }
  return null
}

/**
 * `df -kP`：只列 `/` 与来源为 `/dev/…` 的分区（排除 `/dev/loop…` 这类 snap 挂载），同一来源只列一次；
 * 挂载点可以含空格。
 */
function parseDisks(lines: string[]): ServerDiskUsage[] {
  const disks: ServerDiskUsage[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const match = /^(\S+)\s+\d+\s+(\d+)\s+(\d+)\s+\d+%\s+(.+)$/.exec(line)
    if (!match) continue
    const [, device, used, available, mount] = match as unknown as [
      string,
      string,
      string,
      string,
      string
    ]
    const isDevice = device.startsWith('/dev/') && !device.startsWith('/dev/loop')
    if ((mount !== '/' && !isDevice) || seen.has(device)) continue
    seen.add(device)
    disks.push({
      mount,
      device,
      used: Number(used) * 1024,
      available: Number(available) * 1024
    })
  }
  return disks
}

/**
 * 程序名：命令行首个词的文件名，去掉进程自己改标题时常带的尾冒号（如「sshd: ubuntu@pts/0」「nginx: master」）；
 * 没有命令行（内核线程、`ps` 不可用）或是内核线程的方括号写法时，用内核记录的名字（最多 15 个字符）。
 */
export function programName(args: string, comm: string): string {
  const first = args.trim().split(/\s+/)[0] ?? ''
  if (first === '' || first.startsWith('[')) return comm
  return first.slice(first.lastIndexOf('/') + 1).replace(/:$/, '') || comm
}

/**
 * 进程排行：@@ps 每行「嘀嗒增量 常驻页数 pid 内核记录的名字」（名字可含空格）；@@psinfo 每行
 * 「pid 用户 命令行」（`ps` 的输出，前面可能有空格）。`ps` 不可用时用户为「?」、程序名用内核记录的名字。
 */
function parseProcesses(
  lines: string[],
  infoLines: string[],
  pageSize: number
): StatusFrame['processes'] {
  const info = new Map<number, { user: string; args: string }>()
  for (const line of infoLines) {
    const match = /^\s*(\d+)\s+(\S+)\s*(.*)$/.exec(line)
    if (match) info.set(Number(match[1]), { user: match[2]!, args: match[3]! })
  }
  const processes: StatusFrame['processes'] = []
  for (const line of lines) {
    const match = /^(-?\d+) (\d+) (\d+) (.*)$/.exec(line)
    if (!match) continue
    const pid = Number(match[3])
    const extra = info.get(pid)
    processes.push({
      pid,
      user: extra?.user ?? '?',
      name: programName(extra?.args ?? '', match[4]!),
      cpuTicks: Math.max(0, Number(match[1])),
      memory: Number(match[2]) * pageSize
    })
  }
  return processes
}

/** `/proc/diskstats` 里系统盘那一行：第 6、10 列为读、写的扇区数（恒按 512 字节计）。 */
function parseDiskIo(line: string | undefined): StatusFrame['diskIo'] {
  const values = numbersOf(line?.replace(/^\s*\d+\s+\d+\s+\S+/, ''))
  if (values.length < 7) return null
  return { read: values[2]! * 512, write: values[6]! * 512 }
}

/** 把一帧按段分好的原始行解析成计数。 */
export function parseStatusFrame(
  sections: Map<string, string[]>,
  info: Pick<ServerSystemInfo, 'iface'>,
  scale: StatusScale
): StatusFrame {
  const load = numbersOf(sections.get('load')?.[0])
  return {
    cpu: parseCpu(sections.get('stat')?.[0]),
    ...parseMemory(sections.get('mem') ?? []),
    load: [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0],
    uptimeSeconds: numbersOf(sections.get('uptime')?.[0])[0] ?? 0,
    net: parseNet(sections.get('net') ?? [], info.iface),
    disks: parseDisks(sections.get('df') ?? []),
    diskIo: parseDiskIo(sections.get('io')?.[0]),
    processes: parseProcesses(
      sections.get('ps') ?? [],
      sections.get('psinfo') ?? [],
      scale.pageSize
    )
  }
}

/**
 * 由相邻两帧算出一帧状态：CPU 使用率 = 1 − 空闲增量 / 总增量；网络速度 = 字节增量 / 两帧开机秒数之差
 * （计数器回绕或网卡重建时增量为负，按 0 算）；进程 CPU = 嘀嗒增量 /（每秒嘀嗒数 × 两帧间隔）。
 * 没有上一帧时速率为 null、进程排行为空。
 */
export function computeStatusSample(
  prev: StatusFrame | null,
  cur: StatusFrame,
  scale: StatusScale
): ServerStatusSample {
  const seconds = prev ? cur.uptimeSeconds - prev.uptimeSeconds : 0
  const paired = prev !== null && seconds > 0

  let cpuPercent: number | null = null
  if (paired && prev.cpu && cur.cpu) {
    const total = cur.cpu.total - prev.cpu.total
    const idle = cur.cpu.idle - prev.cpu.idle
    if (total > 0) cpuPercent = Math.min(100, Math.max(0, (1 - idle / total) * 100))
  }

  const rate = (now: number, before: number | undefined): number | null =>
    paired && before !== undefined ? Math.max(0, now - before) / seconds : null
  let network: ServerStatusSample['network'] = null
  if (cur.net) {
    network = {
      rxPerSecond: rate(cur.net.rx, prev?.net?.rx),
      txPerSecond: rate(cur.net.tx, prev?.net?.tx),
      rxTotal: cur.net.rx,
      txTotal: cur.net.tx
    }
  }

  const processes = paired
    ? cur.processes.map(({ cpuTicks, ...rest }) => ({
        ...rest,
        cpuPercent: (cpuTicks / (scale.clockTicks * seconds)) * 100
      }))
    : []

  return {
    cpuPercent,
    memory: cur.memory,
    swap: cur.swap,
    load: cur.load,
    uptimeSeconds: cur.uptimeSeconds,
    network,
    disks: cur.disks,
    diskIo: cur.diskIo
      ? {
          readPerSecond: rate(cur.diskIo.read, prev?.diskIo?.read),
          writePerSecond: rate(cur.diskIo.write, prev?.diskIo?.write)
        }
      : null,
    processes
  }
}

/** 只留最近 5 分钟（以 now 为准）的曲线点。 */
export function pruneStatusHistory(history: readonly StatusPoint[], now: number): StatusPoint[] {
  return history.filter((p) => p.time > now - STATUS_HISTORY_WINDOW_MS)
}

/** 把一帧加进曲线（以这一帧的时间为准，旧于 5 分钟的点丢掉）。 */
export function appendStatusHistory(
  history: readonly StatusPoint[],
  time: number,
  sample: ServerStatusSample
): StatusPoint[] {
  const point: StatusPoint = {
    time,
    cpu: sample.cpuPercent,
    memory: sample.memory.total > 0 ? (sample.memory.used / sample.memory.total) * 100 : null,
    rx: sample.network?.rxPerSecond ?? null,
    tx: sample.network?.txPerSecond ?? null,
    diskRead: sample.diskIo?.readPerSecond ?? null,
    diskWrite: sample.diskIo?.writePerSecond ?? null
  }
  return [...pruneStatusHistory(history, time), point]
}

/**
 * 画图用的点：相邻两点相隔超过 2.5 个刷新间隔（断开过）时，在中间补一个全空的点，让曲线在那里断开。
 */
export function withHistoryGaps(history: readonly StatusPoint[]): StatusPoint[] {
  const points: StatusPoint[] = []
  for (const point of history) {
    const last = points.at(-1)
    if (last && point.time - last.time > STATUS_INTERVAL_MS * 2.5) {
      points.push({
        time: last.time + STATUS_INTERVAL_MS,
        cpu: null,
        memory: null,
        rx: null,
        tx: null,
        diskRead: null,
        diskWrite: null
      })
    }
    points.push(point)
  }
  return points
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/**
 * 字节速率纵轴：从 0 起，在盖住最大值的单位（按 1024 进位）上取 1 / 2 / 5 × 10ⁿ 的步长，约 3 段（卡内小图放不下更密的刻度）；
 * 最大值不足 1 KB 时按 1 KB 算，空闲时纵轴也不至于缩成零点几字节。刻度文字统一用最大刻度的单位。
 */
export function byteRateAxis(max: number): { ticks: number[]; label: (value: number) => string } {
  const top = Math.max(max, 1024)
  let unit = 0
  while (top / 1024 ** unit >= 1024 && unit < BYTE_UNITS.length - 1) unit++
  const scaled = top / 1024 ** unit
  const raw = scaled / 3
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= raw)!
  const ticks = Array.from(
    { length: Math.ceil(scaled / step - 1e-9) + 1 },
    (_, i) => i * step * 1024 ** unit
  )
  const label = (value: number): string => {
    const n = value / 1024 ** unit
    return `${Number.isInteger(n) ? n : n.toFixed(1)} ${BYTE_UNITS[unit]}`
  }
  return { ticks, label }
}

/** 字节按 1024 进位：B 为整数，其余一位小数，如「512 B」「1.5 GB」。 */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${BYTE_UNITS[unit]}`
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** epoch 秒 → 本地时间「2026-05-02 15:21」。 */
export function formatBootTime(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 开机时长：满一天为「N 天 N 小时」，满一小时为「N 小时 N 分钟」，否则「N 分钟」。 */
export function formatUptime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days} 天 ${hours % 24} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes % 60} 分钟`
  return `${minutes} 分钟`
}
