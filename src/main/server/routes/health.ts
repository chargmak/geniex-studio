import { Hono } from 'hono'

export const healthRoutes = new Hono()

healthRoutes.get('/health', (c) => {
  const ctx = c.get('ctx')
  return c.json({
    ok: true,
    name: 'geniex-studio',
    version: ctx.version,
    mode: ctx.mode,
    uptimeMs: Date.now() - ctx.startedAt,
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    electron: process.versions.electron ?? null,
  })
})
