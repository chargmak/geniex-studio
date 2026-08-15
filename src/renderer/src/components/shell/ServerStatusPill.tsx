import { useEffect } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/utils'
import { useServerStore } from '@/stores/serverStore'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Compact GenieX server indicator. State colour semantics:
 * running = positive · starting/stopping = job-initializing · error = negative · stopped = neutral fg-disabled.
 */
export function ServerStatusPill({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const genie = useServerStore((s) => s.genie)
  const reachable = useServerStore((s) => s.reachable)
  const startPolling = useServerStore((s) => s.startPolling)

  useEffect(() => startPolling(5000), [startPolling])

  const state = !reachable ? 'unreachable' : (genie?.state ?? 'unknown')
  const label =
    state === 'running'
      ? genie?.busy
        ? 'Generating'
        : 'Server running'
      : state === 'starting'
        ? 'Starting server…'
        : state === 'stopping'
          ? 'Stopping…'
          : state === 'error'
            ? 'Server error'
            : state === 'unreachable'
              ? 'Studio offline'
              : state === 'stopped'
                ? genie?.cliFound
                  ? 'Server stopped'
                  : 'GenieX CLI not found'
                : 'Checking…'

  const dot =
    state === 'running'
      ? genie?.busy
        ? 'bg-job-running'
        : 'bg-positive'
      : state === 'starting' || state === 'stopping'
        ? 'bg-job-initializing animate-pulse'
        : state === 'error' || state === 'unreachable'
          ? 'bg-negative'
          : 'bg-fg-disabled'

  const detail = genie
    ? [
        genie.residentModel ? `Model: ${genie.residentModel}` : 'No model resident',
        genie.chipset ? `Chipset: ${genie.chipset}` : null,
        genie.cliVersion ? `GenieX ${genie.cliVersion}` : null,
        genie.url,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'GenieX status unavailable'

  const pill = (
    <Link
      to="/system"
      className={cn(
        'flex h-8 items-center gap-2 rounded-sm px-2 text-xs text-text-secondary hover:bg-surface-3 hover:text-text-primary',
        compact && 'w-8 justify-center px-0',
      )}
      aria-label={label}
    >
      <span className={cn('job-dot shrink-0', dot)} aria-hidden />
      {!compact && <span className="truncate">{label}</span>}
    </Link>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent side={compact ? 'right' : 'top'}>
        <span className="font-medium">{label}</span>
        <span className="block text-text-secondary">{detail}</span>
      </TooltipContent>
    </Tooltip>
  )
}
