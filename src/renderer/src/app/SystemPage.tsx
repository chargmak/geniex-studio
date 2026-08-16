import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertTriangle, Cpu, Gauge, HardDrive, Play, RefreshCw, Square, Terminal, Zap } from 'lucide-react'
import { api } from '@/lib/api'
import { cn, formatBytes, formatDuration, formatNumber } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useServerStore } from '@/stores/serverStore'
import { useModelsStore } from '@/stores/modelsStore'

interface SystemStats {
  ts: number
  cpuPercent: number | null
  memUsedBytes: number
  memTotalBytes: number
  npuPercent: number | null
  npuCounterName: string | null
  gpuPercent: number | null
  geniex: { pid: number; workingSetBytes: number; cpuSeconds: number } | null
  cores: number
}

interface TelemetryRow {
  ts: number
  model: string | null
  compute: string | null
  ttft_ms: number | null
  total_ms: number | null
  prompt_tokens: number | null
  completion_tokens: number | null
  tokens_per_second: number | null
  load_ms: number | null
  finish_reason: string | null
}

interface ByModel {
  model: string
  compute: string | null
  n: number
  avg_tps: number | null
  avg_ttft: number | null
  last_ts: number
}

function Sparkline({ values, max, className }: { values: number[]; max?: number; className?: string }): React.JSX.Element {
  const w = 160
  const h = 36
  const m = max ?? Math.max(1, ...values)
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${h - (Math.min(v, m) / m) * (h - 2) - 1}`).join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={cn('overflow-visible', className)} aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function StatTile({ icon: Icon, label, value, unit, sub, series, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; unit?: string; sub?: string; series?: number[]; tone?: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface-2 p-4 hairline-subtle">
      <div className="flex items-center gap-2 metadata-md text-text-secondary">
        <Icon className="size-3.5" /> {label}
      </div>
      <div className="flex items-baseline gap-1">
        <span className={cn('heading-lg tabular-nums text-text-primary', tone)}>{value}</span>
        {unit && <span className="text-sm text-text-secondary">{unit}</span>}
      </div>
      {series && series.length > 1 && <Sparkline values={series} max={100} className="text-accent-brand" />}
      {sub && <div className="text-xs text-text-disabled">{sub}</div>}
    </div>
  )
}


/**
 * Forgetting the crash history re-arms models that took the runtime down, so it asks twice.
 * Only worth doing after an NPU / Compute-DSP driver update (or a GenieX release that fixes #1154).
 */
function ClearCrashesButton({ onCleared }: { onCleared: () => void }): React.JSX.Element {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 10_000)
    return () => clearTimeout(t)
  }, [armed])
  if (!armed)
    return (
      <Button size="xs" variant="secondary" onClick={() => setArmed(true)}>
        Clear after driver update
      </Button>
    )
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-text-secondary">Only if the driver changed — these models will be auto-selectable again.</span>
      <Button size="xs" variant="destructive" onClick={() => void api('/api/genie/crashes/clear', { method: 'POST', json: {} }).then(() => { setArmed(false); onCleared() })}>
        Clear history
      </Button>
      <Button size="xs" variant="ghost" onClick={() => setArmed(false)}>
        Cancel
      </Button>
    </span>
  )
}

export function SystemPage(): React.JSX.Element {
  const genie = useServerStore((s) => s.genie)
  const studio = useServerStore((s) => s.studio)
  const start = useServerStore((s) => s.start)
  const stop = useServerStore((s) => s.stop)
  const restart = useServerStore((s) => s.restart)
  const refresh = useServerStore((s) => s.refresh)
  const installed = useModelsStore((s) => s.installed)
  const refreshModels = useModelsStore((s) => s.refresh)
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [history, setHistory] = useState<SystemStats[]>([])
  const [tele, setTele] = useState<{ recent: TelemetryRow[]; byModel: ByModel[] } | null>(null)
  const [logs, setLogs] = useState<{ ts: number; stream: string; line: string }[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [bench, setBench] = useState<{ model: string; compute: string; running: boolean; result: Record<string, unknown> | null }>({ model: '', compute: 'hybrid', running: false, result: null })
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void refresh()
    void refreshModels()
    const es = new EventSource('/api/system/stats-events')
    es.addEventListener('stats', (e) => {
      const s = JSON.parse((e as MessageEvent).data) as SystemStats
      setStats(s)
      setHistory((h) => [...h.slice(-59), s])
    })
    const ge = new EventSource('/api/genie/events')
    ge.addEventListener('log', (e) => setLogs((l) => [...l.slice(-499), JSON.parse((e as MessageEvent).data)]))
    ge.addEventListener('status', () => void refresh())
    void api<{ lines: { ts: number; stream: string; line: string }[] }>('/api/genie/logs?limit=200').then((r) => setLogs(r.lines))
    const loadTele = (): void => void api<{ recent: TelemetryRow[]; byModel: ByModel[] }>('/api/system/telemetry').then(setTele).catch(() => {})
    loadTele()
    const t = setInterval(loadTele, 10_000)
    return () => {
      es.close()
      ge.close()
      clearInterval(t)
    }
  }, [refresh, refreshModels])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs.length])

  const act = useCallback(async (name: string, fn: () => Promise<void>) => {
    setBusy(name)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }, [])

  const cpuSeries = useMemo(() => history.map((h) => h.cpuPercent ?? 0), [history])
  const npuSeries = useMemo(() => history.map((h) => h.npuPercent ?? 0), [history])
  const tpsSeries = useMemo(() => (tele?.recent ?? []).slice(0, 40).reverse().map((r) => r.tokens_per_second ?? 0), [tele])
  const state = genie?.state ?? 'unknown'
  const uptime = genie?.startedAt ? Date.now() - genie.startedAt : null

  const runBench = async (): Promise<void> => {
    const model = bench.model || installed[0]?.requestIds[0]
    if (!model) return
    setBench((b) => ({ ...b, running: true, result: null }))
    try {
      const r = await api<Record<string, unknown>>('/api/system/benchmark', { method: 'POST', json: { model, compute: installed.find((m) => m.requestIds.includes(model))?.runtime === 'qairt' ? undefined : bench.compute, tokens: 256 }, timeoutMs: 600_000 })
      setBench((b) => ({ ...b, running: false, result: r }))
    } catch (err) {
      setBench((b) => ({ ...b, running: false, result: { error: err instanceof Error ? err.message : String(err) } }))
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 overflow-y-auto p-4">
      {/* Server card */}
      <div className="rounded-md bg-surface-2 p-4 hairline-subtle">
        <div className="flex flex-wrap items-center gap-3">
          <span className={cn('job-dot', state === 'running' ? (genie?.busy ? 'bg-job-running' : 'bg-positive') : state === 'starting' || state === 'stopping' ? 'bg-job-initializing animate-pulse' : state === 'error' ? 'bg-negative' : 'bg-fg-disabled')} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="heading-xs text-text-primary">GenieX server</span>
              <Badge variant={state === 'running' ? 'positive' : state === 'error' ? 'negative' : 'neutral'}>{state}</Badge>
              {genie?.managed === false && state === 'running' && <Badge variant="outline">external</Badge>}
              {genie?.busy && <Badge variant="running">generating</Badge>}
              {genie && genie.queueDepth > 0 && <Badge variant="pending">{genie.queueDepth} queued</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
              <span className="font-mono">{genie?.url}</span>
              {genie?.pid && <span>pid {genie.pid}</span>}
              {uptime != null && state === 'running' && <span>up {formatDuration(uptime)}</span>}
              {genie?.cliVersion && <span>GenieX {genie.cliVersion}</span>}
              {genie?.qairtVersion && <span>QAIRT {genie.qairtVersion}</span>}
              {genie?.llamaCppHash && <span>llama.cpp {genie.llamaCppHash}</span>}
              {genie?.chipset && <span>{genie.chipset}</span>}
              {studio && (
                <span>
                  Studio {studio.version} · Electron {studio.electron ?? '—'} · Node {studio.node} · {studio.arch}
                </span>
              )}
            </div>
            {genie?.lastError && state !== 'running' && <div className="mt-1 text-xs text-negative">{genie.lastError}</div>}
            {genie?.residentModel && (
              <div className="mt-1 text-xs text-text-secondary">
                Resident model: <span className="font-mono text-text-primary">{genie.residentModel}</span>
                {genie.residentSince && <span> · since {formatDuration(Date.now() - genie.residentSince)} ago</span>}
                <span> · unloads after {genie.settings.keepaliveSeconds}s idle</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {state !== 'running' ? (
              <Button variant="primary" size="sm" disabled={!!busy || !genie?.cliFound} onClick={() => void act('start', start)}>
                <Play className="size-3.5" /> {busy === 'start' ? 'Starting…' : 'Start'}
              </Button>
            ) : (
              <>
                <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => void act('restart', restart)}>
                  <RefreshCw className={cn('size-3.5', busy === 'restart' && 'animate-spin')} /> Restart
                </Button>
                <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => void act('stop', stop)}>
                  <Square className="size-3.5" /> Stop
                </Button>
              </>
            )}
          </div>
        </div>
        {!genie?.cliFound && (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            GenieX CLI was not found. Install it from geniex.aihub.qualcomm.com or set the path in Settings → GenieX server.
          </div>
        )}
        {genie && Object.keys(genie.crashedModels).length > 0 && (
          <div className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
            <div className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="size-3.5" /> Models that crashed the runtime on this device
            </div>
            <ul className="mt-1 list-disc pl-5">
              {Object.entries(genie.crashedModels).map(([name, c]) => (
                <li key={name}>
                  <span className="font-mono">{name}</span> — {c.count}× (exit {c.code}). {/^qualcomm\//i.test(name) ? 'QAIRT/NPU-driver issue (GenieX #1154): use GGUF Q4_0 with compute npu/hybrid instead.' : ''}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-text-secondary">Remembered across restarts — new chats never auto-select these. You can still pick one by hand.</span>
              <ClearCrashesButton onCleared={refresh} />
            </div>
          </div>
        )}
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile icon={Zap} label="Hexagon NPU" value={stats?.npuPercent != null ? formatNumber(stats.npuPercent, 0) : '—'} unit={stats?.npuPercent != null ? '%' : undefined} series={npuSeries} sub={stats?.npuCounterName ? 'Windows NPU Engine counter' : 'No NPU utilisation counter exposed by this driver — watch tok/s instead'} />
        <StatTile icon={Cpu} label="CPU" value={stats?.cpuPercent != null ? formatNumber(stats.cpuPercent, 0) : '—'} unit="%" series={cpuSeries} sub={stats ? `${stats.cores} cores` : undefined} />
        <StatTile icon={HardDrive} label="Memory" value={stats ? formatBytes(stats.memUsedBytes, 1) : '—'} sub={stats ? `of ${formatBytes(stats.memTotalBytes, 0)} · geniex ${stats.geniex ? formatBytes(stats.geniex.workingSetBytes, 1) : '—'}` : undefined} />
        <StatTile icon={Gauge} label="Last decode speed" value={tele?.recent?.[0]?.tokens_per_second != null ? formatNumber(tele.recent[0].tokens_per_second, 1) : '—'} unit="tok/s" series={tpsSeries.length > 1 ? tpsSeries.map((v) => (v / Math.max(1, ...tpsSeries)) * 100) : undefined} sub={tele?.recent?.[0]?.model ? `${tele.recent[0].model.split('/').pop()} · TTFT ${formatDuration(tele.recent[0].ttft_ms)}` : 'Send a message to record telemetry'} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Per-model performance */}
        <div className="rounded-md bg-surface-2 p-4 hairline-subtle">
          <div className="mb-2 flex items-center gap-2 metadata-md text-text-secondary">
            <Activity className="size-3.5" /> Performance by model
          </div>
          {!tele?.byModel?.length && <div className="text-sm text-text-secondary">No measurements yet.</div>}
          <table className="w-full text-sm">
            <tbody>
              {tele?.byModel?.map((r) => (
                <tr key={`${r.model}-${r.compute}`} className="hairline-b last:border-b-0">
                  <td className="py-1.5 pr-2">
                    <div className="truncate font-medium text-text-primary">{r.model.split('/').pop()}</div>
                    <div className="text-xs text-text-secondary">{r.compute?.toUpperCase() ?? 'NPU'} · {r.n} runs</div>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    <div className="text-text-primary">{formatNumber(r.avg_tps ?? 0, 1)} tok/s</div>
                    <div className="text-xs text-text-secondary">TTFT {formatDuration(r.avg_ttft)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Benchmark */}
        <div className="rounded-md bg-surface-2 p-4 hairline-subtle">
          <div className="mb-2 flex items-center gap-2 metadata-md text-text-secondary">
            <Gauge className="size-3.5" /> Benchmark
          </div>
          <p className="mb-3 text-xs text-text-secondary">Runs a fixed 256-token prompt and reports load time, TTFT and decode speed. Compare compute units for GGUF models.</p>
          <div className="flex flex-wrap items-center gap-2">
            <select value={bench.model || installed[0]?.requestIds[0] || ''} onChange={(e) => setBench((b) => ({ ...b, model: e.target.value }))} className="h-8 max-w-64 rounded-sm bg-surface-1 px-2 text-sm hairline outline-none">
              {installed.flatMap((m) => m.requestIds).map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            <select value={bench.compute} onChange={(e) => setBench((b) => ({ ...b, compute: e.target.value }))} className="h-8 rounded-sm bg-surface-1 px-2 text-sm hairline outline-none">
              {['npu', 'hybrid', 'gpu', 'cpu'].map((c) => (
                <option key={c} value={c}>
                  {c.toUpperCase()}
                </option>
              ))}
            </select>
            <Button size="sm" variant="primary" disabled={bench.running || !installed.length} onClick={() => void runBench()}>
              {bench.running ? 'Running…' : 'Run'}
            </Button>
          </div>
          {bench.result && (
            <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
              {'error' in bench.result && bench.result.error ? (
                <div className="col-span-3 text-negative">{String(bench.result.error)}</div>
              ) : (
                <>
                  <div className="rounded-sm bg-surface-1 p-2 hairline-subtle">
                    <div className="metadata-sm text-text-secondary">Decode</div>
                    <div className="tabular-nums text-text-primary">{formatNumber(bench.result.tokensPerSecond as number, 1)} tok/s</div>
                  </div>
                  <div className="rounded-sm bg-surface-1 p-2 hairline-subtle">
                    <div className="metadata-sm text-text-secondary">TTFT</div>
                    <div className="tabular-nums text-text-primary">{formatDuration(bench.result.ttftMs as number)}</div>
                  </div>
                  <div className="rounded-sm bg-surface-1 p-2 hairline-subtle">
                    <div className="metadata-sm text-text-secondary">Load</div>
                    <div className="tabular-nums text-text-primary">{formatDuration(bench.result.loadMs as number)}</div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Logs */}
      <div className="rounded-md bg-surface-2 hairline-subtle">
        <div className="flex h-9 items-center gap-2 px-3 hairline-b metadata-md text-text-secondary">
          <Terminal className="size-3.5" /> Server log
          <span className="ml-auto text-text-disabled">{logs.length} lines</span>
        </div>
        <div ref={logRef} className="h-64 overflow-auto p-2 code-xs">
          {logs.map((l, i) => (
            <div key={i} className={cn('whitespace-pre-wrap break-all', l.stream === 'studio' ? 'text-accent-brand' : l.stream === 'stderr' ? 'text-warning' : 'text-text-secondary')}>
              <span className="text-text-disabled">{new Date(l.ts).toLocaleTimeString()} </span>
              {l.line}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
