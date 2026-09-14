import { execFile, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import type { CachedModel, CatalogueModel } from '@shared/api'
import type { ModelHub } from '@shared/config'

export interface CliResult {
  code: number | null
  stdout: string
  stderr: string
  durationMs: number
}

/** Process-wide GenieX environment chosen in Settings; applies to every `geniex` we spawn (serve, pull, list…). */
let geniexEnv: { dataDir: string | null; qairtLib: string | null } = { dataDir: null, qairtLib: null }

export function configureGeniexEnv(next: Partial<typeof geniexEnv>): void {
  geniexEnv = { ...geniexEnv, ...next }
}

export function currentGeniexEnv(): typeof geniexEnv {
  return geniexEnv
}

const BASE_ENV = (): NodeJS.ProcessEnv => ({
  ...process.env,
  NO_COLOR: '1',
  TERM: 'dumb',
  // Never let the CLI block on its update check when driven programmatically.
  GENIEX_SKIP_UPDATE: '1',
  // Model cache location and QAIRT runtime override, same knobs the CLI reads from its own env.
  ...(geniexEnv.dataDir ? { GENIEX_DATADIR: geniexEnv.dataDir } : {}),
  ...(geniexEnv.qairtLib ? { GENIEX_QAIRT_LIB: geniexEnv.qairtLib } : {}),
})

/** Run a short-lived geniex command (list/version/config/model list/remove/set-type). Always appends --skip-update. */
export function runGeniex(cliPath: string, args: string[], opts: { timeoutMs?: number; cwd?: string } = {}): Promise<CliResult> {
  const started = Date.now()
  return new Promise((resolve) => {
    execFile(
      cliPath,
      [...args, '--skip-update'],
      {
        env: BASE_ENV(),
        windowsHide: true,
        timeout: opts.timeoutMs ?? 60_000,
        maxBuffer: 16 * 1024 * 1024,
        cwd: opts.cwd,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        const code = error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? ((error as { code: number }).code as number) : error ? 1 : 0
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), durationMs: Date.now() - started })
      },
    )
  })
}

/** Spawn a long-lived geniex process (serve, pull) with the standard env. */
export function spawnGeniex(cliPath: string, args: string[], opts: SpawnOptions = {}): ChildProcess {
  return spawn(cliPath, [...args, '--skip-update'], {
    env: BASE_ENV(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  })
}

// ---------------------------------------------------------------- parsers

export interface GenieXVersion {
  cli: string | null
  qairt: string | null
  llamaCppHash: string | null
  raw: string
}

/** Parses `geniex version` (v0.6.1 prints `QAIRT Runtime Version:  2.45`, v0.4 printed `v2.45.0.260326`):
 *   GenieX CLI Version:     v0.6.1
 *   QAIRT Runtime Version:  2.45
 *   LlamaCPP Runtime Hash:  0eadefe
 */
export function parseVersion(text: string): GenieXVersion {
  const grab = (re: RegExp): string | null => {
    const m = text.match(re)
    return m ? m[1].trim() : null
  }
  return {
    cli: grab(/GenieX CLI Version:\s*(\S+)/i),
    qairt: grab(/QAIRT Runtime Version:\s*(\S+)/i),
    llamaCppHash: grab(/LlamaCPP Runtime Hash:\s*(\S+)/i),
    raw: text.trim(),
  }
}

/** Parses `geniex config list` / `geniex config get chipset` (either `chipset: X` or bare `X`). */
export function parseChipset(text: string): string | null {
  const m = text.match(/chipset:\s*(.+)/i)
  if (m) return m[1].trim()
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('Usage') && !l.startsWith('Error'))
  return line ?? null
}

/** Best-effort hub classification from a cached model name. */
export function classifyHub(name: string): ModelHub | 'unknown' {
  const lower = name.toLowerCase()
  if (lower.startsWith('qualcomm/') || lower.startsWith('ai-hub-models/')) return 'aihub'
  if (lower.startsWith('docker.io/') || lower.startsWith('ai/')) return 'docker'
  if (lower.startsWith('local/')) return 'localfs'
  // ModelScope repos share the owner/name shape with Hugging Face; the cache does not record the source hub.
  if (lower.includes('/')) return 'hf'
  return 'unknown'
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
    // "1.2 GiB" style
    const m = v.match(/^([\d.]+)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)$/i)
    if (m) {
      const mult: Record<string, number> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 }
      return Number(m[1]) * (mult[m[2].toLowerCase()] ?? 1)
    }
  }
  return null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * Parses `geniex list --format json`. The documented stable schema is {name, size, runtime, type, precisions};
 * the plausible variants (model_name|Name, total_size|Size, Runtime, model_type|Type, Precisions) are accepted too.
 */
export function parseListJson(text: string): CachedModel[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  let data: unknown
  try {
    data = JSON.parse(trimmed)
  } catch {
    // Some CLIs print a banner before JSON; take the last JSON array in the output.
    const idx = trimmed.lastIndexOf('[')
    if (idx === -1) return []
    try {
      data = JSON.parse(trimmed.slice(idx))
    } catch {
      return []
    }
  }
  const arr: unknown[] = Array.isArray(data) ? data : Array.isArray((data as { models?: unknown[] })?.models) ? (data as { models: unknown[] }).models : []
  return arr
    .map((raw): CachedModel | null => {
      if (!raw || typeof raw !== 'object') return null
      const o = raw as Record<string, unknown>
      const name = str(o.name) ?? str(o.model_name) ?? str(o.Name) ?? str(o.model) ?? str(o.id)
      if (!name) return null
      const runtime = (str(o.runtime) ?? str(o.Runtime) ?? str(o.plugin) ?? 'unknown').toLowerCase()
      const type = (str(o.type) ?? str(o.model_type) ?? str(o.Type) ?? 'llm').toLowerCase()
      const precRaw = o.precisions ?? o.Precisions ?? o.precision ?? o.quantizations
      const precisions = Array.isArray(precRaw)
        ? precRaw.map((p) => (typeof p === 'string' ? p : str((p as { name?: unknown })?.name) ?? '')).filter(Boolean)
        : typeof precRaw === 'string' && precRaw && precRaw !== 'N/A'
          ? [precRaw]
          : []
      const sizeBytes = num(o.size ?? o.total_size ?? o.Size ?? o.size_bytes)
      const hub = classifyHub(name)
      const isQairt = runtime.includes('qairt') || runtime.includes('genie')
      const requestIds = isQairt || precisions.length === 0 ? [name] : precisions.map((p) => `${name}:${p}`)
      const npuEligible = isQairt || precisions.some((p) => /^q4_0$/i.test(p))
      return {
        name,
        displayName: name.split('/').pop() ?? name,
        runtime: isQairt ? 'qairt' : runtime.includes('llama') ? 'llama_cpp' : runtime,
        type,
        sizeBytes,
        precisions,
        hub,
        requestIds,
        npuEligible,
      }
    })
    .filter((m): m is CachedModel => !!m)
}

/**
 * Parses the box-drawing table printed by `geniex model list [--all]`:
 * │ NAME │ TYPE │ [CHIPSETS] │
 */
export function parseCatalogueTable(text: string, installed: Set<string>): CatalogueModel[] {
  const rows: CatalogueModel[] = []
  let headers: string[] | null = null
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('│')) continue
    const cells = line
      .split('│')
      .map((c) => c.trim())
      .filter((c, i, arr) => !(i === 0 && c === '') && !(i === arr.length - 1 && c === ''))
    if (!cells.length) continue
    if (!headers) {
      if (cells.some((c) => /^NAME$/i.test(c))) headers = cells.map((c) => c.toUpperCase())
      continue
    }
    const get = (h: string): string => {
      const i = headers!.indexOf(h)
      return i >= 0 ? (cells[i] ?? '') : ''
    }
    const name = get('NAME')
    if (!name) continue
    const chipsets = get('CHIPSETS')
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean)
    rows.push({ name, type: (get('TYPE') || 'llm').toLowerCase(), chipsets, installed: installed.has(name), vendor: 'qualcomm' })
  }
  return rows
}
