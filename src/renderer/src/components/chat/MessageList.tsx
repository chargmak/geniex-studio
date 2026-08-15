import { useMemo, useRef } from 'react'
import { ArrowDown, Bot } from 'lucide-react'
import type { StoredMessage } from '@shared/chat'
import type { ApprovalDecision, ApprovalRequest } from '@shared/agent'
import { useStickToBottom } from '@/hooks/useStickToBottom'
import type { AgentLive, StreamState } from '@/stores/chatStore'
import { AssistantMessage, UserMessage } from './MessageItem'
import { ToolCallCard } from '@/components/agent/ToolCallCard'
import { ApprovalCard } from '@/components/agent/ApprovalCard'
import { cn } from '@/lib/utils'

export function MessageList({
  messages,
  stream,
  agent,
  onEdit,
  onRegenerate,
  onDecide,
  header,
}: {
  messages: StoredMessage[]
  stream: StreamState | null
  agent: AgentLive | null
  onEdit: (m: StoredMessage) => void
  onRegenerate: () => void
  onDecide: (request: ApprovalRequest, decision: ApprovalDecision) => Promise<void>
  header?: React.ReactNode
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { showJump, jumpToLatest } = useStickToBottom(scrollRef, [messages.length])
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id
  const toolResults = useMemo(() => {
    const map = new Map<string, StoredMessage>()
    for (const m of messages) if (m.role === 'tool' && m.toolCallId) map.set(m.toolCallId, m)
    return map
  }, [messages])
  const runLive = agent?.run && (agent.run.status === 'running' || agent.run.status === 'waiting_approval')

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-[var(--q-prose-max)] px-6 pt-4 pb-6">
          {header}
          {messages.map((m) => {
            if (m.role === 'user') return <UserMessage key={m.id} message={m} onEdit={onEdit} />
            if (m.role === 'assistant') {
              const hasText = typeof m.content === 'string' ? m.content.trim().length > 0 : true
              const isLive = !!stream && stream.messageId === m.id && stream.phase !== 'done'
              return (
                <div key={m.id}>
                  {(hasText || isLive || m.reasoning || m.status === 'error') && <AssistantMessage message={m} stream={stream} isLast={m.id === lastAssistantId} onRegenerate={onRegenerate} />}
                  {m.toolCalls?.length ? (
                    <div className="ml-10">
                      {m.toolCalls.map((tc) => (
                        <ToolCallCard key={tc.id} call={tc} live={agent?.toolCalls[tc.id]} resultMessage={toolResults.get(tc.id)} />
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            }
            return null
          })}
          {agent?.pendingApprovals.map((r) => (
            <div key={r.id} className="ml-10">
              <ApprovalCard request={r} onDecide={(d) => onDecide(r, d)} />
            </div>
          ))}
          {runLive && (
            <div className={cn('ml-10 mt-2 inline-flex h-7 items-center gap-2 rounded-sm bg-surface-2 px-2 text-xs text-text-secondary hairline-subtle')}>
              <Bot className="size-3.5 text-accent-brand" />
              {agent!.run!.status === 'waiting_approval' ? 'Waiting for your approval' : `Agent turn ${agent!.turn}/${agent!.maxTurns}`}
              <span className="job-dot bg-job-running animate-pulse" />
            </div>
          )}
        </div>
      </div>
      {showJump && (
        <button type="button" onClick={jumpToLatest} className="absolute bottom-3 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full bg-surface-3 px-3 text-xs text-text-primary shadow-3 hairline hover:bg-surface-4">
          <ArrowDown className="size-3.5" /> Jump to latest
        </button>
      )}
    </div>
  )
}
