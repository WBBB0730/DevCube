import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // original-fs 是 Electron 内置模块（不带 asar 改装的原版 fs），运行时由 Electron 提供，不参与打包
    build: { rollupOptions: { external: ['original-fs'] } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()],
    // react-xlsx 自带的解析线程是 ES 模块线程且内有动态 import，默认的 iife 打不了（预览虽不用该线程，打包仍要过它）
    worker: { format: 'es' }
  }
})
