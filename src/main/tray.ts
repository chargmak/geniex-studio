import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import type { Booted } from './bootstrap'
import type { UpdateService } from './updater'

let tray: Tray | null = null
let rebuildMenu: (() => void) | null = null

/** System tray: show/hide window, GenieX server controls, updates, quit. Keeps the app (and server) alive when closed to tray. */
export function createTray(booted: Booted, updater: UpdateService, getWindow: () => BrowserWindow | null, showWindow: () => void, quit: () => void): Tray {
  const iconPath = join(app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources'), 'tray.png')
  let icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) icon = nativeImage.createFromPath(join(__dirname, '../../resources/tray.png'))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)

  const rebuild = (): void => {
    if (!tray || tray.isDestroyed()) return
    const st = booted.ctx.genie.status()
    const running = st.state === 'running'
    const upd = updater.get()
    tray.setToolTip(upd.status === 'downloaded' ? `GenieX Studio — update ${upd.availableVersion} ready` : 'GenieX Studio')
    const menu = Menu.buildFromTemplate([
      { label: 'Open GenieX Studio', click: showWindow },
      { type: 'separator' },
      { label: `GenieX server: ${st.state}${st.residentModel ? ` · ${st.residentModel.split('/').pop()}` : ''}`, enabled: false },
      running ? { label: 'Restart server', click: () => void booted.ctx.genie.restart().catch(() => {}) } : { label: 'Start server', click: () => void booted.ctx.genie.start().catch(() => {}) },
      { label: 'Stop server', enabled: running, click: () => void booted.ctx.genie.stop() },
      { type: 'separator' },
      ...updateItems(updater, showWindow),
      { type: 'separator' },
      { label: 'Quit', click: quit },
    ])
    tray.setContextMenu(menu)
  }
  rebuildMenu = rebuild
  rebuild()
  booted.ctx.genie.on('status', rebuild)
  tray.on('click', () => {
    const w = getWindow()
    if (w && w.isVisible() && !w.isMinimized()) w.focus()
    else showWindow()
  })
  return tray
}

function updateItems(updater: UpdateService, showWindow: () => void): Electron.MenuItemConstructorOptions[] {
  const s = updater.get()
  if (!s.supported) return [{ label: `Version ${s.currentVersion}`, enabled: false }]
  switch (s.status) {
    case 'downloaded':
      return [{ label: `Restart to install ${s.availableVersion}`, click: () => updater.install() }]
    case 'downloading':
      return [{ label: `Downloading update… ${s.percent}%`, enabled: false }]
    case 'available':
      return [{ label: `Update ${s.availableVersion} available`, click: showWindow }]
    case 'checking':
      return [{ label: 'Checking for updates…', enabled: false }]
    default:
      return [{ label: `Check for updates (v${s.currentVersion})`, click: () => void updater.check().catch(() => {}) }]
  }
}

/** Re-render the menu after external state changes (e.g. update progress). Safe to call before/after the tray exists. */
export function refreshTray(): void {
  rebuildMenu?.()
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
  rebuildMenu = null
}
