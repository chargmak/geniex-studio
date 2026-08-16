import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Loader2, Mic, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { startRecording, type Recorder } from '@/lib/audio'
import { useSidecarStore } from '@/stores/sidecarStore'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Push-to-talk: click to record, click again to stop → transcribed on the NPU (sidecar Whisper) → text appended
 * to the composer draft. Hidden when the sidecar isn't installed; disabled (with a hint) when STT isn't ready.
 */
export function MicButton({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }): React.JSX.Element | null {
  const status = useSidecarStore((s) => s.status)
  const subscribe = useSidecarStore((s) => s.subscribe)
  const transcribe = useSidecarStore((s) => s.transcribe)
  const [rec, setRec] = useState<Recorder | null>(null)
  const [busy, setBusy] = useState(false)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => subscribe(), [subscribe])
  useEffect(() => {
    if (!rec) return
    timer.current = setInterval(() => setElapsed(Date.now() - rec.startedAt), 200)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [rec])

  if (!status?.installedDeps) return null
  const sttReady = status.state === 'running' && !!status.features?.stt

  const toggle = async (): Promise<void> => {
    setError(null)
    if (rec) {
      setBusy(true)
      try {
        const wav = await rec.stop()
        setRec(null)
        if (wav.size < 2000) return
        const r = await transcribe(wav)
        if (r.text?.trim()) onText(r.text.trim())
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
      return
    }
    try {
      setRec(await startRecording(setLevel))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const btn = (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={disabled || busy || !sttReady}
      className={cn(
        'relative inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-[13px] text-text-secondary hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40',
        rec && 'bg-negative-soft text-negative hover:bg-negative-soft',
      )}
      aria-label={rec ? 'Stop recording' : 'Dictate with the microphone'}
      aria-pressed={!!rec}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : rec ? <Square className="size-3.5 fill-current" /> : <Mic className="size-3.5" />}
      {rec && (
        <span className="flex items-center gap-1.5">
          <span className="tabular-nums text-xs">{Math.floor(elapsed / 1000)}s</span>
          <span className="h-3 w-8 overflow-hidden rounded-full bg-surface-3">
            <span className="block h-full rounded-full bg-negative transition-[width]" style={{ width: `${Math.min(100, level * 300)}%` }} />
          </span>
        </span>
      )}
      {busy && <span className="text-xs">transcribing…</span>}
    </button>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent>
        {error ? (
          <span className="text-negative">{error}</span>
        ) : sttReady ? (
          rec ? 'Click to stop and transcribe on the NPU' : 'Dictate — Whisper on the Hexagon NPU'
        ) : status.state !== 'running' ? (
          <span>
            Start the media sidecar in <Link to="/studio" className="text-accent-brand underline">Studio</Link> to dictate
          </span>
        ) : (
          <span>
            Download a Whisper model in <Link to="/studio" className="text-accent-brand underline">Studio</Link> to dictate
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
