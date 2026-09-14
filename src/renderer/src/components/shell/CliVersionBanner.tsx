import { Link } from 'react-router'
import { AlertTriangle } from 'lucide-react'
import { useServerStore } from '@/stores/serverStore'

/**
 * Shown when the installed GenieX CLI predates the protocol Studio speaks (MIN_GENIEX_VERSION). Chat and agent
 * turns are refused server-side with the same message, so this is the one place that tells the user what to do.
 */
export function CliVersionBanner(): React.JSX.Element | null {
  const genie = useServerStore((s) => s.genie)
  if (!genie || genie.cliVersionOk !== false) return null
  return (
    <div className="flex shrink-0 items-start gap-2 bg-warning-soft px-4 py-2 text-xs text-warning hairline-b" role="alert">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>
        GenieX CLI <strong>{genie.cliVersion}</strong> is older than the <strong>{genie.requiredCliVersion}</strong> this Studio needs (streamed tool calls, automatic cache reuse, working AI Hub bundles). Run{' '}
        <code className="code-xs">geniex update</code> in a terminal or reinstall from geniex.aihub.qualcomm.com, then{' '}
        <Link to="/system" className="underline">
          restart the server
        </Link>
        .
      </span>
    </div>
  )
}
