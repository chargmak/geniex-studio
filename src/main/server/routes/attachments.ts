import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { promises as fs, createReadStream } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { extForMime, kindForMime, sniffImage } from '../../util/imageMeta'
import type { AppContext } from '../context'
import type { Attachment } from '@shared/chat'

export const attachmentRoutes = new Hono()

const MAX_BYTES = 64 * 1024 * 1024

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
}

async function store(ctx: AppContext, conversationId: string, name: string, bytes: Buffer, declaredMime?: string): Promise<Attachment> {
  const { repos, dataDir } = ctx
  if (bytes.length > MAX_BYTES) throw new Error('attachment too large (max 64 MB)')
  const sniff = sniffImage(bytes)
  const mime = sniff?.mime ?? declaredMime ?? MIME_BY_EXT[extname(name).toLowerCase()] ?? 'application/octet-stream'
  const id = randomUUID()
  const file = join(dataDir, 'attachments', `${id}.${extForMime(mime)}`)
  await fs.writeFile(file, bytes)
  const att = repos.attachments.insert({
    id,
    messageId: null,
    conversationId,
    kind: kindForMime(mime),
    name: basename(name) || `attachment.${extForMime(mime)}`,
    mime,
    size: bytes.length,
    path: file,
    width: sniff?.width ?? null,
    height: sniff?.height ?? null,
  })
  return att
}

/** multipart/form-data: conversationId + file(s) */
attachmentRoutes.post('/', async (c) => {
  try {
    const body = await c.req.parseBody({ all: true })
    const conversationId = String(body.conversationId ?? '')
    if (!conversationId) return c.json({ error: 'conversationId required' }, 400)
    const filesRaw = body.file ?? body.files
    const files = (Array.isArray(filesRaw) ? filesRaw : [filesRaw]).filter((f): f is File => f instanceof File)
    if (!files.length) return c.json({ error: 'no files' }, 400)
    const out: Attachment[] = []
    for (const f of files) out.push(await store(c.get('ctx'), conversationId, f.name, Buffer.from(await f.arrayBuffer()), f.type || undefined))
    return c.json({ attachments: out }, 201)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
  }
})

/** Import from an absolute local path (Electron file dialog). Copies the file into the attachments store. */
attachmentRoutes.post('/from-path', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { conversationId?: string; paths?: string[] }
  if (!body.conversationId || !body.paths?.length) return c.json({ error: 'conversationId and paths required' }, 400)
  const out: Attachment[] = []
  const errors: string[] = []
  for (const p of body.paths) {
    try {
      const bytes = await fs.readFile(p)
      out.push(await store(c.get('ctx'), body.conversationId, basename(p), bytes))
    } catch (err) {
      errors.push(`${p}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return c.json({ attachments: out, errors }, out.length ? 201 : 400)
})

attachmentRoutes.get('/:id/raw', async (c) => {
  const { repos } = c.get('ctx')
  const att = repos.attachments.get(c.req.param('id'))
  if (!att) return c.text('not found', 404)
  const stat = await fs.stat(att.path).catch(() => null)
  if (!stat) return c.text('file missing', 404)
  const stream = Readable.toWeb(createReadStream(att.path)) as ReadableStream
  return new Response(stream, {
    headers: {
      'Content-Type': att.mime ?? 'application/octet-stream',
      'Content-Length': String(stat.size),
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Disposition': `inline; filename="${encodeURIComponent(att.name)}"`,
    },
  })
})

attachmentRoutes.delete('/:id', async (c) => {
  const { repos } = c.get('ctx')
  const att = repos.attachments.get(c.req.param('id'))
  if (!att) return c.json({ error: 'not found' }, 404)
  repos.attachments.delete(att.id)
  await fs.unlink(att.path).catch(() => {})
  return c.json({ ok: true })
})
