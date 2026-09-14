import { EventEmitter } from 'node:events'
import { dirname } from 'node:path'
import { CrashLog } from './crashLog'
import type { ChildProcess } from 'node:child_process'
import type { CrashKind, GenieServerState, GenieServerStatus, GenieServeSettings } from '@shared/api'
import type { Runtime } from '@shared/config'
import { isCliVersionSupported, MIN_GENIEX_VERSION } from '@shared/config'
import type { SettingsStore } from '../settings'
import { RingBuffer } from '../util/ringBuffer'
import { killTree } from '../util/killTree'
import { findGenieXCli } from './paths'
import { configureGeniexEnv, parseChipset, parseVersion, runGeniex, spawnGeniex } from './cli'

export interface LogLine {
  ts: number
  stream: 'stdout' | 'stderr' | 'studio'
  line: string
}

interface CliInfo {
  path: string | null
  version: string | null
  qairt: string | null
  llamaCppHash: string | null
  chipset: string | null
  probedAt: number
}

const HEALTH_TIMEOUT_MS = 2500
const START_TIMEOUT_MS = 60_000
const POLL_INTERVAL_MS = 4000
/** How long after an overflow log line a process exit is still blamed on the overflow. */
const OVERFLOW_ATTRIBUTION_MS = 15_000

/**
 * llama.cpp on the Hexagon backend cannot shift its context: the ROPE the shift needs is not implemented for the
 * HTP buffer, and the process aborts. These lines precede that abort in the server log (GenieX v0.6.1).
 */
const OVERFLOW_SIGNATURE = /cannot run the operation \(ROPE\)|Context shifting - discarding|failed to find a memory slot for batch/i

/**
 * Owns the `geniex serve` process (or attaches to an external one), tracks health, keeps a log ring buffer,
 * and exposes the "resident model / busy" bookkeeping the client updates. Emits: 'state', 'log', 'status'.
 */
export class GenieXSupervisor extends EventEmitter {
  private state: GenieServerState = 'stopped'
  private managed = false
  private proc: ChildProcess | null = null
  private startedAt: number | null = null
  private lastError: string | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private cli: CliInfo = { path: null, version: null, qairt: null, llamaCppHash: null, chipset: null, probedAt: 0 }
  private starting: Promise<void> | null = null
  private restartAttempts = 0
  /** Set while *we* are terminating the process, so its exit is never mistaken for a runtime crash. */
  private intentionalStop = false
  /** Timestamp of the last context-overflow signature seen in the log (see OVERFLOW_SIGNATURE). */
  private overflowSeenAt = 0

  readonly logs = new RingBuffer<LogLine>(1000)

  /** Updated by GenieXClient. */
  residentModel: string | null = null
  residentSince: number | null = null
  busy = false
  queueDepth = 0
  /** Model a request is currently loading/using — attributed to a crash if the process dies mid-request. */
  activeModel: string | null = null
  /**
   * A QAIRT bundle has been loaded in this process. After that llama.cpp can no longer open its Hexagon session
   * (`HTP0 failed to open session : error 0x80000406`, even with compute=cpu), so the client restarts the server
   * before the next GGUF request. Reset on every (re)start.
   */
  qairtLoadedSinceStart = false
  /** Crash bookkeeping: models whose load killed the server under the current CLI version.
   *  Backed by `runtime-crashes.json` so the app does not re-select a known-fatal model after a restart. */
  readonly crashLog: CrashLog
  readonly crashedModels = new Map<string, { count: number; lastAt: number; code: string; cliVersion?: string | null }>()
  lastCrash: { at: number; code: string; model: string | null; kind: CrashKind } | null = null

  constructor(
    private readonly settings: SettingsStore,
    dataDir: string = dirname(settings.file),
  ) {
    super()
    this.crashLog = new CrashLog(dataDir)
    for (const [name, rec] of this.crashLog.entries()) this.crashedModels.set(name, rec)
    this.applyEnv()
    settings.on('change', () => {
      this.applyEnv()
      void this.probeCli(true)
    })
  }

  private applyEnv(): void {
    const g = this.settings.get().genie
    configureGeniexEnv({ dataDir: g.dataDir?.trim() || null, qairtLib: g.qairtLib?.trim() || null })
  }

  /** Forget crash history (one model or all) — e.g. after an NPU driver update. */
  clearCrashes(model?: string): void {
    this.crashLog.clear(model)
    if (model) this.crashedModels.delete(model)
    else this.crashedModels.clear()
    this.emit('status')
  }

  /** Called by the client with the runtime family of every model it sends a request for. */
  noteRuntime(runtime: Runtime): void {
    if (runtime === 'qairt' && !this.qairtLoadedSinceStart) {
      this.qairtLoadedSinceStart = true
      this.emit('status')
    }
  }

  /** True when the log showed a context-overflow signature just before now (used to classify an exit). */
  get overflowSeenRecently(): boolean {
    return Date.now() - this.overflowSeenAt < OVERFLOW_ATTRIBUTION_MS
  }

  // ------------------------------------------------------------ info

  get serveSettings(): GenieServeSettings {
    const g = this.settings.get().genie
    return {
      host: g.host,
      keepaliveSeconds: g.keepaliveSeconds,
      nctx: g.nctx,
      ngl: g.ngl,
      compute: g.compute,
      origins: g.origins,
      logLevel: g.logLevel,
      autoStart: g.autoStart,
    }
  }

  get baseUrl(): string {
    const host = this.settings.get().genie.host || '127.0.0.1:18181'
    return /^https?:\/\//.test(host) ? host : `http://${host}`
  }

  get cliPath(): string | null {
    if (!this.cli.path) this.cli.path = findGenieXCli(this.settings.get().genie.cliPath)
    return this.cli.path
  }

  get cliVersion(): string | null {
    return this.cli.version
  }

  /** True when Studio spawned the process and it is alive, i.e. a restart is ours to do. */
  get managedRunning(): boolean {
    return this.managed && this.state === 'running' && !!this.proc && this.proc.exitCode === null
  }

  async probeCli(force = false): Promise<CliInfo> {
    const path = findGenieXCli(this.settings.get().genie.cliPath)
    if (!force && this.cli.probedAt && this.cli.path === path && Date.now() - this.cli.probedAt < 10 * 60_000) return this.cli
    this.cli = { path, version: null, qairt: null, llamaCppHash: null, chipset: null, probedAt: Date.now() }
    if (!path) return this.cli
    const [v, c] = await Promise.all([
      runGeniex(path, ['version'], { timeoutMs: 20_000 }),
      runGeniex(path, ['config', 'get', 'chipset'], { timeoutMs: 20_000 }),
    ])
    const ver = parseVersion(v.stdout + '\n' + v.stderr)
    this.cli.version = ver.cli
    this.cli.qairt = ver.qairt
    this.cli.llamaCppHash = ver.llamaCppHash
    this.cli.chipset = c.code === 0 ? parseChipset(c.stdout) : null
    // Crash history belongs to the CLI version it was recorded under: a new CLI is a new runtime.
    const dropped = this.crashLog.prune(ver.cli)
    if (dropped.length) {
      for (const name of dropped) this.crashedModels.delete(name)
      this.log('studio', `GenieX CLI is now ${ver.cli}: forgot crash history for ${dropped.join(', ')}`)
    }
    if (ver.cli && isCliVersionSupported(ver.cli) === false) {
      this.log('studio', `GenieX CLI ${ver.cli} is older than the ${MIN_GENIEX_VERSION} Studio requires — run "geniex update"`)
    }
    this.emit('status')
    return this.cli
  }

  status(): GenieServerStatus {
    return {
      state: this.state,
      managed: this.managed,
      url: this.baseUrl,
      pid: this.proc?.pid ?? null,
      cliPath: this.cli.path ?? this.cliPath,
      cliFound: !!(this.cli.path ?? this.cliPath),
      cliVersion: this.cli.version,
      cliVersionOk: isCliVersionSupported(this.cli.version),
      requiredCliVersion: MIN_GENIEX_VERSION,
      qairtVersion: this.cli.qairt,
      llamaCppHash: this.cli.llamaCppHash,
      chipset: this.cli.chipset,
      startedAt: this.startedAt,
      lastError: this.lastError,
      residentModel: this.residentModel,
      residentSince: this.residentSince,
      busy: this.busy,
      queueDepth: this.queueDepth,
      settings: this.serveSettings,
      lastCrash: this.lastCrash,
      crashedModels: Object.fromEntries(this.crashedModels),
      qairtLoadedSinceStart: this.qairtLoadedSinceStart,
    }
  }

  get isRunning(): boolean {
    return this.state === 'running'
  }

  /** True while the server is down because *we* stopped it (Stop button, restart, app quit) — not a crash. */
  get stoppedIntentionally(): boolean {
    return this.intentionalStop
  }

  // ------------------------------------------------------------ health

  async isHealthy(timeoutMs = HEALTH_TIMEOUT_MS): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/`, { signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) return false
      const text = await res.text().catch(() => '')
      return /running/i.test(text) || res.status === 200
    } catch {
      return false
    }
  }

  // ------------------------------------------------------------ lifecycle

  async start(): Promise<void> {
    if (this.state === 'running') return
    if (this.starting) return this.starting
    this.starting = this.doStart().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async doStart(): Promise<void> {
    this.intentionalStop = false
    this.qairtLoadedSinceStart = false
    await this.probeCli()
    const g = this.settings.get().genie

    if (g.attachExisting && (await this.isHealthy())) {
      this.attach()
      return
    }

    const cli = this.cliPath
    if (!cli) {
      this.setState('error', 'GenieX CLI not found. Install GenieX CLI (geniex.aihub.qualcomm.com) or set the path in Settings.')
      throw new Error(this.lastError!)
    }

    const args = [
      'serve',
      '--host',
      g.host,
      '--keepalive',
      String(g.keepaliveSeconds),
      '--nctx',
      String(g.nctx),
      '--ngl',
      String(g.ngl),
      '--origins',
      g.origins || '*',
      '--log',
      g.logLevel,
    ]
    if (g.compute) args.push('--compute', g.compute)
    if (g.qairtLib?.trim()) args.push('--qairt-lib', g.qairtLib.trim())
    if (g.dataDir?.trim()) args.push('--data-dir', g.dataDir.trim())

    this.log('studio', `starting: "${cli}" ${args.join(' ')}`)
    this.setState('starting')
    this.lastError = null
    this.managed = true
    const proc = spawnGeniex(cli, args)
    this.proc = proc
    this.startedAt = Date.now()

    proc.stdout?.setEncoding('utf8')
    proc.stderr?.setEncoding('utf8')
    proc.stdout?.on('data', (d: string) => this.ingest('stdout', d))
    proc.stderr?.on('data', (d: string) => this.ingest('stderr', d))
    proc.on('error', (err) => {
      this.log('studio', `process error: ${err.message}`)
      this.setState('error', err.message)
    })
    proc.on('exit', (code, signal) => {
      this.log('studio', `geniex serve exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`)
      const wasRunning = this.state === 'running'
      this.proc = null
      if (this.intentionalStop || this.state === 'stopping') {
        this.setState('stopped')
      } else if (!wasRunning) {
        // Died during startup (port still taken, bad flags…): a start failure, reported through lastError — not a runtime crash.
        this.setState('error', this.lastError ?? `geniex serve exited during startup (code ${code ?? signal ?? '?'})`)
      } else {
        const codeStr = code != null ? (code > 0x7fffffff || code < 0 ? `0x${(code >>> 0).toString(16).toUpperCase()}` : String(code)) : (signal ?? '?')
        const kind: CrashKind = this.overflowSeenRecently ? 'context_overflow' : this.activeModel ? 'model' : 'unknown'
        this.lastCrash = { at: Date.now(), code: codeStr, model: this.activeModel, kind }
        if (kind === 'model' && this.activeModel) {
          this.crashedModels.set(this.activeModel, this.crashLog.record(this.activeModel, codeStr, this.cli.version))
          this.log('studio', `runtime crash attributed to model ${this.activeModel} (${codeStr})`)
        } else if (kind === 'context_overflow') {
          // A GenieX bug (llama.cpp context shift on the HTP), not this model's fault — do not blacklist it.
          this.log('studio', `runtime crash attributed to a context overflow on the NPU while running ${this.activeModel ?? 'a model'} (${codeStr})`)
        }
        this.residentModel = null
        this.residentSince = null
        this.setState('error', `geniex serve exited unexpectedly (code ${code ?? signal ?? '?'})`)
        if (wasRunning && this.restartAttempts < 3) {
          this.restartAttempts++
          const delay = 1500 * this.restartAttempts
          this.log('studio', `auto-restart in ${delay} ms (attempt ${this.restartAttempts}/3)`)
          setTimeout(() => void this.start().catch(() => {}), delay)
        }
      }
    })

    // Wait until healthy or the process dies.
    const deadline = Date.now() + START_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (this.proc !== proc || proc.exitCode !== null) {
        const msg = this.lastError ?? 'geniex serve exited during startup'
        this.setState('error', msg)
        throw new Error(msg)
      }
      if (await this.isHealthy(1500)) {
        this.restartAttempts = 0
        this.setState('running')
        this.log('studio', `healthy at ${this.baseUrl}`)
        this.startPolling()
        return
      }
      await new Promise((r) => setTimeout(r, 400))
    }
    this.setState('error', 'Timed out waiting for geniex serve to become healthy')
    await killTree(proc)
    throw new Error(this.lastError!)
  }

  private attach(): void {
    this.managed = false
    this.proc = null
    this.startedAt = Date.now()
    this.lastError = null
    this.log('studio', `attached to existing GenieX server at ${this.baseUrl}`)
    this.setState('running')
    this.startPolling()
  }

  async stop(): Promise<void> {
    this.stopPolling()
    this.intentionalStop = true
    if (this.managed && this.proc) {
      this.setState('stopping')
      const p = this.proc
      // taskkill returns before the process is gone and the socket is released; a `serve` started right after
      // would fail to bind 18181 (or attach to the dying process). Wait for the exit, then for the port to close.
      const exited = new Promise<void>((resolve) => (p.exitCode !== null ? resolve() : p.once('exit', () => resolve())))
      await killTree(p)
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))])
      for (let i = 0; i < 25 && (await this.isHealthy(400)); i++) await new Promise((r) => setTimeout(r, 200))
      this.proc = null
    }
    this.managed = false
    this.residentModel = null
    this.residentSince = null
    this.qairtLoadedSinceStart = false
    this.setState('stopped')
  }

  async restart(): Promise<void> {
    await this.stop()
    this.restartAttempts = 0
    await this.start()
  }

  /**
   * Quit path. `intentionalStop` must be set *before* the kill: without it the exit handler treats our own
   * termination as a runtime crash and records the in-flight model in runtime-crashes.json — so quitting the
   * app mid-generation would permanently blacklist a perfectly healthy model.
   */
  async shutdown(): Promise<void> {
    this.stopPolling()
    this.intentionalStop = true
    if (this.managed && this.proc) await killTree(this.proc)
    this.proc = null
  }

  // ------------------------------------------------------------ polling

  private startPolling(): void {
    this.stopPolling()
    this.pollTimer = setInterval(() => void this.pollOnce(), POLL_INTERVAL_MS)
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  private async pollOnce(): Promise<void> {
    if (this.state !== 'running') return
    if (this.busy) return // a long generation may make /v1/ slow to answer; skip
    const ok = await this.isHealthy()
    if (ok) return
    if (this.managed) {
      if (this.proc && this.proc.exitCode === null) return // still alive, maybe under load
      this.setState('error', 'GenieX server stopped responding')
    } else {
      this.log('studio', 'external GenieX server is no longer reachable')
      this.stopPolling()
      this.residentModel = null
      this.setState('stopped')
    }
  }

  // ------------------------------------------------------------ helpers

  private setState(next: GenieServerState, error?: string): void {
    if (error !== undefined) this.lastError = error
    if (this.state === next) {
      this.emit('status')
      return
    }
    this.state = next
    this.emit('state', next)
    this.emit('status')
  }

  private ingest(stream: 'stdout' | 'stderr', chunk: string): void {
    for (const raw of chunk.split(/\r?\n/)) {
      const line = raw.replace(/\[[0-9;]*[A-Za-z]/g, '').trimEnd()
      if (!line) continue
      this.log(stream, line)
      if (OVERFLOW_SIGNATURE.test(line)) this.overflowSeenAt = Date.now()
      if (/error|panic|fatal/i.test(line) && !/error=nil|level=info/i.test(line)) this.lastError = line
    }
  }

  log(stream: LogLine['stream'], line: string): void {
    const entry: LogLine = { ts: Date.now(), stream, line }
    this.logs.push(entry)
    this.emit('log', entry)
  }
}
