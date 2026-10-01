// 服务器的 Status Tab 正文（见 docs/prd/server-status.md）：每台服务器常驻一个，切走仅隐藏。
// 连上后主进程每 2 秒推一次状态（含最近 5 分钟的曲线），不管 Tab 是否可见；系统卡底部可手动断开。
// 上半部分四张卡（CPU / 内存 / 系统盘 / 网络）固定两列、分两行，各带自己的曲线；下半部分左进程、右系统信息。
import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown } from 'lucide-react'
import { CartesianGrid, LineChart, Line, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@renderer/components/ui/button'
import { ConnectPlaceholder } from '@renderer/components/ui/connect-placeholder'
import { createKeyedSubscription, useKeyedPushed } from '@renderer/lib/keyed-subscription'
import { cn } from '@renderer/lib/utils'
import { useApp } from '@renderer/store'
import {
  byteRateAxis,
  formatBootTime,
  formatBytes,
  formatUptime,
  STATUS_HISTORY_WINDOW_MS,
  STATUS_PROCESS_COUNT,
  withHistoryGaps,
  type ServerDiskUsage,
  type ServerProcess,
  type ServerStatusEvent,
  type ServerStatusSample,
  type ServerStatusState,
  type ServerSystemInfo,
  type StatusPoint
} from '@shared/server-status'

const SERIES_1 = 'var(--chart-1)'
const SERIES_2 = 'var(--chart-2)'

// 各台服务器的状态面板共用一个底层推送监听，按服务器 id 分发
const subscribeServerStatus = createKeyedSubscription(
  window.api.onServerStatusChanged,
  (event) => event.serverId
)

const stateOf = (event: ServerStatusEvent): ServerStatusState => event.state

const IDLE: ServerStatusState = { phase: 'idle' }

export function ServerStatusPane({ serverId }: { serverId: string }): React.JSX.Element {
  const name = useApp((s) => s.servers.find((n) => n.server.id === serverId)?.server.name ?? '')
  // 渲染端重载后接上主进程里已有的连接；尚未得知时按未连接
  const state =
    useKeyedPushed(serverId, subscribeServerStatus, window.api.getServerStatus, stateOf) ?? IDLE

  const connect = (): void => void window.api.connectServerStatus(serverId)

  if (state.phase === 'connected') {
    return (
      <StatusDashboard
        info={state.info}
        sample={state.sample}
        history={state.history}
        onDisconnect={() => void window.api.disconnectServerStatus(serverId)}
      />
    )
  }
  if (state.phase === 'connecting') return <ConnectPlaceholder phase="connecting" />
  if (state.phase === 'unsupported') {
    return <ConnectPlaceholder phase="idle" message="暂不支持：状态只支持 Linux 服务器" />
  }
  if (state.phase === 'disconnected') {
    return (
      <ConnectPlaceholder
        phase="failed"
        message={state.message}
        actionLabel="重新连接"
        onAction={connect}
      />
    )
  }
  return (
    <ConnectPlaceholder
      phase="idle"
      message={name === '' ? '尚未连接' : `尚未连接到 ${name}`}
      actionLabel="连接"
      onAction={connect}
    />
  )
}

const formatPercent = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${Math.round(value)}%`

const formatRate = (bytesPerSecond: number | null | undefined): string =>
  bytesPerSecond === null || bytesPerSecond === undefined ? '—' : `${formatBytes(bytesPerSecond)}/s`

const usage = (used: number, total: number): string =>
  `${formatBytes(used)} / ${formatBytes(total)}`

const percentOf = (used: number, total: number): number | null =>
  total > 0 ? (used / total) * 100 : null

/** 分区总量按 已用 + 可用 算，与 `df` 的使用率一致。 */
const diskTotal = (disk: ServerDiskUsage): number => disk.used + disk.available

function StatusDashboard({
  info,
  sample,
  history,
  onDisconnect
}: {
  info: ServerSystemInfo
  sample: ServerStatusSample | null
  history: StatusPoint[]
  onDisconnect: () => void
}): React.JSX.Element {
  const points = withHistoryGaps(history)
  const rootDisk = sample?.disks.find((d) => d.mount === '/') ?? null
  const otherDisks = sample?.disks.filter((d) => d.mount !== '/') ?? []
  const network = sample?.network
  const diskIo = sample?.diskIo

  return (
    <div className="h-full select-text overflow-y-auto p-4">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Panel title="CPU">
            <Headline
              rows={[{ label: '核数', value: info.cores === null ? '—' : String(info.cores) }]}
            >
              <BigValue>{formatPercent(sample?.cpuPercent)}</BigValue>
            </Headline>
            <MetricChart
              points={points}
              series={[{ key: 'cpu', label: 'CPU', color: SERIES_1 }]}
              unit="percent"
            />
          </Panel>

          <Panel title="内存">
            <Headline
              rows={[
                {
                  label: '已用',
                  value: sample ? usage(sample.memory.used, sample.memory.total) : '—'
                }
              ]}
            >
              <BigValue>
                {formatPercent(sample ? percentOf(sample.memory.used, sample.memory.total) : null)}
              </BigValue>
            </Headline>
            <MetricChart
              points={points}
              series={[{ key: 'memory', label: '内存', color: SERIES_1 }]}
              unit="percent"
            />
          </Panel>

          <Panel title="系统盘">
            <Headline
              rows={[
                { label: '读取', value: formatRate(diskIo?.readPerSecond), rate: true },
                { label: '写入', value: formatRate(diskIo?.writePerSecond), rate: true }
              ]}
            >
              <BigValue>
                {formatPercent(rootDisk ? percentOf(rootDisk.used, diskTotal(rootDisk)) : null)}
              </BigValue>
              <Caption
                label="已用"
                value={rootDisk ? usage(rootDisk.used, diskTotal(rootDisk)) : '—'}
                title={rootDisk ? `${rootDisk.device} 挂载于 /` : undefined}
              />
            </Headline>
            {otherDisks.length > 0 && <PartitionRows disks={otherDisks} />}
            <MetricChart
              points={points}
              series={[
                { key: 'diskRead', label: '读取', color: SERIES_1 },
                { key: 'diskWrite', label: '写入', color: SERIES_2 }
              ]}
              unit="bytes"
            />
          </Panel>

          <Panel title="网络">
            <div className="grid grid-cols-2">
              <RateColumn direction="down" rate={network?.rxPerSecond} total={network?.rxTotal} />
              <RateColumn direction="up" rate={network?.txPerSecond} total={network?.txTotal} />
            </div>
            <MetricChart
              points={points}
              series={[
                { key: 'rx', label: '下行', color: SERIES_1 },
                { key: 'tx', label: '上行', color: SERIES_2 }
              ]}
              unit="bytes"
            />
          </Panel>
        </div>

        <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-3">
          <ProcessPanel processes={sample?.processes ?? null} />
          <SystemPanel
            info={info}
            uptimeSeconds={sample?.uptimeSeconds ?? null}
            onDisconnect={onDisconnect}
          />
        </div>
      </div>
    </div>
  )
}

function Panel({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-[var(--separator)] bg-panel px-4 py-3.5">
      <div className="mb-1 text-[13px] font-medium text-foreground">{title}</div>
      {children}
    </div>
  )
}

/** 卡顶一行：左边大数字，右边明细贴右，填满大数字右侧的空间；两边按末行基线（底部）对齐。 */
function Headline({
  rows,
  children
}: {
  rows: Row[]
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-baseline-last justify-between gap-6">
      <div className="shrink-0">{children}</div>
      <Rows rows={rows} />
    </div>
  )
}

function BigValue({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="whitespace-nowrap text-[22px] leading-tight text-foreground">{children}</div>
  )
}

/** 大数字下的一行小字：名字（muted）+ 数值。 */
function Caption({
  label,
  value,
  title
}: {
  label: string
  value: string
  title?: string
}): React.JSX.Element {
  return (
    <div className="mt-1 flex gap-1.5 whitespace-nowrap text-[12px]" title={title}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  )
}

/** 曲线的图例：一小段系列色的线。 */
function LineKey({ color }: { color: string }): React.JSX.Element {
  return (
    <span className="inline-block h-0.5 w-3 shrink-0 rounded-full" style={{ background: color }} />
  )
}

interface Row {
  label: string
  value: string
  title?: string
  /** 每帧都在变的速度：数值列预留最长速度「1023.9 MB/s」的宽度，名字不跟着跳 */
  rate?: boolean
}

/** 卡顶右侧的明细：名字（muted）/ 数值两列，数值右对齐、单行截断（hover 看全）。 */
function Rows({ rows }: { rows: Row[] }): React.JSX.Element {
  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,auto)] gap-x-3 gap-y-1 text-[12px]">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <span className="whitespace-nowrap text-muted-foreground" title={row.title}>
            {row.label}
          </span>
          <span
            className={cn(
              'truncate text-right tabular-nums text-foreground',
              row.rate === true && 'min-w-[4.75rem]'
            )}
            title={row.value}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * 系统盘的其他分区：占满卡宽的清单，名字（挂载位置）过长时截断、hover 看全，用量不截断。
 * 不放在大数字右侧——那里放不下最长的「1023.9 GB / 1023.9 GB · 100%」。
 */
function PartitionRows({ disks }: { disks: ServerDiskUsage[] }): React.JSX.Element {
  return (
    <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[12px]">
      {disks.map((d) => (
        <div key={d.mount} className="contents">
          <span className="truncate text-muted-foreground" title={`${d.device} 挂载于 ${d.mount}`}>
            {d.mount}
          </span>
          <span className="whitespace-nowrap text-right tabular-nums text-foreground">
            {`${usage(d.used, diskTotal(d))} · ${formatPercent(percentOf(d.used, diskTotal(d)))}`}
          </span>
        </div>
      ))}
    </div>
  )
}

/** 网络卡的一栏：箭头兼作曲线图例（下行 ↓ 系列一色、上行 ↑ 系列二色，hover 显示名字），其下开机以来的累计量。 */
const RATE_DIRECTIONS = {
  down: { label: '下行', Icon: ArrowDown, color: SERIES_1 },
  up: { label: '上行', Icon: ArrowUp, color: SERIES_2 }
}

function RateColumn({
  direction,
  rate,
  total
}: {
  direction: keyof typeof RATE_DIRECTIONS
  rate: number | null | undefined
  total: number | undefined
}): React.JSX.Element {
  const { label, Icon, color } = RATE_DIRECTIONS[direction]
  return (
    <div>
      <BigValue>
        <span title={label}>
          <Icon className="mr-0.5 inline size-5 align-baseline" style={{ color }} />
          {formatRate(rate)}
        </span>
      </BigValue>
      <Caption label="累计" value={total === undefined ? '—' : formatBytes(total)} />
    </div>
  )
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** 时刻：「15:23」，悬停读数带秒「15:23:40」。 */
function formatClock(ms: number, withSeconds = false): string {
  const d = new Date(ms)
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  return withSeconds ? `${hm}:${pad2(d.getSeconds())}` : hm
}

type SeriesKey = 'cpu' | 'memory' | 'diskRead' | 'diskWrite' | 'rx' | 'tx'

const AXIS_TICK = { fontSize: 10, fill: 'var(--muted-foreground)' }

/**
 * 卡底的最近 5 分钟曲线：横轴按时间（整分钟刻度），纵轴百分比为 0 / 50 / 100%，字节速率按
 * byteRateAxis 取整刻度，刻度全部显示；只画线。鼠标移上去显示那一刻各系列的数值。
 */
function MetricChart({
  points,
  series,
  unit
}: {
  points: StatusPoint[]
  series: { key: SeriesKey; label: string; color: string }[]
  unit: 'percent' | 'bytes'
}): React.JSX.Element {
  const height = 120
  const end = points.at(-1)?.time
  if (end === undefined) return <div className="mt-auto pt-3" style={{ height: height + 12 }} />

  const start = end - STATUS_HISTORY_WINDOW_MS
  const minuteTicks: number[] = []
  for (let t = Math.ceil(start / 60_000) * 60_000; t <= end; t += 60_000) minuteTicks.push(t)

  const byteAxis =
    unit === 'bytes'
      ? byteRateAxis(Math.max(0, ...points.flatMap((p) => series.map((s) => p[s.key] ?? 0))))
      : null
  const yTicks = byteAxis?.ticks ?? [0, 50, 100]
  const yLabel = byteAxis?.label ?? ((v: number): string => `${v}%`)
  const formatValue = (value: number | null): string =>
    unit === 'percent' ? formatPercent(value) : formatRate(value)

  return (
    <div className="mt-auto pt-3">
      <LineChart
        responsive
        data={points}
        style={{ width: '100%', height }}
        margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
      >
        <CartesianGrid vertical={false} stroke="var(--separator)" />
        <XAxis
          dataKey="time"
          type="number"
          domain={[start, end]}
          ticks={minuteTicks}
          tickFormatter={(t: number) => formatClock(t)}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          height={20}
          allowDataOverflow
        />
        <YAxis
          domain={[0, yTicks.at(-1)!]}
          ticks={yTicks}
          tickFormatter={yLabel}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          interval={0}
          width="auto"
        />
        <Tooltip
          isAnimationActive={false}
          cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1 }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as StatusPoint | undefined
            if (!active || !point) return null
            return (
              <div className="rounded border border-[var(--separator)] bg-[var(--popover)] px-2.5 py-1.5 text-[12px] shadow-md">
                <div className="mb-0.5 tabular-nums text-muted-foreground">
                  {formatClock(point.time, true)}
                </div>
                {series.map((s) => (
                  <div key={s.key} className="flex items-center gap-2">
                    <LineKey color={s.color} />
                    <span className="tabular-nums text-foreground">
                      {formatValue(point[s.key])}
                    </span>
                    <span className="text-muted-foreground">{s.label}</span>
                  </div>
                ))}
              </div>
            )
          }}
        />
        {series.map((s) => (
          <Line
            key={s.key}
            dataKey={s.key}
            type="linear"
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: 'var(--bg-panel)', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </div>
  )
}

function SystemPanel({
  info,
  uptimeSeconds,
  onDisconnect
}: {
  info: ServerSystemInfo
  uptimeSeconds: number | null
  onDisconnect: () => void
}): React.JSX.Element {
  const rows = [
    { label: '主机名', value: info.hostname },
    { label: '连接地址', value: info.address },
    {
      label: '内网 IP',
      value: info.ip === '' ? '' : `${info.ip}${info.iface ? `（${info.iface}）` : ''}`
    },
    { label: '系统', value: info.os },
    { label: '内核', value: info.kernel },
    { label: '架构', value: info.arch },
    { label: 'CPU 型号', value: info.cpuModel },
    { label: '开机时间', value: info.bootTime === null ? '' : formatBootTime(info.bootTime) },
    { label: '已运行', value: uptimeSeconds === null ? '' : formatUptime(uptimeSeconds) }
  ].filter((row) => row.value !== '')
  return (
    <Panel title="系统">
      <div className="mt-1 grid grid-cols-[72px_minmax(0,1fr)] gap-x-2.5 gap-y-2 text-[12px]">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="break-words text-foreground">{row.value}</span>
          </div>
        ))}
      </div>
      <div className="mt-auto pt-3">
        <Button variant="destructiveSoft" className="w-full" onClick={onDisconnect}>
          断开连接
        </Button>
      </div>
    </Panel>
  )
}

type ProcessSort = 'cpu' | 'memory'

/** 进程排行：点表头「CPU」「内存」切换排序（默认按 CPU），取前 10；第一帧还没有增量时提示正在统计。 */
function ProcessPanel({ processes }: { processes: ServerProcess[] | null }): React.JSX.Element {
  const [sortBy, setSortBy] = useState<ProcessSort>('cpu')
  const sorted = [...(processes ?? [])]
    .sort((a, b) =>
      sortBy === 'cpu'
        ? b.cpuPercent - a.cpuPercent || b.memory - a.memory
        : b.memory - a.memory || b.cpuPercent - a.cpuPercent
    )
    .slice(0, STATUS_PROCESS_COUNT)

  const sortHeader = (key: ProcessSort, label: string, width: string): React.JSX.Element => (
    <th className={cn('py-1 text-right font-normal', width)}>
      <button
        type="button"
        onClick={() => setSortBy(key)}
        className={cn(
          'inline-flex items-center gap-0.5 hover:text-foreground',
          sortBy === key ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        {label}
        {sortBy === key && <ChevronDown className="size-3" />}
      </button>
    </th>
  )

  return (
    <Panel title="进程">
      {sorted.length === 0 ? (
        <div className="py-2 text-[12px] text-muted-foreground">正在统计…</div>
      ) : (
        <table className="w-full table-fixed text-[12px]">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 font-normal">名称</th>
              <th className="w-16 py-1 font-normal">用户</th>
              {sortHeader('cpu', 'CPU', 'w-[3.5rem]')}
              {sortHeader('memory', '内存', 'w-[6rem]')}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.pid} className="text-foreground">
                <td className="truncate py-1 pr-2" title={`PID ${p.pid} · ${p.name}`}>
                  {p.name}
                </td>
                <td className="truncate py-1 pr-2 text-muted-foreground">{p.user}</td>
                <td className="py-1 text-right tabular-nums">{p.cpuPercent.toFixed(1)}%</td>
                <td className="py-1 text-right tabular-nums">{formatBytes(p.memory)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  )
}
