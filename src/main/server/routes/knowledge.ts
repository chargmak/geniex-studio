import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { KnowledgeProgress } from '../../knowledge/service'
import type { KnowledgeSource } from '@shared/sidecar'

/** /api/knowledge — local RAG over text folders/files, embedded on the NPU (nomic-embed-text). */
export const knowledgeRoutes = new Hono()

knowledgeRoutes.get('/sources', (c) => {
  const { knowledge } = c.get('ctx')
  return c.json({ sources: knowledge.list(), ready: knowledge.hasReadySources() })
})

knowledgeRoutes.post('/sources', async (c) => {
  const { knowledge } = c.get('ctx')
  const body = (await c.req.json().catch(() => ({}))) as { path?: string; name?: string }
  if (!body.path?.trim()) return c.json({ error: 'path is required' }, 400)
  try {
    const src = await knowledge.add(body.path.trim(), body.name)
    return c.json({ source: src }, 201)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
  }
})

knowledgeRoutes.post('/sources/:id/reindex', (c) => {
  const { knowledge } = c.get('ctx')
  const id = c.req.param('id')
  if (!knowledge.get(id)) return c.json({ error: 'not found' }, 404)
  void knowledge.reindex(id).catch(() => {})
  return c.json({ ok: true })
})

knowledgeRoutes.delete('/sources/:id', (c) => {
  const { knowledge } = c.get('ctx')
  return knowledge.remove(c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404)
})

knowledgeRoutes.post('/search', async (c) => {
  const { knowledge } = c.get('ctx')
  const body = (await c.req.json().catch(() => ({}))) as { query?: string; topK?: number; sourceIds?: string[] }
  if (!body.query?.trim()) return c.json({ error: 'query is required' }, 400)
  try {
    const t0 = Date.now()
    const hits = await knowledge.search(body.query, { topK: body.topK, sourceIds: body.sourceIds })
    return c.json({ hits, durationMs: Date.now() - t0 })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502)
  }
})

/** SSE: source status changes + indexing progress. */
knowledgeRoutes.get('/events', (c) => {
  const { knowledge } = c.get('ctx')
  return streamSSE(c, async (stream) => {
    const onSource = (s: KnowledgeSource): void => void stream.writeSSE({ event: 'source', data: JSON.stringify(s) }).catch(() => {})
    const onProgress = (p: KnowledgeProgress): void => void stream.writeSSE({ event: 'progress', data: JSON.stringify(p) }).catch(() => {})
    knowledge.on('source', onSource)
    knowledge.on('progress', onProgress)
    await stream.writeSSE({ event: 'hello', data: JSON.stringify({ sources: knowledge.list() }) }).catch(() => {})
    const ping = setInterval(() => void stream.writeSSE({ event: 'ping', data: '' }).catch(() => {}), 20_000)
    await new Promise<void>((resolve) => stream.onAbort(() => resolve()))
    clearInterval(ping)
    knowledge.off('source', onSource)
    knowledge.off('progress', onProgress)
  })
})
