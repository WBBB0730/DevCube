import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { parsePreviewLaunch } from '@shared/preview-window'
import { parseCompressLaunch } from '@shared/compress'
import App from './App'
import { CompressWindow } from './components/CompressWindow'
import { PreviewWindow } from './components/PreviewWindow'
import { syncAppPrefsAcrossWindows, syncThemeWithSystem } from './store'

// 同一渲染入口、三种窗口：主进程按查询串决定挂工作台、Preview Window（shared/preview-window）
// 还是压缩窗口（shared/compress）。
const preview = parsePreviewLaunch(window.location.search)
const compress = parseCompressLaunch(window.location.search)
syncThemeWithSystem()
syncAppPrefsAcrossWindows()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {compress ? (
      <CompressWindow launch={compress} />
    ) : preview ? (
      <PreviewWindow launch={preview} />
    ) : (
      <App />
    )}
  </StrictMode>
)
