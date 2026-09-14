import { describe, expect, it } from 'vitest'
import { compareVersions, isCliVersionSupported } from '@shared/config'
import { classifyHub, parseCatalogueTable, parseChipset, parseListJson, parseVersion } from './cli'
import { parseProgressLine } from './pulls'

describe('parseVersion', () => {
  it('reads the three version lines printed by geniex version', () => {
    const v = parseVersion('GenieX CLI Version:     v0.4.0\nQAIRT Runtime Version:  v2.45.0.260326\nLlamaCPP Runtime Hash:  6ba5ef2\n')
    expect(v).toMatchObject({ cli: 'v0.4.0', qairt: 'v2.45.0.260326', llamaCppHash: '6ba5ef2' })
  })
  it('reads the shorter form v0.6.1 prints', () => {
    const v = parseVersion('GenieX CLI Version:     v0.6.1\nQAIRT Runtime Version:  2.45\nLlamaCPP Runtime Hash:  0eadefe\n')
    expect(v).toMatchObject({ cli: 'v0.6.1', qairt: '2.45', llamaCppHash: '0eadefe' })
  })
})

describe('version gate', () => {
  it('compares GenieX versions numerically and gates on MIN_GENIEX_VERSION', () => {
    expect(compareVersions('v0.6.1', '0.6.0')).toBeGreaterThan(0)
    expect(compareVersions('v0.10.0', 'v0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('0.6.0', 'v0.6.0')).toBe(0)
    expect(isCliVersionSupported('v0.6.1')).toBe(true)
    expect(isCliVersionSupported('v0.4.0')).toBe(false)
    expect(isCliVersionSupported('v0.3.0-alpha.1')).toBe(false)
    expect(isCliVersionSupported(null)).toBeNull()
    expect(isCliVersionSupported('garbage')).toBeNull()
  })
})

describe('parseChipset', () => {
  it('accepts key: value and bare forms', () => {
    expect(parseChipset('chipset: Snapdragon X Elite CRD\n')).toBe('Snapdragon X Elite CRD')
    expect(parseChipset('Snapdragon X Elite CRD')).toBe('Snapdragon X Elite CRD')
  })
})

describe('parseListJson (real geniex list --format json schema)', () => {
  const sample = JSON.stringify([
    { name: 'qualcomm/Qwen3-0.6B', size: 788109397, runtime: 'qairt', type: 'llm', precisions: ['W4A16'] },
    { name: 'unsloth/Qwen3-4B-GGUF', size: 2400000000, runtime: 'llama_cpp', type: 'llm', precisions: ['Q4_0', 'Q8_0'] },
    { name: 'unsloth/Qwen3-VL-2B-Instruct-GGUF', size: 1, runtime: 'llama_cpp', type: 'vlm', precisions: ['Q4_K_M'] },
  ])
  it('maps QAIRT bundles to a single unsuffixed request id', () => {
    const [q] = parseListJson(sample)
    expect(q.requestIds).toEqual(['qualcomm/Qwen3-0.6B'])
    expect(q.hub).toBe('aihub')
    expect(q.npuEligible).toBe(true)
    expect(q.sizeBytes).toBe(788109397)
  })
  it('maps GGUF precisions to name:PRECISION ids and flags Q4_0 as NPU-eligible', () => {
    const [, g, vl] = parseListJson(sample)
    expect(g.requestIds).toEqual(['unsloth/Qwen3-4B-GGUF:Q4_0', 'unsloth/Qwen3-4B-GGUF:Q8_0'])
    expect(g.npuEligible).toBe(true)
    expect(g.hub).toBe('hf')
    expect(vl.type).toBe('vlm')
    expect(vl.npuEligible).toBe(false)
  })
  it('tolerates empty and banner-prefixed output', () => {
    expect(parseListJson('')).toEqual([])
    expect(parseListJson('Checking for updates...\n[]')).toEqual([])
  })
})

describe('parseCatalogueTable', () => {
  it('parses the box-drawing table from geniex model list', () => {
    const table = `Qualcomm AI Hub models for Snapdragon X Elite CRD (use --all to see every model):

┌─────────────────────────────┬──────┐
│ NAME                        │ TYPE │
├─────────────────────────────┼──────┤
│ qualcomm/Qwen3-4B           │  llm │
│ qualcomm/Qwen3-VL-4B-Instruct │  vlm │
└─────────────────────────────┴──────┘`
    const rows = parseCatalogueTable(table, new Set(['qualcomm/Qwen3-4B']))
    expect(rows).toEqual([
      { name: 'qualcomm/Qwen3-4B', type: 'llm', chipsets: [], installed: true, vendor: 'qualcomm' },
      { name: 'qualcomm/Qwen3-VL-4B-Instruct', type: 'vlm', chipsets: [], installed: false, vendor: 'qualcomm' },
    ])
  })
})

describe('classifyHub', () => {
  it('classifies by prefix', () => {
    expect(classifyHub('qualcomm/X')).toBe('aihub')
    expect(classifyHub('ai/gemma3')).toBe('docker')
    expect(classifyHub('local/foo')).toBe('localfs')
    expect(classifyHub('unsloth/Qwen3-4B-GGUF')).toBe('hf')
    expect(classifyHub('qwen3')).toBe('unknown')
  })
})

describe('parseProgressLine (real geniex pull output)', () => {
  it('extracts percent, shared-unit fraction, speed and ETA', () => {
    const p = parseProgressLine('downloading  15% |████                         | (121/788 MB, 15 MB/s) :45s]\x1b')
    expect(p.progress).toBeCloseTo(0.15)
    expect(p.downloadedBytes).toBe(121e6)
    expect(p.totalBytes).toBe(788e6)
    expect(p.speedBytesPerSec).toBe(15e6)
    expect(p.etaSeconds).toBe(45)
    expect(p.message).toMatch(/^downloading 15%/)
    expect(p.message).not.toContain('\x1b')
  })
  it('handles unit-on-both-sides fractions', () => {
    const p = parseProgressLine('1.2 GiB / 3.8 GiB')
    expect(p.downloadedBytes).toBeCloseTo(1.2 * 1024 ** 3)
    expect(p.progress).toBeCloseTo(1.2 / 3.8, 2)
  })
})
