import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_STUDIO_PORT } from '@shared/config'
import type { AppContext } from './server/context'
import { startServer, type StudioServer } from './server/app'
import { SettingsStore } from './settings'
import { GenieXSupervisor } from './geniex/supervisor'
import { GenieXClient } from './geniex/client'
import { ModelManager } from './geniex/models'
import { PullManager } from './geniex/pulls'
import { openDatabase } from './db'
import { AttachmentRepo, ConversationRepo, MessageRepo, TelemetryRepo } from './db/repos'

export interface BootOptions {
  mode: AppContext['mode']
  version: string
  /** Electron's app.getPath('userData') or undefined for headless (falls back to ~/.geniex-studio). */
  dataDir?: string
  rendererDir?: string
  port?: number
  host?: string
}

export interface Booted {
  ctx: AppContext
  server: StudioServer
  shutdown(): Promise<void>
}

/** Builds the AppContext, opens the DB, prepares GenieX services and starts the Studio API server. */
export async function boot(opts: BootOptions): Promise<Booted> {
  const dataDir = opts.dataDir ?? join(homedir(), '.geniex-studio')
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(join(dataDir, 'attachments'), { recursive: true })

  const settings = new SettingsStore(dataDir)
  const genie = new GenieXSupervisor(settings)
  const client = new GenieXClient(genie, settings)
  const models = new ModelManager(genie)
  const pulls = new PullManager(genie, models)
  const db = openDatabase(dataDir)

  const ctx: AppContext = {
    mode: opts.mode,
    version: opts.version,
    startedAt: Date.now(),
    dataDir,
    rendererDir: opts.rendererDir,
    settings,
    genie,
    client,
    models,
    pulls,
    db,
    repos: {
      conversations: new ConversationRepo(db),
      messages: new MessageRepo(db),
      attachments: new AttachmentRepo(db),
      telemetry: new TelemetryRepo(db),
    },
  }

  const port = opts.port ?? Number(process.env.GENIEX_STUDIO_PORT ?? DEFAULT_STUDIO_PORT)
  const server = await startServer(ctx, { host: opts.host, port })
  console.log(`[studio] ${opts.mode} server listening on ${server.url} (data: ${dataDir})`)

  // Probe the CLI immediately (non-blocking) and auto-start the GenieX server if configured.
  void genie.probeCli().then(() => {
    if (settings.get().genie.autoStart) {
      genie.start().catch((err) => console.warn('[studio] GenieX auto-start failed:', err instanceof Error ? err.message : err))
    }
  })

  return {
    ctx,
    server,
    shutdown: async () => {
      await pulls.shutdown().catch(() => {})
      await genie.shutdown().catch(() => {})
      await server.close().catch(() => {})
      try {
        db.close()
      } catch {
        /* ignore */
      }
    },
  }
}
