import { Settings } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

export function SettingsPage(): React.JSX.Element {
  return (
    <EmptyState
      icon={Settings}
      title="Settings"
      description="Sampling defaults, compute unit, context, thinking, speculative decoding, MCP servers and workspace. Coming in a later milestone."
    />
  )
}
