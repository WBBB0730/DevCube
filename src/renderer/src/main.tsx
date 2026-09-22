import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { parsePreviewLaunch } from '@shared/preview-window'
import App from './App'
import { PreviewWindow } from './components/PreviewWindow'
import { syncThemeWithSystem } from './store'

// 同一渲染入口、两种窗口：主进程按查询串决定挂工作台还是 Preview Window（shared/preview-window）。
const preview = parsePreviewLaunch(window.location.search)
syncThemeWithSystem()

createRoot(document.getElementById('root')!).render(
  <StrictMode>{preview ? <PreviewWindow launch={preview} /> : <App />}</StrictMode>
)
