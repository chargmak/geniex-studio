/**
 * Shared constants for main + renderer. Keep this file free of Node/DOM imports.
 */

/** Port of the in-process Studio API server (Hono). Overridable with GENIEX_STUDIO_PORT. */
export const DEFAULT_STUDIO_PORT = 18190

/** Default bind address of `geniex serve`. */
export const DEFAULT_GENIEX_HOST = '127.0.0.1:18181'

/** GenieX server keepalive (seconds a loaded model stays resident after the last request). */
export const DEFAULT_GENIEX_KEEPALIVE_SECONDS = 600

/** Context window default for llama.cpp-backed (GGUF) models. QAIRT bundles have their context baked in (~4096). */
export const DEFAULT_NCTX = 4096

/**
 * Oldest GenieX CLI Studio drives. v0.6.0 brought streamed multi-call tool turns, structural `role: tool`
 * messages, automatic KV-cache continuation (the `GenieX-KeepCache` header is gone) and working AI Hub QAIRT
 * bundles on X Elite. Studio keeps a single code path against that behaviour instead of two.
 */
export const MIN_GENIEX_VERSION = '0.6.0'

export const APP_NAME = 'GenieX Studio'
export const APP_ID = 'dev.stama.geniex-studio'

export type ComputeUnit = 'npu' | 'gpu' | 'cpu' | 'hybrid'
export const COMPUTE_UNITS: readonly ComputeUnit[] = ['npu', 'hybrid', 'gpu', 'cpu'] as const

export type ModelType = 'llm' | 'vlm'
export type ModelHub = 'aihub' | 'hf' | 'modelscope' | 'docker' | 'localfs'
export type Runtime = 'qairt' | 'llama_cpp'

/** `v0.6.1`, `0.6.1`, `0.3.0-alpha.1` → [0, 6, 1]; anything unparseable → null. */
export function parseSemver(v: string | null | undefined): [number, number, number] | null {
  const m = v?.trim().match(/^v?(\d+)\.(\d+)(?:\.(\d+))?/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null
}

/** Negative when a < b, 0 when equal, positive when a > b (pre-release suffixes are ignored). */
export function compareVersions(a: string, b: string): number {
  const pa = parseSemver(a) ?? [0, 0, 0]
  const pb = parseSemver(b) ?? [0, 0, 0]
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}

/** true/false once the version is known; null while it is not (CLI missing or not probed yet). */
export function isCliVersionSupported(version: string | null | undefined): boolean | null {
  if (!version || !parseSemver(version)) return null
  return compareVersions(version, MIN_GENIEX_VERSION) >= 0
}
