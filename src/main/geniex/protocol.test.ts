import { describe, expect, it } from 'vitest'
import { explainLoadFailure, explainLoadStall, isModelLoadFailure, MODEL_LOAD_FAILED_CODE, parseServerStatus, parseTimings, toEpochMs } from './protocol'

// Verbatim from a v0.9.3 `geniex serve` answering a chat completion for qualcomm/Qwen3-0.6B (2026-10-20).
const LOAD_FAILED_BODY = { code: -100201, error: 'SDKError(Model loading failed)' }

describe('isModelLoadFailure', () => {
  it('recognises the v0.9.3 QAIRT bundle failure by its SDK code', () => {
    expect(isModelLoadFailure(500, LOAD_FAILED_BODY.code, LOAD_FAILED_BODY.error)).toBe(true)
    expect(isModelLoadFailure(500, '-100201', 'SDKError(Model loading failed)')).toBe(true)
    expect(MODEL_LOAD_FAILED_CODE).toBe(-100201)
  })
  it('accepts the code inside an SSE error frame (HTTP 200) too', () => {
    expect(isModelLoadFailure(200, -100201, 'SDKError(Model loading failed)')).toBe(true)
  })
  it('falls back to the message only on a 500', () => {
    expect(isModelLoadFailure(500, undefined, 'SDKError(Model loading failed)')).toBe(true)
    expect(isModelLoadFailure(502, undefined, 'Model loading failed')).toBe(false)
  })
  it('never matches overflows, not-found or other SDK errors', () => {
    expect(isModelLoadFailure(400, 'context_length_exceeded', "The prompt is longer than the model's context window.")).toBe(false)
    expect(isModelLoadFailure(200, -200103, 'Input prompt too long')).toBe(false)
    expect(isModelLoadFailure(404, undefined, 'model not found')).toBe(false)
    expect(isModelLoadFailure(500, -100999, 'SDKError(Something else)')).toBe(false)
  })
})

describe('explainLoadFailure', () => {
  it('names the QAIRT 2.45 vs 2.50 gap and the GGUF way out for AI Hub bundles', () => {
    const msg = explainLoadFailure('qualcomm/Qwen3-1.7B', { cliVersion: 'v0.9.3', qairtVersion: '2.50', restarted: true })
    expect(msg).toContain('qualcomm/Qwen3-1.7B')
    expect(msg).toContain('QAIRT 2.45')
    expect(msg).toContain('GenieX v0.9.3')
    expect(msg).toContain('QAIRT 2.50')
    expect(msg).toMatch(/NPU driver/)
    expect(msg).toMatch(/GGUF Q4_0/)
    expect(msg).toMatch(/restarted/)
    expect(msg).toMatch(/not be auto-selected/)
  })
  it('does not blame the bundle format for non-AI-Hub models', () => {
    const msg = explainLoadFailure('unsloth/Qwen3-4B-GGUF:Q4_0')
    expect(msg).not.toContain('QAIRT 2.45')
    expect(msg).toMatch(/Model loading failed/)
    expect(msg).not.toMatch(/restarted/)
  })
})

describe('explainLoadStall', () => {
  it('treats a hung AI Hub load as the same QAIRT failure, recorded, with the deadline named', () => {
    const msg = explainLoadStall('qualcomm/Qwen3-0.6B', { timeoutMs: 180_000, cliVersion: 'v0.9.3', qairtVersion: '2.50', restarted: true })
    expect(msg).toMatch(/180 s/)
    expect(msg).toContain('QAIRT 2.45')
    expect(msg).toMatch(/restarted/)
    expect(msg).toMatch(/not be auto-selected/)
  })
  it('does not blame a GGUF model for a slow or stuck load', () => {
    const msg = explainLoadStall('unsloth/Qwen3-4B-GGUF:Q4_0', { timeoutMs: 90_000 })
    expect(msg).toMatch(/90 s/)
    expect(msg).toMatch(/Nothing was recorded/)
    expect(msg).not.toContain('QAIRT 2.45')
  })
})

describe('parseServerStatus (GET /status, v0.9.3)', () => {
  it('parses the live v0.9.3 answer (ISO timestamps with 7 fractional digits and a zone offset)', () => {
    const live = parseServerStatus({
      alive: true,
      models: [{ id: 'unsloth/Qwen3-0.6B-GGUF:Q4_0', type: 'llm', runtime: 'llama_cpp', device: 'HTP0', state: 'idle', loaded_at: '2026-10-20T13:21:14.2795765+02:00', last_activity: '2026-10-20T13:21:14.6198844+02:00', idle_seconds: 0 }],
    })
    expect(live?.models[0].loadedAt).toBe(Date.parse('2026-10-20T11:21:14.279Z'))
    expect(live?.models[0].idleSeconds).toBe(0)
  })
  it('parses the mid-load answer, which has no timestamps yet (live v0.9.3, QAIRT bundle wedged in loading)', () => {
    const live = parseServerStatus({ alive: true, models: [{ id: 'qualcomm/Qwen3-0.6B', type: 'llm', runtime: 'qairt', device: 'NPU', state: 'loading', idle_seconds: 0 }] })
    expect(live?.models[0]).toMatchObject({ id: 'qualcomm/Qwen3-0.6B', device: 'NPU', state: 'loading', loadedAt: null, lastActivity: null })
  })
  it('parses a loaded GGUF model on the HTP as the live response shows it', () => {
    const live = parseServerStatus(
      {
        alive: true,
        models: [{ id: 'unsloth/Qwen3-0.6B-GGUF:Q4_0', type: 'llm', runtime: 'llama_cpp', device: 'HTP0', state: 'idle', loaded_at: '2026-10-20T11:02:17Z', last_activity: 1760958200, idle_seconds: 42.5 }],
      },
      1_000,
    )
    expect(live).toEqual({
      supported: true,
      checkedAt: 1_000,
      models: [{ id: 'unsloth/Qwen3-0.6B-GGUF:Q4_0', type: 'llm', runtime: 'llama_cpp', device: 'HTP0', state: 'idle', loadedAt: Date.parse('2026-10-20T11:02:17Z'), lastActivity: 1760958200_000, idleSeconds: 42.5 }],
    })
  })
  it('returns an empty list after keep-alive eviction', () => {
    expect(parseServerStatus({ alive: true, models: [] })?.models).toEqual([])
  })
  it('tolerates missing fields and skips entries without an id', () => {
    const live = parseServerStatus({ models: [{ id: 'a/b' }, { state: 'active' }, null] })
    expect(live?.models).toEqual([{ id: 'a/b', type: null, runtime: null, device: null, state: 'active', loadedAt: null, lastActivity: null, idleSeconds: null }])
  })
  it('rejects bodies that are not the /status shape (so a stray 200 is not taken as support)', () => {
    expect(parseServerStatus(null)).toBeNull()
    expect(parseServerStatus('GenieX server is running')).toBeNull()
    expect(parseServerStatus({ data: [] })).toBeNull()
    expect(parseServerStatus([1, 2])).toBeNull()
  })
  it('normalises epoch seconds, epoch ms and ISO strings to ms', () => {
    expect(toEpochMs(1760958200)).toBe(1760958200_000)
    expect(toEpochMs(1760958200_123)).toBe(1760958200_123)
    expect(toEpochMs('2026-10-20T11:02:17Z')).toBe(Date.parse('2026-10-20T11:02:17Z'))
    expect(toEpochMs('soon')).toBeNull()
    expect(toEpochMs(0)).toBeNull()
    expect(toEpochMs(undefined)).toBeNull()
  })
})

describe('parseTimings (completion `timings`, v0.7.1+)', () => {
  it('reads prefill and decode speed from the server numbers', () => {
    const t = parseTimings({ prompt_n: 37, prompt_ms: 73.5, prompt_per_second: 503.4, predicted_n: 128, predicted_ms: 1882.3, predicted_per_second: 68.0 })
    expect(t).toEqual({ promptTokens: 37, promptMs: 73.5, prefillTokensPerSecond: 503.4, predictedTokens: 128, predictedMs: 1882.3, decodeTokensPerSecond: 68.0 })
  })
  it('derives the rates when only counts and durations are present', () => {
    const t = parseTimings({ prompt_n: 100, prompt_ms: 200, predicted_n: 50, predicted_ms: 1000 })
    expect(t?.prefillTokensPerSecond).toBeCloseTo(500)
    expect(t?.decodeTokensPerSecond).toBeCloseTo(50)
  })
  it('treats the all-zero timings of a fully cached repeat (measured on v0.9.3) as "not measured"', () => {
    // Verbatim final include_usage chunk after repeating an identical prompt: tokens were produced, numbers are 0.
    const t = parseTimings({ prompt_n: 0, prompt_ms: 0.005, prompt_per_second: 0, predicted_n: 0, predicted_ms: 0.199, predicted_per_second: 0 })
    expect(t?.decodeTokensPerSecond).toBeNull()
    expect(t?.prefillTokensPerSecond).toBeNull()
    expect(t?.predictedTokens).toBeNull()
    // …so `timings.decodeTokensPerSecond ?? wallClockTps` picks the wall-clock estimate, never 0 tok/s.
    expect(t?.decodeTokensPerSecond ?? 42).toBe(42)
  })
  it('returns null when absent or empty, so wall-clock numbers are used (CLIs < 0.7.1)', () => {
    expect(parseTimings(undefined)).toBeNull()
    expect(parseTimings(null)).toBeNull()
    expect(parseTimings({})).toBeNull()
    expect(parseTimings('fast')).toBeNull()
  })
})
