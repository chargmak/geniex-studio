import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import type { ApprovalDecision, ApprovalRequest } from '@shared/agent'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const RISK_LABEL: Record<string, string> = { read: 'Read-only', write: 'Writes files', exec: 'Runs a command', network: 'Network access', mcp: 'External tool (MCP)' }

/** Human-in-the-loop gate (React Bits agent-approval pattern). Blocks the run until answered. */
export function ApprovalCard({ request, onDecide }: { request: ApprovalRequest; onDecide: (d: ApprovalDecision) => Promise<void> | void }): React.JSX.Element {
  const [busy, setBusy] = useState<ApprovalDecision | null>(null)
  const decide = async (d: ApprovalDecision): Promise<void> => {
    setBusy(d)
    try {
      await onDecide(d)
    } finally {
      setBusy(null)
    }
  }
  const detail = request.tool === 'run_command' ? String(request.args.command ?? '') : request.tool === 'write_file' || request.tool === 'edit_file' ? String(request.args.path ?? '') : request.summary
  return (
    <div className="my-2 rounded-md bg-surface-2 p-3 hairline border-[color-mix(in_srgb,var(--warning)_55%,transparent)] shadow-1">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm bg-warning-soft">
          <ShieldAlert className="size-4 text-warning" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-[560] text-text-primary">Agent wants to run {request.tool.replace(/^mcp__/, '')}</span>
            <Badge variant="warning">{RISK_LABEL[request.risk] ?? request.risk}</Badge>
          </div>
          <pre className="mt-1.5 max-h-40 overflow-auto rounded-sm bg-surface-1 px-2.5 py-1.5 code-xs text-text-primary hairline-subtle whitespace-pre-wrap break-words">{detail}</pre>
          {request.tool === 'write_file' && typeof request.args.content === 'string' && (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-xs text-text-secondary hover:text-text-primary">Show content ({(request.args.content as string).length} chars)</summary>
              <pre className="mt-1 max-h-56 overflow-auto rounded-sm bg-surface-1 px-2.5 py-1.5 code-xs text-text-secondary hairline-subtle whitespace-pre-wrap break-words">{request.args.content as string}</pre>
            </details>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void decide('allow')}>
              {busy === 'allow' ? 'Allowing…' : 'Allow'}
            </Button>
            <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void decide('allow-always')} title={`Always allow ${request.tool} without asking`}>
              Always allow {request.tool.replace(/^mcp__/, '')}
            </Button>
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void decide('deny')}>
              Deny
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
