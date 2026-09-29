import { describe, expect, it } from 'vitest'
import {
  SFTP_MAX_INFLIGHT,
  SFTP_STATUS,
  SftpTransferPlan,
  SftpWindow,
  sftpEntryKind,
  sftpStatusMessage
} from './sftp'

describe('sftpEntryKind', () => {
  it('按权限位的文件类型', () => {
    expect(sftpEntryKind({ permissions: 0o40755 })).toBe('directory')
    expect(sftpEntryKind({ permissions: 0o120777 })).toBe('symlink')
    expect(sftpEntryKind({ permissions: 0o100644 })).toBe('file')
    expect(sftpEntryKind({ permissions: 0o20620 })).toBe('other')
    expect(sftpEntryKind({})).toBe('file')
  })
})

describe('sftpStatusMessage', () => {
  it('常见状态码给中文原因，其余用服务器的说明', () => {
    expect(sftpStatusMessage(SFTP_STATUS.NO_SUCH_FILE, 'No such file')).toBe('文件或文件夹不存在')
    expect(sftpStatusMessage(SFTP_STATUS.PERMISSION_DENIED, 'Permission denied')).toBe('没有权限')
    expect(sftpStatusMessage(SFTP_STATUS.FAILURE, 'Failure')).toBe('操作失败')
    expect(sftpStatusMessage(42, 'Quota exceeded')).toBe('Quota exceeded')
    expect(sftpStatusMessage(42, '')).toBe('操作失败（SFTP 状态码 42）')
  })
})

describe('SftpTransferPlan', () => {
  const drain = (plan: SftpTransferPlan): { offset: number; length: number }[] => {
    const out: { offset: number; length: number }[] = []
    for (let r = plan.take(); r !== null; r = plan.take()) out.push(r)
    return out
  }

  it('按块顺序切分，末块取余下的', () => {
    expect(drain(new SftpTransferPlan(10, 4))).toEqual([
      { offset: 0, length: 4 },
      { offset: 4, length: 4 },
      { offset: 8, length: 2 }
    ])
    expect(drain(new SftpTransferPlan(0, 4))).toEqual([])
  })

  it('短读的余下部分优先补读', () => {
    const plan = new SftpTransferPlan(12, 4)
    const first = plan.take()!
    plan.shortRead(first.offset, first.length, 1)
    expect(plan.take()).toEqual({ offset: 1, length: 3 })
    expect(plan.take()).toEqual({ offset: 4, length: 4 })
    plan.shortRead(4, 4, 4)
    expect(plan.take()).toEqual({ offset: 8, length: 4 })
    expect(plan.take()).toBeNull()
  })

  it('读到文件尾：不再出更靠后的块，补读裁到文件尾', () => {
    const plan = new SftpTransferPlan(16, 4)
    plan.take()
    const second = plan.take()!
    plan.shortRead(second.offset, second.length, 1)
    plan.endAt(6)
    expect(plan.size).toBe(6)
    expect(plan.take()).toEqual({ offset: 5, length: 1 })
    expect(plan.take()).toBeNull()
  })
})

describe('SftpWindow', () => {
  it('从 1 块起步；不排队时每个回复加一块，至多 SFTP_MAX_INFLIGHT', () => {
    const w = new SftpWindow()
    expect(w.size).toBe(1)
    w.observe(40)
    for (let i = 0; i < 100; i++) w.adapt(40)
    expect(w.size).toBe(SFTP_MAX_INFLIGHT)
  })

  it('排着的块数在 1 与 2 之间时不动', () => {
    const w = new SftpWindow()
    w.observe(40)
    for (let i = 0; i < 7; i++) w.adapt(40)
    expect(w.size).toBe(8)
    // 8 × (1 − 40 / 50) = 1.6 块
    w.adapt(50)
    expect(w.size).toBe(8)
  })

  it('排队多了就减，最少 1 块', () => {
    const w = new SftpWindow()
    w.observe(40)
    for (let i = 0; i < 7; i++) w.adapt(40)
    // 8 × (1 − 40 / 400) = 7.2 块
    for (let i = 0; i < 20; i++) w.adapt(400)
    expect(w.size).toBe(2)
    // 慢线路：一块本身就要传很久，窗口停在一两块
    const slow = new SftpWindow()
    slow.observe(40)
    for (let i = 0; i < 20; i++) slow.adapt(1100)
    expect(slow.size).toBeLessThanOrEqual(2)
    expect(slow.size).toBeGreaterThanOrEqual(1)
  })

  it('基准取见过的最短往返（小请求也算）', () => {
    const w = new SftpWindow()
    w.adapt(100)
    w.adapt(100)
    expect(w.size).toBe(3)
    // 小请求见到更短的往返：原来的 100 其实排着队
    w.observe(10)
    // 3 × (1 − 10 / 100) = 2.7 块
    w.adapt(100)
    expect(w.size).toBe(2)
  })
})
