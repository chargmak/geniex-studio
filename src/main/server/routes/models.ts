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
