import { useRef } from 'react'
import { ArrowDown } from 'lucide-react'
import type { StoredMessage } from '@shared/chat'
import { useStickToBottom } from '@/hooks/useStickToBottom'
import type { StreamState } from '@/stores/chatStore'
import { AssistantMessage, UserMessage } from './MessageItem'

export function MessageList({
  messages,
  stream,
  onEdit,
  onRegenerate,
  header,
}: {
  messages: StoredMessage[]
  stream: StreamState | null
  onEdit: (m: StoredMessage) => void
  onRegenerate: () => void
  header?: React.ReactNode
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { showJump, jumpToLatest } = useStickToBottom(scrollRef, [messages.length])
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-[var(--q-prose-max)] px-6 pt-4 pb-6">
          {header}
          {messages.map((m) =>
            m.role === 'user' ? (
              <UserMessage key={m.id} message={m} onEdit={onEdit} />
            ) : m.role === 'assistant' ? (
              <AssistantMessage key={m.id} message={m} stream={stream} isLast={m.id === lastAssistantId} onRegenerate={onRegenerate} />
            ) : null,
          )}
        </div>
      </div>
      {showJump && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full bg-surface-3 px-3 text-xs text-text-primary shadow-3 hairline hover:bg-surface-4"
        >
          <ArrowDown className="size-3.5" /> Jump to latest
        </button>
      )}
    </div>
  )
}
