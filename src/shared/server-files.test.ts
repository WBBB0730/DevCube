import { describe, expect, it } from 'vitest'
import {
  SERVER_FILES_PREVIEW_MAX_BYTES,
  createConflictPolicy,
  normalizeRemotePath,
  remoteCwdFromPicked,
  resolveRemoteInput,
  serverOpenPlan,
  sftpOpenFailureMessage,
  uploadTargetDir,
  type TransferConflictResponse
} from './server-files'
import { FILES_TEXT_MAX_BYTES, FILES_XLSX_PREVIEW_MAX_BYTES } from './files'

const MB = 1024 * 1024

describe('serverOpenPlan', () => {
  it('文本：5 MB 以内直接读，超过占位且不能「仍然打开」', () => {
    expect(serverOpenPlan('text', FILES_TEXT_MAX_BYTES, false)).toEqual({ action: 'read-text' })
    expect(serverOpenPlan('text', FILES_TEXT_MAX_BYTES + 1, true)).toEqual({
      action: 'too-large',
      canForce: false
    })
  })

  it('Excel：10 MB 以内下载预览，超过占位且不能「仍然打开」', () => {
    expect(serverOpenPlan('xlsx', FILES_XLSX_PREVIEW_MAX_BYTES, false)).toEqual({
      action: 'download'
    })
    expect(serverOpenPlan('xlsx', 11 * MB, true)).toEqual({ action: 'too-large', canForce: false })
  })

  it('其余可预览类型：超过 10 MB 先占位，「仍然打开」照常下载', () => {
    for (const kind of ['image', 'pdf', 'pptx', 'audio', 'video'] as const) {
      expect(serverOpenPlan(kind, SERVER_FILES_PREVIEW_MAX_BYTES, false)).toEqual({
        action: 'download'
      })
      expect(serverOpenPlan(kind, SERVER_FILES_PREVIEW_MAX_BYTES + 1, false)).toEqual({
        action: 'too-large',
        canForce: true
      })
      expect(serverOpenPlan(kind, 500 * MB, true)).toEqual({ action: 'download' })
    }
  })

  it('不能预览的二进制：不下载', () => {
    expect(serverOpenPlan('other', 1, true)).toEqual({ action: 'unsupported' })
  })
})

describe('normalizeRemotePath / resolveRemoteInput', () => {
  it('折叠 . .. 与重复斜杠，保留反斜杠', () => {
    expect(normalizeRemotePath('/var//log/./nginx/../syslog')).toBe('/var/log/syslog')
    expect(normalizeRemotePath('/..')).toBe('/')
    expect(normalizeRemotePath('/srv/a\\b')).toBe('/srv/a\\b')
  })

  it('绝对路径与 ~ 开头的路径', () => {
    expect(resolveRemoteInput(' /etc/nginx/ ', '/home/u')).toBe('/etc/nginx')
    expect(resolveRemoteInput('~', '/home/u')).toBe('/home/u')
    expect(resolveRemoteInput('~/app/../logs', '/home/u')).toBe('/home/u/logs')
  })

  it('空、相对路径、~user 不接受', () => {
    expect(resolveRemoteInput('', '/home/u')).toBeNull()
    expect(resolveRemoteInput('etc', '/home/u')).toBeNull()
    expect(resolveRemoteInput('~root/x', '/home/u')).toBeNull()
  })
})

describe('remoteCwdFromPicked', () => {
  it('家目录写成空，即默认的登录后的目录', () => {
    expect(remoteCwdFromPicked('/home/u', '/home/u')).toBe('')
    expect(remoteCwdFromPicked('/home/u/', '/home/u')).toBe('')
  })

  it('家目录之下写成 ~/…', () => {
    expect(remoteCwdFromPicked('/home/u', '/home/u/apps/web')).toBe('~/apps/web')
  })

  it('其余为绝对路径；同前缀的兄弟目录不算家目录之下', () => {
    expect(remoteCwdFromPicked('/home/u', '/var/log')).toBe('/var/log')
    expect(remoteCwdFromPicked('/home/u', '/home/user2')).toBe('/home/user2')
    expect(remoteCwdFromPicked('/home/u', '/')).toBe('/')
  })

  it('家目录是根时，其下的都写成 ~/…', () => {
    expect(remoteCwdFromPicked('/', '/srv')).toBe('~/srv')
    expect(remoteCwdFromPicked('/', '/')).toBe('')
  })
})

describe('uploadTargetDir', () => {
  it('目录行即该目录，文件行即所在目录', () => {
    expect(uploadTargetDir({ path: '/srv/app', isDirectory: true })).toBe('/srv/app')
    expect(uploadTargetDir({ path: '/srv/app/a.txt', isDirectory: false })).toBe('/srv/app')
    expect(uploadTargetDir({ path: '/a.txt', isDirectory: false })).toBe('/')
  })
})

describe('createConflictPolicy', () => {
  const answer = (
    response: Omit<TransferConflictResponse, 'id'>
  ): { ask: () => Promise<TransferConflictResponse>; count: () => number } => {
    let asked = 0
    return {
      ask: async () => {
        asked++
        return { id: String(asked), ...response }
      },
      count: () => asked
    }
  }

  it('没勾「对其余同名项同样处理」：每个都问', async () => {
    const policy = createConflictPolicy()
    const a = answer({ action: 'skip', applyToRest: false })
    expect(await policy.resolve(a.ask)).toBe('skip')
    expect(await policy.resolve(a.ask)).toBe('skip')
    expect(a.count()).toBe(2)
  })

  it('勾了：之后照那次的选择处理，不再问', async () => {
    const policy = createConflictPolicy()
    const a = answer({ action: 'replace', applyToRest: true })
    expect(await policy.resolve(a.ask)).toBe('replace')
    expect(await policy.resolve(a.ask)).toBe('replace')
    expect(a.count()).toBe(1)
  })
})

describe('sftpOpenFailureMessage', () => {
  it('没启用 sftp 子系统、通道里混进别的输出时给明确原因，其余原样', () => {
    expect(sftpOpenFailureMessage(new Error('Unable to start subsystem: sftp'))).toBe(
      '服务器没有启用 SFTP，无法管理文件'
    )
    expect(
      sftpOpenFailureMessage({ message: 'Invalid packet length', level: 'sftp-protocol' })
    ).toBe('服务器返回了无法识别的数据，可能是登录脚本往 SFTP 通道里输出了内容')
    expect(sftpOpenFailureMessage(new Error('No response from server'))).toBe(
      'No response from server'
    )
  })
})
