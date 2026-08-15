import { BrowserWindow, dialog, ipcMain, shell } from 'electron'

/** IPC handlers backing the preload `window.studio` bridge. */
export function registerIpc(): void {
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
}
