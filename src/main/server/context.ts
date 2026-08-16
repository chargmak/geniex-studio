import type { SettingsStore } from '../settings'
import type { GenieXSupervisor } from '../geniex/supervisor'
import type { GenieXClient } from '../geniex/client'
import type { ModelManager } from '../geniex/models'
import type { PullManager } from '../geniex/pulls'
import type { Database } from '../db'
import type { AttachmentRepo, ConversationRepo, MessageRepo, TelemetryRepo } from '../db/repos'
import type { TurnRunner } from '../chat/turns'
import type { AgentRunner } from '../agent/loop'
import type { ApprovalCenter } from '../agent/approvals'
import type { McpManager } from '../mcp/manager'
import type { SidecarSupervisor } from '../sidecar/supervisor'
import type { KnowledgeService } from '../knowledge/service'

/**
 * Everything long-lived that HTTP routes need. Constructed once at boot (Electron main or the headless runner)
 * and threaded through Hono via `c.get('ctx')`.
 */
export interface AppContext {
  /** 'electron' when running inside the desktop shell, 'headless' for `npm run serve` / --headless. */
  mode: 'electron' | 'headless'
  version: string
  startedAt: number
  /** Absolute path of the writable per-user data directory (Electron userData or ~/.geniex-studio). */
  dataDir: string
  /** Absolute path to the built renderer (out/renderer); undefined in dev when Vite serves it. */
  rendererDir?: string

  settings: SettingsStore
  genie: GenieXSupervisor
  client: GenieXClient
  models: ModelManager
  pulls: PullManager
  db: Database
  turns: TurnRunner
  agent: AgentRunner
  approvals: ApprovalCenter
  mcp: McpManager
  sidecar: SidecarSupervisor
  knowledge: KnowledgeService
  repos: {
    conversations: ConversationRepo
    messages: MessageRepo
    attachments: AttachmentRepo
    telemetry: TelemetryRepo
  }
}

declare module 'hono' {
  interface ContextVariableMap {
    ctx: AppContext
  }
}
