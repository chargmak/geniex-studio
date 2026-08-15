import type { ElectronAPI } from '@electron-toolkit/preload'
import type { StudioBridge } from './index'

declare global {
  interface Window {
    electron?: ElectronAPI
    /** Present only inside the Electron shell; absent in browser/headless mode. */
    studio?: StudioBridge
  }
}

export {}
