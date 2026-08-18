import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { UpdateState } from '@shared/update'
import type { UpdateService } from './updater'

/** Push channel: main → every renderer, whenever the updater's state changes. */
export const UPDATE_CHANGED = 'studio:update:changed'

export function broadcastUpdateState(state: UpdateState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(UPDATE_CHANGED, state)
  }
}

/** IPC handlers backing the preload `window.studio` bridge. */
export function registerIpc(updater: UpdateService): void {
  ipcMain.handle('studio:open-external', async (_e, url: unknown) => {
    if (typeof url !== 'string') return
    if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) return
    await shell.openExternal(url)
  })

  ipcMain.handle('studio:show-open-dialog', async (e, opts: Electron.OpenDialogOptions) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = win ? await dialog.showOpenDialog(win, opts ?? {}) : await dialog.showOpenDialog(opts ?? {})
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.on('studio:window', (e, action: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (action === 'minimize') win.minimize()
    else if (action === 'toggle-maximize') (win.isMaximized() ? win.unmaximize() : win.maximize())
    else if (action === 'close') win.close()
  })

  ipcMain.handle('studio:update:get', () => updater.get())
  ipcMain.handle('studio:update:check', () => updater.check())
  ipcMain.handle('studio:update:download', () => updater.download())
  ipcMain.handle('studio:update:install', () => updater.install())
}
