import { app } from 'electron'
import path from 'node:path'
import { FILES_ASSET_PDFJS, FILES_ASSET_XLSX, FILES_XLSX_WASM } from '../shared/files'

/**
 * 应用自带的运行期静态资源包。生产态渲染层是 `file://`，fetch / XHR 都碰不到本地文件，所以经 dc-media 协议
 * `a=<包名>&f=<相对路径>` 读取；每个包只放行声明过的路径。
 * 开发态直接读 node_modules；打包后由 electron-builder extraResources 复制到 resources/<包名>。
 * - pdfjs：PDF.js 的字体映射表 / 标准字体 / wasm 解码器（ADR-0030）
 * - xlsx：表格预览解析用的 WebAssembly（@dukelib/sheets-wasm，ADR-0034）
 */
const APP_ASSET_BUNDLES: Record<string, { devDir: string[]; allow: (rel: string) => boolean }> = {
  [FILES_ASSET_PDFJS]: {
    devDir: ['pdfjs-dist'],
    allow: (rel) => ['cmaps/', 'standard_fonts/', 'wasm/'].some((dir) => rel.startsWith(dir))
  },
  [FILES_ASSET_XLSX]: {
    devDir: ['@dukelib', 'sheets-wasm'],
    allow: (rel) => rel === FILES_XLSX_WASM
  }
}

/** 资源包根目录；包名未知或路径不在放行范围内为 null */
export function appAssetRoot(bundle: string, rel: string): string | null {
  const def = APP_ASSET_BUNDLES[bundle]
  if (!def || !def.allow(rel)) return null
  return app.isPackaged
    ? path.join(process.resourcesPath, bundle)
    : path.join(app.getAppPath(), 'node_modules', ...def.devDir)
}

const ASSET_MIME: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf'
}

export function appAssetMime(rel: string): string {
  return ASSET_MIME[path.extname(rel).toLowerCase()] ?? 'application/octet-stream'
}
