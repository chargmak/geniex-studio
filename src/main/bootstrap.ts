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
import { TurnRunner } from './chat/turns'
import { AgentRunner } from './agent/loop'
import { ApprovalCenter } from './agent/approvals'
import { McpManager } from './mcp/manager'
import { SidecarSupervisor } from './sidecar/supervisor'
import { KnowledgeService } from './knowledge/service'

export interface BootOptions {
  mode: AppContext['mode']
  version: string
  /** Electron's app.getPath('userData') or undefined for headless (falls back to ~/.geniex-studio). */
  dataDir?: string
  rendererDir?: string
  port?: number
  host?: string
  /** Directory holding the Python sidecar sources (server.py, engines/, requirements.txt). */
  sidecarSourceDir: string
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
  const genie = new GenieXSupervisor(settings, dataDir)
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
    turns: null as unknown as TurnRunner,
    agent: null as unknown as AgentRunner,
    approvals: new ApprovalCenter(db, settings),
    mcp: new McpManager(db),
    sidecar: new SidecarSupervisor({ sourceDir: opts.sidecarSourceDir, home: join(dataDir, 'sidecar') }),
    knowledge: null as unknown as KnowledgeService,
    repos: {
      conversations: new ConversationRepo(db),
      messages: new MessageRepo(db),
      attachments: new AttachmentRepo(db),
      telemetry: new TelemetryRepo(db),
    },
  }
  client.recorder = (r) => ctx.repos.telemetry.insert(r)
  ctx.knowledge = new KnowledgeService(db, ctx.sidecar)
  ctx.turns = new TurnRunner(ctx)
  ctx.agent = new AgentRunner(ctx)
  void ctx.mcp.connectEnabled().catch(() => {})

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
      await ctx.sidecar.shutdown().catch(() => {})
      await ctx.mcp.shutdown().catch(() => {})
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
