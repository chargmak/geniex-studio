import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { AgentRunRequest } from '../../agent/loop'
import { buildToolset, toolInfos } from '../../agent/registry'
import type { RunSummary } from '@shared/agent'

export const agentRoutes = new Hono()

/** Start an agent run; streams AgentEvents as SSE. Approval requests are also delivered in this stream. */
agentRoutes.post('/runs', async (c) => {
  const { agent } = c.get('ctx')
  const body = (await c.req.json().catch(() => null)) as AgentRunRequest | null
  if (!body?.conversationId || typeof body.userText !== 'string') return c.json({ error: 'conversationId and userText required' }, 400)
  return streamSSE(
    c,
    async (stream) => {
      let gone = false
      stream.onAbort(() => {
        gone = true // keep running server-side; approvals can still be answered from the UI
      })
      try {
        for await (const ev of agent.run(body)) {
          if (!gone) await stream.writeSSE({ data: JSON.stringify(ev) }).catch(() => {})
        }
      } catch (err) {
        if (!gone) await stream.writeSSE({ data: JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : String(err) }) }).catch(() => {})
      }
      if (!gone) await stream.writeSSE({ data: '[DONE]' }).catch(() => {})
    },
    async (err, stream) => {
      await stream.writeSSE({ data: JSON.stringify({ type: 'error', message: err.message }) }).catch(() => {})
    },
  )
})

agentRoutes.post('/runs/:id/cancel', (c) => {
  const { agent } = c.get('ctx')
  return c.json({ cancelled: agent.cancel(c.req.param('id')) })
})

agentRoutes.get('/runs', (c) => {
  const { db } = c.get('ctx')
  const limit = Math.min(200, Number(c.req.query('limit') ?? 50))
  const rows = db.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?').all(limit) as Record<string, unknown>[]
  const runs: RunSummary[] = rows.map((r) => ({
    id: r.id as string,
    conversationId: (r.conversation_id as string) ?? null,
    title: (r.title as string) ?? null,
    model: (r.model as string) ?? null,
    status: r.status as RunSummary['status'],
    turns: Number(r.turns),
    toolCalls: Number(r.tool_calls),
    startedAt: Number(r.started_at),
    finishedAt: (r.finished_at as number) ?? null,
    error: (r.error as string) ?? null,
    summary: (r.summary as string) ?? null,
  }))
  return c.json({ runs })
})

agentRoutes.get('/runs/:id/events', (c) => {
  const { db } = c.get('ctx')
  const rows = db.prepare('SELECT * FROM run_events WHERE run_id = ? ORDER BY id').all(c.req.param('id')) as { id: number; run_id: string; ts: number; type: string; payload_json: string }[]
  return c.json({ events: rows.map((r) => ({ id: r.id, runId: r.run_id, ts: r.ts, type: r.type, payload: JSON.parse(r.payload_json) })) })
})

agentRoutes.get('/active', (c) => {
  const { agent } = c.get('ctx')
  const conversationId = c.req.query('conversationId')
  return c.json({ run: conversationId ? agent.runFor(conversationId) : null })
})

// ---------------------------------------------------------------- approvals

agentRoutes.get('/approvals', (c) => {
  const { approvals } = c.get('ctx')
  return c.json({ pending: approvals.listPending(c.req.query('runId') ?? undefined) })
})

agentRoutes.post('/approvals/:id', async (c) => {
  const { approvals } = c.get('ctx')
  const body = (await c.req.json().catch(() => ({}))) as { decision?: 'allow' | 'deny' | 'allow-always' }
  if (!body.decision || !['allow', 'deny', 'allow-always'].includes(body.decision)) return c.json({ error: 'decision must be allow | deny | allow-always' }, 400)
  const ok = approvals.respond(c.req.param('id'), body.decision)
  return ok ? c.json({ ok: true }) : c.json({ error: 'no such pending approval' }, 404)
})

agentRoutes.get('/rules', (c) => c.json({ rules: c.get('ctx').approvals.rules() }))
agentRoutes.post('/rules', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { tool?: string; decision?: 'allow' | 'deny'; pattern?: string | null }
  if (!body.tool || (body.decision !== 'allow' && body.decision !== 'deny')) return c.json({ error: 'tool and decision required' }, 400)
  c.get('ctx').approvals.addRule(body.tool, body.decision, body.pattern ?? null)
  return c.json({ rules: c.get('ctx').approvals.rules() })
})
agentRoutes.delete('/rules/:id', (c) => {
  c.get('ctx').approvals.removeRule(c.req.param('id'))
  return c.json({ rules: c.get('ctx').approvals.rules() })
})

// ---------------------------------------------------------------- tools

agentRoutes.get('/tools', async (c) => {
  const ctx = c.get('ctx')
  const tools = await buildToolset(ctx)
  return c.json({ tools: toolInfos(tools) })
})

// ---------------------------------------------------------------- MCP servers

agentRoutes.get('/mcp/servers', (c) => {
  const { mcp } = c.get('ctx')
  const configs = mcp.repo.list()
  const statuses = mcp.statuses()
  return c.json({ servers: configs.map((cfg) => ({ ...cfg, status: statuses.find((s) => s.id === cfg.id) ?? null })) })
})

agentRoutes.post('/mcp/servers', async (c) => {
  const { mcp } = c.get('ctx')
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body.name !== 'string' || !body.name.trim()) return c.json({ error: 'name required' }, 400)
  const cfg = mcp.repo.upsert({
    id: typeof body.id === 'string' ? body.id : undefined,
    name: body.name.trim(),
    transport: body.transport === 'http' ? 'http' : 'stdio',
    command: typeof body.command === 'string' ? body.command : null,
    args: Array.isArray(body.args) ? (body.args as string[]).map(String) : typeof body.args === 'string' ? (body.args as string).split(/\s+/).filter(Boolean) : [],
    env: body.env && typeof body.env === 'object' ? (body.env as Record<string, string>) : {},
    url: typeof body.url === 'string' ? body.url : null,
    headers: body.headers && typeof body.headers === 'object' ? (body.headers as Record<string, string>) : {},
    enabled: body.enabled !== false,
    allow: Array.isArray(body.allow) ? (body.allow as string[]) : null,
  })
  const status = cfg.enabled ? await mcp.connect(cfg.id) : null
  return c.json({ server: { ...cfg, status } })
})

agentRoutes.delete('/mcp/servers/:id', async (c) => {
  const { mcp } = c.get('ctx')
  await mcp.disconnect(c.req.param('id'))
  mcp.repo.delete(c.req.param('id'))
  return c.json({ ok: true })
})

agentRoutes.post('/mcp/servers/:id/connect', async (c) => {
  const { mcp } = c.get('ctx')
  return c.json({ status: await mcp.connect(c.req.param('id')) })
})

agentRoutes.post('/mcp/servers/:id/disconnect', async (c) => {
  const { mcp } = c.get('ctx')
  await mcp.disconnect(c.req.param('id'))
  return c.json({ ok: true })
})
