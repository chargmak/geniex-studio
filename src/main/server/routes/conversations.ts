import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { TurnRequest } from '../../chat/turns'

export const conversationRoutes = new Hono()

conversationRoutes.get('/', (c) => {
  const { repos } = c.get('ctx')
  return c.json({ conversations: repos.conversations.list({ includeArchived: c.req.query('archived') === '1' }) })
})

conversationRoutes.post('/', async (c) => {
  const { repos, settings } = c.get('ctx')
  const body = (await c.req.json().catch(() => ({}))) as { title?: string; model?: string | null; systemPrompt?: string | null; mode?: 'chat' | 'agent'; workspaceRoot?: string | null }
  const conv = repos.conversations.create({
    title: body.title,
    model: body.model ?? settings.get().defaults.chatModel,
    systemPrompt: body.systemPrompt ?? null,
    mode: body.mode ?? 'chat',
    workspaceRoot: body.workspaceRoot ?? settings.get().workspace.root,
  })
  return c.json({ conversation: conv }, 201)
})

conversationRoutes.get('/:id', (c) => {
  const { repos } = c.get('ctx')
  const conv = repos.conversations.get(c.req.param('id'))
  if (!conv) return c.json({ error: 'not found' }, 404)
  return c.json({ conversation: conv, messages: repos.messages.list(conv.id) })
})

conversationRoutes.patch('/:id', async (c) => {
  const { repos } = c.get('ctx')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const allowed = ['title', 'model', 'systemPrompt', 'mode', 'settings', 'workspaceRoot', 'pinned', 'archived'] as const
  const patch: Record<string, unknown> = {}
  for (const k of allowed) if (k in body) patch[k] = body[k]
  const conv = repos.conversations.update(c.req.param('id'), patch)
  if (!conv) return c.json({ error: 'not found' }, 404)
  return c.json({ conversation: conv })
})

conversationRoutes.delete('/:id', (c) => {
  const { repos, turns } = c.get('ctx')
  turns.cancel(c.req.param('id'))
  repos.conversations.delete(c.req.param('id'))
  return c.json({ ok: true })
})

conversationRoutes.delete('/:id/messages/:messageId', (c) => {
  const { repos } = c.get('ctx')
  const m = repos.messages.get(c.req.param('messageId'))
  if (!m || m.conversationId !== c.req.param('id')) return c.json({ error: 'not found' }, 404)
  repos.messages.delete(m.id)
  return c.json({ ok: true })
})

/** Run a turn; streams TurnEvents as SSE. */
conversationRoutes.post('/:id/turns', async (c) => {
  const { turns } = c.get('ctx')
  const body = (await c.req.json().catch(() => ({}))) as Omit<TurnRequest, 'conversationId'>
  const req: TurnRequest = { ...body, conversationId: c.req.param('id') }
  return streamSSE(
    c,
    async (stream) => {
      let clientGone = false
      stream.onAbort(() => {
        clientGone = true
        // Client navigated away: keep the turn running server-side so the reply is persisted; do NOT cancel.
      })
      try {
        for await (const ev of turns.run(req)) {
          if (!clientGone) await stream.writeSSE({ data: JSON.stringify(ev) }).catch(() => {})
        }
      } catch (err) {
        if (!clientGone) await stream.writeSSE({ data: JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : String(err) }) }).catch(() => {})
      }
      if (!clientGone) await stream.writeSSE({ data: '[DONE]' }).catch(() => {})
    },
    async (err, stream) => {
      await stream.writeSSE({ data: JSON.stringify({ type: 'error', message: err.message }) }).catch(() => {})
    },
  )
})

conversationRoutes.post('/:id/cancel', (c) => {
  const { turns } = c.get('ctx')
  return c.json({ cancelled: turns.cancel(c.req.param('id')) })
})

conversationRoutes.get('/:id/running', (c) => {
  const { turns } = c.get('ctx')
  return c.json({ running: turns.isRunning(c.req.param('id')) })
})
