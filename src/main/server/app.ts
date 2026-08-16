import { serve, type ServerType } from '@hono/node-server'
import { Hono } from 'hono'
import type { AppContext } from './context'
import { healthRoutes } from './routes/health'
import { genieRoutes } from './routes/genie'
import { modelRoutes } from './routes/models'
import { settingsRoutes } from './routes/settings'
import { conversationRoutes } from './routes/conversations'
import { attachmentRoutes } from './routes/attachments'
import { agentRoutes } from './routes/agent'
import { systemRoutes } from './routes/system'
import { sidecarRoutes } from './routes/sidecar'
import { spaStatic } from './static'

export interface StudioServer {
  app: Hono
  host: string
  port: number
  url: string
  close(): Promise<void>
}

export function createApp(ctx: AppContext): Hono {
  const app = new Hono()

  app.use('*', async (c, next) => {
    c.set('ctx', ctx)
    await next()
  })

  // Never cache API responses; the renderer is same-origin so no CORS is needed.
  app.use('/api/*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
  })

  app.route('/api', healthRoutes)
  app.route('/api/genie', genieRoutes)
  app.route('/api/models', modelRoutes)
  app.route('/api/settings', settingsRoutes)
  app.route('/api/conversations', conversationRoutes)
  app.route('/api/attachments', attachmentRoutes)
  app.route('/api/agent', agentRoutes)
  app.route('/api/system', systemRoutes)
  app.route('/api/sidecar', sidecarRoutes)

  app.notFound((c) => {
    if (new URL(c.req.url).pathname.startsWith('/api/')) return c.json({ error: 'not found' }, 404)
    return c.text('Not found', 404)
  })

  app.onError((err, c) => {
    console.error('[studio] route error', err)
    const message = err instanceof Error ? err.message : String(err)
    return c.json({ error: message }, 500)
  })

  if (ctx.rendererDir) app.use('*', spaStatic(ctx.rendererDir))

  return app
}

export function startServer(ctx: AppContext, opts: { host?: string; port: number }): Promise<StudioServer> {
  const host = opts.host ?? '127.0.0.1'
  const app = createApp(ctx)
  return new Promise((resolvePromise, reject) => {
    let server: ServerType | undefined
    const onError = (err: unknown): void => reject(err)
    server = serve({ fetch: app.fetch, hostname: host, port: opts.port }, (info) => {
      server?.off('error', onError)
      resolvePromise({
        app,
        host,
        port: info.port,
        url: `http://${host}:${info.port}`,
        close: () =>
          new Promise<void>((res, rej) => {
            server?.close((e) => (e ? rej(e) : res()))
          }),
      })
    })
    server.on('error', onError)
  })
}
