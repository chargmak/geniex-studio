import { memo, useState } from 'react'
import { AlertTriangle, Check, Copy, Pencil, RefreshCw, User } from 'lucide-react'
import type { StoredMessage } from '@shared/chat'
import { cn, formatDuration, formatNumber } from '@/lib/utils'
import { BrandMark } from '@/components/shell/BrandMark'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Markdown } from './Markdown'
import { ThinkingFold } from './ThinkingFold'
import { useSmoothedReveal } from '@/hooks/useSmoothedReveal'
import type { StreamState } from '@/stores/chatStore'

function contentText(m: StoredMessage): string {
  if (typeof m.content === 'string') return m.content
  return m.content
    .filter((p) => p.type === 'text')
    .map((p) => (p as { text: string }).text)
    .join('\n')
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={onClick} className="flex size-7 items-center justify-center rounded-sm text-text-secondary hover:bg-surface-3 hover:text-text-primary" aria-label={label}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function CopyAction({ text }: { text: string }): React.JSX.Element {
  const [ok, setOk] = useState(false)
  return (
    <IconAction
      label={ok ? 'Copied' : 'Copy'}
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setOk(true)
        setTimeout(() => setOk(false), 1200)
      }}
    >
      {ok ? <Check className="size-3.5 text-positive" /> : <Copy className="size-3.5" />}
    </IconAction>
  )
}

export const UserMessage = memo(function UserMessage({ message, onEdit }: { message: StoredMessage; onEdit?: (m: StoredMessage) => void }): React.JSX.Element {
  const text = contentText(message)
  return (
    <div className="group/msg flex justify-end gap-3 py-2">
      <div className="flex max-w-[78%] flex-col items-end gap-1.5">
        {message.attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {message.attachments.map((a) =>
              a.kind === 'image' ? (
                <img key={a.id} src={`/api/attachments/${a.id}/raw`} alt={a.name} className="max-h-48 max-w-64 rounded-md hairline-subtle object-cover" />
              ) : (
                <span key={a.id} className="inline-flex h-7 items-center rounded-sm bg-surface-3 px-2 text-xs text-text-secondary hairline-subtle">
                  {a.name}
                </span>
              ),
            )}
          </div>
        )}
        {text && (
          <div className="rounded-lg rounded-tr-sm bg-accent-soft px-3.5 py-2 body-md whitespace-pre-wrap break-words text-text-primary hairline-subtle">
            {text}
          </div>
        )}
        <div className="flex h-7 items-center gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100">
          <CopyAction text={text} />
          {onEdit && (
            <IconAction label="Edit & resend" onClick={() => onEdit(message)}>
              <Pencil className="size-3.5" />
            </IconAction>
          )}
        </div>
      </div>
      <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-3 hairline-subtle">
        <User className="size-3.5 text-text-secondary" />
      </div>
    </div>
  )
})

export const AssistantMessage = memo(function AssistantMessage({
  message,
  stream,
  isLast,
  onRegenerate,
}: {
  message: StoredMessage
  stream: StreamState | null
  isLast: boolean
  onRegenerate?: () => void
}): React.JSX.Element {
  const live = !!stream && stream.messageId === message.id && stream.phase !== 'done'
  const rawContent = live ? stream!.content : contentText(message)
  const reasoning = live ? stream!.reasoning : (message.reasoning ?? '')
  const shown = useSmoothedReveal(rawContent, !live)
  const thinkingLive = live && stream!.phase === 'thinking'
  const loading = live && (stream!.phase === 'loading-model' || stream!.phase === 'queued')
  const m = message.metrics
  const thinkMs = null

  return (
    <div className="group/msg flex gap-3 py-2">
      <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 hairline-subtle">
        <BrandMark size={16} />
      </div>
      <div className="min-w-0 flex-1">
        {loading && (
          <div className="mb-2 inline-flex h-7 items-center gap-2 rounded-sm bg-surface-2 px-2 text-[13px] text-text-secondary hairline-subtle">
            <span className="job-dot bg-job-initializing animate-pulse" />
            {stream!.phase === 'loading-model' ? 'Loading model into memory…' : 'Waiting for the model…'}
          </div>
        )}
        <ThinkingFold text={reasoning} live={thinkingLive} durationMs={thinkMs} />
        {shown ? (
          <Markdown text={shown} />
        ) : live && !thinkingLive && !loading ? (
          <span className="stream-caret" aria-hidden />
        ) : null}
        {live && shown && stream!.phase === 'answering' && <span className="stream-caret" aria-hidden />}
        {message.status === 'error' && (
          <div className="mt-2 flex items-start gap-2 rounded-md bg-negative-soft px-3 py-2 text-sm text-negative hairline-subtle">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span className="break-words">{message.error ?? 'The model returned an error.'}</span>
          </div>
        )}
        {message.status === 'cancelled' && <div className="mt-1 text-xs text-text-secondary">Stopped.</div>}
        {message.metrics?.finishReason === 'length' && <div className="mt-1 text-xs text-warning">Reached the max tokens limit — raise “Max tokens” in the composer settings to continue longer answers.</div>}
        {!live && (
          <div className="mt-1 flex h-7 items-center gap-0.5 text-text-secondary opacity-0 transition-opacity group-hover/msg:opacity-100">
            <CopyAction text={rawContent} />
            {isLast && onRegenerate && (
              <IconAction label="Regenerate" onClick={onRegenerate}>
                <RefreshCw className="size-3.5" />
              </IconAction>
            )}
            {m && (m.tokensPerSecond != null || m.ttftMs != null) && (
              <span className="ml-2 flex items-center gap-2 metadata-sm text-text-disabled">
                {m.tokensPerSecond != null && <span>{formatNumber(m.tokensPerSecond)} tok/s</span>}
                {m.ttftMs != null && <span>TTFT {formatDuration(m.ttftMs)}</span>}
                {m.completionTokens != null && <span>{m.completionTokens} tok</span>}
                {m.loadMs != null && m.loadMs > 500 && <span>load {formatDuration(m.loadMs)}</span>}
                {message.model && <span className={cn('truncate max-w-56')}>{message.model.split('/').pop()}</span>}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
})
