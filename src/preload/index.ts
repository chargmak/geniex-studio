import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

/**
 * Minimal, explicit bridge. Everything data-related goes over same-origin HTTP (/api); the bridge only exposes
 * shell-level affordances the web platform cannot provide.
 */
const studio = {
  isElectron: true as const,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('studio:open-external', url),
  showOpenDialog: (opts: {
    title?: string
    filters?: { name: string; extensions: string[] }[]
    properties?: ('openFile' | 'openDirectory' | 'multiSelections')[]
  }): Promise<string[]> => ipcRenderer.invoke('studio:show-open-dialog', opts),
  window: {
    minimize: (): void => ipcRenderer.send('studio:window', 'minimize'),
    toggleMaximize: (): void => ipcRenderer.send('studio:window', 'toggle-maximize'),
    close: (): void => ipcRenderer.send('studio:window', 'close'),
  },
}

export type StudioBridge = typeof studio

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('studio', studio)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.studio = studio
}
