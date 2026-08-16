import type { ChatStreamEvent } from './api'
import type { KnowledgeHit } from './sidecar'
import type { Conversation, StoredMessage } from './chat'

export type ToolRisk = 'read' | 'write' | 'exec' | 'network' | 'mcp'

export interface ToolInfo {
  name: string
  description: string
  risk: ToolRisk
  /** Family for enable/disable in UI: fs | shell | web | mcp | vision */
  family: 'fs' | 'shell' | 'web' | 'mcp' | 'vision'
  source?: string // MCP server name
}

export type ApprovalDecision = 'allow' | 'deny' | 'allow-always'

export interface ApprovalRequest {
  id: string
  runId: string
  tool: string
  risk: ToolRisk
  args: Record<string, unknown>
  /** Human summary, e.g. the command line or file path. */
  summary: string
  createdAt: number
}

export interface RunSummary {
  id: string
  conversationId: string | null
  title: string | null
  model: string | null
  status: 'running' | 'waiting_approval' | 'done' | 'error' | 'cancelled'
  turns: number
  toolCalls: number
  startedAt: number
  finishedAt: number | null
  error: string | null
  summary: string | null
}

export interface RunEventRow {
  id: number
  runId: string
  ts: number
  type: string
  payload: unknown
}

export type AgentEvent =
  | ChatStreamEvent
  | { type: 'run-start'; run: RunSummary }
  | { type: 'run-update'; run: RunSummary }
  | { type: 'turn'; index: number; maxTurns: number }
  | { type: 'message'; message: StoredMessage }
  | { type: 'conversation'; conversation: Conversation }
  | { type: 'prompt'; estimatedTokens: number; contextTokens: number; droppedHistory: number; droppedSections: string[]; imagesStripped: number }
  | { type: 'citations'; hits: KnowledgeHit[]; error?: string }
  | { type: 'tool-call'; callId: string; tool: string; args: Record<string, unknown>; summary: string; risk: ToolRisk }
  | { type: 'approval-request'; request: ApprovalRequest }
  | { type: 'approval-decision'; requestId: string; decision: ApprovalDecision }
  | { type: 'tool-output'; callId: string; chunk: string }
  | { type: 'tool-result'; callId: string; tool: string; ok: boolean; content: string; durationMs: number; meta?: Record<string, unknown> }
  | { type: 'run-done'; run: RunSummary }

export interface McpServerConfig {
  id: string
  name: string
  transport: 'stdio' | 'http'
  command: string | null
  args: string[]
  env: Record<string, string>
  url: string | null
  headers: Record<string, string>
  enabled: boolean
  allow: string[] | null
  createdAt: number
  updatedAt: number
}

export interface McpServerStatus {
  id: string
  name: string
  connected: boolean
  error: string | null
  tools: { name: string; description: string }[]
}
