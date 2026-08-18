/**
 * Auto-update contract shared by the main process (electron-updater) and the renderer.
 * Keep free of Node/Electron imports — the renderer imports this too.
 */

export type UpdateChannel = 'stable' | 'beta'

export type UpdateStatus =
  /** Nothing in flight; no update known. */
  | 'idle'
  | 'checking'
  /** A newer version exists but has not been downloaded yet. */
  | 'available'
  | 'not-available'
  | 'downloading'
  /** Installer is on disk — restarting applies it. */
  | 'downloaded'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  /** Version offered by the feed, when one is. */
  availableVersion: string | null
  releaseName: string | null
  releaseNotes: string | null
  releaseDate: string | null
  /** 0–100 while downloading. */
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
  error: string | null
  lastCheckedAt: number | null
  /**
   * false when no update feed is wired up (dev runs, `npm start` previews, browser/headless mode).
   * The UI shows the version but hides the check/install controls.
   */
  supported: boolean
  channel: UpdateChannel
}

export function idleUpdateState(currentVersion: string, channel: UpdateChannel, supported: boolean): UpdateState {
  return {
    status: 'idle',
    currentVersion,
    availableVersion: null,
    releaseName: null,
    releaseNotes: null,
    releaseDate: null,
    percent: 0,
    bytesPerSecond: 0,
    transferred: 0,
    total: 0,
    error: null,
    lastCheckedAt: null,
    supported,
    channel,
  }
}
