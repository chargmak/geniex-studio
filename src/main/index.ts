import { app, BrowserWindow, shell, nativeTheme } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { APP_ID, APP_NAME } from '@shared/config'
import { boot, type Booted } from './bootstrap'
import { registerIpc } from './ipc'
import { createTray, destroyTray } from './tray'

const HEADLESS = process.argv.includes('--headless')

let mainWindow: BrowserWindow | null = null
let booted: Booted | null = null
let quitting = false

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
  win.on('close', (e) => {
    if (quitting || HEADLESS) return
    if (booted?.ctx.settings.get().ui.closeToTray) {
      e.preventDefault()
      win.hide()
    }
  })
  win.on('closed', () => {
    mainWindow = null
  })

  // In dev the renderer comes from Vite (HMR); its /api calls are proxied to our server (see electron.vite.config.ts).
  if (process.env['ELECTRON_RENDERER_URL']) {
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

  booted = await boot({
    mode: 'electron',
    version: app.getVersion(),
    dataDir: app.getPath('userData'),
    // Only the electron-vite dev server sets ELECTRON_RENDERER_URL; preview and packaged builds serve out/renderer.
    rendererDir: process.env['ELECTRON_RENDERER_URL'] ? undefined : join(__dirname, '../renderer'),
    sidecarSourceDir: app.isPackaged ? join(process.resourcesPath, 'sidecar') : join(app.getAppPath(), 'sidecar'),
  })
  const server = booted.server

  if (HEADLESS) {
    console.log(`[studio] headless mode — open ${server.url} in a browser`)
    return
  }

  mainWindow = createWindow(server.url)
  const showWindow = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow(booted!.server.url)
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
  createTray(booted, () => mainWindow, showWindow, () => {
    quitting = true
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && booted) mainWindow = createWindow(booted.server.url)
  })
})

app.on('window-all-closed', () => {
  // With close-to-tray the window is hidden, not closed; only quit when the user really closed it.
  if (!HEADLESS && !booted?.ctx.settings.get().ui.closeToTray) app.quit()
})

let shuttingDown = false
app.on('before-quit', (e) => {
  quitting = true
  if (shuttingDown || !booted) return
  e.preventDefault()
  shuttingDown = true
  destroyTray()
  void booted
    .shutdown()
    .catch(() => {})
    .finally(() => app.quit())
})
