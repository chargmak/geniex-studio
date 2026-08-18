import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AlertTriangle, ArrowDownToLine, Check, FolderOpen, RefreshCw, Search } from 'lucide-react'
import type { StudioSettings } from '@shared/settings'
import type { ComputeUnit } from '@shared/config'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useUiStore } from '@/stores/uiStore'
import { useServerStore } from '@/stores/serverStore'
import { useModelsStore } from '@/stores/modelsStore'
import { useUpdates } from '@/hooks/useUpdates'

type Section = 'server' | 'defaults' | 'workspace' | 'appearance' | 'updates' | 'about'
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'server', label: 'GenieX server' },
  { id: 'defaults', label: 'Model defaults' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'appearance', label: 'Appearance & startup' },
  { id: 'updates', label: 'Updates' },
  { id: 'about', label: 'About' },
]

function formatBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start gap-4 px-4 py-3 hairline-b last:border-b-0">
      <div className="w-56 shrink-0">
        <div className="text-sm text-text-primary">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-text-secondary">{hint}</div>}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  )
}

const inputCls = 'h-8 rounded-sm bg-surface-1 px-2 text-sm text-text-primary hairline outline-none focus:border-[var(--accent)] disabled:opacity-50'

export function SettingsPage(): React.JSX.Element {
  const { section } = useParams()
  const navigate = useNavigate()
  const active = (SECTIONS.some((s) => s.id === section) ? section : 'server') as Section
  const [settings, setSettings] = useState<StudioSettings | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const genie = useServerStore((s) => s.genie)
  const restart = useServerStore((s) => s.restart)
  const refresh = useServerStore((s) => s.refresh)
  const installed = useModelsStore((s) => s.installed)
  const refreshModels = useModelsStore((s) => s.refresh)
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)

  useEffect(() => {
    void api<StudioSettings>('/api/settings').then(setSettings)
    void api<{ version: string }>('/api/health').then((h) => setVersion(h.version)).catch(() => {})
    void refreshModels()
  }, [refreshModels])

  const patch = useCallback(async (p: Record<string, unknown>) => {
    const next = await api<StudioSettings>('/api/settings', { method: 'PATCH', json: p })
    setSettings(next)
    setSaved(true)
    setTimeout(() => setSaved(false), 1200)
    return next
  }, [])

  if (!settings) return <div className="p-6 text-sm text-text-secondary">Loading settings…</div>
  const g = settings.genie
  const d = settings.defaults
  const serverDirty = false

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-56 shrink-0 bg-surface-2 p-2 hairline-r">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" onClick={() => navigate(`/settings/${s.id}`)} className={cn('flex h-8 w-full items-center rounded-sm px-2 text-left text-[13px]', active === s.id ? 'bg-accent-soft text-accent-brand' : 'text-text-secondary hover:bg-surface-3 hover:text-text-primary')}>
            {s.label}
          </button>
        ))}
        <div className={cn('mt-3 flex items-center gap-1 px-2 text-xs text-positive transition-opacity', saved ? 'opacity-100' : 'opacity-0')}>
          <Check className="size-3.5" /> Saved
        </div>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl p-6">
          {active === 'server' && (
            <>
              <h2 className="heading-sm text-text-primary">GenieX server</h2>
              <p className="mt-1 mb-4 body-sm text-text-secondary">How Studio launches <code className="code-xs">geniex serve</code>. Changes to host/keepalive/context/compute apply after a restart.</p>
              <div className="rounded-md bg-surface-2 hairline-subtle">
                <Row label="CLI path" hint={genie?.cliFound ? `Detected: ${genie.cliPath}` : 'Not found — install GenieX CLI or set the full path to geniex.exe'}>
                  <input defaultValue={g.cliPath ?? ''} placeholder="auto-detect (%LOCALAPPDATA%\GenieX CLI\geniex.exe)" onBlur={(e) => void patch({ genie: { cliPath: e.target.value.trim() || null } }).then(() => api('/api/genie/probe-cli', { method: 'POST' })).then(() => refresh())} className={cn(inputCls, 'flex-1 font-mono')} />
                  {window.studio?.showOpenDialog && (
                    <Button variant="secondary" size="sm" onClick={() => void window.studio!.showOpenDialog({ title: 'Locate geniex.exe', properties: ['openFile'], filters: [{ name: 'geniex', extensions: ['exe'] }] }).then((p) => { if (p[0]) void patch({ genie: { cliPath: p[0] } }).then(() => api('/api/genie/probe-cli', { method: 'POST' })).then(() => refresh()) })}>
                      <Search className="size-3.5" /> Browse
                    </Button>
                  )}
                </Row>
                <Row label="Host" hint="Bind address for geniex serve. Keep loopback — the server has no authentication.">
                  <input defaultValue={g.host} onBlur={(e) => void patch({ genie: { host: e.target.value.trim() || '127.0.0.1:18181' } })} className={cn(inputCls, 'w-56 font-mono')} />
                </Row>
                <Row label="Keep model loaded (seconds)" hint="Idle time before GenieX unloads the resident model. Higher = faster follow-ups, more RAM held.">
                  <input type="number" min={0} max={86400} defaultValue={g.keepaliveSeconds} onBlur={(e) => void patch({ genie: { keepaliveSeconds: Number(e.target.value) || 600 } })} className={cn(inputCls, 'w-28 tabular-nums')} />
                </Row>
                <Row label="Context window (GGUF)" hint="Default --nctx for llama.cpp models. QAIRT bundles have context baked in (~4096). More context = more RAM.">
                  <input type="number" min={512} max={131072} step={512} defaultValue={g.nctx} onBlur={(e) => void patch({ genie: { nctx: Number(e.target.value) || 4096 } })} className={cn(inputCls, 'w-28 tabular-nums')} />
                </Row>
                <Row label="Server-wide compute" hint="Default compute unit passed to geniex serve (per-chat setting overrides). Empty = GenieX default (npu).">
                  <select value={g.compute ?? ''} onChange={(e) => void patch({ genie: { compute: (e.target.value || null) as ComputeUnit | null } })} className={cn(inputCls, 'w-40')}>
                    <option value="">default (npu)</option>
                    {(['npu', 'hybrid', 'gpu', 'cpu'] as ComputeUnit[]).map((c) => (
                      <option key={c} value={c}>
                        {c.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Log level">
                  <select value={g.logLevel} onChange={(e) => void patch({ genie: { logLevel: e.target.value } })} className={cn(inputCls, 'w-40')}>
                    {['none', 'error', 'warn', 'info', 'debug', 'trace'].map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Start server with Studio">
                  <Switch checked={g.autoStart} onCheckedChange={(v) => void patch({ genie: { autoStart: v } })} />
                </Row>
                <Row label="Attach to an already-running server" hint="If something else already runs geniex serve on the host, use it instead of failing.">
                  <Switch checked={g.attachExisting} onCheckedChange={(v) => void patch({ genie: { attachExisting: v } })} />
                </Row>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => void restart()} disabled={serverDirty}>
                  Restart server now
                </Button>
                <span className="text-xs text-text-secondary">Status: {genie?.state ?? '—'}</span>
              </div>
            </>
          )}

          {active === 'defaults' && (
            <>
              <h2 className="heading-sm text-text-primary">Model defaults</h2>
              <p className="mt-1 mb-4 body-sm text-text-secondary">Used for new conversations. Each chat can override these from the composer.</p>
              <div className="rounded-md bg-surface-2 hairline-subtle">
                {(
                  [
                    ['chatModel', 'Chat model', 'Default for new chats'],
                    ['agentModel', 'Agent model', 'Used in Agent mode (tool calling works best with ≥4B models)'],
                    ['visionModel', 'Vision model', 'Used for image attachments and analyze_image'],
                  ] as const
                ).map(([key, label, hint]) => (
                  <Row key={key} label={label} hint={hint}>
                    <select value={d[key] ?? ''} onChange={(e) => void patch({ defaults: { [key]: e.target.value || null } })} className={cn(inputCls, 'w-full max-w-md')}>
                      <option value="">— auto (first installed) —</option>
                      {installed
                        .filter((m) => key !== 'visionModel' || m.type === 'vlm')
                        .flatMap((m) => m.requestIds)
                        .map((id) => (
                          <option key={id} value={id}>
                            {id}
                          </option>
                        ))}
                    </select>
                  </Row>
                ))}
                <Row label="System prompt" hint="Prepended to every conversation unless the chat sets its own.">
                  <textarea defaultValue={d.systemPrompt} rows={3} onBlur={(e) => void patch({ defaults: { systemPrompt: e.target.value } })} className="w-full rounded-sm bg-surface-1 px-3 py-2 body-sm hairline outline-none focus:border-[var(--accent)]" />
                </Row>
                <Row label="Thinking mode by default" hint="Reasoning models (Qwen3) plan in a collapsible “thought process” before answering. Slower but smarter.">
                  <Switch checked={d.enableThink} onCheckedChange={(v) => void patch({ defaults: { enableThink: v } })} />
                </Row>
                <Row label="Compute for GGUF models" hint="npu = pinned to the Hexagon NPU (reliable default); hybrid = NPU + CPU scheduler (documented as fastest, but crashed on 4B models here); QAIRT bundles ignore this.">
                  <select value={d.computeGguf} onChange={(e) => void patch({ defaults: { computeGguf: e.target.value } })} className={cn(inputCls, 'w-40')}>
                    {(['npu', 'hybrid', 'gpu', 'cpu'] as ComputeUnit[]).map((c) => (
                      <option key={c} value={c}>
                        {c.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Reuse KV cache between turns" hint="Sends GenieX-KeepCache so unchanged history isn’t re-prefilled. Turn off if answers look stale.">
                  <Switch checked={d.keepCache} onCheckedChange={(v) => void patch({ defaults: { keepCache: v } })} />
                </Row>
                <Row label="Sampling defaults" hint="temperature · top-p · max tokens">
                  <input type="number" step={0.05} min={0} max={2} defaultValue={d.sampler.temperature} onBlur={(e) => void patch({ defaults: { sampler: { temperature: Number(e.target.value) } } })} className={cn(inputCls, 'w-20 tabular-nums')} title="temperature" />
                  <input type="number" step={0.01} min={0} max={1} defaultValue={d.sampler.top_p} onBlur={(e) => void patch({ defaults: { sampler: { top_p: Number(e.target.value) } } })} className={cn(inputCls, 'w-20 tabular-nums')} title="top-p" />
                  <input type="number" step={64} min={64} max={32768} defaultValue={d.sampler.max_tokens} onBlur={(e) => void patch({ defaults: { sampler: { max_tokens: Number(e.target.value) } } })} className={cn(inputCls, 'w-24 tabular-nums')} title="max tokens" />
                </Row>
              </div>
            </>
          )}

          {active === 'workspace' && (
            <>
              <h2 className="heading-sm text-text-primary">Workspace</h2>
              <p className="mt-1 mb-4 body-sm text-text-secondary">The folder Agent mode reads and writes. Each conversation can pick its own; this is the default. Tools cannot escape the workspace.</p>
              <div className="rounded-md bg-surface-2 hairline-subtle">
                <Row label="Default workspace folder">
                  <input defaultValue={settings.workspace.root ?? ''} placeholder="~/GenieX Studio Workspace" onBlur={(e) => void patch({ workspace: { root: e.target.value.trim() || null } })} className={cn(inputCls, 'flex-1 font-mono')} />
                  {window.studio?.showOpenDialog && (
                    <Button variant="secondary" size="sm" onClick={() => void window.studio!.showOpenDialog({ title: 'Choose workspace folder', properties: ['openDirectory'] }).then((p) => { if (p[0]) void patch({ workspace: { root: p[0] } }) })}>
                      <FolderOpen className="size-3.5" /> Browse
                    </Button>
                  )}
                </Row>
              </div>
              <p className="mt-3 text-xs text-text-secondary">Tool permissions, auto-approve rules and MCP servers live under Agents → Tools & approvals.</p>
            </>
          )}

          {active === 'appearance' && (
            <>
              <h2 className="heading-sm text-text-primary">Appearance & startup</h2>
              <div className="mt-4 rounded-md bg-surface-2 hairline-subtle">
                <Row label="Theme">
                  <div className="flex h-8 items-center rounded-sm bg-surface-3 p-0.5 hairline-subtle">
                    {(['dark', 'light'] as const).map((t) => (
                      <button key={t} type="button" onClick={() => { setTheme(t); void patch({ ui: { theme: t } }) }} className={cn('h-7 rounded-xs px-3 text-xs capitalize', theme === t ? 'bg-surface-1 text-text-primary shadow-1' : 'text-text-secondary')}>
                        {t}
                      </button>
                    ))}
                  </div>
                </Row>
                <Row label="Close to tray" hint="Keep the server and downloads running when the window is closed.">
                  <Switch checked={settings.ui.closeToTray} onCheckedChange={(v) => void patch({ ui: { closeToTray: v } })} />
                </Row>
                <Row label="Start with Windows" hint="Launches Studio into the tray when you sign in, so the first chat of the day has no cold start.">
                  <Switch checked={settings.ui.launchAtLogin} onCheckedChange={(v) => void patch({ ui: { launchAtLogin: v } })} />
                </Row>
                <Row label="Start minimized to tray" hint="Applies to every launch, not just sign-in. Click the tray icon to open the window.">
                  <Switch checked={settings.ui.startMinimized} onCheckedChange={(v) => void patch({ ui: { startMinimized: v } })} />
                </Row>
              </div>
              {!window.studio?.isElectron && <p className="mt-3 text-xs text-text-secondary">Tray and startup options only apply to the desktop app.</p>}
            </>
          )}

          {active === 'updates' && <UpdatesSection settings={settings} patch={patch} />}

          {active === 'about' && (
            <>
              <h2 className="heading-sm text-text-primary">About GenieX Studio</h2>
              <div className="mt-3 rounded-md bg-surface-2 p-4 body-sm text-text-secondary hairline-subtle">
                <p>A local-first desktop studio for Qualcomm GenieX on Snapdragon: chat, vision and agents on the Hexagon NPU. Nothing leaves this device unless the agent’s web tools are used.</p>
                <ul className="mt-3 list-disc pl-5 text-xs">
                  <li>Studio version: {version ?? '—'}{window.studio ? ` · Electron ${window.studio.versions.electron}` : ' · browser mode'}</li>
                  <li>GenieX runtime: {genie?.cliVersion ?? '—'} · QAIRT {genie?.qairtVersion ?? '—'} · llama.cpp {genie?.llamaCppHash ?? '—'}</li>
                  <li>Chipset: {genie?.chipset ?? '—'}</li>
                  <li>Data folder: settings.json, studio.db, attachments and checkpoints live in the app data directory.</li>
                  <li>Design system: Qualcomm --q-* tokens · React Bits Pro App-UI patterns.</li>
                </ul>
                <div className="mt-3 flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => void patch({ onboarding: { completed: false } }).then(() => navigate('/chat'))}>
                    Show onboarding again
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** Updates section: version, release channel, and the check → download → restart flow (desktop app only). */
function UpdatesSection({ settings, patch }: { settings: StudioSettings; patch: (p: Record<string, unknown>) => Promise<StudioSettings> }): React.JSX.Element {
  const { state, check, download, install } = useUpdates()
  const u = settings.updates
  const busy = state?.status === 'checking' || state?.status === 'downloading'

  return (
    <>
      <h2 className="heading-sm text-text-primary">Updates</h2>
      <p className="mt-1 mb-4 body-sm text-text-secondary">
        Studio updates itself from its GitHub releases: it downloads only the changed blocks of the installer, then applies them on restart. Your settings, chats and models are untouched.
      </p>

      {!state && <div className="rounded-md bg-surface-2 p-4 body-sm text-text-secondary hairline-subtle">Updates are managed by the desktop app — this browser view only shows the running version.</div>}

      {state && (
        <>
          <div className="rounded-md bg-surface-2 p-4 hairline-subtle">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-text-primary">
                  {state.status === 'downloaded'
                    ? `Version ${state.availableVersion} is ready to install`
                    : state.status === 'downloading'
                      ? `Downloading ${state.availableVersion}…`
                      : state.status === 'available'
                        ? `Version ${state.availableVersion} is available`
                        : state.status === 'checking'
                          ? 'Checking for updates…'
                          : `GenieX Studio ${state.currentVersion}`}
                </div>
                <div className="mt-0.5 text-xs text-text-secondary">
                  {state.status === 'downloading'
                    ? `${formatBytes(state.transferred)} of ${formatBytes(state.total)} · ${formatBytes(state.bytesPerSecond)}/s`
                    : state.status === 'not-available'
                      ? 'You are on the latest version.'
                      : !state.supported
                        ? 'Development build — no update feed is wired up.'
                        : state.lastCheckedAt
                          ? `Last checked ${new Date(state.lastCheckedAt).toLocaleString()}`
                          : 'Not checked yet.'}
                </div>
              </div>
              {state.supported && state.status === 'downloaded' && (
                <Button size="sm" onClick={() => void install()}>
                  <RefreshCw className="size-3.5" /> Restart & install
                </Button>
              )}
              {state.supported && state.status === 'available' && (
                <Button size="sm" onClick={() => void download()}>
                  <ArrowDownToLine className="size-3.5" /> Download
                </Button>
              )}
              {state.supported && state.status !== 'downloaded' && state.status !== 'available' && (
                <Button variant="secondary" size="sm" onClick={() => void check()} disabled={busy}>
                  <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} /> Check now
                </Button>
              )}
            </div>
            {state.status === 'downloading' && (
              <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-surface-3">
                <div className="h-full bg-[var(--accent)] transition-[width] duration-300" style={{ width: `${state.percent}%` }} />
              </div>
            )}
            {state.error && (
              <div className="mt-3 flex items-start gap-2 rounded-sm bg-surface-3 p-2 text-xs text-negative">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0 break-words">{state.error}</span>
              </div>
            )}
            {state.releaseNotes && (state.status === 'available' || state.status === 'downloaded') && (
              <div className="mt-3 max-h-48 overflow-y-auto rounded-sm bg-surface-1 p-3 text-xs text-text-secondary [&_a]:text-accent-brand [&_li]:ml-4 [&_li]:list-disc" dangerouslySetInnerHTML={{ __html: sanitizeNotes(state.releaseNotes) }} />
            )}
          </div>

          <div className="mt-4 rounded-md bg-surface-2 hairline-subtle">
            <Row label="Check automatically" hint="On launch and every few hours.">
              <Switch checked={u.autoCheck} onCheckedChange={(v) => void patch({ updates: { autoCheck: v } })} />
            </Row>
            <Row label="Download in the background" hint="Fetch the installer as soon as an update is found. Installing still waits for you to restart.">
              <Switch checked={u.autoDownload} onCheckedChange={(v) => void patch({ updates: { autoDownload: v } })} />
            </Row>
            <Row label="Release channel" hint="Beta also offers pre-releases. Switching to stable takes effect at the next check.">
              <select value={u.channel} onChange={(e) => void patch({ updates: { channel: e.target.value } })} className={cn(inputCls, 'w-40')}>
                <option value="stable">Stable</option>
                <option value="beta">Beta (pre-releases)</option>
              </select>
            </Row>
          </div>
        </>
      )}
    </>
  )
}

/** Release notes come from GitHub as HTML. Keep text and links, drop anything executable or remote. */
function sanitizeNotes(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|img)[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href\s*=\s*)("|')\s*javascript:[^"']*\2/gi, '$1$2#$2')
}
