import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import type { Booted } from './bootstrap'

let tray: Tray | null = null

/** System tray: show/hide window, GenieX server controls, quit. Keeps the app (and server) alive when closed to tray. */
export function createTray(booted: Booted, getWindow: () => BrowserWindow | null, showWindow: () => void, quit: () => void): Tray {
  const iconPath = join(app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources'), app.isPackaged ? 'tray.png' : 'tray.png')
  let icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) icon = nativeImage.createFromPath(join(__dirname, '../../resources/tray.png'))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('GenieX Studio')

  const rebuild = (): void => {
    const st = booted.ctx.genie.status()
    const running = st.state === 'running'
    const menu = Menu.buildFromTemplate([
      { label: 'Open GenieX Studio', click: showWindow },
      { type: 'separator' },
      { label: `GenieX server: ${st.state}${st.residentModel ? ` · ${st.residentModel.split('/').pop()}` : ''}`, enabled: false },
      running ? { label: 'Restart server', click: () => void booted.ctx.genie.restart().catch(() => {}) } : { label: 'Start server', click: () => void booted.ctx.genie.start().catch(() => {}) },
      { label: 'Stop server', enabled: running, click: () => void booted.ctx.genie.stop() },
      { type: 'separator' },
      { label: 'Quit', click: quit },
    ])
    tray?.setContextMenu(menu)
  }
  rebuild()
  booted.ctx.genie.on('status', rebuild)
  tray.on('click', () => {
    const w = getWindow()
    if (w && w.isVisible() && !w.isMinimized()) w.focus()
    else showWindow()
  })
  return tray
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
