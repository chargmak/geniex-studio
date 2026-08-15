import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { PullRequestBody } from '@shared/api'

export const modelRoutes = new Hono()

modelRoutes.get('/', async (c) => {
  const { models } = c.get('ctx')
  try {
    return c.json({ models: await models.list({ fresh: c.req.query('fresh') === '1' }) })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err), models: [] }, 500)
  }
})

modelRoutes.get('/catalogue', async (c) => {
  const { models } = c.get('ctx')
  try {
    return c.json({ models: await models.catalogue({ fresh: c.req.query('fresh') === '1', all: c.req.query('all') === '1' }) })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err), models: [] }, 500)
  }
})

modelRoutes.delete('/:name{.+}', async (c) => {
  const { models } = c.get('ctx')
  const name = decodeURIComponent(c.req.param('name'))
  try {
    await models.remove(name)
    return c.json({ ok: true })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

modelRoutes.post('/set-type', async (c) => {
  const { models } = c.get('ctx')
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; type?: 'llm' | 'vlm' }
  if (!body.name || (body.type !== 'llm' && body.type !== 'vlm')) return c.json({ error: 'name and type (llm|vlm) required' }, 400)
  try {
    await models.setType(body.name, body.type)
    return c.json({ ok: true })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ---------------------------------------------------------------- pulls

modelRoutes.get('/pulls', (c) => {
  const { pulls } = c.get('ctx')
  return c.json({ jobs: pulls.list() })
})

modelRoutes.post('/pulls', async (c) => {
  const { pulls } = c.get('ctx')
  const body = (await c.req.json().catch(() => null)) as PullRequestBody | null
  if (!body?.name) return c.json({ error: 'name is required' }, 400)
  try {
    return c.json({ job: pulls.start(body) }, 202)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

modelRoutes.get('/pulls/:id', (c) => {
  const { pulls } = c.get('ctx')
  const job = pulls.get(c.req.param('id'))
  return job ? c.json({ job }) : c.json({ error: 'not found' }, 404)
})

modelRoutes.post('/pulls/:id/cancel', async (c) => {
  const { pulls } = c.get('ctx')
  const job = await pulls.cancel(c.req.param('id'))
  return job ? c.json({ job }) : c.json({ error: 'not found' }, 404)
})

modelRoutes.post('/pulls/clear', (c) => {
  const { pulls } = c.get('ctx')
  pulls.clearFinished()
  return c.json({ ok: true })
})

/** Live pull progress for all jobs. */
modelRoutes.get('/pulls-events', (c) => {
  const { pulls } = c.get('ctx')
  return streamSSE(c, async (stream) => {
    const onUpdate = (): void => void stream.writeSSE({ event: 'jobs', data: JSON.stringify(pulls.list()) })
    pulls.on('update', onUpdate)
    onUpdate()
    const ping = setInterval(() => void stream.writeSSE({ event: 'ping', data: String(Date.now()) }), 15_000)
    stream.onAbort(() => {
      clearInterval(ping)
      pulls.off('update', onUpdate)
    })
    await new Promise<void>((resolve) => stream.onAbort(resolve))
  })
})

// ---------------------------------------------------------------- Hugging Face helper (GGUF quant discovery)

/** Lists GGUF quantisations available in a HF repo so the pull dialog can offer a precision picker (Q4_0 = NPU-friendly). */
modelRoutes.get('/hf/:repo{.+}', async (c) => {
  const repo = decodeURIComponent(c.req.param('repo')).replace(/^\/+|\/+$/g, '')
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return c.json({ error: 'repo must look like owner/name' }, 400)
  try {
    const res = await fetch(`https://huggingface.co/api/models/${repo}?blobs=true`, { headers: { Accept: 'application/json', ...(process.env.HF_TOKEN ? { Authorization: `Bearer ${process.env.HF_TOKEN}` } : {}) }, signal: AbortSignal.timeout(20_000) })
    if (res.status === 404) return c.json({ error: 'repository not found' }, 404)
    if (!res.ok) return c.json({ error: `Hugging Face returned ${res.status}` }, 502)
    const json = (await res.json()) as { siblings?: { rfilename: string; size?: number }[]; gated?: boolean | string; pipeline_tag?: string; tags?: string[] }
    const files = (json.siblings ?? []).filter((s) => s.rfilename.toLowerCase().endsWith('.gguf'))
    const mmproj = files.filter((f) => /mmproj/i.test(f.rfilename))
    const quants = files
      .filter((f) => !/mmproj/i.test(f.rfilename))
      .map((f) => {
        const m = f.rfilename.match(/[-_.]((?:IQ|Q|BF|F|MXFP)\d[\w]*)(?:-\d+-of-\d+)?\.gguf$/i)
        return { file: f.rfilename, precision: m ? m[1].toUpperCase() : f.rfilename.replace(/\.gguf$/i, ''), sizeBytes: f.size ?? null, npuEligible: /^Q4_0$/i.test(m?.[1] ?? '') }
      })
      .sort((a, b) => Number(b.npuEligible) - Number(a.npuEligible) || (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0))
    const isVision = mmproj.length > 0 || (json.tags ?? []).some((t) => /image-text|vision|multimodal/i.test(t)) || /VL|vision/i.test(repo)
    return c.json({ repo, gated: !!json.gated, quants, hasMmproj: mmproj.length > 0, suggestedType: isVision ? 'vlm' : 'llm' })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502)
  }
})
