import { useEffect, useRef, useState } from 'react'
import { Loader2, Square, Volume2 } from 'lucide-react'
import { useSidecarStore } from '@/stores/sidecarStore'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** Reads an assistant reply aloud with the sidecar's TTS (Piper on the NPU). Hidden unless TTS is available. */
export function SpeakButton({ text }: { text: string }): React.JSX.Element | null {
  const status = useSidecarStore((s) => s.status)
  const speak = useSidecarStore((s) => s.speak)
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  useEffect(() => () => audioRef.current?.pause(), [])
  if (!status?.features?.tts || status.state !== 'running') return null

  const toggle = async (): Promise<void> => {
    if (state === 'playing') {
      audioRef.current?.pause()
      setState('idle')
      return
    }
    setState('loading')
    try {
      const plain = text.replace(/```[\s\S]*?```/g, ' code block omitted. ').replace(/[*_`#>|]/g, '').slice(0, 4000)
      const blob = await speak(plain)
      const url = URL.createObjectURL(blob)
      const a = new Audio(url)
      audioRef.current = a
      a.onended = () => {
        setState('idle')
        URL.revokeObjectURL(url)
      }
      a.onerror = () => setState('idle')
      await a.play()
      setState('playing')
    } catch {
      setState('idle')
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={() => void toggle()} className="flex size-7 items-center justify-center rounded-sm text-text-secondary hover:bg-surface-3 hover:text-text-primary" aria-label={state === 'playing' ? 'Stop' : 'Read aloud'}>
          {state === 'loading' ? <Loader2 className="size-3.5 animate-spin" /> : state === 'playing' ? <Square className="size-3.5 fill-current" /> : <Volume2 className="size-3.5" />}
        </button>
      </TooltipTrigger>
      <TooltipContent>{state === 'playing' ? 'Stop' : 'Read aloud (NPU TTS)'}</TooltipContent>
    </Tooltip>
  )
}
