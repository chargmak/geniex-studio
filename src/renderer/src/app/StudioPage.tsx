import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Download, Image as ImageIcon, Loader2, Play, RefreshCw, Sparkles, Square, Trash2, Wand2, X } from 'lucide-react'
import type { Generation, SidecarModelInfo } from '@shared/sidecar'
import { cn, formatBytes, formatDuration } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useSidecarStore } from '@/stores/sidecarStore'

const SIZES = ['512x512', '512x768', '768x512', '768x768', '1024x1024']

/**
 * Image Studio: text-to-image on the Hexagon NPU via the Python sidecar (Stable Diffusion via QAI AppBuilder / ORT-QNN).
 * Also hosts the sidecar setup (install → start → download models) so the rest of the app can stay sidecar-agnostic.
 */
export function StudioPage(): React.JSX.Element {
  const status = useSidecarStore((s) => s.status)
  const subscribe = useSidecarStore((s) => s.subscribe)
  const loadGenerations = useSidecarStore((s) => s.loadGenerations)
  useEffect(() => {
    void loadGenerations()
    return subscribe()
  }, [subscribe, loadGenerations])

  const installed = !!status?.installedDeps
  const running = status?.state === 'running'
  const imageModels = useMemo(() => (status?.models ?? []).filter((m) => m.feature === 'images'), [status])
  const readyImageModel = imageModels.find((m) => m.installed)

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
          <SidecarSetupCard />
          {installed && running && imageModels.length > 0 && !readyImageModel && <ModelPicker models={imageModels} title="Choose an image model to download" />}
          {readyImageModel && <GenerateCard models={imageModels.filter((m) => m.installed)} />}
          <Gallery />
        </div>
      </div>
    </div>
  )
}

function SidecarSetupCard(): React.JSX.Element {
  const status = useSidecarStore((s) => s.status)
  const provision = useSidecarStore((s) => s.provision)
  const provisioning = useSidecarStore((s) => s.provisioning)
  const provisionLog = useSidecarStore((s) => s.provisionLog)
  const provisionStep = useSidecarStore((s) => s.provisionStep)
  const start = useSidecarStore((s) => s.start)
  const stop = useSidecarStore((s) => s.stop)
  const lastError = useSidecarStore((s) => s.lastError)
  const [showLog, setShowLog] = useState(false)
  const st = status?.state ?? 'not-installed'
  const running = st === 'running'
  const feats = status?.features

  return (
    <div className="rounded-md bg-surface-2 p-4 hairline-subtle">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-3 hairline-subtle">
          <Sparkles className="size-4 text-accent-brand" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="heading-xs text-text-primary">NPU media sidecar</span>
            <Badge variant={running ? 'positive' : st === 'installing' || st === 'starting' ? 'initializing' : st === 'error' ? 'negative' : 'neutral'}>{st.replace('-', ' ')}</Badge>
            {feats && (
              <>
                <FeatureBadge on={feats.images} label="Image generation" />
                <FeatureBadge on={feats.stt} label="Speech-to-text" />
                <FeatureBadge on={feats.tts} label="Text-to-speech" />
                <FeatureBadge on={feats.embeddings} label="Embeddings" />
              </>
            )}
          </div>
          <p className="mt-1 body-sm text-text-secondary">
            Runs Stable Diffusion, Whisper, Piper TTS and text embeddings on the Hexagon NPU through Qualcomm's QAI AppBuilder / QNN runtime. Optional — installs a private Python 3.12 (arm64) environment under the app's data folder; nothing system-wide.
            {status?.pythonVersion && <span> Python {status.pythonVersion}.</span>}
            {status?.qairt && <span> QAIRT {status.qairt}.</span>}
          </p>
          {(status?.lastError || lastError) && st !== 'installing' && (
            <div className="mt-2 flex items-start gap-2 rounded-md bg-negative-soft px-3 py-1.5 text-xs text-negative">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> <span className="break-words">{lastError ?? status?.lastError}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!status?.installedDeps || provisioning ? (
            <Button variant="primary" size="sm" disabled={provisioning} onClick={() => void provision()}>
              {provisioning ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />} {provisioning ? 'Installing…' : 'Install sidecar'}
            </Button>
          ) : running ? (
            <Button variant="ghost" size="sm" onClick={() => void stop()}>
              <Square className="size-3.5" /> Stop
            </Button>
          ) : (
            <>
              <Button variant="primary" size="sm" disabled={st === 'starting'} onClick={() => void start()}>
                {st === 'starting' ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Start
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void provision()} title="Re-run the installer (repairs / upgrades packages)">
                <RefreshCw className="size-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>
      {(provisioning || provisionLog.length > 0) && (
        <div className="mt-3">
          <button type="button" onClick={() => setShowLog((v) => !v)} className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary">
            {provisioning && <Loader2 className="size-3.5 animate-spin text-job-initializing" />}
            <span>{provisionStep ?? 'Install log'}</span>
            <span className="text-text-disabled">{showLog ? 'hide log' : 'show log'}</span>
          </button>
          {showLog && (
            <pre className="mt-2 max-h-56 overflow-auto rounded-sm bg-surface-1 p-2 code-xs text-text-secondary hairline-subtle whitespace-pre-wrap">{provisionLog.join('\n')}</pre>
          )}
        </div>
      )}
    </div>
  )
}

function FeatureBadge({ on, label }: { on: boolean; label: string }): React.JSX.Element {
  return <Badge variant={on ? 'positive' : 'outline'}>{label}</Badge>
}

function ModelPicker({ models, title }: { models: SidecarModelInfo[]; title: string }): React.JSX.Element {
  const downloads = useSidecarStore((s) => s.downloads)
  const downloadModel = useSidecarStore((s) => s.downloadModel)
  return (
    <div className="rounded-md bg-surface-2 p-4 hairline-subtle">
      <div className="heading-xs text-text-primary">{title}</div>
      <div className="mt-3 flex flex-col gap-2">
        {models.map((m) => {
          const d = downloads[m.id]
          return (
            <div key={m.id} className="flex items-center gap-3 rounded-md bg-surface-1 px-3 py-2.5 hairline-subtle">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">{m.name}</span>
                  <Badge variant="npu">{m.runtime}</Badge>
                  <span className="metadata-sm text-text-disabled">{formatBytes(m.sizeBytes)}</span>
                </div>
                <div className="text-xs text-text-secondary">{m.description}</div>
                {d && !d.done && !d.error && (
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                    <div className={cn('h-full rounded-full bg-job-pending', d.progress == null && 'animate-pulse')} style={{ width: `${Math.round((d.progress ?? 0.05) * 100)}%` }} />
                  </div>
                )}
                {d?.message && !d.done && <div className="mt-0.5 truncate metadata-sm text-text-secondary">{d.message}</div>}
                {d?.error && <div className="mt-0.5 text-xs text-negative">{d.error}</div>}
              </div>
              {m.installed ? (
                <span className="inline-flex items-center gap-1 text-xs text-positive">
                  <Check className="size-3.5" /> Ready
                </span>
              ) : (
                <Button size="sm" variant="secondary" disabled={!!d && !d.done && !d.error} onClick={() => void downloadModel(m.id)}>
                  <Download className="size-3.5" /> Download
                </Button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GenerateCard({ models }: { models: SidecarModelInfo[] }): React.JSX.Element {
  const generate = useSidecarStore((s) => s.generate)
  const generating = useSidecarStore((s) => s.generating)
  const [prompt, setPrompt] = useState('')
  const [negative, setNegative] = useState('')
  const [model, setModel] = useState(models[0]?.id ?? '')
  const [size, setSize] = useState('512x512')
  const [steps, setSteps] = useState(20)
  const [guidance, setGuidance] = useState(7.5)
  const [seed, setSeed] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!generating) return
    const t0 = Date.now()
    const t = setInterval(() => setElapsed(Date.now() - t0), 250)
    return () => clearInterval(t)
  }, [generating])

  const run = async (): Promise<void> => {
    setError(null)
    const [w, h] = size.split('x').map(Number)
    try {
      await generate({ prompt: prompt.trim(), negative_prompt: negative.trim() || undefined, model, width: w, height: h, steps, guidance, seed: seed.trim() ? Number(seed) : undefined })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="rounded-md bg-surface-2 p-4 hairline-subtle">
      <div className="flex items-center gap-2">
        <Wand2 className="size-4 text-accent-brand" />
        <span className="heading-xs text-text-primary">Generate an image</span>
        <span className="ml-auto metadata-sm text-text-disabled">Hexagon NPU</span>
      </div>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="A cinematic photo of a snow leopard on a rocky ridge at golden hour, ultra detailed" className="mt-3 w-full resize-none rounded-md bg-surface-1 px-3 py-2 body-md hairline outline-none focus:border-[var(--accent)]" />
      <input value={negative} onChange={(e) => setNegative(e.target.value)} placeholder="Negative prompt (optional): blurry, low quality, text, watermark" className="mt-2 h-9 w-full rounded-sm bg-surface-1 px-3 text-sm hairline outline-none focus:border-[var(--accent)]" />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select value={model} onChange={(e) => setModel(e.target.value)} className="h-8 rounded-sm bg-surface-1 px-2 text-sm hairline outline-none">
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select value={size} onChange={(e) => setSize(e.target.value)} className="h-8 rounded-sm bg-surface-1 px-2 text-sm hairline outline-none">
          {SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          Steps
          <input type="number" min={1} max={100} value={steps} onChange={(e) => setSteps(Number(e.target.value) || 20)} className="h-8 w-16 rounded-sm bg-surface-1 px-2 text-sm tabular-nums hairline outline-none" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          Guidance
          <input type="number" min={0} max={20} step={0.5} value={guidance} onChange={(e) => setGuidance(Number(e.target.value) || 7.5)} className="h-8 w-16 rounded-sm bg-surface-1 px-2 text-sm tabular-nums hairline outline-none" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          Seed
          <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="random" className="h-8 w-24 rounded-sm bg-surface-1 px-2 text-sm tabular-nums hairline outline-none" />
        </label>
        <Button variant="primary" className="ml-auto" disabled={generating || !prompt.trim()} onClick={() => void run()}>
          {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles />} {generating ? `Generating… ${formatDuration(elapsed)}` : 'Generate'}
        </Button>
      </div>
      {error && <div className="mt-2 rounded-md bg-negative-soft px-3 py-1.5 text-xs text-negative">{error}</div>}
    </div>
  )
}

function Gallery(): React.JSX.Element {
  const generations = useSidecarStore((s) => s.generations)
  const del = useSidecarStore((s) => s.deleteGeneration)
  const [open, setOpen] = useState<Generation | null>(null)
  if (!generations.length)
    return (
      <div className="rounded-md bg-surface-2 p-8 text-center hairline-subtle">
        <ImageIcon className="mx-auto mb-2 size-6 text-text-secondary" />
        <div className="text-sm text-text-primary">No generations yet</div>
        <div className="mt-1 text-xs text-text-secondary">Generated images are saved locally and listed here.</div>
      </div>
    )
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {generations.map((g) => (
          <div key={g.id} className="group/gen relative overflow-hidden rounded-md bg-surface-2 hairline-subtle">
            <button type="button" onClick={() => setOpen(g)} className="block w-full">
              <img src={`/api/sidecar/generations/${g.id}/raw`} alt={g.prompt ?? ''} className="aspect-square w-full object-cover" loading="lazy" />
            </button>
            <div className="p-2">
              <div className="line-clamp-2 text-xs text-text-primary" title={g.prompt ?? ''}>
                {g.prompt}
              </div>
              <div className="mt-1 flex items-center gap-2 metadata-sm text-text-disabled">
                <span>
                  {g.width}×{g.height}
                </span>
                <span>{g.steps} steps</span>
                {g.durationMs != null && <span>{formatDuration(g.durationMs)}</span>}
                <button type="button" onClick={() => void del(g.id)} className="ml-auto text-text-disabled hover:text-negative" aria-label="Delete">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {open && (
        <div className="fixed inset-0 z-(--z-modal) flex items-center justify-center bg-[color-mix(in_srgb,var(--surface-1)_80%,transparent)] p-6" onClick={() => setOpen(null)}>
          <div className="relative max-h-full max-w-5xl overflow-hidden rounded-lg bg-surface-2 shadow-4 hairline" onClick={(e) => e.stopPropagation()}>
            <img src={`/api/sidecar/generations/${open.id}/raw`} alt={open.prompt ?? ''} className="max-h-[80vh] w-auto" />
            <div className="flex items-start gap-3 p-3">
              <div className="min-w-0 flex-1 text-sm text-text-primary">
                {open.prompt}
                <div className="mt-1 metadata-sm text-text-secondary">
                  {open.model} · {open.width}×{open.height} · {open.steps} steps · guidance {open.guidance} · seed {open.seed ?? '—'} · {formatDuration(open.durationMs)}
                </div>
              </div>
              <a href={`/api/sidecar/generations/${open.id}/raw`} download={`geniex-${open.id}.png`} className="inline-flex h-8 items-center gap-1 rounded-sm px-2 text-xs text-text-secondary hairline hover:bg-surface-3">
                <Download className="size-3.5" /> Save
              </a>
              <Button variant="ghost" size="iconSm" onClick={() => setOpen(null)} aria-label="Close">
                <X />
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
