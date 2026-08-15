import type { CachedModel } from '@shared/api'
import type { Conversation } from '@shared/chat'
import { cn, formatDuration, formatNumber } from '@/lib/utils'
import type { PromptInfo, StreamState } from '@/stores/chatStore'

/** Slim status strip above the composer: context fill, live tok/s, resident model, compute. */
export function ContextMeter({ promptInfo, stream, conversation, modelInfo }: { promptInfo: PromptInfo | null; stream: StreamState | null; conversation: Conversation | null; modelInfo: CachedModel | undefined }): React.JSX.Element | null {
  if (!promptInfo && !stream && !conversation) return null
  const fill = promptInfo ? Math.min(1, promptInfo.estimatedTokens / Math.max(1, promptInfo.contextTokens)) : 0
  const live = stream && stream.phase !== 'done' && stream.phase !== 'idle'
  const elapsed = stream?.startedAt ? Date.now() - stream.startedAt : null
  const liveTps = live && stream?.firstTokenAt && stream.content ? (stream.content.length / 3.6) / Math.max(0.001, (Date.now() - stream.firstTokenAt) / 1000) : null

  return (
    <div className="mx-auto flex h-6 w-full max-w-[var(--q-prose-max)] items-center gap-3 px-7 metadata-sm text-text-disabled">
      {promptInfo && (
        <span className="flex items-center gap-1.5" title={`≈${promptInfo.estimatedTokens} of ${promptInfo.contextTokens} context tokens used by the last request`}>
          <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-surface-3">
            <span className={cn('absolute inset-y-0 left-0 rounded-full', fill > 0.9 ? 'bg-negative' : fill > 0.7 ? 'bg-warning' : 'bg-accent-brand')} style={{ width: `${Math.max(2, fill * 100)}%` }} />
          </span>
          <span className="tabular-nums">
            {promptInfo.estimatedTokens < 1000 ? promptInfo.estimatedTokens : `${formatNumber(promptInfo.estimatedTokens / 1000, 1)}k`} / {formatNumber(promptInfo.contextTokens / 1000, 0)}k ctx
          </span>
        </span>
      )}
      {live && (
        <span className="flex items-center gap-1.5 text-job-running">
          <span className="job-dot bg-job-running animate-pulse" />
          {stream!.phase === 'loading-model' ? 'loading model' : stream!.phase === 'thinking' ? 'thinking' : stream!.phase === 'answering' ? 'generating' : 'queued'}
          {liveTps != null && liveTps > 0 && <span className="tabular-nums">≈{formatNumber(liveTps, 0)} tok/s</span>}
          {elapsed != null && <span className="tabular-nums">{formatDuration(elapsed)}</span>}
        </span>
      )}
      {!live && stream?.tokensPerSecond != null && <span className="tabular-nums">{formatNumber(stream.tokensPerSecond)} tok/s</span>}
      <span className="ml-auto flex items-center gap-2 truncate">
        {modelInfo && <span className="truncate">{modelInfo.runtime === 'qairt' ? 'QAIRT · Hexagon NPU' : `llama.cpp · ${(conversation?.settings.options?.compute ?? 'npu').toUpperCase()}`}</span>}
      </span>
    </div>
  )
}
