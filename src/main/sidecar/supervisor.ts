import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, promises as fs, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProvisionEvent, SidecarFeature, SidecarModelInfo, SidecarState, SidecarStatus } from '@shared/sidecar'
import { RingBuffer } from '../util/ringBuffer'
import { killTree } from '../util/killTree'
import type { LogLine } from '../geniex/supervisor'

export const SIDECAR_PORT = 18195
const PY_SERIES = ['3.12', '3.13'] // qai-appbuilder ships cp311–cp313 win_arm64 wheels; 3.12 is the safest
const UV_ZIP_URL = 'https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-pc-windows-msvc.zip'

export interface SidecarPaths {
  /** Python sources shipped with the app (server.py, engines/, requirements.txt). */
  sourceDir: string
  /** Writable home: venv, uv, managed python, models, cache. */
  home: string
}

type Emit = (e: ProvisionEvent) => void

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; onLine?: (l: string) => void; timeoutMs?: number } = {}): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    let out = ''
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, NO_COLOR: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ...(opts.env ?? {}) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const onData = (d: Buffer): void => {
      const text = d.toString('utf8')
      out += text
      if (opts.onLine) for (const l of text.split(/\r?\n/)) if (l.trim()) opts.onLine(l.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trimEnd())
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    const t = opts.timeoutMs ? setTimeout(() => void killTree(child), opts.timeoutMs) : null
    child.on('error', (err) => {
      out += `\n${err.message}`
      resolve({ code: -1, out })
    })
    child.on('exit', (code) => {
      if (t) clearTimeout(t)
      resolve({ code, out })
    })
  })
}

/**
 * Provisions and supervises the Python NPU sidecar: a `uv`-managed CPython 3.12 (arm64) venv with
 * qai-appbuilder / onnxruntime-qnn + FastAPI, run as `uvicorn server:app` on 127.0.0.1:18195.
 */
export class SidecarSupervisor extends EventEmitter {
  private state: SidecarState = 'not-installed'
  private proc: ChildProcess | null = null
  private lastError: string | null = null
  private health: { features: Record<SidecarFeature, boolean>; version: string; qairt: string | null } | null = null
  private models: SidecarModelInfo[] = []
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private provisioning = false
  busy = false
  readonly logs = new RingBuffer<LogLine>(800)

  constructor(readonly paths: SidecarPaths) {
    super()
    mkdirSync(paths.home, { recursive: true })
    mkdirSync(this.modelsDir, { recursive: true })
    if (this.depsInstalled()) this.state = 'stopped'
  }

  get url(): string {
    return `http://127.0.0.1:${SIDECAR_PORT}`
  }
  get venvDir(): string {
    return join(this.paths.home, '.venv')
  }
  get modelsDir(): string {
    return join(this.paths.home, 'models')
  }
  get pythonExe(): string {
    return join(this.venvDir, 'Scripts', 'python.exe')
  }
  private get uvDir(): string {
    return join(this.paths.home, 'uv')
  }
  private get uvExe(): string {
    return join(this.uvDir, 'uv.exe')
  }
  private get uvEnv(): NodeJS.ProcessEnv {
    return { UV_PYTHON_INSTALL_DIR: join(this.uvDir, 'python'), UV_CACHE_DIR: join(this.uvDir, 'cache'), UV_NO_PROGRESS: '1' }
  }

  depsInstalled(): boolean {
    return existsSync(this.pythonExe) && existsSync(join(this.paths.home, '.deps-ok'))
  }

  status(): SidecarStatus {
    return {
      state: this.state,
      url: this.url,
      pid: this.proc?.pid ?? null,
      pythonPath: existsSync(this.pythonExe) ? this.pythonExe : null,
      pythonVersion: this.readMarker('.python-version'),
      venvDir: this.venvDir,
      modelsDir: this.modelsDir,
      installedDeps: this.depsInstalled(),
      lastError: this.lastError,
      features: this.health?.features ?? null,
      version: this.health?.version ?? null,
      qairt: this.health?.qairt ?? null,
      models: this.models,
      busy: this.busy,
    }
  }

  private readMarker(name: string): string | null {
    try {
      return readFileSync(join(this.paths.home, name), 'utf8').trim() || null
    } catch {
      return null
    }
  }

  private setState(next: SidecarState, error?: string): void {
    if (error !== undefined) this.lastError = error
    this.state = next
    this.emit('status')
  }

  log(stream: LogLine['stream'], line: string): void {
    const entry = { ts: Date.now(), stream, line }
    this.logs.push(entry)
    this.emit('log', entry)
  }

  // ------------------------------------------------------------ provisioning

  private async ensureUv(emit: Emit): Promise<string> {
    if (existsSync(this.uvExe)) return this.uvExe
    // A uv on PATH is fine too.
    const onPath = await run(process.platform === 'win32' ? 'where.exe' : 'which', ['uv']).then((r) => (r.code === 0 ? r.out.split(/\r?\n/)[0].trim() : ''))
    if (onPath) return onPath
    emit({ type: 'step', step: 'uv', message: 'Downloading uv (Python manager)…' })
    mkdirSync(this.uvDir, { recursive: true })
    const zip = join(this.uvDir, 'uv.zip')
    const res = await fetch(UV_ZIP_URL, { redirect: 'follow' })
    if (!res.ok) throw new Error(`uv download failed: HTTP ${res.status}`)
    await fs.writeFile(zip, Buffer.from(await res.arrayBuffer()))
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${this.uvDir}' -Force`], { timeoutMs: 120_000 })
    if (r.code !== 0 || !existsSync(this.uvExe)) throw new Error(`Could not extract uv: ${r.out.slice(-400)}`)
    await fs.unlink(zip).catch(() => {})
    return this.uvExe
  }

  private async ensurePython(uv: string, emit: Emit): Promise<string> {
    for (const series of PY_SERIES) {
      const found = await run(uv, ['python', 'find', series], { env: this.uvEnv })
      if (found.code === 0 && found.out.trim()) {
        const exe = found.out.trim().split(/\r?\n/).pop()!.trim()
        emit({ type: 'log', message: `Using Python ${series} at ${exe}` })
        return exe
      }
    }
    emit({ type: 'step', step: 'python', message: `Installing CPython ${PY_SERIES[0]} (arm64) — about 30 MB…` })
    const r = await run(uv, ['python', 'install', PY_SERIES[0]], { env: this.uvEnv, onLine: (l) => emit({ type: 'log', message: l }), timeoutMs: 600_000 })
    if (r.code !== 0) throw new Error(`uv python install failed: ${r.out.slice(-600)}`)
    const found = await run(uv, ['python', 'find', PY_SERIES[0]], { env: this.uvEnv })
    const exe = found.out.trim().split(/\r?\n/).pop()?.trim()
    if (!exe) throw new Error('Python installed but not found by uv')
    return exe
  }

  /** Full install: uv → python 3.12 → venv → pip requirements. Idempotent; safe to re-run. */
  async provision(emit: Emit): Promise<void> {
    if (this.provisioning) throw new Error('provisioning already running')
    this.provisioning = true
    const prev = this.state
    this.setState('installing')
    try {
      const uv = await this.ensureUv(emit)
      const py = await this.ensurePython(uv, emit)
      if (!existsSync(this.pythonExe)) {
        emit({ type: 'step', step: 'venv', message: 'Creating virtual environment…' })
        const r = await run(uv, ['venv', this.venvDir, '--python', py, '--seed'], { env: this.uvEnv, onLine: (l) => emit({ type: 'log', message: l }), timeoutMs: 300_000 })
        if (r.code !== 0) throw new Error(`uv venv failed: ${r.out.slice(-600)}`)
      }
      emit({ type: 'step', step: 'deps', message: 'Installing Python packages (qai-appbuilder, onnxruntime-qnn, fastapi…) — this can take a few minutes…' })
      const req = join(this.paths.sourceDir, 'requirements.txt')
      const r = await run(uv, ['pip', 'install', '--python', this.pythonExe, '-r', req], { env: this.uvEnv, onLine: (l) => emit({ type: 'log', message: l }), timeoutMs: 1_800_000 })
      if (r.code !== 0) throw new Error(`pip install failed: ${r.out.slice(-1200)}`)
      emit({ type: 'step', step: 'verify', message: 'Verifying imports…' })
      const v = await run(this.pythonExe, ['-c', 'import sys, fastapi, uvicorn, numpy; print(sys.version.split()[0])'], { timeoutMs: 60_000 })
      if (v.code !== 0) throw new Error(`verification failed: ${v.out.slice(-600)}`)
      await fs.writeFile(join(this.paths.home, '.python-version'), v.out.trim())
      await fs.writeFile(join(this.paths.home, '.deps-ok'), new Date().toISOString())
      emit({ type: 'done', message: `Sidecar ready (Python ${v.out.trim()})` })
      this.setState('stopped')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      emit({ type: 'error', message })
      this.setState(prev === 'running' ? 'running' : this.depsInstalled() ? 'stopped' : 'not-installed', message)
      throw err
    } finally {
      this.provisioning = false
    }
  }

  // ------------------------------------------------------------ lifecycle

  async isHealthy(timeoutMs = 2000): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/health`, { signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) return false
      const j = (await res.json()) as { ok?: boolean; features?: Record<SidecarFeature, boolean>; version?: string; qairt?: string | null }
      if (j.features) this.health = { features: j.features, version: j.version ?? '?', qairt: j.qairt ?? null }
      return !!j.ok
    } catch {
      return false
    }
  }

  async start(): Promise<void> {
    if (this.state === 'running') return
    if (!this.depsInstalled()) throw new Error('Sidecar is not installed yet')
    if (await this.isHealthy()) {
      this.setState('running')
      this.startPolling()
      void this.refreshModels()
      return
    }
    this.setState('starting')
    this.lastError = null
    const geniexQairt = join(process.env.LOCALAPPDATA ?? '', 'GenieX CLI', 'qairt', 'htp-files')
    const proc = spawn(this.pythonExe, ['-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', String(SIDECAR_PORT), '--log-level', 'info'], {
      cwd: this.paths.sourceDir,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        NO_COLOR: '1',
        GENIEX_SIDECAR_MODELS: this.modelsDir,
        GENIEX_SIDECAR_HOME: this.paths.home,
        GENIEX_QAIRT_HTP_DIR: existsSync(geniexQairt) ? geniexQairt : '',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.proc = proc
    proc.stdout?.setEncoding('utf8')
    proc.stderr?.setEncoding('utf8')
    const ingest = (stream: 'stdout' | 'stderr') => (d: string): void => {
      for (const l of d.split(/\r?\n/)) {
        const line = l.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trimEnd()
        if (line) this.log(stream, line)
      }
    }
    proc.stdout?.on('data', ingest('stdout'))
    proc.stderr?.on('data', ingest('stderr'))
    proc.on('exit', (code, signal) => {
      this.log('studio', `sidecar exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`)
      this.proc = null
      this.stopPolling()
      if (this.state !== 'stopped') this.setState('error', `sidecar exited unexpectedly (code ${code ?? signal ?? '?'})`)
    })
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) throw new Error(this.lastError ?? 'sidecar exited during startup')
      if (await this.isHealthy(1500)) {
        this.setState('running')
        this.startPolling()
        void this.refreshModels()
        return
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    await killTree(proc)
    this.setState('error', 'sidecar did not become healthy in time')
    throw new Error(this.lastError!)
  }

  async stop(): Promise<void> {
    this.stopPolling()
    this.setState('stopped')
    if (this.proc) {
      await killTree(this.proc)
      this.proc = null
    }
  }

  async shutdown(): Promise<void> {
    this.stopPolling()
    if (this.proc) await killTree(this.proc)
    this.proc = null
  }

  private startPolling(): void {
    this.stopPolling()
    this.pollTimer = setInterval(() => void this.pollOnce(), 5000)
  }
  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }
  private async pollOnce(): Promise<void> {
    if (this.state !== 'running' || this.busy) return
    if (!(await this.isHealthy())) {
      if (this.proc && this.proc.exitCode === null) return
      this.setState('error', 'sidecar stopped responding')
    }
  }

  // ------------------------------------------------------------ models (proxied)

  async refreshModels(): Promise<SidecarModelInfo[]> {
    if (this.state !== 'running') return this.models
    try {
      const res = await fetch(`${this.url}/models`, { signal: AbortSignal.timeout(10_000) })
      if (res.ok) {
        const j = (await res.json()) as { models?: SidecarModelInfo[] }
        this.models = j.models ?? []
        this.emit('status')
      }
    } catch {
      /* keep old list */
    }
    return this.models
  }

  /** Generic proxy to the sidecar. */
  async fetch(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response> {
    if (this.state !== 'running') await this.start()
    const { timeoutMs, ...rest } = init ?? {}
    this.busy = true
    this.emit('status')
    try {
      return await fetch(`${this.url}${path}`, { ...rest, signal: rest.signal ?? (timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined) })
    } finally {
      this.busy = false
      this.emit('status')
    }
  }
}
