import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface CrashRecord {
  count: number
  lastAt: number
  code: string
}

/**
 * Persistent "this model killed the runtime" log.
 *
 * Crash attribution is worth nothing if it is forgotten on every app restart: the next launch would auto-select the
 * same broken model and crash again (exactly what AI Hub QAIRT bundles do on drivers affected by GenieX issue #1154).
 * Kept out of settings.json because it is device/runtime state the user never edits by hand — and because clearing it
 * (after a driver update) must actually delete entries, which the settings deep-merge cannot express.
 */
export class CrashLog {
  readonly file: string
  private value: Record<string, CrashRecord>

  constructor(dataDir: string) {
    this.file = join(dataDir, 'runtime-crashes.json')
    this.value = this.load()
  }

  private load(): Record<string, CrashRecord> {
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          const out: Record<string, CrashRecord> = {}
          for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
            const r = v as Partial<CrashRecord>
            if (typeof r?.count === 'number' && typeof r?.lastAt === 'number') out[k] = { count: r.count, lastAt: r.lastAt, code: String(r.code ?? '?') }
          }
          return out
        }
      }
    } catch (err) {
      console.warn('[studio] failed to read runtime-crashes.json:', err)
    }
    return {}
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.value, null, 2), 'utf8')
      renameSync(tmp, this.file)
    } catch (err) {
      console.warn('[studio] failed to write runtime-crashes.json:', err)
    }
  }

  all(): Record<string, CrashRecord> {
    return { ...this.value }
  }

  entries(): [string, CrashRecord][] {
    return Object.entries(this.value)
  }

  get(model: string): CrashRecord | undefined {
    return this.value[model]
  }

  record(model: string, code: string): CrashRecord {
    const prev = this.value[model]
    const next: CrashRecord = { count: (prev?.count ?? 0) + 1, lastAt: Date.now(), code }
    this.value[model] = next
    this.save()
    return next
  }

  /** Forget one model (or all) — e.g. after an NPU driver update, so the catalogue becomes usable again. */
  clear(model?: string): void {
    if (model) delete this.value[model]
    else this.value = {}
    this.save()
  }
}
