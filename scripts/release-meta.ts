import { createRequire } from 'node:module'
import { resolveReleaseEdition } from '../src/shared/release-edition'

const tag = process.argv[2]
const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

if (tag !== `v${version}`) {
  throw new Error(`Tag ${tag ?? '(missing)'} does not match package.json version ${version}`)
}

process.stdout.write(`prerelease=${resolveReleaseEdition(version).prerelease}\n`)
