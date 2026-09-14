import { describe, expect, it } from 'vitest'
import type { CachedModel } from '@shared/api'
import { bareModelName, crashRecordFor, findInstalled, pickAutoModel, runtimeOfModel } from './select'

const model = (name: string, runtime: string, requestIds: string[], extra: Partial<CachedModel> = {}): CachedModel => ({
  name,
  displayName: name,
  runtime,
  type: 'llm',
  sizeBytes: 1_000_000_000,
  precisions: [],
  hub: 'unknown',
  requestIds,
  npuEligible: true,
  ...extra,
})

// The real shape on this machine: `geniex list` returns the AI Hub QAIRT bundle first.
const INSTALLED = [
  model('qualcomm/Qwen3-0.6B', 'qairt', ['qualcomm/Qwen3-0.6B'], { sizeBytes: 500_000_000 }),
  model('unsloth/Qwen3-0.6B-GGUF', 'llama_cpp', ['unsloth/Qwen3-0.6B-GGUF:Q4_0'], { sizeBytes: 400_000_000 }),
  model('unsloth/Qwen3-4B-GGUF', 'llama_cpp', ['unsloth/Qwen3-4B-GGUF:Q4_0'], { sizeBytes: 2_400_000_000 }),
]
const crash = (n = 1) => ({ count: n, lastAt: Date.now(), code: '0xC0000005' })

describe('pickAutoModel', () => {
  it('returns null when nothing is installed', () => {
    expect(pickAutoModel([])).toBeNull()
  })

  it('honours the saved preference when it is healthy', () => {
    expect(pickAutoModel(INSTALLED, { preferred: 'unsloth/Qwen3-0.6B-GGUF:Q4_0' })).toBe('unsloth/Qwen3-0.6B-GGUF:Q4_0')
  })

  it('ignores the saved preference once that model has crashed', () => {
    const picked = pickAutoModel(INSTALLED, { preferred: 'qualcomm/Qwen3-0.6B', crashed: { 'qualcomm/Qwen3-0.6B': crash() } })
    expect(picked).toBe('unsloth/Qwen3-4B-GGUF:Q4_0')
  })

  it('treats a crash as a per-model fact: an untried QAIRT bundle stays eligible when a sibling crashed', () => {
    // GenieX 0.6 runs AI Hub bundles fine on X Elite; a single crashed bundle must not condemn the whole catalogue.
    const withUntried = [...INSTALLED, model('qualcomm/Qwen3-4B', 'qairt', ['qualcomm/Qwen3-4B'], { sizeBytes: 4_000_000_000 })]
    const picked = pickAutoModel(withUntried, { crashed: { 'qualcomm/Qwen3-0.6B': crash() } })
    expect(picked).toBe('qualcomm/Qwen3-4B')
  })

  it('accepts a saved preference in the precision-qualified form /v1/models reports', () => {
    expect(pickAutoModel(INSTALLED, { preferred: 'qualcomm/Qwen3-0.6B:W4A16' })).toBe('qualcomm/Qwen3-0.6B')
  })

  it('matches crash records stored against the bare model name as well as a request id', () => {
    const ggufOnly = INSTALLED.filter((m) => m.runtime === 'llama_cpp')
    // recorded as the bare name; the request id `…-GGUF:Q4_0` must still be treated as crashed
    expect(pickAutoModel(ggufOnly, { crashed: { 'unsloth/Qwen3-4B-GGUF': crash() } })).toBe('unsloth/Qwen3-0.6B-GGUF:Q4_0')
    expect(pickAutoModel(ggufOnly, { crashed: { 'unsloth/Qwen3-4B-GGUF:Q4_0': crash() } })).toBe('unsloth/Qwen3-0.6B-GGUF:Q4_0')
  })

  it('leaves QAIRT bundles eligible while no QAIRT crash has been recorded (they are the fastest path when they work)', () => {
    expect(pickAutoModel(INSTALLED, { crashed: { 'unsloth/Qwen3-4B-GGUF': crash() } })).toBe('qualcomm/Qwen3-0.6B')
  })

  it('prefers the larger NPU-eligible model among healthy candidates', () => {
    expect(pickAutoModel(INSTALLED)).toBe('unsloth/Qwen3-4B-GGUF:Q4_0')
  })

  it('still returns the least-crashed model when everything has crashed', () => {
    const picked = pickAutoModel(INSTALLED, {
      crashed: { 'qualcomm/Qwen3-0.6B': crash(3), 'unsloth/Qwen3-0.6B-GGUF:Q4_0': crash(1), 'unsloth/Qwen3-4B-GGUF:Q4_0': crash(2) },
    })
    expect(picked).toBe('unsloth/Qwen3-0.6B-GGUF:Q4_0')
  })

  it('filters by model type when asked (vision)', () => {
    const withVlm = [...INSTALLED, model('unsloth/Qwen3-VL-4B-GGUF', 'llama_cpp', ['unsloth/Qwen3-VL-4B-GGUF:Q4_0'], { type: 'vlm' })]
    expect(pickAutoModel(withVlm, { type: 'vlm' })).toBe('unsloth/Qwen3-VL-4B-GGUF:Q4_0')
    expect(pickAutoModel(INSTALLED, { type: 'vlm' })).toBeNull()
  })

  it('falls back to the model name when it exposes no request ids', () => {
    expect(pickAutoModel([model('local/thing', 'llama_cpp', [])])).toBe('local/thing')
  })
})

/**
 * The picker's crash warning has to use the same key resolution as the selector. Crashes are recorded against
 * the id the request actually used — a bare name for QAIRT bundles, but `name:precision` for GGUF — so looking
 * up only `model.name` silently hides every GGUF crash.
 */
describe('findInstalled / runtimeOfModel', () => {
  it('resolves bare names, Studio request ids and server-reported precision ids to the same model', () => {
    expect(findInstalled(INSTALLED, 'qualcomm/Qwen3-0.6B')?.name).toBe('qualcomm/Qwen3-0.6B')
    expect(findInstalled(INSTALLED, 'qualcomm/Qwen3-0.6B:W4A16')?.name).toBe('qualcomm/Qwen3-0.6B')
    expect(findInstalled(INSTALLED, 'unsloth/Qwen3-4B-GGUF:Q4_0')?.name).toBe('unsloth/Qwen3-4B-GGUF')
    expect(findInstalled(INSTALLED, 'unsloth/Qwen3-4B-GGUF')?.name).toBe('unsloth/Qwen3-4B-GGUF')
    expect(findInstalled(INSTALLED, 'nope/none')).toBeUndefined()
    expect(bareModelName('a/b:Q4_0')).toBe('a/b')
  })
  it('falls back to the AI Hub naming convention for models not in the list', () => {
    expect(runtimeOfModel('qualcomm/Qwen3-0.6B:W4A16', INSTALLED)).toBe('qairt')
    expect(runtimeOfModel('unsloth/Qwen3-4B-GGUF:Q4_0', INSTALLED)).toBe('llama_cpp')
    expect(runtimeOfModel('qualcomm/Something-New')).toBe('qairt')
    expect(runtimeOfModel('someone/Model-GGUF:Q4_0')).toBe('llama_cpp')
  })
})

describe('crashRecordFor', () => {
  it('finds a crash recorded against a GGUF request id when given that id', () => {
    const crashed = { 'unsloth/Qwen3-4B-GGUF:Q4_0': crash(2) }
    expect(crashRecordFor(crashed, 'unsloth/Qwen3-4B-GGUF:Q4_0', 'unsloth/Qwen3-4B-GGUF')).toMatchObject({ count: 2 })
  })

  it('finds a crash recorded against the bare name when given a request id', () => {
    const crashed = { 'unsloth/Qwen3-4B-GGUF': crash(1) }
    expect(crashRecordFor(crashed, 'unsloth/Qwen3-4B-GGUF:Q4_0', 'unsloth/Qwen3-4B-GGUF')).toMatchObject({ count: 1 })
  })

  it('finds a QAIRT crash where the request id and the name are the same', () => {
    expect(crashRecordFor({ 'qualcomm/Gemma-4-E4B-it': crash(3) }, 'qualcomm/Gemma-4-E4B-it', 'qualcomm/Gemma-4-E4B-it')).toMatchObject({ count: 3 })
  })

  it('prefers the record with more crashes when both keys exist', () => {
    const crashed = { 'unsloth/Qwen3-4B-GGUF': crash(1), 'unsloth/Qwen3-4B-GGUF:Q4_0': crash(5) }
    expect(crashRecordFor(crashed, 'unsloth/Qwen3-4B-GGUF:Q4_0', 'unsloth/Qwen3-4B-GGUF')).toMatchObject({ count: 5 })
  })

  it('returns undefined for a healthy model and for no crash log at all', () => {
    expect(crashRecordFor({ 'other/model': crash() }, 'unsloth/Qwen3-4B-GGUF:Q4_0', 'unsloth/Qwen3-4B-GGUF')).toBeUndefined()
    expect(crashRecordFor(undefined, 'a', 'a')).toBeUndefined()
  })
})
