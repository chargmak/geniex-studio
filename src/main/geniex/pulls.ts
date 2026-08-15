import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { PullJob, PullRequestBody } from '@shared/api'
import { spawnGeniex } from './cli'
import { genieXModelsDir } from './paths'
import type { GenieXSupervisor } from './supervisor'
import type { ModelManager } from './models'
import { killTree } from '../util/killTree'

const UNIT: Record<string, number> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 }

function toBytes(v: string, unit: string): number {
  return Number(v) * (UNIT[unit.toLowerCase()] ?? 1)
}

/**
 * Best-effort progress extraction from CLI output. The exact non-TTY line format of `geniex pull` was not
 * documented, so match the common shapes: `42%`, `1.2 GiB / 3.8 GiB`, `12.3 MB/s`, `Downloading …`.
 */
export function parseProgressLine(line: string): Partial<Pick<PullJob, 'progress' | 'downloadedBytes' | 'totalBytes' | 'speedBytesPerSec' | 'etaSeconds' | 'message'>> {
  const out: ReturnType<typeof parseProgressLine> = {}
  // Strip ANSI escapes / stray ESC bytes and the block-character bar.
  const clean = line
    .replace(/\[[0-9;?]*[A-Za-z]/g, '')
    .replace(//g, '')
    .replace(/[█▉▊▋▌▍▎▏░▒▓■□▪▫]+/g, '')
    .replace(/\|\s*\|/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const pct = clean.match(/(\d{1,3}(?:\.\d+)?)\s*%/)
  if (pct) out.progress = Math.min(1, Math.max(0, Number(pct[1]) / 100))
  // "1.2 GiB / 3.8 GiB" (units on both) or "(121/788 MB" (shared unit)
  const frac2 = clean.match(/([\d.]+)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)\s*\/\s*([\d.]+)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)\b/i)
  const frac1 = clean.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)\b/i)
  if (frac2) {
    out.downloadedBytes = toBytes(frac2[1], frac2[2])
    out.totalBytes = toBytes(frac2[3], frac2[4])
  } else if (frac1) {
    out.downloadedBytes = toBytes(frac1[1], frac1[3])
    out.totalBytes = toBytes(frac1[2], frac1[3])
  }
  if (out.progress == null && out.totalBytes && out.downloadedBytes != null) out.progress = Math.min(1, out.downloadedBytes / out.totalBytes)
  const speed = clean.match(/([\d.]+)\s*(B|KB|MB|GB|KiB|MiB|GiB)\/s/i)
  if (speed) out.speedBytesPerSec = toBytes(speed[1], speed[2])
  const eta = clean.match(/(?:ETA|eta|:)\s*(?:(\d+)m)?\s*(\d+)s\]?/)
  if (eta) out.etaSeconds = (eta[1] ? Number(eta[1]) * 60 : 0) + Number(eta[2])
  const msg = clean.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim()
  if (msg && !/^[\s\d.%/\-=>#|(),:]+$/.test(msg)) out.message = msg.slice(0, 200)
  return out
}

/** Spawns and tracks `geniex pull` jobs; streams progress via 'update' events. */
export class PullManager extends EventEmitter {
  private jobs = new Map<string, PullJob>()
  private procs = new Map<string, ChildProcess>()

  constructor(
    private readonly sup: GenieXSupervisor,
    private readonly models: ModelManager,
  ) {
    super()
  }

  list(): PullJob[] {
    return [...this.jobs.values()].sort((a, b) => b.startedAt - a.startedAt)
  }

  get(id: string): PullJob | undefined {
    return this.jobs.get(id)
  }

  start(req: PullRequestBody): PullJob {
    const cli = this.sup.cliPath
    if (!cli) throw new Error('GenieX CLI not found')
    if (!req.name?.trim()) throw new Error('model name is required')

    // Refuse duplicates for the same target while one is running.
    for (const j of this.jobs.values()) {
      if ((j.state === 'running' || j.state === 'queued') && j.name === req.name && (j.precision ?? null) === (req.precision ?? null)) return j
    }

    const id = randomUUID()
    const job: PullJob = {
      id,
      name: req.name.trim(),
      precision: req.precision?.trim() || null,
      hub: req.hub ?? null,
      modelType: req.modelType ?? null,
      state: 'running',
      progress: null,
      downloadedBytes: null,
      totalBytes: null,
      speedBytesPerSec: null,
      etaSeconds: null,
      message: 'Starting download…',
      log: [],
      startedAt: Date.now(),
      finishedAt: null,
      error: null,
    }
    this.jobs.set(id, job)

    const target = job.precision ? `${job.name}:${job.precision}` : job.name
    const args = ['pull', target]
    if (job.modelType) args.push('--model-type', job.modelType)
    if (job.hub) args.push('--model-hub', job.hub)
    if (req.localPath) args.push('--local-path', req.localPath)

    const proc = spawnGeniex(cli, args)
    this.procs.set(id, proc)
    this.sup.log('studio', `pull: geniex ${args.join(' ')}`)

    let lastEmit = 0
    const onData = (chunk: string): void => {
      // Progress bars rewrite the line with \r; split on both.
      for (const raw of chunk.split(/[\r\n]+/)) {
        const line = raw.replace(/\[[0-9;?]*[A-Za-z]/g, '').replace(//g, '').trim()
        if (!line) continue
        if (job.log.length >= 200) job.log.shift()
        if (job.log[job.log.length - 1] !== line) job.log.push(line)
        Object.assign(job, parseProgressLine(line))
        if (/error|failed|denied|not found|invalid/i.test(line)) job.error = line
      }
      const now = Date.now()
      if (now - lastEmit > 150) {
        lastEmit = now
        this.emit('update', job)
      }
    }
    proc.stdout?.setEncoding('utf8')
    proc.stderr?.setEncoding('utf8')
    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)

    // Fallback progress: watch the cache directory grow when the CLI prints nothing parseable.
    const dir = join(genieXModelsDir(), ...job.name.split('/'))
    const sizeTimer = setInterval(() => {
      if (job.progress != null) return
      void dirSizeQuick(dir).then((bytes) => {
        if (bytes && bytes !== job.downloadedBytes) {
          job.downloadedBytes = bytes
          this.emit('update', job)
        }
      })
    }, 2000)

    proc.on('exit', (code, signal) => {
      clearInterval(sizeTimer)
      this.procs.delete(id)
      job.finishedAt = Date.now()
      if (job.state === 'cancelled') {
        job.message = 'Cancelled'
      } else if (code === 0) {
        job.state = 'done'
        job.progress = 1
        job.message = 'Download complete'
        job.error = null
      } else {
        job.state = 'error'
        job.error = job.error ?? `geniex pull exited with code ${code ?? signal ?? '?'}`
        job.message = job.error
      }
      this.models.invalidate()
      this.emit('update', job)
      this.emit('done', job)
    })
    proc.on('error', (err) => {
      job.state = 'error'
      job.error = err.message
      job.message = err.message
      job.finishedAt = Date.now()
      this.emit('update', job)
    })

    this.emit('update', job)
    return job
  }

  async cancel(id: string): Promise<PullJob | undefined> {
    const job = this.jobs.get(id)
    const proc = this.procs.get(id)
    if (!job) return undefined
    if (proc && job.state === 'running') {
      job.state = 'cancelled'
      job.message = 'Cancelling…'
      this.emit('update', job)
      await killTree(proc)
    }
    return job
  }

  clearFinished(): void {
    for (const [id, j] of this.jobs) if (j.state !== 'running' && j.state !== 'queued') this.jobs.delete(id)
    this.emit('update', null)
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.procs.values()].map((p) => killTree(p)))
  }
}

async function dirSizeQuick(dir: string): Promise<number | null> {
  let total = 0
  const walk = async (d: string): Promise<void> => {
    const entries = await fs.readdir(d, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile()) total += (await fs.stat(p).catch(() => ({ size: 0 }))).size
    }
  }
  await walk(dir)
  return total || null
}
