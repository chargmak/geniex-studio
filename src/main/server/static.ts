import { createReadStream, promises as fs } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import type { MiddlewareHandler } from 'hono'
import { Readable } from 'node:stream'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
}

/**
 * Minimal SPA static file server for the built renderer.
 * `@hono/node-server/serve-static` resolves against process.cwd(), which is unreliable inside a packaged Electron app,
 * so this reads from an absolute directory and falls back to index.html for client-side routes.
 */
export function spaStatic(rootDir: string): MiddlewareHandler {
  const root = resolve(rootDir)
  return async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next()
    const url = new URL(c.req.url)
    if (url.pathname.startsWith('/api/')) return next()

    let rel = decodeURIComponent(url.pathname)
    if (rel.endsWith('/')) rel += 'index.html'
    let file = normalize(join(root, rel))
    if (!file.startsWith(root + sep) && file !== root) return c.text('Forbidden', 403)

    let stat = await fs.stat(file).catch(() => null)
    if (!stat || !stat.isFile()) {
      // SPA fallback (only for navigations without a file extension)
      if (extname(rel) && extname(rel) !== '.html') return c.text('Not found', 404)
      file = join(root, 'index.html')
      stat = await fs.stat(file).catch(() => null)
      if (!stat) return c.text('Renderer not built. Run `npm run build` first.', 404)
    }

    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
    const headers: Record<string, string> = {
      'Content-Type': type,
      'Content-Length': String(stat.size),
      'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    }
    if (c.req.method === 'HEAD') return new Response(null, { headers })
    const stream = Readable.toWeb(createReadStream(file)) as ReadableStream
    return new Response(stream, { headers })
  }
}
