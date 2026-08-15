import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Bot, Check, ExternalLink, Plug, Plus, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react'
import type { McpServerConfig, McpServerStatus, RunSummary, ToolInfo } from '@shared/agent'
import type { StudioSettings } from '@shared/settings'
import { api } from '@/lib/api'
import { cn, formatDuration } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { EmptyState } from '@/components/ui/empty-state'

type Tab = 'runs' | 'tools' | 'mcp'
type ServerRow = McpServerConfig & { status: McpServerStatus | null }

const FAMILIES: { id: StudioSettings['agent']['enabledFamilies'][number]; label: string; hint: string }[] = [
  { id: 'fs', label: 'Workspace files', hint: 'read_file · list_dir · search_files · write_file · edit_file (sandboxed to the workspace folder)' },
  { id: 'shell', label: 'PowerShell commands', hint: 'run_command — approval required unless allowed' },
  { id: 'web', label: 'Web search & fetch', hint: 'web_search (DuckDuckGo) · web_fetch (readable page text)' },
  { id: 'vision', label: 'Image analysis', hint: 'analyze_image via the local Vision model (needs a VLM installed)' },
  { id: 'mcp', label: 'MCP servers', hint: 'Tools from connected Model Context Protocol servers' },
]
const RISKS: { id: StudioSettings['agent']['autoApproveRisks'][number]; label: string }[] = [
  { id: 'read', label: 'Read-only tools' },
  { id: 'network', label: 'Network (search/fetch)' },
  { id: 'write', label: 'File writes' },
  { id: 'exec', label: 'Shell commands' },
  { id: 'mcp', label: 'MCP tools' },
]

export function AgentsPage(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('runs')
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 px-4 hairline-b">
        {(['runs', 'tools', 'mcp'] as Tab[]).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={cn('h-8 rounded-sm px-3 text-[13px] font-medium capitalize', tab === t ? 'bg-accent-soft text-accent-brand' : 'text-text-secondary hover:bg-surface-3 hover:text-text-primary')}>
            {t === 'mcp' ? 'MCP servers' : t === 'tools' ? 'Tools & approvals' : 'Runs'}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'runs' && <RunsTab />}
        {tab === 'tools' && <ToolsTab />}
        {tab === 'mcp' && <McpTab />}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: RunSummary['status'] }): React.JSX.Element {
  const v = status === 'done' ? 'positive' : status === 'error' ? 'negative' : status === 'cancelled' ? 'neutral' : status === 'waiting_approval' ? 'warning' : 'running'
  return <Badge variant={v}>{status.replace('_', ' ')}</Badge>
}

function RunsTab(): React.JSX.Element {
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const navigate = useNavigate()
  const load = useCallback(() => void api<{ runs: RunSummary[] }>('/api/agent/runs').then((r) => setRuns(r.runs)).catch(() => setRuns([])), [])
  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])
  if (runs === null) return <div className="p-6 text-sm text-text-secondary">Loading runs…</div>
  if (!runs.length)
    return (
      <EmptyState
        icon={Bot}
        title="No agent runs yet"
        description="Switch a chat to Agent mode and give it a task: it can read and edit files in your workspace, run PowerShell, search the web and call MCP tools — each risky step waits for your approval."
        action={
          <Button variant="primary" onClick={() => navigate('/chat')}>
            Start in Chat
          </Button>
        }
      />
    )
  return (
    <div className="mx-auto w-full max-w-5xl p-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left metadata-md text-text-secondary">
            <th className="px-2 py-2 hairline-b font-[560]">Task</th>
            <th className="px-2 py-2 hairline-b font-[560]">Model</th>
            <th className="px-2 py-2 hairline-b font-[560]">Status</th>
            <th className="px-2 py-2 hairline-b font-[560] text-right">Turns</th>
            <th className="px-2 py-2 hairline-b font-[560] text-right">Tools</th>
            <th className="px-2 py-2 hairline-b font-[560] text-right">Duration</th>
            <th className="px-2 py-2 hairline-b font-[560]">Started</th>
            <th className="px-2 py-2 hairline-b" />
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="hover:bg-surface-2">
              <td className="max-w-md truncate px-2 py-2 hairline-b text-text-primary" title={r.title ?? ''}>
                {r.title ?? '(untitled)'}
                {r.error && <div className="truncate text-xs text-negative">{r.error}</div>}
              </td>
              <td className="px-2 py-2 hairline-b text-text-secondary">{r.model?.split('/').pop()}</td>
              <td className="px-2 py-2 hairline-b">
                <StatusBadge status={r.status} />
              </td>
              <td className="px-2 py-2 text-right tabular-nums hairline-b">{r.turns}</td>
              <td className="px-2 py-2 text-right tabular-nums hairline-b">{r.toolCalls}</td>
              <td className="px-2 py-2 text-right tabular-nums hairline-b text-text-secondary">{r.finishedAt ? formatDuration(r.finishedAt - r.startedAt) : '…'}</td>
              <td className="px-2 py-2 hairline-b text-text-secondary">{new Date(r.startedAt).toLocaleString()}</td>
              <td className="px-2 py-2 hairline-b text-right">
                {r.conversationId && (
                  <Button variant="ghost" size="xs" onClick={() => navigate(`/chat/${r.conversationId}`)}>
                    Open <ExternalLink className="size-3" />
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ToolsTab(): React.JSX.Element {
  const [settings, setSettings] = useState<StudioSettings | null>(null)
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [rules, setRules] = useState<{ id: string; tool: string; pattern: string | null; decision: 'allow' | 'deny' }[]>([])
  const load = useCallback(() => {
    void api<StudioSettings>('/api/settings').then(setSettings)
    void api<{ tools: ToolInfo[] }>('/api/agent/tools').then((r) => setTools(r.tools))
    void api<{ rules: typeof rules }>('/api/agent/rules').then((r) => setRules(r.rules))
  }, [])
  useEffect(load, [load])
  const patch = async (p: Partial<StudioSettings['agent']>): Promise<void> => {
    const next = await api<StudioSettings>('/api/settings', { method: 'PATCH', json: { agent: p } })
    setSettings(next)
    void api<{ tools: ToolInfo[] }>('/api/agent/tools').then((r) => setTools(r.tools))
  }
  if (!settings) return <div className="p-6 text-sm text-text-secondary">Loading…</div>
  const a = settings.agent
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <section>
        <h2 className="heading-xs text-text-primary">Tool families</h2>
        <p className="mt-1 body-sm text-text-secondary">What the agent is allowed to use. Every risky call still stops for approval unless auto-approved below.</p>
        <div className="mt-3 flex flex-col divide-y divide-[var(--border-subtle)] rounded-md bg-surface-2 hairline-subtle">
          {FAMILIES.map((f) => {
            const on = a.enabledFamilies.includes(f.id)
            return (
              <label key={f.id} className="flex cursor-pointer items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-text-primary">{f.label}</div>
                  <div className="text-xs text-text-secondary">{f.hint}</div>
                </div>
                <Switch checked={on} onCheckedChange={(v) => void patch({ enabledFamilies: v ? [...a.enabledFamilies, f.id] : a.enabledFamilies.filter((x) => x !== f.id) })} />
              </label>
            )
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tools.map((t) => (
            <Badge key={t.name} variant="outline" title={t.description}>
              {t.name}
            </Badge>
          ))}
          {!tools.length && <span className="text-xs text-text-secondary">No tools active.</span>}
        </div>
      </section>

      <section>
        <h2 className="heading-xs text-text-primary">Auto-approve</h2>
        <p className="mt-1 body-sm text-text-secondary">Risk levels that never prompt. Keep file writes and shell commands off unless you fully trust the model.</p>
        <div className="mt-3 flex flex-col divide-y divide-[var(--border-subtle)] rounded-md bg-surface-2 hairline-subtle">
          {RISKS.map((r) => {
            const on = a.autoApproveRisks.includes(r.id)
            return (
              <label key={r.id} className="flex cursor-pointer items-center gap-3 px-4 py-2.5">
                <ShieldCheck className={cn('size-4', on ? 'text-positive' : 'text-text-disabled')} />
                <span className="flex-1 text-sm text-text-primary">{r.label}</span>
                <Switch checked={on} onCheckedChange={(v) => void patch({ autoApproveRisks: v ? [...a.autoApproveRisks, r.id] : a.autoApproveRisks.filter((x) => x !== r.id) })} />
              </label>
            )
          })}
        </div>
      </section>

      <section>
        <h2 className="heading-xs text-text-primary">Always-allow rules</h2>
        <p className="mt-1 body-sm text-text-secondary">Created when you press “Always allow” on an approval card.</p>
        <div className="mt-3 rounded-md bg-surface-2 hairline-subtle">
          {!rules.length && <div className="px-4 py-3 text-sm text-text-secondary">No rules yet.</div>}
          {rules.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-2 hairline-b last:border-b-0">
              <Badge variant={r.decision === 'allow' ? 'positive' : 'negative'}>{r.decision}</Badge>
              <span className="font-mono text-sm text-text-primary">{r.tool}</span>
              {r.pattern && <span className="font-mono text-xs text-text-secondary">/{r.pattern}/</span>}
              <Button variant="ghost" size="iconXs" className="ml-auto" aria-label="Remove rule" onClick={() => void api<{ rules: typeof rules }>(`/api/agent/rules/${r.id}`, { method: 'DELETE' }).then((x) => setRules(x.rules))}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="heading-xs text-text-primary">Behaviour</h2>
        <div className="mt-3 flex flex-col gap-3 rounded-md bg-surface-2 p-4 hairline-subtle">
          <label className="flex items-center gap-3 text-sm">
            <span className="w-40 text-text-secondary">Max turns per run</span>
            <input type="number" min={1} max={100} value={a.maxTurns} onChange={(e) => void patch({ maxTurns: Math.max(1, Math.min(100, Number(e.target.value) || 12)) })} className="h-8 w-24 rounded-sm bg-surface-1 px-2 tabular-nums hairline outline-none focus:border-[var(--accent)]" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-text-secondary">Extra instructions for the agent</span>
            <textarea defaultValue={a.instructions} onBlur={(e) => void patch({ instructions: e.target.value })} rows={4} placeholder="e.g. Prefer edit_file over rewriting whole files. Run tests after code changes." className="rounded-sm bg-surface-1 px-3 py-2 body-sm hairline outline-none focus:border-[var(--accent)]" />
          </label>
        </div>
      </section>
    </div>
  )
}

function McpTab(): React.JSX.Element {
  const [servers, setServers] = useState<ServerRow[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', transport: 'stdio' as 'stdio' | 'http', command: 'npx', args: '-y @modelcontextprotocol/server-filesystem C:\\Users', url: '' })
  const [busyId, setBusyId] = useState<string | null>(null)
  const load = useCallback(() => void api<{ servers: ServerRow[] }>('/api/agent/mcp/servers').then((r) => setServers(r.servers)).catch(() => setServers([])), [])
  useEffect(load, [load])

  const save = async (): Promise<void> => {
    setBusyId('new')
    try {
      await api('/api/agent/mcp/servers', { method: 'POST', json: { ...form, args: form.args }, timeoutMs: 120_000 })
      setAdding(false)
      setForm({ name: '', transport: 'stdio', command: 'npx', args: '', url: '' })
      load()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="heading-xs text-text-primary">MCP servers</h2>
          <p className="mt-1 body-sm text-text-secondary">Connect Model Context Protocol tool servers (stdio commands or Streamable-HTTP URLs). Their tools appear to the agent as <code className="code-xs">mcp__server__tool</code> and always ask for approval unless a rule allows them. Server output is treated as untrusted.</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
          <Plus /> Add server
        </Button>
      </div>

      {adding && (
        <div className="flex flex-col gap-3 rounded-md bg-surface-2 p-4 hairline">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-8 rounded-sm bg-surface-1 px-2 text-sm text-text-primary hairline outline-none focus:border-[var(--accent)]" placeholder="filesystem" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              Transport
              <select value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value as 'stdio' | 'http' })} className="h-8 rounded-sm bg-surface-1 px-2 text-sm text-text-primary hairline outline-none">
                <option value="stdio">stdio (local command)</option>
                <option value="http">Streamable HTTP (URL)</option>
              </select>
            </label>
            {form.transport === 'stdio' ? (
              <>
                <label className="flex flex-col gap-1 text-xs text-text-secondary">
                  Command
                  <input value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} className="h-8 rounded-sm bg-surface-1 px-2 font-mono text-sm text-text-primary hairline outline-none focus:border-[var(--accent)]" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-text-secondary">
                  Arguments
                  <input value={form.args} onChange={(e) => setForm({ ...form, args: e.target.value })} className="h-8 rounded-sm bg-surface-1 px-2 font-mono text-sm text-text-primary hairline outline-none focus:border-[var(--accent)]" />
                </label>
              </>
            ) : (
              <label className="col-span-2 flex flex-col gap-1 text-xs text-text-secondary">
                URL
                <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className="h-8 rounded-sm bg-surface-1 px-2 font-mono text-sm text-text-primary hairline outline-none focus:border-[var(--accent)]" placeholder="https://host/mcp" />
              </label>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" disabled={!form.name.trim() || busyId === 'new'} onClick={() => void save()}>
              {busyId === 'new' ? 'Connecting…' : 'Save & connect'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {servers === null && <div className="text-sm text-text-secondary">Loading…</div>}
      {servers?.length === 0 && !adding && (
        <div className="rounded-md bg-surface-2 p-6 text-center hairline-subtle">
          <Plug className="mx-auto mb-2 size-5 text-text-secondary" />
          <div className="text-sm text-text-primary">No MCP servers configured</div>
          <div className="mt-1 text-xs text-text-secondary">
            Try <code className="code-xs">npx -y @modelcontextprotocol/server-filesystem &lt;dir&gt;</code> or any Streamable-HTTP MCP endpoint.
          </div>
        </div>
      )}
      {servers?.map((s) => (
        <div key={s.id} className="rounded-md bg-surface-2 p-4 hairline-subtle">
          <div className="flex items-center gap-3">
            <span className={cn('job-dot', s.status?.connected ? 'bg-positive' : s.status?.error ? 'bg-negative' : 'bg-fg-disabled')} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">{s.name}</span>
                <Badge variant="outline">{s.transport}</Badge>
                {s.status?.connected && <Badge variant="positive">{s.status.tools.length} tools</Badge>}
              </div>
              <div className="truncate font-mono text-xs text-text-secondary">{s.transport === 'stdio' ? `${s.command ?? ''} ${s.args.join(' ')}` : s.url}</div>
              {s.status?.error && <div className="mt-1 text-xs text-negative">{s.status.error}</div>}
            </div>
            <Switch checked={s.enabled} onCheckedChange={(v) => void api('/api/agent/mcp/servers', { method: 'POST', json: { ...s, enabled: v }, timeoutMs: 120_000 }).then(load)} aria-label="Enabled" />
            <Button variant="ghost" size="iconSm" aria-label="Reconnect" disabled={busyId === s.id} onClick={() => { setBusyId(s.id); void api(`/api/agent/mcp/servers/${s.id}/connect`, { method: 'POST', timeoutMs: 120_000 }).finally(() => { setBusyId(null); load() }) }}>
              <RefreshCw className={cn('size-4', busyId === s.id && 'animate-spin')} />
            </Button>
            <Button variant="ghost" size="iconSm" aria-label="Delete" onClick={() => void api(`/api/agent/mcp/servers/${s.id}`, { method: 'DELETE' }).then(load)}>
              <Trash2 className="size-4" />
            </Button>
          </div>
          {s.status?.tools.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {s.status.tools.map((t) => (
                <Badge key={t.name} variant="neutral" title={t.description}>
                  {t.name}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      ))}
      <div className="flex items-center gap-2 text-xs text-text-disabled">
        <Check className="size-3.5" /> Approval-gated · <X className="size-3.5" /> untrusted output is sanitised before it reaches the prompt
      </div>
    </div>
  )
}
