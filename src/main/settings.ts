import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS, mergeSettings, type StudioSettings } from '@shared/settings'

/**
 * Small JSON-file settings store with atomic writes and change events. Chat data lives in SQLite; this holds
 * only configuration that must be readable before the DB is open (e.g. how to start `geniex serve`).
 */
export class SettingsStore extends EventEmitter {
  readonly file: string
  private value: StudioSettings

  constructor(dataDir: string) {
    super()
    this.file = join(dataDir, 'settings.json')
    this.value = this.load()
  }

  get(): StudioSettings {
    return this.value
  }

  patch(partial: unknown): StudioSettings {
    const next = mergeSettings(this.value, partial)
    this.value = next
    this.save()
    this.emit('change', next)
    return next
  }

  private load(): StudioSettings {
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
        return mergeSettings(structuredClone(DEFAULT_SETTINGS), raw)
      }
    } catch (err) {
      console.warn('[settings] failed to read settings.json, using defaults:', err)
    }
    return structuredClone(DEFAULT_SETTINGS)
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.value, null, 2), 'utf8')
      renameSync(tmp, this.file)
    } catch (err) {
      console.error('[settings] failed to write settings.json:', err)
    }
  }
}
