import { describe, expect, it } from 'vitest'
import {
  changelogVersionOf,
  findChangelogEntry,
  parseChangelog,
  pickChangelogEntries,
  previewChangelog,
  type ChangelogEntry
} from './changelog'

const CHANGELOG = `# 更新日志

## 未发布

- 草稿

## [1.10.0] - 2026-09-25

- 支持 Excel 预览
- 修复 Git 自动刷新

## 1.9.0

- 支持 PPT 预览

## [1.8.0-beta.1]

- 带 prerelease 的标题不算版本段

## [1.8.0] - 2026-09-22

- 支持克隆项目

\`\`\`
## 9.9.9
\`\`\`

## [1.6.0] - 2026-09-20

- 支持 PDF 预览
`

function entry(version: string): ChangelogEntry {
  return { version, date: null, body: '' }
}

function versions(entries: ChangelogEntry[]): string[] {
  return entries.map((e) => e.version)
}

describe('parseChangelog', () => {
  it('按正式版号二级标题切段，日期与方括号可省', () => {
    const entries = parseChangelog(CHANGELOG)
    expect(versions(entries)).toEqual(['1.10.0', '1.9.0', '1.8.0', '1.6.0'])
    expect(entries[0]).toEqual({
      version: '1.10.0',
      date: '2026-09-25',
      body: '- 支持 Excel 预览\n- 修复 Git 自动刷新'
    })
    expect(entries[1]).toEqual({ version: '1.9.0', date: null, body: '- 支持 PPT 预览' })
  })

  it('代码块里的井号不算标题，正文原样保留', () => {
    const entries = parseChangelog(CHANGELOG)
    expect(entries[2]!.body).toBe('- 支持克隆项目\n\n```\n## 9.9.9\n```')
  })

  it('带链接定义的标题同样识别', () => {
    const md = '## [1.2.0] - 2026-01-02\n\n- a\n\n[1.2.0]: https://example.com/v1.2.0\n'
    expect(parseChangelog(md)[0]).toMatchObject({ version: '1.2.0', date: '2026-01-02' })
  })

  it('同一版本写了多段只取第一段；空文件无段落', () => {
    expect(parseChangelog('## 1.0.0\n\n- a\n\n## 1.0.0\n\n- b\n')).toEqual([
      { version: '1.0.0', date: null, body: '- a' }
    ])
    expect(parseChangelog('')).toEqual([])
  })
})

describe('changelogVersionOf', () => {
  it('Beta 取同号正式版', () => {
    expect(changelogVersionOf('1.10.0-beta.1')).toBe('1.10.0')
    expect(changelogVersionOf('1.10.0')).toBe('1.10.0')
    expect(changelogVersionOf('not-a-version')).toBeNull()
  })
})

describe('pickChangelogEntries', () => {
  const entries = [entry('1.6.0'), entry('1.10.0'), entry('1.8.0'), entry('1.9.0')]

  it('当前版本之后、到目标版本为止，新在上', () => {
    expect(versions(pickChangelogEntries(entries, '1.8.0', '1.10.0'))).toEqual(['1.10.0', '1.9.0'])
  })

  it('没写日志的版本跳过', () => {
    expect(versions(pickChangelogEntries(entries, '1.5.1', '1.9.0'))).toEqual([
      '1.9.0',
      '1.8.0',
      '1.6.0'
    ])
  })

  it('Beta 两端都按正式版号比', () => {
    expect(versions(pickChangelogEntries(entries, '1.8.0-beta.1', '1.10.0-beta.1'))).toEqual([
      '1.10.0',
      '1.9.0'
    ])
    expect(pickChangelogEntries(entries, '1.10.0-beta.1', '1.10.0-beta.2')).toEqual([])
  })

  it('非法版本不挑', () => {
    expect(pickChangelogEntries(entries, 'x', '1.10.0')).toEqual([])
  })
})

describe('findChangelogEntry', () => {
  it('Beta tag 取同号正式版那段；没写为 null', () => {
    const entries = parseChangelog(CHANGELOG)
    expect(findChangelogEntry(entries, '1.10.0-beta.1')?.body).toBe(
      '- 支持 Excel 预览\n- 修复 Git 自动刷新'
    )
    expect(findChangelogEntry(entries, '1.7.0')).toBeNull()
  })
})

describe('previewChangelog', () => {
  const entries = [entry('1.9.0'), entry('1.10.0'), entry('1.11.0')]

  it('比当前版本新的全部段落，目标取最新一段', () => {
    expect(previewChangelog(entries, '1.9.0')).toEqual({
      targetVersion: '1.11.0',
      changelog: [entry('1.11.0'), entry('1.10.0')]
    })
  })

  it('一段都没写时目标为当前版本 +1 补丁号', () => {
    expect(previewChangelog(entries, '1.11.0')).toEqual({
      targetVersion: '1.11.1',
      changelog: []
    })
    expect(previewChangelog(entries, '1.11.0-beta.1').targetVersion).toBe('1.11.1')
  })
})
