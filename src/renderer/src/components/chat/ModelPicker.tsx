import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, Check, ChevronDown, Cpu, Eye, Search } from 'lucide-react'
import type { CachedModel } from '@shared/api'
import { crashRecordFor } from '@shared/modelSelect'
import { cn, formatBytes } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useModelsStore } from '@/stores/modelsStore'
import { useServerStore } from '@/stores/serverStore'

const NO_CRASHES: Record<string, { count: number; lastAt: number; code: string }> = {}

export function modelLabel(id: string | null | undefined): string {
  if (!id) return 'Choose a model'
  const [name, prec] = id.split(':')
  const short = name.split('/').pop() ?? name
  return prec ? `${short} · ${prec}` : short
}

function RuntimeBadge({ m }: { m: CachedModel }): React.JSX.Element {
  return m.runtime === 'qairt' ? <Badge variant="npu">QAIRT · NPU</Badge> : <Badge variant="community">GGUF</Badge>
}

/** Model chooser: installed models grouped by runtime with type/size badges and crash warnings. */
export function ModelPicker({ value, onChange, compact = false }: { value: string | null; onChange: (id: string) => void; compact?: boolean }): React.JSX.Element {
  const installed = useModelsStore((s) => s.installed)
  const refresh = useModelsStore((s) => s.refresh)
  const loading = useModelsStore((s) => s.loading)
  const crashed = useServerStore((s) => s.genie?.crashedModels) ?? NO_CRASHES
  const resident = useServerStore((s) => s.genie?.residentModel ?? null)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!installed.length) void refresh()
  }, [installed.length, refresh])

  const entries = useMemo(() => {
    const rows: { id: string; model: CachedModel }[] = []
    for (const m of installed) for (const id of m.requestIds) rows.push({ id, model: m })
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => !needle || r.id.toLowerCase().includes(needle))
  }, [installed, q])

  const current = installed.find((m) => m.requestIds.includes(value ?? '') || m.name === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-8 max-w-72 items-center gap-1.5 rounded-sm px-2 text-[13px] font-medium text-text-primary hairline transition-colors hover:bg-surface-3',
            compact && 'max-w-56',
          )}
          aria-label="Choose model"
        >
          {current?.type === 'vlm' ? <Eye className="size-3.5 text-text-secondary" /> : <Cpu className="size-3.5 text-text-secondary" />}
          <span className="truncate">{modelLabel(value)}</span>
          {value && crashRecordFor(crashed, value, current?.name ?? value.split(':')[0]) && <AlertTriangle className="size-3.5 text-warning" />}
          <ChevronDown className="size-3.5 text-text-secondary" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <div className="flex items-center gap-2 px-3 py-2 hairline-b">
          <Search className="size-3.5 text-text-secondary" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search installed models…" className="h-6 flex-1 bg-transparent text-sm outline-none placeholder:text-text-disabled" autoFocus />
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {loading && !installed.length && <div className="px-3 py-6 text-center text-sm text-text-secondary">Loading models…</div>}
          {!loading && !entries.length && (
            <div className="px-3 py-6 text-center text-sm text-text-secondary">
              {installed.length ? 'No matches.' : 'No models installed yet.'}
              <div className="mt-2">
                <Link to="/models" onClick={() => setOpen(false)} className="text-accent-brand hover:underline">
                  Open the Models page →
                </Link>
              </div>
            </div>
          )}
          {entries.map(({ id, model }) => {
            // Crashes are keyed by the id the request used: the bare name for QAIRT, `name:precision` for GGUF.
            const crash = crashRecordFor(crashed, id, model.name)
            const isSel = id === value
            const isResident = resident === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  onChange(id)
                  setOpen(false)
                }}
                className={cn('flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-4', isSel && 'bg-accent-soft')}
              >
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">{isSel ? <Check className="size-3.5 text-accent-brand" /> : null}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-text-primary">{modelLabel(id)}</span>
                    {isResident && <span className="job-dot bg-positive" title="Resident in memory" />}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1">
                    <RuntimeBadge m={model} />
                    <Badge variant={model.type === 'vlm' ? 'accent' : 'neutral'}>{model.type === 'vlm' ? 'Vision' : 'Text'}</Badge>
                    {model.npuEligible && model.runtime !== 'qairt' && <Badge variant="npu">NPU-eligible</Badge>}
                    <span className="metadata-sm text-text-disabled">{formatBytes(model.sizeBytes)}</span>
                    {crash && (
                      <span className="inline-flex items-center gap-1 metadata-sm text-warning" title={`Crashed the GenieX runtime ${crash.count}× (exit ${crash.code}) under CLI ${crash.cliVersion ?? '?'}. Forgotten automatically when the CLI is updated.`}>
                        <AlertTriangle className="size-3" /> crashed {crash.count}×
                      </span>
                    )}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
        <div className="flex items-center justify-between px-3 py-2 hairline-t text-xs text-text-secondary">
          <span>{installed.length} installed</span>
          <Link to="/models" onClick={() => setOpen(false)} className="text-accent-brand hover:underline">
            Manage models
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
