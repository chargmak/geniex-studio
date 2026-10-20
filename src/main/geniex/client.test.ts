import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GenieXClient, GenieXHttpError } from './client'
import { MODEL_LOAD_FAILED, MODEL_LOAD_TIMEOUT } from './protocol'
import type { GenieXSupervisor } from './supervisor'
import type { SettingsStore } from '../settings'

/**
 * Just enough of the supervisor for the client's load paths: the resident-model bookkeeping, the crash records
 * and a restart that flips the state like the real one (which clears the client's residentKey via 'state').
 */
function fakeSupervisor(): GenieXSupervisor & { restarts: number; failures: [string, string][]; logs: string[] } {
  const sup = new EventEmitter() as GenieXSupervisor & { restarts: number; failures: [string, string][]; logs: string[] }
  Object.assign(sup, {
    restarts: 0,
    failures: [],
    logs: [],
    baseUrl: 'http://127.0.0.1:18181',
    isRunning: true,
    managedRunning: true,
    stoppedIntentionally: false,
    cliVersion: 'v0.9.3',
    qairtVersion: '2.50',
    residentModel: null,
    residentSince: null,
    activeModel: null,
    busy: false,
    queueDepth: 0,
    qairtLoadedSinceStart: false,
    server: { supported: true, checkedAt: 1, models: [] },
    lastCrash: null,
    crashedModels: new Map(),
    crashLog: { record: () => ({ count: 1, lastAt: 0, code: 'x' }) },
    start: async () => {},
    noteRuntime() {},
    log(_s: string, line: string) {
      sup.logs.push(line)
    },
    recordLoadFailure(model: string, code: string) {
      sup.failures.push([model, code])
    },
    async restart() {
      sup.restarts++
      sup.emit('state', 'stopping')
      sup.emit('state', 'running')
    },
    async refreshServerStatus() {
      return sup.server
    },
  })
  return sup
}

const settings = { get: () => ({ defaults: { sampler: {}, enableThink: false }, genie: { nctx: 4096, ngl: 99, compute: null } }) } as unknown as SettingsStore

const LOAD_FAILED = new Response(JSON.stringify({ code: -100201, error: 'SDKError(Model loading failed)' }), { status: 500, headers: { 'Content-Type': 'application/json' } })

/** A fetch that only ends when its signal aborts — like the wedged v0.9.3 server (real fetch rejects at once on an already-aborted signal). */
const hangingFetch = (_url: string, init: RequestInit): Promise<Response> =>
  new Promise((_, reject) => {
    const s = init.signal!
    if (s.aborted) reject(s.reason)
    else s.addEventListener('abort', () => reject(s.reason))
  })

describe('GenieXClient warm-up failure paths', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps the v0.9.3 refused load to a diagnosed error, records it and restarts the server once', async () => {
    const sup = fakeSupervisor()
    fetchMock.mockResolvedValueOnce(LOAD_FAILED)
    const client = new GenieXClient(sup, settings)
    const err = await client.warmUp('qualcomm/Qwen3-0.6B').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GenieXHttpError)
    expect((err as GenieXHttpError).code).toBe(MODEL_LOAD_FAILED)
    expect((err as GenieXHttpError).message).toContain('QAIRT 2.45')
    expect(sup.failures).toEqual([['qualcomm/Qwen3-0.6B', '-100201']])
    expect(sup.restarts).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1) // never retried
    expect(sup.activeModel).toBeNull() // process survived: nothing left to attribute
  })

  it('leaves ordinary HTTP errors alone (no record, no restart)', async () => {
    const sup = fakeSupervisor()
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404 }))
    const err = await new GenieXClient(sup, settings).warmUp('nope/none').catch((e: unknown) => e)
    expect((err as GenieXHttpError).status).toBe(404)
    expect(sup.failures).toEqual([])
    expect(sup.restarts).toBe(0)
  })

  it('turns a warm-up that hangs past the deadline into a load failure for an AI Hub bundle and restarts', async () => {
    const sup = fakeSupervisor()
    fetchMock.mockImplementation(hangingFetch)
    const client = new GenieXClient(sup, settings, { warmUpTimeoutMs: 50 })
    const err = await client.warmUp('qualcomm/Qwen3-1.7B').catch((e: unknown) => e)
    expect((err as GenieXHttpError).code).toBe(MODEL_LOAD_FAILED)
    expect((err as GenieXHttpError).message).toMatch(/did not finish loading/)
    expect(sup.failures).toEqual([['qualcomm/Qwen3-1.7B', 'timeout']])
    expect(sup.restarts).toBe(1)
  })

  it('restarts but does not blame a GGUF model whose load stalls', async () => {
    const sup = fakeSupervisor()
    fetchMock.mockImplementation(hangingFetch)
    const client = new GenieXClient(sup, settings, { warmUpTimeoutMs: 50 })
    const err = await client.warmUp('unsloth/Qwen3-4B-GGUF:Q4_0').catch((e: unknown) => e)
    expect((err as GenieXHttpError).code).toBe(MODEL_LOAD_TIMEOUT)
    expect(sup.failures).toEqual([])
    expect(sup.restarts).toBe(1)
  })

  it("a user cancel during warm-up is still a plain abort, not a stall", async () => {
    const sup = fakeSupervisor()
    fetchMock.mockImplementation(hangingFetch)
    const client = new GenieXClient(sup, settings, { warmUpTimeoutMs: 10_000 })
    const ac = new AbortController()
    const p = client.warmUp('unsloth/Qwen3-4B-GGUF:Q4_0', undefined, ac.signal).catch((e: unknown) => e)
    ac.abort()
    const err = (await p) as Error
    expect(err.name).toBe('AbortError')
    expect(sup.restarts).toBe(0)
    expect(sup.failures).toEqual([])
  })
})
