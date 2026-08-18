import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { UpdateState } from '@shared/update'

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
  /** Auto-update (electron-updater). Absent in browser mode; `state.supported` is false in dev builds. */
  updates: {
    get: (): Promise<UpdateState> => ipcRenderer.invoke('studio:update:get'),
    check: (): Promise<UpdateState> => ipcRenderer.invoke('studio:update:check'),
    download: (): Promise<UpdateState> => ipcRenderer.invoke('studio:update:download'),
    /** Quits and hands over to the installer; resolves false if nothing has been downloaded. */
    install: (): Promise<boolean> => ipcRenderer.invoke('studio:update:install'),
    /** Subscribe to state changes; returns an unsubscribe function. */
    onChange: (cb: (state: UpdateState) => void): (() => void) => {
      const listener = (_e: unknown, state: UpdateState): void => cb(state)
      ipcRenderer.on('studio:update:changed', listener)
      return () => ipcRenderer.removeListener('studio:update:changed', listener)
    },
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
