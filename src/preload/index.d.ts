import { ElectronAPI } from '@electron-toolkit/preload'
import type { RunAPI } from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: RunAPI
  }
}
