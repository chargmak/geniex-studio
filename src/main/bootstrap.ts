import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_STUDIO_PORT } from '@shared/config'
import type { AppContext } from './server/context'
import { startServer, type StudioServer } from './server/app'

export interface BootOptions {
  mode: AppContext['mode']
  version: string
  /** Electron's app.getPath('userData') or undefined for headless (falls back to ~/.geniex-studio). */
  dataDir?: string
  rendererDir?: string
  port?: number
  host?: string
}

/** Builds the AppContext and starts the Studio API server. Shared by Electron main and the headless runner. */
export async function boot(opts: BootOptions): Promise<{ ctx: AppContext; server: StudioServer }> {
  const dataDir = opts.dataDir ?? join(homedir(), '.geniex-studio')
  mkdirSync(dataDir, { recursive: true })

  const ctx: AppContext = {
    mode: opts.mode,
    version: opts.version,
    startedAt: Date.now(),
    dataDir,
    rendererDir: opts.rendererDir,
  }

  const port = opts.port ?? Number(process.env.GENIEX_STUDIO_PORT ?? DEFAULT_STUDIO_PORT)
  const server = await startServer(ctx, { host: opts.host, port })
  console.log(`[studio] ${opts.mode} server listening on ${server.url} (data: ${dataDir})`)
  return { ctx, server }
}
