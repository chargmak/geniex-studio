import type { CachedModel } from '@shared/api'
import type { CrashRecord } from './crashLog'

export interface AutoPickOptions {
  /** Models whose load previously killed the runtime (persisted across restarts). */
  crashed?: Record<string, CrashRecord>
  /** The user's saved preference for this role; used when it is installed and not known-broken. */
  preferred?: string | null
  /** Only consider models of this type (e.g. 'vlm' for image questions). */
  type?: string
}

/** Every request id a model can be addressed by, with the model it belongs to. */
function candidates(installed: CachedModel[], type?: string): { id: string; model: CachedModel }[] {
  return installed.filter((m) => !type || m.type === type).flatMap((m) => (m.requestIds.length ? m.requestIds : [m.name]).map((id) => ({ id, model: m })))
}

const crashCount = (crashed: Record<string, CrashRecord> | undefined, id: string, name: string): number => (crashed?.[id]?.count ?? 0) + (id === name ? 0 : (crashed?.[name]?.count ?? 0))

/**
 * Choose a model for a turn when the user has not pinned one.
 *
 * The important rule: never *automatically* select a model that is known to crash the runtime on this device.
 * The user can still pick one by hand (the picker warns), but a fresh chat must not walk into a known crash —
 * on X Elite systems hit by GenieX issue #1154 the whole AI Hub QAIRT catalogue behaves that way, and
 * `geniex list` happens to return those bundles first.
 *
 * Order of preference: the saved preference (if usable) → healthy models, GGUF/llama.cpp ahead of QAIRT once any
 * QAIRT bundle has crashed here → otherwise the least-crashed model, so we still return *something* to try.
 */
export function pickAutoModel(installed: CachedModel[], opts: AutoPickOptions = {}): string | null {
  const list = candidates(installed, opts.type)
  if (!list.length) return null
  const { crashed, preferred } = opts

  if (preferred) {
    const hit = list.find((c) => c.id === preferred || c.model.name === preferred)
    if (hit && crashCount(crashed, hit.id, hit.model.name) === 0) return hit.id
  }

  // Distrust the whole QAIRT runtime once one of its bundles has crashed: the failure is a driver/runtime
  // incompatibility, not a per-model quirk, so untried bundles are just as likely to take the server down.
  const qairtSuspect = Object.keys(crashed ?? {}).some((name) => installed.some((m) => m.runtime === 'qairt' && (m.name === name || m.requestIds.includes(name))))

  const scored = list.map((c) => {
    const crashes = crashCount(crashed, c.id, c.model.name)
    const risky = crashes > 0 || (qairtSuspect && c.model.runtime === 'qairt')
    return { ...c, crashes, risky }
  })
  const healthy = scored.filter((c) => !c.risky)
  const pool = healthy.length ? healthy : scored
  pool.sort((a, b) => a.crashes - b.crashes || Number(b.model.npuEligible) - Number(a.model.npuEligible) || (b.model.sizeBytes ?? 0) - (a.model.sizeBytes ?? 0))
  return pool[0]?.id ?? null
}
