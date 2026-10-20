/**
 * Pure parsers and classifiers for the parts of the `geniex serve` HTTP surface that changed between v0.6.1 and
 * v0.9.3 (see docs/geniex-v0.9-adoption-plan.md §1–2). No I/O here, so it is unit-testable; the client and the
 * supervisor call these.
 */
import type { GenieLiveModel, GenieLiveServerStatus, GenieTimings } from '@shared/api'

/** SDK error code the server returns (HTTP 500) when a model cannot be opened at all. */
export const MODEL_LOAD_FAILED_CODE = -100201

const LOAD_FAILED_MESSAGE = /Model loading failed/i

/**
 * True for the response GenieX 0.9.x gives when a QAIRT bundle cannot be opened:
 * `HTTP 500 {"code":-100201,"error":"SDKError(Model loading failed)"}`. The process stays alive, so none of the
 * crash machinery (process exit, dropped connection) sees it — it has to be recognised from the body.
 */
export function isModelLoadFailure(status: number, code: unknown, message: string | null | undefined): boolean {
  // The SDK code is unambiguous wherever it appears (a 500 body, or an error frame inside a 200 SSE stream).
  if (code === MODEL_LOAD_FAILED_CODE || code === String(MODEL_LOAD_FAILED_CODE)) return true
  // Without the code, only trust the message on a 500: a 400/413 "too long" or a 404 never means this.
  return status === 500 && !!message && LOAD_FAILED_MESSAGE.test(message)
}

/** Studio's own error code for a refused load (surfaced in the chat error event). */
export const MODEL_LOAD_FAILED = 'model_load_failed'

const AI_HUB_ID = /^(qualcomm|ai-hub-models)[/]/i

/**
 * User-facing explanation of a refused load. For AI Hub bundles the known cause is the QAIRT version gap: the
 * bundles on AI Hub are compiled with QAIRT 2.45 (`metadata.json` → `tool_versions.qairt`) while GenieX 0.9.x
 * ships the 2.50 runtime, which cannot create a context from the older binaries
 * (`Failed to create context from binary with err 0x3ef` / `err 1007` in the server log).
 */
export function explainLoadFailure(model: string, info: { cliVersion?: string | null; qairtVersion?: string | null; restarted?: boolean } = {}): string {
  const cli = info.cliVersion ? `GenieX ${info.cliVersion}` : 'this GenieX'
  const qairt = info.qairtVersion ? `QAIRT ${info.qairtVersion.replace(/^v/, '')}` : 'a newer QAIRT runtime'
  const tail = info.restarted ? ' The server has been restarted; the model is remembered as unusable under this CLI version and will not be auto-selected.' : ' The model is remembered as unusable under this CLI version and will not be auto-selected.'
  if (AI_HUB_ID.test(model)) {
    return (
      `${model} could not be loaded: GenieX reported "Model loading failed" (SDK error ${MODEL_LOAD_FAILED_CODE}). ` +
      `This AI Hub bundle was compiled for QAIRT 2.45, and ${cli} ships ${qairt}, which cannot open it on this NPU driver. ` +
      `Update the Qualcomm NPU driver (Qualcomm Software Center → Qualcomm_HND) and try again, wait for a GenieX/AI Hub fix, ` +
      `or use a GGUF Q4_0 model from the Models page — those run fine on the NPU.${tail}`
    )
  }
  return `${model} could not be loaded: GenieX reported "Model loading failed" (SDK error ${MODEL_LOAD_FAILED_CODE}). Try a smaller quantisation or compute "cpu".${tail}`
}

/** Studio's error code when a load neither succeeds nor fails within the warm-up deadline. */
export const MODEL_LOAD_TIMEOUT = 'model_load_timeout'

/**
 * Deadline for a warm-up load. Measured on 2026-10-20 (v0.9.3): a QAIRT bundle that cannot be opened sometimes
 * does not answer 500 at all — `GET /status` stays at `state: loading` for minutes (`openSessionForPriority
 * failed … 0x200`) and every other request hangs behind it. Healthy loads are far shorter: Gemma-4-E2B (4.3 GB)
 * loads in ~6.5 s, a 10 GB bundle well under a minute from NVMe.
 */
export const WARMUP_TIMEOUT_MS = 180_000

/**
 * Explanation for a load that hit the deadline. For AI Hub bundles this is the same QAIRT 2.45 vs 2.50 failure
 * as `explainLoadFailure`, just without the 500 — so it is recorded like one. Anything else is reported but not
 * recorded against the model (a slow disk is not the model's fault).
 */
export function explainLoadStall(model: string, info: { timeoutMs?: number; cliVersion?: string | null; qairtVersion?: string | null; restarted?: boolean } = {}): string {
  const secs = Math.round((info.timeoutMs ?? WARMUP_TIMEOUT_MS) / 1000)
  const restarted = info.restarted ? ' The server has been restarted.' : ''
  if (AI_HUB_ID.test(model)) {
    const cli = info.cliVersion ? `GenieX ${info.cliVersion}` : 'this GenieX'
    const qairt = info.qairtVersion ? `QAIRT ${info.qairtVersion.replace(/^v/, '')}` : 'a newer QAIRT runtime'
    return (
      `${model} did not finish loading within ${secs} s and the server stopped answering. This is how an AI Hub bundle compiled for QAIRT 2.45 ` +
      `fails on ${cli} (${qairt}) when the NPU session cannot be opened.${restarted} The model is remembered as unusable under this CLI version ` +
      `and will not be auto-selected. Update the Qualcomm NPU driver (Qualcomm Software Center → Qualcomm_HND), wait for a GenieX/AI Hub fix, ` +
      `or use a GGUF Q4_0 model.`
    )
  }
  return `${model} did not finish loading within ${secs} s and the server stopped answering.${restarted} Try again; if it keeps happening, try a smaller quantisation or compute "cpu". Nothing was recorded against the model.`
}

// ------------------------------------------------------------------------------------------------ GET /status

/** Epoch seconds, epoch milliseconds or an ISO-8601 string → epoch ms; anything else → null. */
export function toEpochMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v <= 0) return null
    return v < 1e11 ? Math.round(v * 1000) : Math.round(v)
  }
  if (typeof v === 'string' && v.trim()) {
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : t
  }
  return null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null)

/**
 * Parse the body of `GET /status` (GenieX ≥ 0.9.3, #1560):
 * `{alive, models:[{id, type, runtime, device, state, loaded_at, last_activity, idle_seconds}]}`.
 * Returns null when the body is not that shape (so a 200 from some other server is not mistaken for support).
 */
export function parseServerStatus(json: unknown, now: number = Date.now()): GenieLiveServerStatus | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null
  const o = json as { alive?: unknown; models?: unknown }
  if (!Array.isArray(o.models) && typeof o.alive !== 'boolean') return null
  const models: GenieLiveModel[] = []
  for (const raw of Array.isArray(o.models) ? o.models : []) {
    if (!raw || typeof raw !== 'object') continue
    const m = raw as Record<string, unknown>
    const id = str(m.id)
    if (!id) continue
    models.push({
      id,
      type: str(m.type),
      runtime: str(m.runtime),
      device: str(m.device),
      state: str(m.state) ?? 'active',
      loadedAt: toEpochMs(m.loaded_at),
      lastActivity: toEpochMs(m.last_activity),
      idleSeconds: num(m.idle_seconds),
    })
  }
  return { supported: true, checkedAt: now, models }
}

// ------------------------------------------------------------------------------------------------ timings

/**
 * Parse the `timings` object GenieX ≥ 0.7.1 (#1477) attaches to blocking completions and to the final
 * `include_usage` stream chunk. Returns null when absent or empty, so callers fall back to wall-clock numbers.
 */
export function parseTimings(raw: unknown): GenieTimings | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Record<string, unknown>
  const out: GenieTimings = {
    promptTokens: num(t.prompt_n),
    promptMs: num(t.prompt_ms),
    prefillTokensPerSecond: num(t.prompt_per_second),
    predictedTokens: num(t.predicted_n),
    predictedMs: num(t.predicted_ms),
    decodeTokensPerSecond: num(t.predicted_per_second),
  }
  // Derive the rates when the server gave counts and durations but no per-second fields.
  if (out.prefillTokensPerSecond == null && out.promptTokens != null && out.promptMs) out.prefillTokensPerSecond = (out.promptTokens / out.promptMs) * 1000
  if (out.decodeTokensPerSecond == null && out.predictedTokens != null && out.predictedMs) out.decodeTokensPerSecond = (out.predictedTokens / out.predictedMs) * 1000
  // Measured on v0.9.3: a request that is fully served from the KV cache (identical prompt repeated) streams
  // `prompt_n: 0, predicted_n: 0, *_per_second: 0` even though tokens were produced. A zero rate is "not
  // measured", never a speed — report it as absent so the caller falls back to wall-clock numbers.
  if (!out.promptTokens || !(out.prefillTokensPerSecond! > 0)) out.prefillTokensPerSecond = null
  if (!out.predictedTokens || !(out.decodeTokensPerSecond! > 0)) out.decodeTokensPerSecond = null
  if (out.predictedTokens === 0) out.predictedTokens = null
  if (out.promptTokens === 0) out.promptTokens = null
  const any = Object.values(out).some((v) => v != null)
  return any ? out : null
}
