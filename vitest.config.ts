import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // 与 electron.vite.config.ts / tsconfig.web.json 的别名保持一致（渲染端纯函数测试用）。
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
      // Electron 内置的原版 fs（不带 asar 改装）；测试跑在普通 Node 里，它就是 node:fs
      'original-fs': 'node:fs'
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
