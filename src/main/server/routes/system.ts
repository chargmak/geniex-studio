import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { sampleSystem, type SystemStats } from '../../telemetry/systemStats'

export const systemRoutes = new Hono()

let lastSample: SystemStats | null = null
let sampling: Promise<SystemStats> | null = null

async function sampleOnce(pid: number | null): Promise<SystemStats> {
  if (sampling) return sampling
  sampling = sampleSystem(pid).finally(() => {
    sampling = null
  })
  lastSample = await sampling
  return lastSample
}

systemRoutes.get('/stats', async (c) => {
  const { genie } = c.get('ctx')
  const s = await sampleOnce(genie.status().pid)
  return c.json(s)
})

/** Live stats every ~2.5 s as SSE (one shared sampler regardless of subscribers). */
systemRoutes.get('/stats-events', (c) => {
  const { genie } = c.get('ctx')
  return streamSSE(c, async (stream) => {
    let alive = true
    stream.onAbort(() => {
      alive = false
    })
    while (alive) {
      const s = await sampleOnce(genie.status().pid).catch(() => lastSample)
      if (s) await stream.writeSSE({ event: 'stats', data: JSON.stringify(s) }).catch(() => {})
      await new Promise((r) => setTimeout(r, 2500))
    }
  })
})

systemRoutes.get('/telemetry', (c) => {
  const { repos } = c.get('ctx')
  return c.json({ recent: repos.telemetry.recent(Number(c.req.query('limit') ?? 200)), byModel: repos.telemetry.summaryByModel() })
})

/** Simple benchmark: fixed prompt on a model, returns metrics (runs through the same client → telemetry too). */
systemRoutes.post('/benchmark', async (c) => {
  const { client } = c.get('ctx')
  const body = (await c.req.json().catch(() => ({}))) as { model?: string; compute?: 'npu' | 'gpu' | 'cpu' | 'hybrid'; tokens?: number }
  if (!body.model) return c.json({ error: 'model required' }, 400)
  const started = Date.now()
  let out = ''
  let done: { ttftMs: number | null; totalMs: number; tokensPerSecond: number | null; completionTokens: number | null } | null = null
  let loadMs: number | null = null
  let error: string | null = null
  for await (const ev of client.chatStream({
    model: body.model,
    messages: [{ role: 'user', content: 'Write a detailed, well-structured explanation of how a transformer language model generates text, covering tokenisation, attention, and sampling. Aim for about 300 words.' }],
    sampler: { max_tokens: body.tokens ?? 256, temperature: 0.7 },
    options: { enable_think: false, ...(body.compute ? { compute: body.compute } : {}) },
  })) {
    if (ev.type === 'delta' && ev.content) out += ev.content
    if (ev.type === 'model-ready') loadMs = ev.loadMs
    if (ev.type === 'done') done = { ttftMs: ev.ttftMs, totalMs: ev.totalMs, tokensPerSecond: ev.tokensPerSecond, completionTokens: ev.completionTokens }
    if (ev.type === 'error') error = ev.message
  }
  return c.json({ model: body.model, compute: body.compute ?? null, loadMs, ...done, error, chars: out.length, wallMs: Date.now() - started })
})
