import { Bot } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

export function AgentsPage(): React.JSX.Element {
  return (
    <EmptyState
      icon={Bot}
      title="Agents"
      description="Tool-using agent runs with approvals, workspace files, shell, web and MCP. Coming in a later milestone."
    />
  )
}
