import { useNavigate } from 'react-router'
import { ArrowDownToLine, RefreshCw } from 'lucide-react'
import { useUpdates } from '@/hooks/useUpdates'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Top-bar affordance that appears only when an update is actually in play — the quiet equivalent of the
 * "Restart to update" button every desktop app grows eventually. Renders nothing in browser mode.
 */
export function UpdatePill(): React.JSX.Element | null {
  const { state, install } = useUpdates()
  const navigate = useNavigate()
  if (!state || !state.supported) return null

  if (state.status === 'downloaded') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={() => void install()} className="flex h-7 items-center gap-1.5 rounded-sm bg-accent-soft px-2 text-xs text-accent-brand hover:brightness-110">
            <RefreshCw className="size-3.5" />
            Restart to update
          </button>
        </TooltipTrigger>
        <TooltipContent>Version {state.availableVersion} is ready — Studio will restart</TooltipContent>
      </Tooltip>
    )
  }

  if (state.status === 'available' || state.status === 'downloading') {
    const downloading = state.status === 'downloading'
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={() => navigate('/settings/updates')} className="flex h-7 items-center gap-1.5 rounded-sm px-2 text-xs text-text-secondary hover:bg-surface-3 hover:text-text-primary">
            <ArrowDownToLine className={downloading ? 'size-3.5 animate-pulse' : 'size-3.5'} />
            {downloading ? `${state.percent}%` : `v${state.availableVersion}`}
          </button>
        </TooltipTrigger>
        <TooltipContent>{downloading ? `Downloading ${state.availableVersion}…` : `Update ${state.availableVersion} available`}</TooltipContent>
      </Tooltip>
    )
  }

  return null
}
