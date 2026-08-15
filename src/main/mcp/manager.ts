import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { McpServerConfig, McpServerStatus } from '@shared/agent'
import type { Database } from '../db'
import { clip, type Tool } from '../agent/tools/types'

interface McpRow {
  id: string
  name: string
  transport: string
  command: string | null
  args_json: string | null
  env_json: string | null
  url: string | null
  headers_json: string | null
  enabled: number
  allow_json: string | null
  created_at: number
  updated_at: number
}

function rowToConfig(r: McpRow): McpServerConfig {
  const parse = <T>(s: string | null, fb: T): T => {
    try {
      return s ? (JSON.parse(s) as T) : fb
    } catch {
      return fb
    }
  }
  return {
    id: r.id,
    name: r.name,
    transport: r.transport === 'http' ? 'http' : 'stdio',
    command: r.command,
    args: parse<string[]>(r.args_json, []),
    env: parse<Record<string, string>>(r.env_json, {}),
    url: r.url,
    headers: parse<Record<string, string>>(r.headers_json, {}),
    enabled: !!r.enabled,
    allow: parse<string[] | null>(r.allow_json, null),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/** Untrusted server-provided strings: collapse whitespace and cap length before they touch a prompt. */
function sanitize(s: unknown, max = 400): string {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'server'
}

type SdkClient = {
  connect(t: unknown): Promise<void>
  close(): Promise<void>
  listTools(): Promise<{ tools: { name: string; description?: string; inputSchema?: Record<string, unknown> }[] }>
  callTool(p: { name: string; arguments?: Record<string, unknown> }, _?: unknown, o?: { signal?: AbortSignal; timeout?: number }): Promise<{ content?: unknown; isError?: boolean; structuredContent?: unknown }>
}

interface Live {
  client: SdkClient
  tools: { name: string; description: string; inputSchema: Record<string, unknown> }[]
  error: string | null
}

export class McpRepo {
  constructor(private db: Database) {}
  list(): McpServerConfig[] {
    return (this.db.prepare('SELECT * FROM mcp_servers ORDER BY created_at').all() as McpRow[]).map(rowToConfig)
  }
  get(id: string): McpServerConfig | null {
    const r = this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as McpRow | undefined
    return r ? rowToConfig(r) : null
  }
  upsert(input: Partial<McpServerConfig> & { name: string }): McpServerConfig {
    const now = Date.now()
    const id = input.id ?? randomUUID()
    const cur = this.get(id)
    const next = { ...(cur ?? { transport: 'stdio' as const, command: null, args: [], env: {}, url: null, headers: {}, enabled: true, allow: null }), ...input }
    this.db
      .prepare(
        `INSERT INTO mcp_servers (id, name, transport, command, args_json, env_json, url, headers_json, enabled, allow_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, transport=excluded.transport, command=excluded.command, args_json=excluded.args_json,
           env_json=excluded.env_json, url=excluded.url, headers_json=excluded.headers_json, enabled=excluded.enabled, allow_json=excluded.allow_json, updated_at=excluded.updated_at`,
      )
      .run(id, next.name, next.transport, next.command ?? null, JSON.stringify(next.args ?? []), JSON.stringify(next.env ?? {}), next.url ?? null, JSON.stringify(next.headers ?? {}), next.enabled ? 1 : 0, next.allow ? JSON.stringify(next.allow) : null, cur?.createdAt ?? now, now)
    return this.get(id)!
  }
  delete(id: string): void {
    this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
  }
}

/** Hosts live MCP client connections and exposes their tools as agent Tools (`mcp__<server>__<tool>`). */
export class McpManager extends EventEmitter {
  private live = new Map<string, Live>()
  readonly repo: McpRepo

  constructor(db: Database) {
    super()
    this.repo = new McpRepo(db)
  }

  async connect(id: string): Promise<McpServerStatus> {
    const cfg = this.repo.get(id)
    if (!cfg) throw new Error('MCP server not found')
    await this.disconnect(id)
    try {
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
      const client = new Client({ name: 'geniex-studio', version: '0.1.0' }) as unknown as SdkClient
      let transport: unknown
      if (cfg.transport === 'http') {
        if (!cfg.url) throw new Error('url is required for http transport')
        const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
        transport = new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers } })
      } else {
        if (!cfg.command) throw new Error('command is required for stdio transport')
        const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
        transport = new StdioClientTransport({ command: cfg.command, args: cfg.args, env: { ...(process.env as Record<string, string>), ...cfg.env }, stderr: 'ignore' })
      }
      await client.connect(transport)
      const listed = await client.listTools()
      const tools = (listed.tools ?? []).map((t) => ({ name: sanitize(t.name, 64), description: sanitize(t.description, 400), inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} } }))
      this.live.set(id, { client, tools, error: null })
      this.emit('change')
      return this.status(id)!
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.live.set(id, { client: null as unknown as SdkClient, tools: [], error: message })
      this.emit('change')
      return this.status(id)!
    }
  }

  async disconnect(id: string): Promise<void> {
    const l = this.live.get(id)
    if (l?.client) await l.client.close().catch(() => {})
    this.live.delete(id)
    this.emit('change')
  }

  async connectEnabled(): Promise<void> {
    for (const s of this.repo.list()) if (s.enabled && !this.live.get(s.id)?.client) await this.connect(s.id).catch(() => {})
  }

  status(id: string): McpServerStatus | null {
    const cfg = this.repo.get(id)
    if (!cfg) return null
    const l = this.live.get(id)
    return { id, name: cfg.name, connected: !!l?.client, error: l?.error ?? null, tools: (l?.tools ?? []).map((t) => ({ name: t.name, description: t.description })) }
  }

  statuses(): McpServerStatus[] {
    return this.repo
      .list()
      .map((s) => this.status(s.id))
      .filter((s): s is McpServerStatus => !!s)
  }

  /** Agent tools for all connected + enabled servers (respecting per-server allow-lists). */
  tools(): Tool[] {
    const out: Tool[] = []
    for (const cfg of this.repo.list()) {
      const l = this.live.get(cfg.id)
      if (!cfg.enabled || !l?.client) continue
      const prefix = `mcp__${slug(cfg.name)}__`
      for (const t of l.tools) {
        if (cfg.allow && !cfg.allow.includes(t.name)) continue
        const client = l.client
        out.push({
          name: `${prefix}${t.name}`.slice(0, 64),
          family: 'mcp',
          risk: 'mcp',
          source: cfg.name,
          description: `[MCP ${cfg.name}] ${t.description || t.name}`,
          parameters: t.inputSchema,
          summarize: (a) => `${cfg.name} › ${t.name} ${JSON.stringify(a).slice(0, 120)}`,
          needsApproval: () => true,
          async run(args, rc) {
            const res = await client.callTool({ name: t.name, arguments: args }, undefined, { signal: rc.signal, timeout: 120_000 })
            const parts = Array.isArray(res.content) ? (res.content as { type?: string; text?: string; data?: string; mimeType?: string }[]) : []
            const text = parts
              .map((p) => (p.type === 'text' ? (p.text ?? '') : p.type === 'image' ? `[image ${p.mimeType ?? ''}]` : p.type === 'resource' ? '[resource]' : JSON.stringify(p)))
              .join('\n')
            const content = clip(text || (res.structuredContent ? JSON.stringify(res.structuredContent) : '(no content)'))
            return { ok: !res.isError, content, meta: { server: cfg.name, tool: t.name } }
          },
        })
      }
    }
    return out
  }

  async shutdown(): Promise<void> {
    for (const id of [...this.live.keys()]) await this.disconnect(id)
  }
}
