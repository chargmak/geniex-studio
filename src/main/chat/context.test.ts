import { describe, expect, it } from 'vitest'
import { clampMaxTokens, ContextTracker, DEFAULT_TOKEN_FACTOR, isContextOverflowCode, MIN_MAX_TOKENS } from './context'

describe('ContextTracker', () => {
  it('starts with the conservative default factor for unknown conversations', () => {
    const t = new ContextTracker()
    expect(t.factorFor('c1')).toBe(DEFAULT_TOKEN_FACTOR)
    expect(t.factorFor(null)).toBe(DEFAULT_TOKEN_FACTOR)
  })

  it('raises the factor when the server counted more tokens than estimated on a full prefill', () => {
    const t = new ContextTracker()
    t.observe('c1', 1000, 1400) // real tokens/estimate = 1.4
    expect(t.factorFor('c1')).toBeCloseTo(1.4 * 1.05, 5)
  })

  it('never lowers the factor below the default, even when the estimate was pessimistic', () => {
    const t = new ContextTracker()
    t.observe('c1', 1000, 800)
    expect(t.factorFor('c1')).toBe(DEFAULT_TOKEN_FACTOR)
  })

  it('ignores continuation turns, whose prompt_tokens only count the newly prefilled tail', () => {
    const t = new ContextTracker()
    t.observe('c1', 1000, 1400)
    t.observe('c1', 1200, 65) // KV-cache continuation: 65 new tokens, says nothing about the ratio
    expect(t.factorFor('c1')).toBeCloseTo(1.47, 5)
  })

  it('keeps the worst ratio seen and caps it', () => {
    const t = new ContextTracker()
    t.observe('c1', 1000, 1600)
    t.observe('c1', 1000, 1200)
    expect(t.factorFor('c1')).toBeCloseTo(1.68, 5)
    t.observe('c1', 100, 10_000)
    expect(t.factorFor('c1')).toBe(2.5)
  })

  it('bump() pads harder after an overflow and forget() resets', () => {
    const t = new ContextTracker()
    t.bump('c1')
    expect(t.factorFor('c1')).toBeCloseTo(DEFAULT_TOKEN_FACTOR * 1.3, 5)
    t.forget('c1')
    expect(t.factorFor('c1')).toBe(DEFAULT_TOKEN_FACTOR)
  })
})

describe('clampMaxTokens', () => {
  it('leaves a request alone when it fits', () => {
    expect(clampMaxTokens(4096, 1000, 2048)).toBe(2048)
  })
  it('shrinks max_tokens to what is left of the window minus the margin', () => {
    expect(clampMaxTokens(4096, 3000, 2048)).toBe(4096 - 3000 - 256)
  })
  it('never goes below the floor', () => {
    expect(clampMaxTokens(4096, 4000, 2048)).toBe(MIN_MAX_TOKENS)
  })
})

describe('isContextOverflowCode', () => {
  it('recognises the 400 body code and the streamed SDK code', () => {
    expect(isContextOverflowCode('context_length_exceeded')).toBe(true)
    expect(isContextOverflowCode(-200103)).toBe(true)
    expect(isContextOverflowCode('-200103')).toBe(true)
    expect(isContextOverflowCode('context_overflow')).toBe(true)
    expect(isContextOverflowCode('runtime_crash')).toBe(false)
    expect(isContextOverflowCode(undefined)).toBe(false)
  })
})
