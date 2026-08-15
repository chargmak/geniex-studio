import { MessageSquare } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

export function ChatPage(): React.JSX.Element {
  return (
    <EmptyState
      icon={MessageSquare}
      title="Chat"
      description="Streaming conversations with local GenieX models on the Hexagon NPU. Coming in the next milestone."
    />
  )
}
