import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Boxes, Check, Download, Eye, Loader2, RefreshCw, Search, Star, Trash2, X } from 'lucide-react'
import type { CachedModel, CatalogueModel, PullJob } from '@shared/api'
import type { StudioSettings } from '@shared/settings'
import { api } from '@/lib/api'
import { cn, formatBytes, formatDuration } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useModelsStore } from '@/stores/modelsStore'
import { useServerStore } from '@/stores/serverStore'

type Tab = 'installed' | 'catalogue' | 'add'

const RECOMMENDED: { name: string; precision: string; type: 'llm' | 'vlm'; hub: 'hf'; why: string }[] = [
  { name: 'unsloth/Qwen3-4B-GGUF', precision: 'Q4_0', type: 'llm', hub: 'hf', why: 'Best all-round chat + agent model that fits the NPU (Q4_0). ~2.4 GB.' },
  { name: 'unsloth/Qwen3-1.7B-GGUF', precision: 'Q4_0', type: 'llm', hub: 'hf', why: 'Fast and light (~1.1 GB); good for quick answers and low RAM.' },
  { name: 'unsloth/Qwen3-8B-GGUF', precision: 'Q4_0', type: 'llm', hub: 'hf', why: 'Stronger reasoning; ~4.7 GB, slower (needs 16 GB RAM).' },
  { name: 'unsloth/Qwen2.5-Coder-7B-Instruct-GGUF', precision: 'Q4_0', type: 'llm', hub: 'hf', why: 'Coding-focused; pairs well with Agent mode.' },
]

export function ModelsPage(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('installed')
  const refresh = useModelsStore((s) => s.refresh)
  const subscribePulls = useModelsStore((s) => s.subscribePulls)
  const pulls = useModelsStore((s) => s.pulls)
  useEffect(() => {
    void refresh()
    return subscribePulls()
  }, [refresh, subscribePulls])
  const activePulls = pulls.filter((p) => p.state === 'running' || p.state === 'queued')

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-1 px-4 hairline-b">
          {(['installed', 'catalogue', 'add'] as Tab[]).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={cn('h-8 rounded-sm px-3 text-[13px] font-medium', tab === t ? 'bg-accent-soft text-accent-brand' : 'text-text-secondary hover:bg-surface-3 hover:text-text-primary')}>
              {t === 'installed' ? 'Installed' : t === 'catalogue' ? 'Qualcomm AI Hub' : 'Add model'}
            </button>
          ))}
          {activePulls.length > 0 && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-job-running">
              <Loader2 className="size-3.5 animate-spin" /> {activePulls.length} download{activePulls.length > 1 ? 's' : ''} running
            </span>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'installed' && <InstalledTab onAdd={() => setTab('add')} />}
          {tab === 'catalogue' && <CatalogueTab />}
          {tab === 'add' && <AddTab />}
        </div>
      </div>
      {pulls.length > 0 && <PullJobsPanel />}
    </div>
  )
}

function RuntimeBadge({ m }: { m: CachedModel }): React.JSX.Element {
  return m.runtime === 'qairt' ? <Badge variant="npu">QAIRT · NPU</Badge> : <Badge variant="community">GGUF · llama.cpp</Badge>
}

function InstalledTab({ onAdd }: { onAdd: () => void }): React.JSX.Element {
  const installed = useModelsStore((s) => s.installed)
  const loading = useModelsStore((s) => s.loading)
  const error = useModelsStore((s) => s.error)
  const refresh = useModelsStore((s) => s.refresh)
  const remove = useModelsStore((s) => s.remove)
  const setType = useModelsStore((s) => s.setType)
  const genie = useServerStore((s) => s.genie)
  const [settings, setSettings] = useState<StudioSettings | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  useEffect(() => {
    void api<StudioSettings>('/api/settings').then(setSettings).catch(() => {})
  }, [])
  const setDefault = async (key: 'chatModel' | 'visionModel' | 'agentModel', id: string): Promise<void> => {
    const next = await api<StudioSettings>('/api/settings', { method: 'PATCH', json: { defaults: { [key]: id } } })
    setSettings(next)
  }
  const crashed = genie?.crashedModels ?? {}
  const anyQairtCrash = Object.keys(crashed).some((n) => /^qualcomm\//i.test(n))

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      {anyQairtCrash && (
        <div className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning hairline-subtle">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            AI Hub QAIRT bundles crashed the GenieX runtime on this device (known GenieX issue #1154 with some NPU drivers). GGUF models with the <strong>Q4_0</strong> quantisation still run on the Hexagon NPU through llama.cpp — use those, and check Windows Update for a newer Qualcomm NPU driver.
          </span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="text-sm text-text-secondary">
          {installed.length} model{installed.length === 1 ? '' : 's'} · {formatBytes(installed.reduce((n, m) => n + (m.sizeBytes ?? 0), 0))} on disk
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void refresh(true)} disabled={loading}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={onAdd}>
            <Download /> Add model
          </Button>
        </div>
      </div>
      {error && <div className="rounded-md bg-negative-soft px-3 py-2 text-xs text-negative hairline-subtle">{error}</div>}
      {!installed.length && !loading && (
        <div className="rounded-md bg-surface-2 p-8 text-center hairline-subtle">
          <Boxes className="mx-auto mb-2 size-6 text-text-secondary" />
          <div className="heading-xs text-text-primary">No models installed</div>
          <p className="mt-1 body-sm text-text-secondary">Add one from the Qualcomm AI Hub catalogue or Hugging Face.</p>
        </div>
      )}
      {installed.map((m) => {
        const crash = crashed[m.name]
        const isChat = settings?.defaults.chatModel && m.requestIds.includes(settings.defaults.chatModel)
        const isVision = settings?.defaults.visionModel && m.requestIds.includes(settings.defaults.visionModel)
        const isAgent = settings?.defaults.agentModel && m.requestIds.includes(settings.defaults.agentModel)
        const resident = genie?.residentModel && m.requestIds.includes(genie.residentModel)
        return (
          <div key={m.name} className="rounded-md bg-surface-2 p-4 hairline-subtle">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-[560] text-text-primary">{m.displayName}</span>
                  <span className="truncate font-mono text-xs text-text-secondary">{m.name}</span>
                  {resident && (
                    <span className="inline-flex items-center gap-1 metadata-sm text-positive">
                      <span className="job-dot bg-positive" /> resident
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <RuntimeBadge m={m} />
                  <Badge variant={m.type === 'vlm' ? 'accent' : 'neutral'}>{m.type === 'vlm' ? 'Vision + text' : 'Text'}</Badge>
                  {m.precisions.map((p) => (
                    <Badge key={p} variant="outline">
                      {p}
                    </Badge>
                  ))}
                  {m.npuEligible && m.runtime !== 'qairt' && <Badge variant="npu">NPU-eligible</Badge>}
                  <span className="metadata-sm text-text-disabled">{formatBytes(m.sizeBytes)}</span>
                  {crash && (
                    <span className="inline-flex items-center gap-1 metadata-sm text-warning" title={`exit ${crash.code}`}>
                      <AlertTriangle className="size-3" /> crashed runtime {crash.count}×
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <DefaultChip label="Chat" active={!!isChat} onClick={() => void setDefault('chatModel', m.requestIds[0])} />
                  <DefaultChip label="Agent" active={!!isAgent} onClick={() => void setDefault('agentModel', m.requestIds[0])} />
                  <DefaultChip label="Vision" active={!!isVision} disabled={m.type !== 'vlm'} onClick={() => void setDefault('visionModel', m.requestIds[0])} />
                  <span className="mx-1 h-4 w-px bg-[var(--border-default)]" />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="xs" onClick={() => void setType(m.name, m.type === 'vlm' ? 'llm' : 'vlm')}>
                        <Eye className="size-3.5" /> Mark as {m.type === 'vlm' ? 'text' : 'vision'}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Override the model type (geniex model set-type). Vision models accept image attachments.</TooltipContent>
                  </Tooltip>
                </div>
              </div>
              {confirm === m.name ? (
                <div className="flex items-center gap-1">
                  <Button variant="destructive" size="xs" onClick={() => void remove(m.name).finally(() => setConfirm(null))}>
                    Delete {formatBytes(m.sizeBytes)}
                  </Button>
                  <Button variant="ghost" size="iconXs" onClick={() => setConfirm(null)} aria-label="Cancel">
                    <X className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" size="iconSm" aria-label="Remove model" onClick={() => setConfirm(m.name)}>
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DefaultChip({ label, active, disabled, onClick }: { label: string; active: boolean; disabled?: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={cn('inline-flex h-6 items-center gap-1 rounded-sm px-2 text-xs hairline-subtle', active ? 'bg-accent-soft text-accent-brand border-transparent' : 'text-text-secondary hover:bg-surface-3', disabled && 'cursor-not-allowed opacity-40')} title={active ? `Default ${label.toLowerCase()} model` : `Use as default ${label.toLowerCase()} model`}>
      {active ? <Star className="size-3 fill-current" /> : <Star className="size-3" />} {label}
    </button>
  )
}

function CatalogueTab(): React.JSX.Element {
  const catalogue = useModelsStore((s) => s.catalogue)
  const loading = useModelsStore((s) => s.catalogueLoading)
  const load = useModelsStore((s) => s.loadCatalogue)
  const startPull = useModelsStore((s) => s.startPull)
  const pulls = useModelsStore((s) => s.pulls)
  const genie = useServerStore((s) => s.genie)
  const [q, setQ] = useState('')
  useEffect(() => {
    if (!catalogue.length) void load()
  }, [catalogue.length, load])
  const rows = useMemo(() => catalogue.filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase())), [catalogue, q])
  const pulling = (name: string): PullJob | undefined => pulls.find((p) => p.name === name && (p.state === 'running' || p.state === 'queued'))
  const anyQairtCrash = Object.keys(genie?.crashedModels ?? {}).some((n) => /^qualcomm\//i.test(n))

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 flex-1 items-center gap-2 rounded-sm bg-surface-2 px-2 hairline-subtle">
          <Search className="size-3.5 text-text-secondary" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter Qualcomm AI Hub models for this chipset…" className="h-full flex-1 bg-transparent text-[13px] outline-none placeholder:text-text-disabled" />
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load({ fresh: true })} disabled={loading}>
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> Refresh
        </Button>
      </div>
      <p className="text-xs text-text-secondary">
        Pre-compiled QAIRT bundles for <strong>{genie?.chipset ?? 'this device'}</strong>: run entirely on the Hexagon NPU, fixed ~4k context, no compute options.
        {anyQairtCrash && <span className="text-warning"> These bundles are currently crashing on this machine (GenieX #1154) — prefer GGUF Q4_0 models from the Add tab.</span>}
      </p>
      {loading && !catalogue.length && <div className="p-6 text-center text-sm text-text-secondary">Loading catalogue from geniex…</div>}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {rows.map((m: CatalogueModel) => {
          const job = pulling(m.name)
          return (
            <div key={m.name} className="flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2.5 hairline-subtle">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-text-primary">{m.name.replace(/^qualcomm\//, '')}</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <Badge variant="npu">QAIRT · NPU</Badge>
                  <Badge variant={m.type === 'vlm' ? 'accent' : 'neutral'}>{m.type === 'vlm' ? 'Vision' : 'Text'}</Badge>
                </div>
              </div>
              {m.installed ? (
                <span className="inline-flex items-center gap-1 text-xs text-positive">
                  <Check className="size-3.5" /> Installed
                </span>
              ) : job ? (
                <span className="inline-flex items-center gap-1 text-xs text-job-running">
                  <Loader2 className="size-3.5 animate-spin" /> {job.progress != null ? `${Math.round(job.progress * 100)}%` : 'Pulling…'}
                </span>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => void startPull({ name: m.name, hub: 'aihub', modelType: m.type as 'llm' | 'vlm' })}>
                  <Download className="size-3.5" /> Pull
                </Button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AddTab(): React.JSX.Element {
  const startPull = useModelsStore((s) => s.startPull)
  const installed = useModelsStore((s) => s.installed)
  const [hub, setHub] = useState<'hf' | 'docker' | 'localfs'>('hf')
  const [repo, setRepo] = useState('')
  const [quants, setQuants] = useState<{ precision: string; sizeBytes: number | null; npuEligible: boolean }[] | null>(null)
  const [suggestedType, setSuggestedType] = useState<'llm' | 'vlm'>('llm')
  const [precision, setPrecision] = useState('')
  const [modelType, setModelType] = useState<'llm' | 'vlm'>('llm')
  const [localPath, setLocalPath] = useState('')
  const [tag, setTag] = useState('latest')
  const [looking, setLooking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lookup = useCallback(async () => {
    setError(null)
    setQuants(null)
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo.trim())) {
      setError('Enter a repository like owner/name (e.g. unsloth/Qwen3-4B-GGUF).')
      return
    }
    setLooking(true)
    try {
      const r = await api<{ quants: { precision: string; sizeBytes: number | null; npuEligible: boolean }[]; suggestedType: 'llm' | 'vlm'; gated: boolean }>(`/api/models/hf/${repo.trim()}`, { timeoutMs: 30_000 })
      setQuants(r.quants)
      setSuggestedType(r.suggestedType)
      setModelType(r.suggestedType)
      const best = r.quants.find((x) => x.npuEligible) ?? r.quants[0]
      setPrecision(best?.precision ?? '')
      if (r.gated) setError('This repository is gated on Hugging Face — set HF_TOKEN in your environment before pulling.')
      if (!r.quants.length) setError('No .gguf files found in this repository.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLooking(false)
    }
  }, [repo])

  const pull = async (): Promise<void> => {
    setError(null)
    try {
      if (hub === 'hf') await startPull({ name: repo.trim(), precision: precision || undefined, hub: 'hf', modelType })
      else if (hub === 'docker') await startPull({ name: repo.trim(), precision: tag || 'latest', hub: 'docker', modelType })
      else await startPull({ name: repo.trim() || 'local/model', hub: 'localfs', localPath: localPath.trim(), modelType })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <section>
        <h2 className="heading-xs text-text-primary">Recommended for Snapdragon X Elite</h2>
        <p className="mt-1 body-sm text-text-secondary">GGUF Q4_0 quantisations run on the Hexagon NPU via llama.cpp (compute “npu” or “hybrid”). One click to pull.</p>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          {RECOMMENDED.map((r) => {
            const have = installed.some((m) => m.name === r.name)
            return (
              <div key={r.name} className="flex items-start gap-3 rounded-md bg-surface-2 p-3 hairline-subtle">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-text-primary">{r.name.split('/').pop()}</div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <Badge variant="community">GGUF</Badge>
                    <Badge variant="npu">{r.precision}</Badge>
                    <Badge variant={r.type === 'vlm' ? 'accent' : 'neutral'}>{r.type === 'vlm' ? 'Vision' : 'Text'}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-text-secondary">{r.why}</div>
                </div>
                {have ? (
                  <span className="inline-flex items-center gap-1 text-xs text-positive">
                    <Check className="size-3.5" /> Installed
                  </span>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => void startPull({ name: r.name, precision: r.precision, hub: r.hub, modelType: r.type })}>
                    <Download className="size-3.5" /> Pull
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section className="rounded-md bg-surface-2 p-4 hairline-subtle">
        <div className="mb-3 flex items-center gap-1">
          {(['hf', 'docker', 'localfs'] as const).map((h) => (
            <button key={h} type="button" onClick={() => setHub(h)} className={cn('h-8 rounded-sm px-3 text-[13px] font-medium', hub === h ? 'bg-accent-soft text-accent-brand' : 'text-text-secondary hover:bg-surface-3')}>
              {h === 'hf' ? 'Hugging Face' : h === 'docker' ? 'Docker Hub' : 'Local files'}
            </button>
          ))}
        </div>
        {hub === 'hf' && (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <input value={repo} onChange={(e) => setRepo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void lookup()} placeholder="owner/repo — e.g. unsloth/Qwen3-4B-GGUF" className="h-9 flex-1 rounded-sm bg-surface-1 px-3 font-mono text-sm hairline outline-none focus:border-[var(--accent)]" />
              <Button variant="secondary" onClick={() => void lookup()} disabled={looking}>
                {looking ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Look up
              </Button>
            </div>
            {quants && quants.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="metadata-sm text-text-secondary">Quantisation</div>
                <div className="flex flex-wrap gap-1.5">
                  {quants.map((qz) => (
                    <button key={qz.precision} type="button" onClick={() => setPrecision(qz.precision)} className={cn('inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-xs hairline', precision === qz.precision ? 'bg-accent-soft text-accent-brand border-transparent' : 'text-text-secondary hover:bg-surface-3')}>
                      <span className="font-mono">{qz.precision}</span>
                      <span className="text-text-disabled">{formatBytes(qz.sizeBytes)}</span>
                      {qz.npuEligible && <span className="text-teal-300">NPU</span>}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3 text-xs text-text-secondary">
                  <span>Type:</span>
                  {(['llm', 'vlm'] as const).map((t) => (
                    <label key={t} className="inline-flex items-center gap-1">
                      <input type="radio" name="mtype" checked={modelType === t} onChange={() => setModelType(t)} className="accent-[var(--accent)]" /> {t === 'llm' ? 'Text (llm)' : 'Vision (vlm)'}
                    </label>
                  ))}
                  {suggestedType === 'vlm' && <span className="text-text-disabled">(vision detected)</span>}
                </div>
                <div>
                  <Button variant="primary" onClick={() => void pull()} disabled={!precision}>
                    <Download /> Pull {repo.split('/').pop()}:{precision}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        {hub === 'docker' && (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="ai/gemma3 (Docker Model Runner namespace)" className="h-9 flex-1 rounded-sm bg-surface-1 px-3 font-mono text-sm hairline outline-none focus:border-[var(--accent)]" />
              <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="tag" className="h-9 w-32 rounded-sm bg-surface-1 px-3 font-mono text-sm hairline outline-none focus:border-[var(--accent)]" />
            </div>
            <div className="flex items-center gap-3">
              <select value={modelType} onChange={(e) => setModelType(e.target.value as 'llm' | 'vlm')} className="h-8 rounded-sm bg-surface-1 px-2 text-sm hairline outline-none">
                <option value="llm">Text (llm)</option>
                <option value="vlm">Vision (vlm)</option>
              </select>
              <Button variant="primary" onClick={() => void pull()} disabled={!repo.trim()}>
                <Download /> Pull
              </Button>
            </div>
          </div>
        )}
        {hub === 'localfs' && (
          <div className="flex flex-col gap-3">
            <input value={localPath} onChange={(e) => setLocalPath(e.target.value)} placeholder="C:\path\to\model-folder or aihub .zip" className="h-9 rounded-sm bg-surface-1 px-3 font-mono text-sm hairline outline-none focus:border-[var(--accent)]" />
            <div className="flex items-center gap-2">
              <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="local/my-model (name)" className="h-8 flex-1 rounded-sm bg-surface-1 px-3 font-mono text-sm hairline outline-none focus:border-[var(--accent)]" />
              <select value={modelType} onChange={(e) => setModelType(e.target.value as 'llm' | 'vlm')} className="h-8 rounded-sm bg-surface-1 px-2 text-sm hairline outline-none">
                <option value="llm">Text (llm)</option>
                <option value="vlm">Vision (vlm)</option>
              </select>
              {window.studio?.showOpenDialog && (
                <Button variant="secondary" size="sm" onClick={() => void window.studio!.showOpenDialog({ title: 'Choose model folder or .zip', properties: ['openFile', 'openDirectory'] }).then((p) => p[0] && setLocalPath(p[0]))}>
                  Browse…
                </Button>
              )}
              <Button variant="primary" onClick={() => void pull()} disabled={!localPath.trim()}>
                <Download /> Import
              </Button>
            </div>
          </div>
        )}
        {error && <div className="mt-3 rounded-md bg-negative-soft px-3 py-2 text-xs text-negative">{error}</div>}
      </section>
    </div>
  )
}

function PullJobsPanel(): React.JSX.Element {
  const pulls = useModelsStore((s) => s.pulls)
  const cancel = useModelsStore((s) => s.cancelPull)
  const clear = useModelsStore((s) => s.clearPulls)
  return (
    <aside className="flex h-full w-80 shrink-0 flex-col bg-surface-2 hairline-l">
      <div className="flex h-11 items-center justify-between px-3 hairline-b">
        <span className="text-[13px] font-medium text-text-primary">Downloads</span>
        <Button variant="ghost" size="xs" onClick={() => void clear()}>
          Clear finished
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {pulls.map((j) => (
          <div key={j.id} className="mb-2 rounded-md bg-surface-1 p-3 hairline-subtle">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-primary" title={j.name}>
                {j.name.split('/').pop()}
                {j.precision ? `:${j.precision}` : ''}
              </span>
              {j.state === 'running' && (
                <Button variant="ghost" size="iconXs" aria-label="Cancel" onClick={() => void cancel(j.id)}>
                  <X className="size-3.5" />
                </Button>
              )}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className={cn('h-full rounded-full transition-[width]', j.state === 'error' ? 'bg-negative' : j.state === 'done' ? 'bg-positive' : j.state === 'cancelled' ? 'bg-fg-disabled' : 'bg-job-pending', j.progress == null && j.state === 'running' && 'animate-pulse')} style={{ width: `${Math.round((j.progress ?? (j.state === 'running' ? 0.05 : 1)) * 100)}%` }} />
            </div>
            <div className="mt-1.5 flex items-center justify-between metadata-sm text-text-secondary">
              <span className={cn(j.state === 'error' && 'text-negative', j.state === 'done' && 'text-positive')}>
                {j.state === 'running' ? (j.progress != null ? `${Math.round(j.progress * 100)}%` : 'Starting') : j.state}
                {j.totalBytes ? ` · ${formatBytes(j.downloadedBytes)} / ${formatBytes(j.totalBytes)}` : ''}
              </span>
              <span>
                {j.speedBytesPerSec ? `${formatBytes(j.speedBytesPerSec)}/s` : ''}
                {j.etaSeconds != null && j.state === 'running' ? ` · ${formatDuration(j.etaSeconds * 1000)} left` : ''}
              </span>
            </div>
            {j.error && <div className="mt-1 text-xs text-negative">{j.error}</div>}
          </div>
        ))}
      </div>
    </aside>
  )
}
