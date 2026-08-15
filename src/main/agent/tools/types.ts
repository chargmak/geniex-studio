import type { ChatToolDefinition } from '@shared/api'
import type { ToolInfo, ToolRisk } from '@shared/agent'
import type { AppContext } from '../../server/context'

export interface ToolRunContext {
  ctx: AppContext
  runId: string
  conversationId: string
  workspaceRoot: string
  signal: AbortSignal
  /** Stream partial output (shell stdout etc.) to the UI. */
  onOutput?: (chunk: string) => void
}

export interface ToolResult {
  ok: boolean
  /** Text handed back to the model (tool message content). Keep it bounded. */
  content: string
  meta?: Record<string, unknown>
}

export interface Tool extends ToolInfo {
  parameters: Record<string, unknown>
  /** Human summary of a call for approval cards / timelines. */
  summarize(args: Record<string, unknown>): string
  /** Whether this specific call needs a human decision (before allow-rules are consulted). */
  needsApproval(args: Record<string, unknown>): boolean
  run(args: Record<string, unknown>, rc: ToolRunContext): Promise<ToolResult>
}

export function toChatTool(t: Tool): ChatToolDefinition {
  return { type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }
}

export function riskLabel(r: ToolRisk): string {
  return { read: 'Read-only', write: 'Writes files', exec: 'Runs commands', network: 'Network', mcp: 'External tool' }[r]
}

/** Bound tool output so a single result can't blow the context window. */
export function clip(text: string, max = 12_000): string {
  if (text.length <= max) return text
  const head = text.slice(0, Math.floor(max * 0.7))
  const tail = text.slice(-Math.floor(max * 0.25))
  return `${head}\n…[${text.length - head.length - tail.length} chars omitted]…\n${tail}`
}
