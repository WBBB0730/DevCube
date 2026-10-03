import { describe, expect, it } from 'vitest'
import {
  archiveEntryName,
  archiveNameError,
  buildCompressQuery,
  commonParentPath,
  compressSubject,
  defaultArchiveName,
  isMacJunkDirName,
  isMacJunkHeader,
  macJunkFileKind,
  nextFreeArchiveName,
  parseCompressLaunch,
  visibleCompressOptions
} from './compress'

describe('commonParentPath', () => {
  it('单个条目取所在文件夹', () => {
    expect(commonParentPath(['/Users/me/报告/a.pdf'])).toBe('/Users/me/报告')
    expect(commonParentPath(['/Users/me/web'])).toBe('/Users/me')
  })

  it('同一文件夹里多选取该文件夹；跨子文件夹多选取共同上层', () => {
    expect(commonParentPath(['/w/报告/a.pdf', '/w/报告/b'])).toBe('/w/报告')
    expect(commonParentPath(['/w/报告/x/a.pdf', '/w/报告/y/b.pdf'])).toBe('/w/报告')
    expect(commonParentPath(['/w/报告/x/a.pdf', '/w/报告/b.pdf'])).toBe('/w/报告')
  })

  it('Windows 路径与根', () => {
    expect(commonParentPath(['C:\\w\\a.txt', 'C:\\w\\sub\\b.txt'])).toBe('C:/w')
    expect(commonParentPath(['/a', '/b'])).toBe('/')
  })
})

describe('defaultArchiveName', () => {
  it('单个文件保留扩展名，单个文件夹取名字', () => {
    expect(defaultArchiveName(['/w/report.pdf'], '/w')).toBe('report.pdf')
    expect(defaultArchiveName(['/w/web'], '/w')).toBe('web')
  })

  it('多选取共同上层文件夹的名字；上层是根时退回「归档」', () => {
    expect(defaultArchiveName(['/w/报告/a', '/w/报告/b'], '/w/报告')).toBe('报告')
    expect(defaultArchiveName(['/a', '/b'], '/')).toBe('归档')
    expect(defaultArchiveName(['C:/a', 'C:/b'], 'C:/')).toBe('归档')
  })
})

describe('nextFreeArchiveName', () => {
  it('没被占用就用原名，被占用依次加「 (2)」「 (3)」（同终端编号），不区分大小写', () => {
    expect(nextFreeArchiveName('报告', ['other.zip'])).toBe('报告')
    expect(nextFreeArchiveName('报告', ['报告.zip'])).toBe('报告 (2)')
    expect(nextFreeArchiveName('Web', ['web.ZIP', 'Web (2).zip'])).toBe('Web (3)')
    // 同名的文件夹不占用包名
    expect(nextFreeArchiveName('web', ['web'])).toBe('web')
  })
})

describe('archiveNameError', () => {
  it('空名、. 与 ..', () => {
    expect(archiveNameError('  ', 'darwin')).toBe('请输入名称')
    expect(archiveNameError('..', 'darwin')).toBe('名称不合法')
  })

  it('macOS / Linux 只禁 /，Windows 另禁保留字符', () => {
    expect(archiveNameError('a/b', 'darwin')).toBe('名称不能包含 /')
    expect(archiveNameError('a:b', 'darwin')).toBeNull()
    expect(archiveNameError('a:b', 'win32')).not.toBeNull()
    expect(archiveNameError('a\\b', 'win32')).not.toBeNull()
    expect(archiveNameError('报告 2', 'win32')).toBeNull()
  })
})

describe('Mac 专属文件', () => {
  it('__MACOSX 文件夹按名字认', () => {
    expect(isMacJunkDirName('__MACOSX')).toBe(true)
    expect(isMacJunkDirName('MACOSX')).toBe(false)
  })

  it('名字像的才去看文件头', () => {
    expect(macJunkFileKind('.DS_Store')).toBe('dsStore')
    expect(macJunkFileKind('._a.txt')).toBe('appleDouble')
    expect(macJunkFileKind('.gitignore')).toBeNull()
    expect(macJunkFileKind('DS_Store')).toBeNull()
  })

  it('文件头对得上才算（取自本机 Finder 生成的真实文件）', () => {
    const dsStore = Uint8Array.from([0x00, 0x00, 0x00, 0x01, 0x42, 0x75, 0x64, 0x31])
    const appleDouble = Uint8Array.from([0x00, 0x05, 0x16, 0x07, 0x00, 0x02, 0x00, 0x00])
    const plain = new TextEncoder().encode('not mac')
    expect(isMacJunkHeader('dsStore', dsStore)).toBe(true)
    expect(isMacJunkHeader('appleDouble', appleDouble)).toBe(true)
    expect(isMacJunkHeader('appleDouble', plain)).toBe(false)
    expect(isMacJunkHeader('dsStore', appleDouble)).toBe(false)
    expect(isMacJunkHeader('appleDouble', Uint8Array.from([0x00, 0x05]))).toBe(false)
  })
})

describe('勾选框', () => {
  const none = { hasRepo: false, hasDotGit: false, hasMacJunk: false }

  it('出现条件：内容在仓库里或含仓库 / 有 .git / 有 Mac 专属文件', () => {
    expect(visibleCompressOptions(none)).toEqual({
      excludeIgnored: false,
      excludeGit: false,
      excludeMacJunk: false
    })
    expect(visibleCompressOptions({ ...none, hasMacJunk: true }).excludeMacJunk).toBe(true)
    expect(visibleCompressOptions({ hasRepo: true, hasDotGit: true, hasMacJunk: false })).toEqual({
      excludeIgnored: true,
      excludeGit: true,
      excludeMacJunk: false
    })
  })
})

describe('包内路径与窗口参数', () => {
  it('相对共同上层文件夹', () => {
    expect(archiveEntryName('/w', '/w/web/src/a.ts')).toBe('web/src/a.ts')
    expect(archiveEntryName('/', '/a.txt')).toBe('a.txt')
    expect(archiveEntryName('C:/w', 'C:\\w\\a.txt')).toBe('a.txt')
  })

  it('标题里的名字', () => {
    expect(compressSubject(['/w/web'])).toBe('web')
    expect(compressSubject(['/w/a', '/w/b', '/w/c'])).toBe('3 项')
  })

  it('查询串往返', () => {
    const launch = { subject: '报告', dir: '/w/a b', name: '报告 2' }
    const search = '?' + new URLSearchParams(buildCompressQuery(launch)).toString()
    expect(parseCompressLaunch(search)).toEqual(launch)
    expect(parseCompressLaunch('?mode=compress&subject=x')).toBeNull()
    expect(parseCompressLaunch('?mode=preview&root=%2F')).toBeNull()
  })
})
