import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      // 依赖默认外部化；p-limit 只有 ES 模块且是默认导出，打进包里——主进程产物是 CommonJS，外部化后 require
      // 拿到的是模块命名空间，取不到默认导出
      externalizeDeps: { exclude: ['p-limit'] },
      // original-fs 是 Electron 内置模块（不带 asar 改装的原版 fs），运行时由 Electron 提供，不参与打包
      rollupOptions: { external: ['original-fs'] }
    }
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
