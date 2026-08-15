import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowRight, Check, Cpu, Download, Loader2, ServerCog, X } from 'lucide-react'
import type { StudioSettings } from '@shared/settings'
import { api } from '@/lib/api'
import { cn, formatBytes } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { BrandMark } from './BrandMark'
import { useServerStore } from '@/stores/serverStore'
import { useModelsStore } from '@/stores/modelsStore'

const STARTER = { name: 'unsloth/Qwen3-4B-GGUF', precision: 'Q4_0', type: 'llm' as const, hub: 'hf' as const, size: '≈2.4 GB' }

/**
 * First-run checklist: CLI detected → server running → a starter model on the NPU. Dismissable; can be re-opened
 * from Settings → About.
 */
export function Onboarding(): React.JSX.Element | null {
  const [settings, setSettings] = useState<StudioSettings | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const genie = useServerStore((s) => s.genie)
  const start = useServerStore((s) => s.start)
  const installed = useModelsStore((s) => s.installed)
  const pulls = useModelsStore((s) => s.pulls)
  const startPull = useModelsStore((s) => s.startPull)
  const refreshModels = useModelsStore((s) => s.refresh)
  const subscribePulls = useModelsStore((s) => s.subscribePulls)
  const navigate = useNavigate()

  useEffect(() => {
    void api<StudioSettings>('/api/settings').then(setSettings).catch(() => {})
  }, [])
  const open = !!settings && !settings.onboarding.completed && !dismissed
  useEffect(() => {
    if (!open) return
    void refreshModels()
    return subscribePulls()
  }, [open, refreshModels, subscribePulls])

  if (!open) return null

  const cliOk = !!genie?.cliFound
  const serverOk = genie?.state === 'running'
  const haveModel = installed.length > 0
  const starterJob = pulls.find((p) => p.name === STARTER.name && (p.state === 'running' || p.state === 'queued'))
  const finish = async (): Promise<void> => {
    await api('/api/settings', { method: 'PATCH', json: { onboarding: { completed: true } } })
    setDismissed(true)
    navigate('/chat')
  }

  return (
    <div className="fixed inset-0 z-(--z-modal) flex items-center justify-center bg-[color-mix(in_srgb,var(--surface-1)_70%,transparent)] backdrop-blur-sm">
      <div className="w-[560px] max-w-[92vw] rounded-lg bg-surface-2 p-6 shadow-4 hairline">
        <div className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-surface-3 hairline-subtle">
            <BrandMark size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="heading-md text-text-primary">Welcome to GenieX Studio</h2>
            <p className="mt-1 body-sm text-text-secondary">Local chat, vision and agents on your Snapdragon’s Hexagon NPU. Three quick checks and you’re set.</p>
          </div>
          <button type="button" onClick={() => setDismissed(true)} className="flex size-7 items-center justify-center rounded-sm text-text-secondary hover:bg-surface-3" aria-label="Dismiss">
            <X className="size-4" />
          </button>
        </div>

        <ol className="mt-5 flex flex-col gap-2">
          <Step ok={cliOk} icon={Cpu} title="GenieX CLI" desc={cliOk ? `${genie?.cliVersion ?? ''} · ${genie?.chipset ?? 'chipset detected'}` : 'Not found. Install GenieX CLI from geniex.aihub.qualcomm.com, then set the path in Settings.'} action={!cliOk ? <Button size="sm" variant="secondary" onClick={() => navigate('/settings/server')}>Open Settings</Button> : null} />
          <Step ok={serverOk} icon={ServerCog} title="GenieX server" desc={serverOk ? `Running at ${genie?.url}` : genie?.state === 'starting' ? 'Starting…' : 'Studio starts and supervises `geniex serve` for you.'} action={!serverOk && cliOk ? <Button size="sm" variant="secondary" onClick={() => void start()} disabled={genie?.state === 'starting'}>{genie?.state === 'starting' ? <Loader2 className="size-3.5 animate-spin" /> : null} Start</Button> : null} />
          <Step
            ok={haveModel}
            icon={Download}
            title="A model on the NPU"
            desc={
              haveModel
                ? `${installed.length} installed — ${installed[0].displayName}${installed.length > 1 ? ' and more' : ''}`
                : starterJob
                  ? `Downloading ${STARTER.name.split('/').pop()}:${STARTER.precision} — ${starterJob.progress != null ? `${Math.round(starterJob.progress * 100)}%` : 'starting'}${starterJob.totalBytes ? ` of ${formatBytes(starterJob.totalBytes)}` : ''}`
                  : `Recommended: ${STARTER.name.split('/').pop()} (${STARTER.precision}, ${STARTER.size}) — a strong all-rounder that runs on the Hexagon NPU via llama.cpp.`
            }
            action={
              !haveModel && !starterJob ? (
                <Button size="sm" variant="primary" onClick={() => void startPull({ name: STARTER.name, precision: STARTER.precision, hub: STARTER.hub, modelType: STARTER.type })} disabled={!cliOk}>
                  <Download className="size-3.5" /> Pull
                </Button>
              ) : null
            }
          />
        </ol>

        <div className="mt-5 flex items-center justify-between">
          <button type="button" onClick={() => navigate('/models')} className="text-xs text-text-secondary hover:text-text-primary">
            Browse all models →
          </button>
          <Button variant={haveModel ? 'primary' : 'secondary'} onClick={() => void finish()}>
            {haveModel ? 'Start chatting' : 'Skip for now'} <ArrowRight />
          </Button>
        </div>
      </div>
    </div>
  )
}

function Step({ ok, icon: Icon, title, desc, action }: { ok: boolean; icon: React.ComponentType<{ className?: string }>; title: string; desc: string; action?: React.ReactNode }): React.JSX.Element {
  return (
    <li className={cn('flex items-center gap-3 rounded-md px-3 py-2.5 hairline-subtle', ok ? 'bg-surface-3/60' : 'bg-surface-1')}>
      <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full', ok ? 'bg-positive-soft text-positive' : 'bg-surface-3 text-text-secondary')}>{ok ? <Check className="size-4" /> : <Icon className="size-4" />}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-text-primary">{title}</div>
        <div className="truncate text-xs text-text-secondary" title={desc}>
          {desc}
        </div>
      </div>
      {action}
    </li>
  )
}
