import type { CachedModel } from './api'
import type { Runtime } from './config'

/** One "this model killed the runtime" record (persisted in runtime-crashes.json, mirrored in GenieServerStatus). */
export interface CrashRecord {
  count: number
  lastAt: number
  code: string
  /** GenieX CLI version the crash happened under; a newer CLI is a new runtime and the record is forgotten. */
  cliVersion?: string | null
}

export interface AutoPickOptions {
  /** Models whose load previously killed the runtime (persisted across restarts). */
  crashed?: Record<string, CrashRecord>
  /** The user's saved preference for this role; used when it is installed and not known-broken. */
  preferred?: string | null
  /** Only consider models of this type (e.g. 'vlm' for image questions). */
  type?: string
}

/** Bare name of a request id: `unsloth/Qwen3-4B-GGUF:Q4_0` → `unsloth/Qwen3-4B-GGUF`. */
export function bareModelName(id: string): string {
  const i = id.indexOf(':')
  return i === -1 ? id : id.slice(0, i)
}

/**
 * Resolve any id the user, the server or a saved setting may use — the bare name, a Studio request id
 * (`name:PREC` for GGUF) or the precision-qualified id `/v1/models` reports for every model (QAIRT included,
 * e.g. `qualcomm/Qwen3-0.6B:W4A16`) — to the installed model it belongs to.
 */
export function findInstalled(installed: CachedModel[], id: string | null | undefined): CachedModel | undefined {
  if (!id) return undefined
  return installed.find((m) => m.requestIds.includes(id) || m.name === id) ?? installed.find((m) => m.name === bareModelName(id))
}

/** Runtime family of a model id; falls back to the AI Hub naming convention when the model is not in the list. */
export function runtimeOfModel(id: string, installed: CachedModel[] = []): Runtime {
  const m = findInstalled(installed, id)
  if (m) return m.runtime === 'qairt' ? 'qairt' : 'llama_cpp'
  return /^(qualcomm|ai-hub-models)\//i.test(id) ? 'qairt' : 'llama_cpp'
}

/** Every request id a model can be addressed by, with the model it belongs to. */
function candidates(installed: CachedModel[], type?: string): { id: string; model: CachedModel }[] {
  return installed.filter((m) => !type || m.type === type).flatMap((m) => (m.requestIds.length ? m.requestIds : [m.name]).map((id) => ({ id, model: m })))
}

/**
 * Crashes are recorded against whatever id the request used — a bare name for QAIRT bundles
 * (`qualcomm/Qwen3-0.6B`) but a name:precision request id for GGUF (`unsloth/Qwen3-4B-GGUF:Q4_0`).
 * Always look up both so neither shape is missed.
 */
export function crashRecordFor(crashed: Record<string, CrashRecord> | undefined, id: string, name: string): CrashRecord | undefined {
  if (!crashed) return undefined
  const byId = crashed[id]
  const byName = id === name ? undefined : crashed[name]
  if (byId && byName) return byId.count >= byName.count ? byId : byName
  return byId ?? byName
}

export const crashCount = (crashed: Record<string, CrashRecord> | undefined, id: string, name: string): number =>
  (crashed?.[id]?.count ?? 0) + (id === name ? 0 : (crashed?.[name]?.count ?? 0))

/**
 * Choose a model for a turn when the user has not pinned one.
 *
 * The important rule: never *automatically* select a model that is known to crash the runtime on this device.
 * The user can still pick one by hand (the picker warns), but a fresh chat must not walk into a known crash.
 * Crash records are scoped to the GenieX CLI version they happened under (a CLI update forgets them), so a
 * crash is treated as a per-model fact, never as a verdict on a whole runtime.
 *
 * Order of preference: the saved preference (if usable) → healthy models, larger NPU-eligible ones first →
 * otherwise the least-crashed model, so we still return *something* to try.
 */
export function pickAutoModel(installed: CachedModel[], opts: AutoPickOptions = {}): string | null {
  const list = candidates(installed, opts.type)
  if (!list.length) return null
  const { crashed, preferred } = opts

  if (preferred) {
    const hit = list.find((c) => c.id === preferred || c.model.name === preferred || c.model.name === bareModelName(preferred))
    if (hit && crashCount(crashed, hit.id, hit.model.name) === 0) return hit.id
  }

  const scored = list.map((c) => ({ ...c, crashes: crashCount(crashed, c.id, c.model.name) }))
  const healthy = scored.filter((c) => c.crashes === 0)
  const pool = healthy.length ? healthy : scored
  pool.sort((a, b) => a.crashes - b.crashes || Number(b.model.npuEligible) - Number(a.model.npuEligible) || (b.model.sizeBytes ?? 0) - (a.model.sizeBytes ?? 0))
  return pool[0]?.id ?? null
}
