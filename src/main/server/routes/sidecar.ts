import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { randomUUID } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { Generation, ImageGenerationRequest, ProvisionEvent, SpeechRequest } from '@shared/sidecar'

export const sidecarRoutes = new Hono()

// ---------------------------------------------------------------- status / lifecycle

sidecarRoutes.get('/status', (c) => c.json(c.get('ctx').sidecar.status()))

sidecarRoutes.get('/logs', (c) => {
  const { sidecar } = c.get('ctx')
  return c.json({ lines: sidecar.logs.tail(Math.min(800, Number(c.req.query('limit') ?? 200))) })
})

/** Provision (uv → python → venv → deps) with live progress as SSE. */
sidecarRoutes.post('/provision', (c) => {
  const { sidecar } = c.get('ctx')
  return streamSSE(c, async (stream) => {
    const send = (e: ProvisionEvent): Promise<void> => stream.writeSSE({ data: JSON.stringify(e) }).catch(() => {})
    try {
      await sidecar.provision((e) => void send(e))
    } catch (err) {
      await send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    await stream.writeSSE({ data: '[DONE]' }).catch(() => {})
  })
})

sidecarRoutes.post('/start', async (c) => {
  const { sidecar } = c.get('ctx')
  try {
    await sidecar.start()
    return c.json(sidecar.status())
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err), status: sidecar.status() }, 500)
  }
})

sidecarRoutes.post('/stop', async (c) => {
  const { sidecar } = c.get('ctx')
  await sidecar.stop()
  return c.json(sidecar.status())
})

sidecarRoutes.get('/events', (c) => {
  const { sidecar } = c.get('ctx')
  return streamSSE(c, async (stream) => {
    const onStatus = (): void => void stream.writeSSE({ event: 'status', data: JSON.stringify(sidecar.status()) })
    const onLog = (l: unknown): void => void stream.writeSSE({ event: 'log', data: JSON.stringify(l) })
    sidecar.on('status', onStatus)
    sidecar.on('log', onLog)
    onStatus()
    const ping = setInterval(() => void stream.writeSSE({ event: 'ping', data: String(Date.now()) }), 15_000)
    stream.onAbort(() => {
      clearInterval(ping)
      sidecar.off('status', onStatus)
      sidecar.off('log', onLog)
    })
    await new Promise<void>((resolve) => stream.onAbort(resolve))
  })
})

// ---------------------------------------------------------------- models

sidecarRoutes.get('/models', async (c) => {
  const { sidecar } = c.get('ctx')
  return c.json({ models: await sidecar.refreshModels() })
})

/** Download a model inside the sidecar; progress is relayed as SSE. */
sidecarRoutes.post('/models/:id/download', async (c) => {
  const { sidecar } = c.get('ctx')
  const id = c.req.param('id')
  return streamSSE(c, async (stream) => {
    try {
      const res = await sidecar.fetch(`/models/${encodeURIComponent(id)}/download`, { method: 'POST' })
      if (!res.ok || !res.body) {
        await stream.writeSSE({ data: JSON.stringify({ type: 'error', message: `sidecar returned ${res.status}: ${await res.text().catch(() => '')}` }) })
      } else {
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let i: number
          while ((i = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, i).trim()
            buf = buf.slice(i + 1)
            if (line) await stream.writeSSE({ data: line.startsWith('data:') ? line.slice(5).trim() : line })
          }
        }
        if (buf.trim()) await stream.writeSSE({ data: buf.trim() })
      }
    } catch (err) {
      await stream.writeSSE({ data: JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : String(err) }) }).catch(() => {})
    }
    void sidecar.refreshModels()
    await stream.writeSSE({ data: '[DONE]' }).catch(() => {})
  })
})

sidecarRoutes.delete('/models/:id', async (c) => {
  const { sidecar } = c.get('ctx')
  const res = await sidecar.fetch(`/models/${encodeURIComponent(c.req.param('id'))}`, { method: 'DELETE', timeoutMs: 60_000 })
  void sidecar.refreshModels()
  return c.json(await res.json().catch(() => ({})), res.ok ? 200 : 500)
})

// ---------------------------------------------------------------- images

function rowToGeneration(r: Record<string, unknown>): Generation {
  return {
    id: r.id as string,
    kind: (r.kind as 'image' | 'audio') ?? 'image',
    prompt: (r.prompt as string) ?? null,
    negativePrompt: (r.negative_prompt as string) ?? null,
    model: (r.model as string) ?? null,
    width: (r.width as number) ?? null,
    height: (r.height as number) ?? null,
    steps: (r.steps as number) ?? null,
    seed: (r.seed as number) ?? null,
    guidance: (r.guidance as number) ?? null,
    path: r.path as string,
    durationMs: (r.duration_ms as number) ?? null,
    meta: r.meta_json ? (JSON.parse(r.meta_json as string) as Record<string, unknown>) : null,
    conversationId: (r.conversation_id as string) ?? null,
    createdAt: Number(r.created_at),
  }
}

sidecarRoutes.post('/images/generations', async (c) => {
  const { sidecar, db, dataDir } = c.get('ctx')
  const body = (await c.req.json().catch(() => null)) as ImageGenerationRequest | null
  if (!body?.prompt?.trim()) return c.json({ error: 'prompt is required' }, 400)
  const started = Date.now()
  let res: Response
  try {
    res = await sidecar.fetch('/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: body.prompt, negative_prompt: body.negative_prompt ?? '', model: body.model, size: `${body.width ?? 512}x${body.height ?? 512}`, steps: body.steps ?? 20, guidance_scale: body.guidance ?? 7.5, seed: body.seed, n: body.n ?? 1, response_format: 'b64_json' }),
      timeoutMs: 20 * 60_000,
    })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let message = text
    try {
      message = (JSON.parse(text) as { detail?: string; error?: string }).detail ?? (JSON.parse(text) as { error?: string }).error ?? text
    } catch {
      /* raw */
    }
    return c.json({ error: message || `sidecar returned ${res.status}` }, 502)
  }
  const json = (await res.json()) as { data?: { b64_json?: string; seed?: number; width?: number; height?: number }[]; model?: string; timings?: Record<string, number> }
  const dir = join(dataDir, 'generated')
  await fs.mkdir(dir, { recursive: true })
  const out: Generation[] = []
  const now = Date.now()
  for (const item of json.data ?? []) {
    if (!item.b64_json) continue
    const id = randomUUID()
    const file = join(dir, `${id}.png`)
    await fs.writeFile(file, Buffer.from(item.b64_json, 'base64'))
    db.prepare(
      `INSERT INTO generations (id, kind, prompt, negative_prompt, model, width, height, steps, seed, guidance, path, duration_ms, meta_json, conversation_id, created_at)
       VALUES (?, 'image', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, body.prompt, body.negative_prompt ?? null, json.model ?? body.model ?? null, item.width ?? body.width ?? 512, item.height ?? body.height ?? 512, body.steps ?? 20, item.seed ?? body.seed ?? null, body.guidance ?? 7.5, file, now - started, JSON.stringify(json.timings ?? {}), body.conversationId ?? null, now)
    out.push(rowToGeneration(db.prepare('SELECT * FROM generations WHERE id = ?').get(id) as Record<string, unknown>))
  }
  return c.json({ generations: out, timings: json.timings ?? null })
})

sidecarRoutes.get('/generations', (c) => {
  const { db } = c.get('ctx')
  const rows = db.prepare('SELECT * FROM generations ORDER BY created_at DESC LIMIT ?').all(Math.min(500, Number(c.req.query('limit') ?? 100))) as Record<string, unknown>[]
  return c.json({ generations: rows.map(rowToGeneration) })
})

sidecarRoutes.get('/generations/:id/raw', async (c) => {
  const { db } = c.get('ctx')
  const r = db.prepare('SELECT * FROM generations WHERE id = ?').get(c.req.param('id')) as Record<string, unknown> | undefined
  if (!r) return c.text('not found', 404)
  const st = await fs.stat(r.path as string).catch(() => null)
  if (!st) return c.text('file missing', 404)
  return new Response(Readable.toWeb(createReadStream(r.path as string)) as ReadableStream, { headers: { 'Content-Type': r.kind === 'audio' ? 'audio/wav' : 'image/png', 'Content-Length': String(st.size), 'Cache-Control': 'private, max-age=31536000, immutable' } })
})

sidecarRoutes.delete('/generations/:id', async (c) => {
  const { db } = c.get('ctx')
  const r = db.prepare('SELECT * FROM generations WHERE id = ?').get(c.req.param('id')) as Record<string, unknown> | undefined
  if (!r) return c.json({ error: 'not found' }, 404)
  db.prepare('DELETE FROM generations WHERE id = ?').run(r.id as string)
  await fs.unlink(r.path as string).catch(() => {})
  return c.json({ ok: true })
})

// ---------------------------------------------------------------- audio

/** multipart: file (wav/webm/mp3), optional model, language → { text, segments } */
sidecarRoutes.post('/audio/transcriptions', async (c) => {
  const { sidecar } = c.get('ctx')
  const body = await c.req.parseBody()
  const file = body.file
  if (!(file instanceof File)) return c.json({ error: 'file is required' }, 400)
  const fd = new FormData()
  fd.set('file', file, file.name || 'audio.wav')
  if (typeof body.model === 'string') fd.set('model', body.model)
  if (typeof body.language === 'string') fd.set('language', body.language)
  try {
    const res = await sidecar.fetch('/v1/audio/transcriptions', { method: 'POST', body: fd, timeoutMs: 10 * 60_000 })
    const json = await res.json().catch(() => ({}))
    return c.json(json, res.ok ? 200 : 502)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502)
  }
})

sidecarRoutes.post('/audio/speech', async (c) => {
  const { sidecar } = c.get('ctx')
  const body = (await c.req.json().catch(() => null)) as SpeechRequest | null
  if (!body?.input?.trim()) return c.json({ error: 'input is required' }, 400)
  try {
    const res = await sidecar.fetch('/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeoutMs: 5 * 60_000 })
    if (!res.ok) return c.json({ error: (await res.text().catch(() => '')) || `sidecar returned ${res.status}` }, 502)
    return new Response(res.body, { headers: { 'Content-Type': res.headers.get('content-type') ?? 'audio/wav', 'Cache-Control': 'no-store' } })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502)
  }
})

// ---------------------------------------------------------------- embeddings (raw proxy; knowledge routes build on it)

sidecarRoutes.post('/embeddings', async (c) => {
  const { sidecar } = c.get('ctx')
  const body = (await c.req.json().catch(() => null)) as { input?: string | string[]; model?: string } | null
  if (!body?.input) return c.json({ error: 'input is required' }, 400)
  try {
    const res = await sidecar.fetch('/v1/embeddings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeoutMs: 10 * 60_000 })
    return c.json(await res.json().catch(() => ({})), res.ok ? 200 : 502)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502)
  }
})
