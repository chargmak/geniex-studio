import type { ChatContentPart, ChatToolCall, GenieRequestOptions, SamplerSettings } from './api'
import type { KnowledgeHit } from './sidecar'

/** Per-conversation retrieval settings (Knowledge page sources, embedded on the NPU). */
export interface KnowledgeOptions {
  enabled: boolean
  /** Restrict to these source ids (empty/undefined = all ready sources). */
  sourceIds?: string[]
  topK?: number
}

/** Persisted conversation + message shapes (renderer ↔ /api/conversations). */
export type ConversationMode = 'chat' | 'agent'

export interface ConversationSettings {
  sampler?: SamplerSettings
  options?: GenieRequestOptions
  enableThink?: boolean
  tools?: string[] // enabled tool ids in agent mode
  knowledge?: KnowledgeOptions
}

export interface Conversation {
  id: string
  title: string
  model: string | null
  systemPrompt: string | null
  mode: ConversationMode
  settings: ConversationSettings
  workspaceRoot: string | null
  pinned: boolean
  archived: boolean
  createdAt: number
  updatedAt: number
  /** Populated by list endpoint. */
  messageCount?: number
  lastMessagePreview?: string | null
}

export type MessageStatus = 'streaming' | 'complete' | 'error' | 'cancelled'

export interface MessageMetrics {
  ttftMs?: number | null
  totalMs?: number | null
  tokensPerSecond?: number | null
  loadMs?: number | null
  promptTokens?: number | null
  completionTokens?: number | null
  finishReason?: string | null
  compute?: string | null
  /** Speculative decoding (llama.cpp `spec_type`): draft tokens the target accepted / rejected this turn. */
  acceptedTokens?: number | null
  rejectedTokens?: number | null
  specType?: string | null
  /** Knowledge-base excerpts that were injected for this reply (numbered as cited). */
  citations?: KnowledgeHit[] | null
}

export interface Attachment {
  id: string
  messageId: string | null
  conversationId: string
  kind: 'image' | 'audio' | 'file'
  name: string
  mime: string | null
  size: number | null
  /** Absolute path on disk (server-side). Renderer loads via /api/attachments/:id/raw. */
  path: string
  width: number | null
  height: number | null
  createdAt: number
}

export interface StoredMessage {
  id: string
  conversationId: string
  seq: number
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ChatContentPart[]
  reasoning: string | null
  toolCalls: ChatToolCall[] | null
  toolCallId: string | null
  name: string | null
  model: string | null
  status: MessageStatus
  error: string | null
  metrics: MessageMetrics | null
  attachments: Attachment[]
  createdAt: number
}
