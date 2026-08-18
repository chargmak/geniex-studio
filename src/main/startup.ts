import { app } from 'electron'
import { APP_NAME } from '@shared/config'

/** Argument the login-item entry passes so an auto-started Studio comes up in the tray, not in your face. */
export const HIDDEN_FLAG = '--hidden'

/**
 * Mirrors the `ui.launchAtLogin` setting into the Windows "Run" registry entry (and the macOS login items list).
 * No-op unless packaged — otherwise we would register the dev `electron.exe`.
 */
export function applyLaunchAtLogin(enabled: boolean): void {
  if (!app.isPackaged) return
  try {
    const current = app.getLoginItemSettings({ path: process.execPath, args: [HIDDEN_FLAG] })
    if (current.openAtLogin === enabled) return
    app.setLoginItemSettings({
      openAtLogin: enabled,
      name: APP_NAME,
      path: process.execPath,
      args: [HIDDEN_FLAG],
    })
  } catch (err) {
    console.warn('[startup] could not update launch-at-login:', err instanceof Error ? err.message : err)
  }
}

/** True when this launch should stay in the tray: the login item asked for it, or the user set start-minimized. */
export function shouldStartHidden(startMinimizedSetting: boolean): boolean {
  return process.argv.includes(HIDDEN_FLAG) || startMinimizedSetting
}
