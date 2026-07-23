import { createRequire } from 'node:module'
import type { Configuration } from 'electron-builder'
import { resolveReleaseEdition } from './src/shared/release-edition'

const { version } = createRequire(import.meta.url)('./package.json') as { version: string }
const edition = resolveReleaseEdition(version)
const releaseBuild = process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REF_TYPE === 'tag'

const config: Configuration = {
  appId: edition.appId,
  productName: edition.productName,
  directories: {
    buildResources: edition.buildResources
  },
  icon: edition.icon,
  extraMetadata: {
    name: edition.name,
    productName: edition.productName
  },
  files: [
    '!**/.vscode/*',
    '!src/*',
    '!electron.vite.config.{js,ts,mjs,cjs}',
    '!electron-builder.{js,ts,mjs,cjs}',
    '!{.eslintcache,eslint.config.mjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}',
    '!{.env,.env.*,.npmrc,pnpm-lock.yaml}',
    '!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}'
  ],
  asarUnpack: ['resources/**', '**/{@parcel/watcher,@parcel/watcher-*}/**'],
  win: {
    executableName: edition.executableName,
    icon: edition.winIcon,
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] }
    ]
  },
  nsis: {
    artifactName: '${name}-${version}-setup.${ext}',
    shortcutName: '${productName}',
    uninstallDisplayName: '${productName}',
    createDesktopShortcut: 'always'
  },
  portable: {
    artifactName: '${name}-${version}-portable.${ext}'
  },
  mac: {
    forceCodeSigning: releaseBuild,
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    notarize: releaseBuild,
    // 更新制品名必须无空格：GitHub Release 会把空格改成 `.`，而 latest-mac.yml 常写成 `-`，
    // productName「DevCube Beta」作默认 zip 名会让 url 与资产对不上（ADR-0015）。
    // 用 ${name}（devcube / devcube-beta）与 Win / dmg 一致；显示名仍走 productName。
    artifactName: '${name}-${version}-${arch}-mac.${ext}',
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] }
    ],
    extendInfo: {
      NSCameraUsageDescription: "Application requests access to the device's camera.",
      NSMicrophoneUsageDescription: "Application requests access to the device's microphone.",
      NSDocumentsFolderUsageDescription:
        "Application requests access to the user's Documents folder.",
      NSDownloadsFolderUsageDescription:
        "Application requests access to the user's Downloads folder."
    }
  },
  dmg: {
    artifactName: '${name}-${version}.${ext}'
  },
  linux: {
    target: ['AppImage', 'snap', 'deb'],
    maintainer: 'WBBB',
    category: 'Utility'
  },
  appImage: {
    artifactName: '${name}-${version}.${ext}'
  },
  npmRebuild: false,
  publish: {
    provider: 'github',
    owner: 'WBBB0730',
    repo: 'DevCube'
  },
  electronDownload: {
    mirror: 'https://npmmirror.com/mirrors/electron/'
  }
}

export default config
