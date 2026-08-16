import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { ChatRequestBody, ChatStreamEvent, CompletionRequestBody } from '@shared/api'

export const genieRoutes = new Hono()

// ---------------------------------------------------------------- status / lifecycle

genieRoutes.get('/status', async (c) => {
  const { genie } = c.get('ctx')
  return c.json(genie.status())
})

genieRoutes.post('/start', async (c) => {
  const { genie } = c.get('ctx')
  try {
    await genie.start()
    return c.json(genie.status())
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err), status: genie.status() }, 500)
  }
})

genieRoutes.post('/stop', async (c) => {
  const { genie } = c.get('ctx')
  await genie.stop()
  return c.json(genie.status())
})

genieRoutes.post('/restart', async (c) => {
  const { genie } = c.get('ctx')
  try {
    await genie.restart()
    return c.json(genie.status())
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err), status: genie.status() }, 500)
  }
})

genieRoutes.post('/probe-cli', async (c) => {
  const { genie } = c.get('ctx')
  await genie.probeCli(true)
  return c.json(genie.status())
})

genieRoutes.post('/crashes/clear', async (c) => {
  const { genie } = c.get('ctx')
  const body = (await c.req.json().catch(() => ({}))) as { model?: string }
  genie.clearCrashes(body.model)
  return c.json({ ok: true, crashedModels: genie.status().crashedModels })
})

genieRoutes.get('/logs', (c) => {
  const { genie } = c.get('ctx')
  const limit = Number(c.req.query('limit') ?? 300)
  return c.json({ lines: genie.logs.tail(Math.min(1000, Math.max(1, limit))), sequence: genie.logs.sequence })
})

/** Live server events (state changes + log lines) as SSE. */
genieRoutes.get('/events', (c) => {
  const { genie } = c.get('ctx')
  return streamSSE(c, async (stream) => {
    const send = (event: string, data: unknown): Promise<void> => stream.writeSSE({ event, data: JSON.stringify(data) })
    const onStatus = (): void => void send('status', genie.status())
    const onLog = (line: unknown): void => void send('log', line)
    genie.on('status', onStatus)
    genie.on('log', onLog)
    await send('status', genie.status())
    const ping = setInterval(() => void stream.writeSSE({ event: 'ping', data: String(Date.now()) }), 15_000)
    stream.onAbort(() => {
      clearInterval(ping)
      genie.off('status', onStatus)
      genie.off('log', onLog)
    })
    // Keep the handler alive until the client disconnects.
    await new Promise<void>((resolve) => stream.onAbort(resolve))
  })
})

// ---------------------------------------------------------------- upstream models (cached + precision ids)

genieRoutes.get('/v1-models', async (c) => {
  const { client } = c.get('ctx')
  try {
    return c.json({ data: await client.listModels() })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502)
  }
})

// ---------------------------------------------------------------- warm-up (explicit load)

genieRoutes.post('/warmup', async (c) => {
  const { client } = c.get('ctx')
  const body = (await c.req.json().catch(() => ({}))) as { model?: string; options?: ChatRequestBody['options'] }
  if (!body.model) return c.json({ error: 'model is required' }, 400)
  try {
    const loadMs = await client.warmUp(body.model, body.options)
    return c.json({ ok: true, model: body.model, loadMs })
  } catch (err) {
    const e = err as Error & { status?: number; code?: unknown }
    return c.json({ error: e.message, code: e.code }, e.status && e.status >= 400 && e.status < 600 ? (e.status as 400) : 502)
  }
})

// ---------------------------------------------------------------- chat (SSE proxy)

genieRoutes.post('/chat', async (c) => {
  const { client } = c.get('ctx')
  let body: ChatRequestBody
  try {
    body = (await c.req.json()) as ChatRequestBody
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400)
  }
  if (!body?.model || !Array.isArray(body.messages)) return c.json({ error: 'model and messages are required' }, 400)

  const abort = new AbortController()
  return streamSSE(
    c,
    async (stream) => {
      stream.onAbort(() => abort.abort())
      try {
        for await (const ev of client.chatStream(body, abort.signal)) {
          await stream.writeSSE({ data: JSON.stringify(ev) })
        }
      } catch (err) {
        const e: ChatStreamEvent = { type: 'error', message: err instanceof Error ? err.message : String(err) }
        await stream.writeSSE({ data: JSON.stringify(e) }).catch(() => {})
      }
      await stream.writeSSE({ data: '[DONE]' }).catch(() => {})
    },
    async (err, stream) => {
      await stream.writeSSE({ data: JSON.stringify({ type: 'error', message: err.message } satisfies ChatStreamEvent) }).catch(() => {})
    },
  )
})

// ---------------------------------------------------------------- raw completions

genieRoutes.post('/completions', async (c) => {
  const { client } = c.get('ctx')
  let body: CompletionRequestBody
  try {
    body = (await c.req.json()) as CompletionRequestBody
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400)
  }
  if (!body?.model || typeof body.prompt !== 'string') return c.json({ error: 'model and prompt are required' }, 400)
  try {
    return c.json(await client.completions(body))
  } catch (err) {
    const e = err as Error & { status?: number; code?: unknown }
    return c.json({ error: e.message, code: e.code }, 502)
  }
})
