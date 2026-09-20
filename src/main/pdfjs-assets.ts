import { app } from 'electron'
import path from 'node:path'

/**
 * PDF.js 运行期静态资源（字体映射表 / 标准字体 / wasm 解码器）的根目录（ADR-0030）。
 * 开发态直接读 node_modules；打包后由 electron-builder extraResources 复制到 resources/pdfjs。
 * 渲染层经 dc-media 协议 `a=pdfjs&f=<相对路径>` 读取；只放行这三个子目录。
 */
export const PDFJS_ASSET_DIRS = ['cmaps', 'standard_fonts', 'wasm'] as const

export function pdfjsAssetRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'pdfjs')
    : path.join(app.getAppPath(), 'node_modules', 'pdfjs-dist')
}

export function isPdfjsAssetPath(rel: string): boolean {
  return PDFJS_ASSET_DIRS.some((dir) => rel.startsWith(`${dir}/`))
}

const ASSET_MIME: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf'
}

export function pdfjsAssetMime(rel: string): string {
  return ASSET_MIME[path.extname(rel).toLowerCase()] ?? 'application/octet-stream'
}
