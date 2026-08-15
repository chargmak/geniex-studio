import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { CachedModel, CatalogueModel } from '@shared/api'
import type { ModelType } from '@shared/config'
import { parseCatalogueTable, parseListJson, runGeniex } from './cli'
import { genieXModelsDir } from './paths'
import type { GenieXSupervisor } from './supervisor'

const CATALOGUE_TTL_MS = 10 * 60_000

/** Model management is CLI-only in GenieX v0.4.0 (the HTTP server has no pull/remove/catalogue endpoints). */
export class ModelManager extends EventEmitter {
  private catalogueCache: { at: number; rows: CatalogueModel[] } | null = null
  private listCache: { at: number; rows: CachedModel[] } | null = null

  constructor(private readonly sup: GenieXSupervisor) {
    super()
  }

  private cli(): string {
    const p = this.sup.cliPath
    if (!p) throw new Error('GenieX CLI not found')
    return p
  }

  invalidate(): void {
    this.listCache = null
    this.emit('change')
  }

  async list(opts: { fresh?: boolean } = {}): Promise<CachedModel[]> {
    if (!opts.fresh && this.listCache && Date.now() - this.listCache.at < 15_000) return this.listCache.rows
    const r = await runGeniex(this.cli(), ['list', '--format', 'json'], { timeoutMs: 60_000 })
    if (r.code !== 0 && !r.stdout.trim()) throw new Error(`geniex list failed: ${(r.stderr || r.stdout).trim() || r.code}`)
    const rows = parseListJson(r.stdout)
    // Fill sizes from the cache directory when the CLI omits them.
    await Promise.all(
      rows.map(async (m) => {
        if (m.sizeBytes == null) m.sizeBytes = await dirSize(join(genieXModelsDir(), ...m.name.split('/'))).catch(() => null)
      }),
    )
    this.listCache = { at: Date.now(), rows }
    return rows
  }

  async catalogue(opts: { fresh?: boolean; all?: boolean } = {}): Promise<CatalogueModel[]> {
    const installed = new Set((await this.list().catch(() => [] as CachedModel[])).map((m) => m.name))
    if (!opts.fresh && this.catalogueCache && Date.now() - this.catalogueCache.at < CATALOGUE_TTL_MS) {
      return this.catalogueCache.rows.map((r) => ({ ...r, installed: installed.has(r.name) }))
    }
    const args = ['model', 'list']
    if (opts.all) args.push('--all')
    const r = await runGeniex(this.cli(), args, { timeoutMs: 120_000 })
    if (r.code !== 0 && !r.stdout.includes('│')) throw new Error(`geniex model list failed: ${(r.stderr || r.stdout).trim() || r.code}`)
    const rows = parseCatalogueTable(r.stdout, installed)
    this.catalogueCache = { at: Date.now(), rows }
    return rows
  }

  async remove(name: string): Promise<void> {
    const r = await runGeniex(this.cli(), ['remove', name, '-y'], { timeoutMs: 120_000 })
    if (r.code !== 0) throw new Error(`geniex remove failed: ${(r.stderr || r.stdout).trim() || r.code}`)
    this.invalidate()
  }

  async setType(name: string, type: ModelType): Promise<void> {
    const r = await runGeniex(this.cli(), ['model', 'set-type', name, type], { timeoutMs: 60_000 })
    if (r.code !== 0) throw new Error(`geniex model set-type failed: ${(r.stderr || r.stdout).trim() || r.code}`)
    this.invalidate()
  }
}

async function dirSize(dir: string): Promise<number | null> {
  let total = 0
  let any = false
  const walk = async (d: string): Promise<void> => {
    const entries = await fs.readdir(d, { withFileTypes: true })
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile()) {
        const st = await fs.stat(p)
        total += st.size
        any = true
      }
    }
  }
  await walk(dir)
  return any ? total : null
}
