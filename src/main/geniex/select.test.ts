import { describe, expect, it } from 'vitest'
import type { CachedModel } from '@shared/api'
import { pickAutoModel } from './select'

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

  it('avoids every QAIRT bundle once one of them has crashed (runtime-wide failure, issue #1154)', () => {
    const withUntried = [...INSTALLED, model('qualcomm/Qwen3-4B', 'qairt', ['qualcomm/Qwen3-4B'], { sizeBytes: 4_000_000_000 })]
    const picked = pickAutoModel(withUntried, { crashed: { 'qualcomm/Qwen3-0.6B': crash() } })
    expect(picked).toBe('unsloth/Qwen3-4B-GGUF:Q4_0')
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
