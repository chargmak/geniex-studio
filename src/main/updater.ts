import { EventEmitter } from 'node:events'
import { app } from 'electron'
import electronUpdater, { type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { idleUpdateState, type UpdateState } from '@shared/update'
import type { SettingsStore } from './settings'

// electron-updater is CommonJS; a named import breaks under the ESM main bundle.
const { autoUpdater } = electronUpdater

/** Delay before the first automatic check, so startup (server + model probe) is not competing for the network. */
const FIRST_CHECK_DELAY_MS = 25_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Wraps electron-updater with a single observable state object.
 *
 * The feed is baked in at build time (`app-update.yml` from electron-builder's `publish` config), so this only
 * works in packaged builds. In dev / preview the service reports `supported: false` and the UI degrades to
 * showing the version number. Set GENIEX_FORCE_UPDATER=1 with a `dev-app-update.yml` to exercise it locally.
 */
export class UpdateService extends EventEmitter {
  private state: UpdateState
  private timer: NodeJS.Timeout | null = null
  private firstCheck: NodeJS.Timeout | null = null
  private checking: Promise<UpdateState> | null = null
  /** Set once the user asks to install; the quit handler then hands over to the NSIS installer. */
  installOnQuit = false

  constructor(
    private readonly settings: SettingsStore,
    private readonly requestQuit: () => void,
  ) {
    super()
    const forced = process.env.GENIEX_FORCE_UPDATER === '1'
    const supported = app.isPackaged || forced
    this.state = idleUpdateState(app.getVersion(), settings.get().updates.channel, supported)

    if (!supported) return
    if (forced) autoUpdater.forceDevUpdateConfig = true

    autoUpdater.autoDownload = false // we drive downloads ourselves so the UI can reflect the choice
    autoUpdater.autoInstallOnAppQuit = false // installing is an explicit user action, never a surprise on quit
    autoUpdater.allowPrerelease = settings.get().updates.channel === 'beta'
    autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} }

    autoUpdater.on('checking-for-update', () => this.patch({ status: 'checking', error: null }))
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.patch({
        status: 'available',
        availableVersion: info.version,
        releaseName: typeof info.releaseName === 'string' ? info.releaseName : null,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
        releaseDate: info.releaseDate ?? null,
        lastCheckedAt: Date.now(),
      })
      if (this.settings.get().updates.autoDownload) void this.download().catch(() => {})
    })
    autoUpdater.on('update-not-available', () => this.patch({ status: 'not-available', availableVersion: null, lastCheckedAt: Date.now() }))
    autoUpdater.on('download-progress', (p: ProgressInfo) =>
      this.patch({ status: 'downloading', percent: Math.round(p.percent), bytesPerSecond: Math.round(p.bytesPerSecond), transferred: p.transferred, total: p.total }),
    )
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => this.patch({ status: 'downloaded', percent: 100, availableVersion: info.version }))
    autoUpdater.on('error', (err: Error) => this.patch({ status: 'error', error: err?.message ?? String(err) }))

    settings.on('change', () => this.applySettings())
    this.applySettings()
  }

  get(): UpdateState {
    return this.state
  }

  /** Manual check: runs even when automatic checks are disabled. Concurrent calls share one request. */
  async check(): Promise<UpdateState> {
    if (!this.state.supported) return this.state
    if (this.state.status === 'downloading' || this.state.status === 'downloaded') return this.state
    if (this.checking) return this.checking
    this.checking = autoUpdater
      .checkForUpdates()
      .then(() => this.state)
      .catch((err: unknown) => {
        this.patch({ status: 'error', error: err instanceof Error ? err.message : String(err), lastCheckedAt: Date.now() })
        return this.state
      })
      .finally(() => {
        this.checking = null
      })
    return this.checking
  }

  async download(): Promise<UpdateState> {
    if (!this.state.supported || this.state.status === 'downloading' || this.state.status === 'downloaded') return this.state
    this.patch({ status: 'downloading', percent: 0, error: null })
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      this.patch({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
    return this.state
  }

  /**
   * Shuts the app down normally (GenieX server, sidecar, DB) and hands over to the installer on quit.
   * No-op unless an installer has actually been downloaded.
   */
  install(): boolean {
    if (this.state.status !== 'downloaded') return false
    this.installOnQuit = true
    this.requestQuit()
    return true
  }

  /** Called from the quit path once everything is shut down. */
  runInstaller(): void {
    // isSilent=false shows the NSIS progress UI; isForceRunAfter relaunches Studio when it finishes.
    autoUpdater.quitAndInstall(false, true)
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.firstCheck) clearTimeout(this.firstCheck)
    this.timer = null
    this.firstCheck = null
  }

  private applySettings(): void {
    const { autoCheck, channel } = this.settings.get().updates
    if (this.state.channel !== channel) {
      autoUpdater.allowPrerelease = channel === 'beta'
      this.patch({ channel, status: 'idle', availableVersion: null, error: null })
    }
    if (autoCheck && !this.timer) {
      this.firstCheck = setTimeout(() => void this.check().catch(() => {}), FIRST_CHECK_DELAY_MS)
      this.timer = setInterval(() => void this.check().catch(() => {}), CHECK_INTERVAL_MS)
    } else if (!autoCheck && this.timer) {
      this.dispose()
    }
  }

  private patch(partial: Partial<UpdateState>): void {
    this.state = { ...this.state, ...partial }
    this.emit('change', this.state)
  }
}

function log(...args: unknown[]): void {
  console.log('[updater]', ...args)
}
