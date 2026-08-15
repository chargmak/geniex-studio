import { Cpu } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

export function SystemPage(): React.JSX.Element {
  return (
    <EmptyState
      icon={Cpu}
      title="System"
      description="GenieX server control, NPU/CPU telemetry, tokens-per-second history and logs. Coming in a later milestone."
    />
  )
}
