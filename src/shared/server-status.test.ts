import { describe, expect, it } from 'vitest'
import {
  appendStatusHistory,
  byteRateAxis,
  computeStatusSample,
  createStatusStreamParser,
  formatBootTime,
  formatBytes,
  formatUptime,
  parseStatusFrame,
  programName,
  STATUS_HISTORY_WINDOW_MS,
  STATUS_INTERVAL_MS,
  STATUS_SCRIPT,
  withHistoryGaps,
  type ServerStatusSample,
  type StatusFrame,
  type StatusPoint
} from './server-status'

const INFO = [
  '@@info',
  'host web-01',
  'kernel Linux 5.15.0-105-generic',
  'arch x86_64',
  'os Ubuntu 22.04.4 LTS',
  'cores 4',
  'cpu Intel(R) Xeon(R) Platinum 8255C CPU @ 2.50GHz',
  'iface eth0',
  'ip 10.0.0.5',
  'pagesize 4096',
  'clk 100',
  'btime 1758340980',
  '@@ready'
].join('\n')

const SCALE = { pageSize: 4096, clockTicks: 100 }

const frameText = (
  stat: string,
  rx: number,
  tx: number,
  uptime: number,
  ps: string[] = [],
  psinfo: string[] = [],
  io = ' 252       1 vda1 100 0 2000 50 300 0 4000 80 0 90 130'
): string =>
  [
    '@@sample',
    '@@stat',
    stat,
    '@@mem',
    'MemTotal:        4000000 kB',
    'MemFree:          500000 kB',
    'MemAvailable:    3000000 kB',
    'SwapTotal:       2000000 kB',
    'SwapFree:        1500000 kB',
    '@@load',
    '0.12 0.08 0.03 1/234 5678',
    '@@uptime',
    `${uptime} 1000.00`,
    '@@net',
    `  eth0: ${rx} 100 0 0 0 0 0 0 ${tx} 80 0 0 0 0 0 0`,
    '@@df',
    'Filesystem     1024-blocks    Used Available Capacity Mounted on',
    'udev                 987654       0    987654       0% /dev',
    'tmpfs                198000    1000    197000       1% /run',
    '/dev/vda1          41000000 12000000  29000000      30% /',
    '/dev/loop0            64000   64000         0     100% /snap/core20/2105',
    '/dev/vdb1         100000000 50000000  50000000      50% /data disk',
    '/dev/vda1          41000000 12000000  29000000      30% /var/lib/docker',
    '@@io',
    io,
    '@@ps',
    ...ps,
    '@@psinfo',
    ...psinfo,
    '@@end',
    ''
  ].join('\n')

describe('STATUS_SCRIPT', () => {
  it('不含连续两个反斜杠：外层单引号包裹后，fish 等登录 shell 也能原样转交给 sh', () => {
    expect(STATUS_SCRIPT).not.toContain('\\\\')
  })
})

describe('createStatusStreamParser', () => {
  it('读出基本信息与各帧；帧外的杂项（rc 文件打印的）忽略', () => {
    const parse = createStatusStreamParser()
    const events = parse(
      `Welcome!\n${INFO}\n${frameText('cpu  100 0 100 800 0 0 0 0 0 0', 1000, 2000, 500)}`
    )
    expect(events.map((e) => e.type)).toEqual(['info', 'frame'])
    expect(events[0]).toEqual({
      type: 'info',
      info: {
        hostname: 'web-01',
        os: 'Ubuntu 22.04.4 LTS',
        kernel: 'Linux 5.15.0-105-generic',
        arch: 'x86_64',
        cores: 4,
        cpuModel: 'Intel(R) Xeon(R) Platinum 8255C CPU @ 2.50GHz',
        iface: 'eth0',
        ip: '10.0.0.5',
        bootTime: 1758340980,
        address: ''
      },
      scale: SCALE
    })
  })

  it('chunk 可以在任意位置断开', () => {
    const text = `${INFO}\n${frameText('cpu  1 0 1 8 0 0 0 0 0 0', 0, 0, 1)}`
    const parse = createStatusStreamParser()
    const events = [...text].flatMap((ch) => parse(ch))
    expect(events.map((e) => e.type)).toEqual(['info', 'frame'])
  })

  it('读不到的信息为空；没有默认路由时网卡为 null；getconf 缺席时用常见默认值', () => {
    const parse = createStatusStreamParser()
    const [event] = parse(
      '@@info\nhost \nkernel Linux 6.1\narch \nos \ncores \ncpu \niface \nip \npagesize \nclk \nbtime \n@@ready\n'
    )
    expect(event).toEqual({
      type: 'info',
      info: {
        hostname: '',
        os: '',
        kernel: 'Linux 6.1',
        arch: '',
        cores: null,
        cpuModel: '',
        iface: null,
        ip: '',
        bootTime: null,
        address: ''
      },
      scale: { pageSize: 4096, clockTicks: 100 }
    })
  })

  it('不是 Linux：给出不支持', () => {
    expect(createStatusStreamParser()('@@unsupported\n')).toEqual([{ type: 'unsupported' }])
  })
})

function frameOf(
  stat: string,
  rx: number,
  tx: number,
  uptime: number,
  ps: string[] = [],
  iface: string | null = 'eth0',
  psinfo: string[] = [],
  io?: string
): StatusFrame {
  const events = createStatusStreamParser()(frameText(stat, rx, tx, uptime, ps, psinfo, io))
  const frame = events[0]
  if (frame?.type !== 'frame') throw new Error('没有解析出帧')
  return parseStatusFrame(frame.sections, { iface }, SCALE)
}

describe('parseStatusFrame', () => {
  const frame = frameOf('cpu  100 0 100 800 0 0 0 0 0 0', 1000, 2000, 500)

  it('内存按 MemAvailable 算已用，交换区按 SwapFree 算', () => {
    expect(frame.memory).toEqual({ total: 4000000 * 1024, used: 1000000 * 1024 })
    expect(frame.swap).toEqual({ total: 2000000 * 1024, used: 500000 * 1024 })
  })

  it('负载、开机时长、默认网卡的收发字节', () => {
    expect(frame.load).toEqual([0.12, 0.08, 0.03])
    expect(frame.uptimeSeconds).toBe(500)
    expect(frame.net).toEqual({ rx: 1000, tx: 2000 })
  })

  it('硬盘只列 / 与 /dev/ 分区，排除 loop，同一来源只列一次，挂载点可含空格', () => {
    expect(frame.disks).toEqual([
      { mount: '/', device: '/dev/vda1', used: 12000000 * 1024, available: 29000000 * 1024 },
      {
        mount: '/data disk',
        device: '/dev/vdb1',
        used: 50000000 * 1024,
        available: 50000000 * 1024
      }
    ])
  })

  it('进程排行：用户与程序名取自 ps；ps 缺席的进程用「?」与内核记录的名字；负增量（pid 被复用）按 0', () => {
    const withPs = frameOf(
      'cpu  1 0 1 8 0 0 0 0 0 0',
      0,
      0,
      1,
      ['150 2560 1234 MainThread', '3 100 88 next-server (v1', '-5 10 99 gone', '0 0 2 kthreadd'],
      'eth0',
      [
        ' 1234 999      /usr/bin/python3 app.py',
        '   88 root     next-server (v15.1.0)',
        '    2 root     [kthreadd]'
      ]
    )
    expect(withPs.processes).toEqual([
      { pid: 1234, user: '999', name: 'python3', cpuTicks: 150, memory: 2560 * 4096 },
      { pid: 88, user: 'root', name: 'next-server', cpuTicks: 3, memory: 100 * 4096 },
      { pid: 99, user: '?', name: 'gone', cpuTicks: 0, memory: 10 * 4096 },
      { pid: 2, user: 'root', name: 'kthreadd', cpuTicks: 0, memory: 0 }
    ])
  })

  it('系统盘读写：diskstats 第 6、10 列的扇区数按 512 字节换算；读不到为 null', () => {
    expect(frameOf('cpu  1 0 1 8 0 0 0 0 0 0', 0, 0, 1).diskIo).toEqual({
      read: 2000 * 512,
      write: 4000 * 512
    })
    expect(frameOf('cpu  1 0 1 8 0 0 0 0 0 0', 0, 0, 1, [], 'eth0', [], '').diskIo).toBeNull()
  })

  it('没有默认网卡时网络为 null', () => {
    expect(frameOf('cpu  1 0 1 8 0 0 0 0 0 0', 0, 0, 1, [], null).net).toBeNull()
  })

  it('老内核没有 MemAvailable：用 MemFree + Buffers + Cached', () => {
    const sections = new Map([
      ['mem', ['MemTotal: 1000 kB', 'MemFree: 200 kB', 'Buffers: 100 kB', 'Cached: 300 kB']]
    ])
    expect(parseStatusFrame(sections, { iface: null }, SCALE).memory).toEqual({
      total: 1000 * 1024,
      used: 400 * 1024
    })
  })
})

describe('computeStatusSample', () => {
  const first = frameOf('cpu  100 0 100 800 0 0 0 0 0 0', 1000, 2000, 500)

  it('第一帧：速率为 null，但累计收发量已有；进程排行为空', () => {
    const sample = computeStatusSample(null, first, SCALE)
    expect(sample.cpuPercent).toBeNull()
    expect(sample.network).toEqual({
      rxPerSecond: null,
      txPerSecond: null,
      rxTotal: 1000,
      txTotal: 2000
    })
    expect(sample.processes).toEqual([])
  })

  it('CPU 使用率把 iowait 算作空闲；网络速度与进程 CPU 按两帧开机秒数之差', () => {
    // 总增量 100（user 30 + system 10 + idle 50 + iowait 10），空闲增量 60 → 40%
    const second = frameOf(
      'cpu  130 0 110 850 10 0 0 0 0 0',
      5000,
      4000,
      502,
      ['150 2560 1234 mysqld'],
      'eth0',
      [' 1234 mysql /usr/sbin/mysqld'],
      ' 252       1 vda1 100 0 3024 50 300 0 6048 80 0 90 130'
    )
    const sample = computeStatusSample(first, second, SCALE)
    expect(sample.cpuPercent).toBeCloseTo(40)
    expect(sample.network).toEqual({
      rxPerSecond: 2000,
      txPerSecond: 1000,
      rxTotal: 5000,
      txTotal: 4000
    })
    // 读写各多了 1024 / 2048 个扇区，2 秒 → 256 KB/s 与 512 KB/s
    expect(sample.diskIo).toEqual({
      readPerSecond: (1024 * 512) / 2,
      writePerSecond: (2048 * 512) / 2
    })
    // 2 秒内 150 个嘀嗒（每秒 100）→ 75%
    expect(sample.processes).toEqual([
      { pid: 1234, user: 'mysql', name: 'mysqld', cpuPercent: 75, memory: 2560 * 4096 }
    ])
  })

  it('计数器回绕（增量为负）按 0 算', () => {
    const second = frameOf('cpu  130 0 110 850 10 0 0 0 0 0', 10, 20, 502)
    const network = computeStatusSample(first, second, SCALE).network
    expect([network?.rxPerSecond, network?.txPerSecond]).toEqual([0, 0])
  })
})

describe('appendStatusHistory', () => {
  const sample = computeStatusSample(
    null,
    frameOf('cpu  1 0 1 8 0 0 0 0 0 0', 0, 0, 1),
    SCALE
  ) satisfies ServerStatusSample

  it('按时间追加，只保留最近 5 分钟', () => {
    const now = 1_000_000_000
    const values = { cpu: 1, memory: 1, rx: 1, tx: 1, diskRead: 1, diskWrite: 1 }
    const old = { time: now - STATUS_HISTORY_WINDOW_MS - 1, ...values }
    const recent = { time: now - 1000, ...values }
    const next = appendStatusHistory([old, recent], now, sample)
    expect(next.map((p) => p.time)).toEqual([now - 1000, now])
    expect(next[1]).toEqual({
      time: now,
      cpu: null,
      memory: 25,
      rx: null,
      tx: null,
      diskRead: null,
      diskWrite: null
    })
  })
})

describe('withHistoryGaps', () => {
  const point = (time: number): StatusPoint => ({
    time,
    cpu: 1,
    memory: 1,
    rx: 1,
    tx: 1,
    diskRead: 1,
    diskWrite: 1
  })

  it('相隔超过 2.5 个刷新间隔时补一个全空的点，曲线在那里断开', () => {
    const gapped = withHistoryGaps([
      point(0),
      point(STATUS_INTERVAL_MS),
      point(STATUS_INTERVAL_MS * 10)
    ])
    expect(gapped.map((p) => [p.time, p.cpu])).toEqual([
      [0, 1],
      [STATUS_INTERVAL_MS, 1],
      [STATUS_INTERVAL_MS * 2, null],
      [STATUS_INTERVAL_MS * 10, 1]
    ])
  })
})

describe('byteRateAxis', () => {
  it('按盖住最大值的单位取 1 / 2 / 5 步长，刻度文字统一单位', () => {
    const kb = byteRateAxis(2.1 * 1024)
    expect(kb.ticks).toEqual([0, 1024, 2048, 3072])
    expect(kb.ticks.map(kb.label)).toEqual(['0 KB', '1 KB', '2 KB', '3 KB'])
    const mb = byteRateAxis(12.3 * 1024 ** 2)
    expect(mb.ticks.map(mb.label)).toEqual(['0 MB', '5 MB', '10 MB', '15 MB'])
  })

  it('空闲时按 1 KB 算，纵轴不缩成零点几字节', () => {
    const idle = byteRateAxis(0)
    expect(idle.ticks.map(idle.label)).toEqual(['0 KB', '0.5 KB', '1 KB'])
  })
})

describe('programName', () => {
  it('取命令行首个词的文件名，去掉改标题时的尾冒号', () => {
    expect(programName('/usr/bin/python3 app.py', 'MainThread')).toBe('python3')
    expect(programName('sshd: ubuntu@pts/0', 'sshd')).toBe('sshd')
  })

  it('没有命令行或是内核线程时用内核记录的名字', () => {
    expect(programName('', 'kworker/0:1')).toBe('kworker/0:1')
    expect(programName('[kcompactd0]', 'kcompactd0')).toBe('kcompactd0')
  })
})

describe('formatBootTime', () => {
  it('本地时间「年-月-日 时:分」，补零', () => {
    const epoch = new Date(2026, 4, 2, 9, 5, 30).getTime() / 1000
    expect(formatBootTime(epoch)).toBe('2026-05-02 09:05')
  })
})

describe('formatBytes / formatUptime', () => {
  it('字节按 1024 进位，B 取整，其余一位小数', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB')
  })

  it('开机时长按天 / 小时 / 分钟', () => {
    expect(formatUptime(90)).toBe('1 分钟')
    expect(formatUptime(3 * 3600 + 5 * 60)).toBe('3 小时 5 分钟')
    expect(formatUptime(12 * 86400 + 3 * 3600)).toBe('12 天 3 小时')
  })
})
