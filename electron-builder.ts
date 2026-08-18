import { createRequire } from 'node:module'
import type { Configuration } from 'electron-builder'
import { resolveReleaseEdition } from './src/shared/release-edition'

const { version: pkgVersion } = createRequire(import.meta.url)('./package.json') as {
  version: string
}

/**
 * BUILD_CHANNEL=beta（`pnpm build:beta`）：版本号保持当前值，仅在非 beta 时追加 -beta.1
 * 以派生 Beta 身份（Release Edition 由 semver 决定）。正式发版仍以 bumpp 写入
 * package.json 的版本为准，CI 不使用该变量。
 */
function resolveBuildVersion(version: string): string {
  if (process.env.BUILD_CHANNEL !== 'beta' || version.includes('-')) return version
  return `${version}-beta.1`
}

const version = resolveBuildVersion(pkgVersion)
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
    productName: edition.productName,
    // 覆写进 app 的版本（BUILD_CHANNEL=beta 派生版号时运行时 app.getVersion() 须一致）
    version
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
  // External Open deep link：scheme 按 Edition 分线（devcube / devcube-beta，ADR-0025）。
  // macOS 写入 Info.plist CFBundleURLTypes；Windows 由运行时 setAsDefaultProtocolClient 注册。
  protocols: [{ name: edition.productName, schemes: [edition.name] }],
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
    createDesktopShortcut: 'always',
    // Beta 的 buildResources 是 build/beta，显式固定共用同一份钩子脚本
    include: 'build/installer.nsh'
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
    category: 'Utility',
    // 文件管理器「用其他应用打开」对目录可见（External Open 的 Linux 投影）
    mimeTypes: ['inode/directory']
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
