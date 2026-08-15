import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import type { GenieServerState, GenieServerStatus, GenieServeSettings } from '@shared/api'
import type { SettingsStore } from '../settings'
import { RingBuffer } from '../util/ringBuffer'
import { killTree } from '../util/killTree'
import { findGenieXCli } from './paths'
import { parseChipset, parseVersion, runGeniex, spawnGeniex } from './cli'

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

  readonly logs = new RingBuffer<LogLine>(1000)

  /** Updated by GenieXClient. */
  residentModel: string | null = null
  residentSince: number | null = null
  busy = false
  queueDepth = 0
  /** Model a request is currently loading/using — attributed to a crash if the process dies mid-request. */
  activeModel: string | null = null
  /** Crash bookkeeping: models whose load killed the server (GenieX issue #1154 on some X Elite systems). */
  readonly crashedModels = new Map<string, { count: number; lastAt: number; code: string }>()
  lastCrash: { at: number; code: string; model: string | null } | null = null

  constructor(private readonly settings: SettingsStore) {
    super()
    settings.on('change', () => void this.probeCli(true))
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
    }
  }

  get isRunning(): boolean {
    return this.state === 'running'
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
      if (this.state !== 'stopping') {
        const codeStr = code != null ? (code > 0x7fffffff || code < 0 ? `0x${(code >>> 0).toString(16).toUpperCase()}` : String(code)) : (signal ?? '?')
        this.lastCrash = { at: Date.now(), code: codeStr, model: this.activeModel }
        if (this.activeModel) {
          const prev = this.crashedModels.get(this.activeModel)
          this.crashedModels.set(this.activeModel, { count: (prev?.count ?? 0) + 1, lastAt: Date.now(), code: codeStr })
          this.log('studio', `runtime crash attributed to model ${this.activeModel} (${codeStr})`)
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
      } else {
        this.setState('stopped')
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
    if (this.managed && this.proc) {
      this.setState('stopping')
      const p = this.proc
      await killTree(p)
      this.proc = null
    }
    this.managed = false
    this.residentModel = null
    this.residentSince = null
    this.setState('stopped')
  }

  async restart(): Promise<void> {
    await this.stop()
    this.restartAttempts = 0
    await this.start()
  }

  async shutdown(): Promise<void> {
    this.stopPolling()
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
      const line = raw.replace(/\[[0-9;]*[A-Za-z]/g, '').trimEnd()
      if (!line) continue
      this.log(stream, line)
      if (/error|panic|fatal/i.test(line) && !/error=nil|level=info/i.test(line)) this.lastError = line
    }
  }

  log(stream: LogLine['stream'], line: string): void {
    const entry: LogLine = { ts: Date.now(), stream, line }
    this.logs.push(entry)
    this.emit('log', entry)
  }
}
