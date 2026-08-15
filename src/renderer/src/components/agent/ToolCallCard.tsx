import { useState } from 'react'
import { AlertTriangle, Check, ChevronRight, FileEdit, FilePlus2, FolderSearch, Globe, Loader2, Search, ShieldAlert, Terminal, Eye, Plug, FileText, X } from 'lucide-react'
import type { ChatToolCall } from '@shared/api'
import type { StoredMessage } from '@shared/chat'
import { cn, formatDuration } from '@/lib/utils'
import type { LiveToolCall } from '@/stores/chatStore'
import { CodeBlock } from '@/components/chat/CodeBlock'

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  read_file: FileText,
  list_dir: FolderSearch,
  search_files: Search,
  write_file: FilePlus2,
  edit_file: FileEdit,
  run_command: Terminal,
  web_search: Globe,
  web_fetch: Globe,
  analyze_image: Eye,
}

function iconFor(tool: string): React.ComponentType<{ className?: string }> {
  return ICONS[tool] ?? (tool.startsWith('mcp__') ? Plug : Terminal)
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return { raw: s }
  }
}

function argsPreview(tool: string, args: Record<string, unknown>): string {
  if (tool === 'run_command') return String(args.command ?? '')
  if (tool === 'web_search') return String(args.query ?? '')
  if (tool === 'web_fetch') return String(args.url ?? '')
  if (tool === 'search_files') return `/${String(args.pattern ?? '')}/ in ${String(args.path ?? '.')}`
  if (typeof args.path === 'string') return args.path
  const s = JSON.stringify(args)
  return s.length > 90 ? `${s.slice(0, 90)}…` : s
}

/**
 * Tool invocation row (React Bits tool-calls pattern, on tokens): icon · name · args preview · status · duration,
 * expands to arguments, live output, result, and a diff for edits.
 */
export function ToolCallCard({ call, live, resultMessage }: { call: ChatToolCall; live: LiveToolCall | undefined; resultMessage: StoredMessage | undefined }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const Icon = iconFor(call.function.name)
  const args = live?.args ?? safeParse(call.function.arguments)
  const status: LiveToolCall['status'] = live?.status ?? (resultMessage ? (resultMessage.error ? 'error' : 'done') : 'done')
  const result = live?.result ?? (resultMessage ? (typeof resultMessage.content === 'string' ? resultMessage.content : '') : undefined)
  const denied = status === 'denied' || (result ?? '').startsWith('The user declined')
  const diff = typeof live?.meta?.diff === 'string' ? (live.meta.diff as string) : null

  return (
    <div className={cn('my-1.5 overflow-hidden rounded-md bg-surface-2 hairline-subtle', status === 'awaiting-approval' && 'border-[color-mix(in_srgb,var(--warning)_60%,transparent)]')}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex h-9 w-full items-center gap-2 px-2.5 text-left hover:bg-surface-3">
        <ChevronRight className={cn('size-3.5 shrink-0 text-text-secondary transition-transform', open && 'rotate-90')} />
        <Icon className="size-3.5 shrink-0 text-accent-brand" />
        <span className="shrink-0 font-mono text-[12.5px] text-text-primary">{call.function.name.replace(/^mcp__/, '')}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary">{argsPreview(call.function.name, args)}</span>
        <span className="flex shrink-0 items-center gap-1.5 metadata-sm">
          {status === 'running' && (
            <>
              <Loader2 className="size-3.5 animate-spin text-job-running" /> <span className="text-job-running">running</span>
            </>
          )}
          {status === 'awaiting-approval' && (
            <>
              <ShieldAlert className="size-3.5 text-warning" /> <span className="text-warning">needs approval</span>
            </>
          )}
          {status === 'done' && !denied && (
            <>
              <Check className="size-3.5 text-positive" /> <span className="text-text-secondary">done</span>
            </>
          )}
          {(status === 'error' || denied) && (
            <>
              {denied ? <X className="size-3.5 text-text-secondary" /> : <AlertTriangle className="size-3.5 text-negative" />}
              <span className={denied ? 'text-text-secondary' : 'text-negative'}>{denied ? 'declined' : 'failed'}</span>
            </>
          )}
          {live?.durationMs != null && <span className="tabular-nums text-text-disabled">{formatDuration(live.durationMs)}</span>}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-3 pb-3 pt-1">
          <div>
            <div className="mb-1 metadata-sm text-text-disabled">Arguments</div>
            <pre className="max-h-48 overflow-auto rounded-sm bg-surface-1 p-2 code-xs text-text-secondary hairline-subtle whitespace-pre-wrap break-words">{JSON.stringify(args, null, 2)}</pre>
          </div>
          {live?.output && status === 'running' && (
            <div>
              <div className="mb-1 metadata-sm text-text-disabled">Output</div>
              <pre className="max-h-64 overflow-auto rounded-sm bg-surface-1 p-2 code-xs text-text-primary hairline-subtle whitespace-pre-wrap break-words">{live.output}</pre>
            </div>
          )}
          {diff && <CodeBlock code={diff} lang="diff" className="my-0" />}
          {result !== undefined && (
            <div>
              <div className="mb-1 metadata-sm text-text-disabled">Result</div>
              <pre className={cn('max-h-72 overflow-auto rounded-sm bg-surface-1 p-2 code-xs hairline-subtle whitespace-pre-wrap break-words', status === 'error' ? 'text-negative' : 'text-text-primary')}>{result || '(empty)'}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
