import { useEffect, useState } from 'react'
import { ChevronRight, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDuration } from '@/lib/utils'

/**
 * Collapsible "Thought process" row (React Bits ReasoningRow pattern, on tokens). Auto-opens while the model is
 * still thinking and folds once the answer starts.
 */
export function ThinkingFold({ text, live, durationMs }: { text: string; live: boolean; durationMs?: number | null }): React.JSX.Element | null {
  const [open, setOpen] = useState(live)
  const [userToggled, setUserToggled] = useState(false)
  useEffect(() => {
    if (!userToggled) setOpen(live)
  }, [live, userToggled])
  if (!text && !live) return null
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => {
          setUserToggled(true)
          setOpen((o) => !o)
        }}
        aria-expanded={open}
        className="-ml-1.5 inline-flex h-7 items-center gap-1.5 rounded-sm px-1.5 text-[13px] text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary"
      >
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform duration-(--q-transition-duration-fast)', open && 'rotate-90')} />
        <Sparkles className={cn('size-3.5', live && 'animate-pulse text-job-initializing')} />
        {live ? 'Thinking…' : durationMs ? `Thought for ${formatDuration(durationMs)}` : 'Thought process'}
      </button>
      {open && (
        <div className="mt-1.5 max-h-72 overflow-y-auto rounded-md border-l-2 border-[color-mix(in_srgb,var(--q-semantic-initializing)_60%,transparent)] bg-surface-2/60 px-3 py-2 body-sm leading-relaxed whitespace-pre-wrap text-text-secondary">
          {text || <span className="italic">…</span>}
          {live && <span className="stream-caret" aria-hidden />}
        </div>
      )}
    </div>
  )
}
