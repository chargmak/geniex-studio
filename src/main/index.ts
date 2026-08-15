import { app, BrowserWindow, shell, nativeTheme } from 'electron'
import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { APP_ID, APP_NAME } from '@shared/config'
import { boot } from './bootstrap'
import { registerIpc } from './ipc'
import type { StudioServer } from './server/app'

const HEADLESS = process.argv.includes('--headless')

let mainWindow: BrowserWindow | null = null
let server: StudioServer | null = null

// Single instance: a second launch focuses the existing window instead of starting another server.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

function createWindow(url: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: APP_NAME,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#151516' : '#fafbfc',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#151516',
      symbolColor: '#ffffff8c',
      height: 40,
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target)
    return { action: 'deny' }
  })
  win.on('closed', () => {
    mainWindow = null
  })

  // In dev the renderer comes from Vite (HMR); its /api calls are proxied to our server (see electron.vite.config.ts).
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadURL(url)
  }
  return win
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId(APP_ID)
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  registerIpc()

  const booted = await boot({
    mode: 'electron',
    version: app.getVersion(),
    dataDir: app.getPath('userData'),
    rendererDir: is.dev ? undefined : join(__dirname, '../renderer'),
  })
  server = booted.server

  if (HEADLESS) {
    console.log(`[studio] headless mode — open ${server.url} in a browser`)
    return
  }

  mainWindow = createWindow(server.url)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && server) mainWindow = createWindow(server.url)
  })
})

app.on('window-all-closed', () => {
  if (!HEADLESS) app.quit()
})

app.on('before-quit', () => {
  void server?.close().catch(() => {})
})
