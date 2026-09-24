import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { findChangelogEntry, parseChangelog } from '../src/shared/changelog'
import { resolveReleaseEdition } from '../src/shared/release-edition'

const tag = process.argv[2]
const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

if (tag !== `v${version}`) {
  throw new Error(`Tag ${tag ?? '(missing)'} does not match package.json version ${version}`)
}

// Release 正文 = CHANGELOG.md 里这一版那段（Beta 取同号正式版）；没写就留空。
const changelog = parseChangelog(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'))
const notes = findChangelogEntry(changelog, version)?.body ?? ''
// 多行输出按 GitHub 文档写成 heredoc，分隔符随机，避免与正文撞车
const delimiter = `NOTES_${randomUUID()}`

process.stdout.write(`prerelease=${resolveReleaseEdition(version).prerelease}\n`)
process.stdout.write(`notes<<${delimiter}\n${notes}\n${delimiter}\n`)
