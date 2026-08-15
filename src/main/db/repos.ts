import { randomUUID } from 'node:crypto'
import type { Attachment, Conversation, ConversationSettings, MessageMetrics, StoredMessage } from '@shared/chat'
import type { ChatContentPart, ChatToolCall } from '@shared/api'
import type { Database } from './index'

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

interface ConversationRow {
  id: string
  title: string
  model: string | null
  system_prompt: string | null
  mode: string
  settings_json: string
  workspace_root: string | null
  pinned: number
  archived: number
  created_at: number
  updated_at: number
  message_count?: number
  last_preview?: string | null
}

interface MessageRow {
  id: string
  conversation_id: string
  seq: number
  role: string
  content_json: string
  reasoning: string | null
  tool_calls_json: string | null
  tool_call_id: string | null
  name: string | null
  model: string | null
  status: string
  error: string | null
  metrics_json: string | null
  created_at: number
}

interface AttachmentRow {
  id: string
  message_id: string | null
  conversation_id: string
  kind: string
  name: string
  mime: string | null
  size: number | null
  path: string
  width: number | null
  height: number | null
  created_at: number
}

function rowToConversation(r: ConversationRow): Conversation {
  return {
    id: r.id,
    title: r.title,
    model: r.model,
    systemPrompt: r.system_prompt,
    mode: (r.mode as Conversation['mode']) ?? 'chat',
    settings: parseJson<ConversationSettings>(r.settings_json, {}),
    workspaceRoot: r.workspace_root,
    pinned: !!r.pinned,
    archived: !!r.archived,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    messageCount: r.message_count,
    lastMessagePreview: r.last_preview ?? null,
  }
}

function rowToAttachment(r: AttachmentRow): Attachment {
  return {
    id: r.id,
    messageId: r.message_id,
    conversationId: r.conversation_id,
    kind: r.kind as Attachment['kind'],
    name: r.name,
    mime: r.mime,
    size: r.size,
    path: r.path,
    width: r.width,
    height: r.height,
    createdAt: r.created_at,
  }
}

export class ConversationRepo {
  constructor(private db: Database) {}

  list(opts: { includeArchived?: boolean; limit?: number } = {}): Conversation[] {
    const rows = this.db
      .prepare(
        `SELECT c.*,
           (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
           (SELECT substr(CASE WHEN json_valid(m.content_json) AND json_type(m.content_json) = 'text' THEN json_extract(m.content_json, '$') ELSE '' END, 1, 140)
              FROM messages m WHERE m.conversation_id = c.id AND m.role IN ('user','assistant') ORDER BY m.seq DESC LIMIT 1) AS last_preview
         FROM conversations c
         WHERE (? = 1 OR c.archived = 0)
         ORDER BY c.pinned DESC, c.updated_at DESC
         LIMIT ?`,
      )
      .all(opts.includeArchived ? 1 : 0, opts.limit ?? 500) as ConversationRow[]
    return rows.map(rowToConversation)
  }

  get(id: string): Conversation | null {
    const r = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined
    return r ? rowToConversation(r) : null
  }

  create(input: Partial<Pick<Conversation, 'title' | 'model' | 'systemPrompt' | 'mode' | 'settings' | 'workspaceRoot'>> = {}): Conversation {
    const now = Date.now()
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO conversations (id, title, model, system_prompt, mode, settings_json, workspace_root, pinned, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      )
      .run(id, input.title ?? 'New chat', input.model ?? null, input.systemPrompt ?? null, input.mode ?? 'chat', JSON.stringify(input.settings ?? {}), input.workspaceRoot ?? null, now, now)
    return this.get(id)!
  }

  update(id: string, patch: Partial<Pick<Conversation, 'title' | 'model' | 'systemPrompt' | 'mode' | 'settings' | 'workspaceRoot' | 'pinned' | 'archived'>>): Conversation | null {
    const cur = this.get(id)
    if (!cur) return null
    const next = { ...cur, ...patch, settings: patch.settings ? { ...cur.settings, ...patch.settings } : cur.settings }
    this.db
      .prepare(
        `UPDATE conversations SET title=?, model=?, system_prompt=?, mode=?, settings_json=?, workspace_root=?, pinned=?, archived=?, updated_at=? WHERE id=?`,
      )
      .run(next.title, next.model, next.systemPrompt, next.mode, JSON.stringify(next.settings), next.workspaceRoot, next.pinned ? 1 : 0, next.archived ? 1 : 0, Date.now(), id)
    return this.get(id)
  }

  touch(id: string): void {
    this.db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(Date.now(), id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
  }
}

export class MessageRepo {
  constructor(private db: Database) {}

  private attachmentsFor(messageIds: string[]): Map<string, Attachment[]> {
    const map = new Map<string, Attachment[]>()
    if (!messageIds.length) return map
    const placeholders = messageIds.map(() => '?').join(',')
    const rows = this.db.prepare(`SELECT * FROM attachments WHERE message_id IN (${placeholders}) ORDER BY created_at`).all(...messageIds) as AttachmentRow[]
    for (const r of rows) {
      const a = rowToAttachment(r)
      const list = map.get(r.message_id!) ?? []
      list.push(a)
      map.set(r.message_id!, list)
    }
    return map
  }

  private rowToMessage(r: MessageRow, atts: Map<string, Attachment[]>): StoredMessage {
    return {
      id: r.id,
      conversationId: r.conversation_id,
      seq: r.seq,
      role: r.role as StoredMessage['role'],
      content: parseJson<string | ChatContentPart[]>(r.content_json, ''),
      reasoning: r.reasoning,
      toolCalls: parseJson<ChatToolCall[] | null>(r.tool_calls_json, null),
      toolCallId: r.tool_call_id,
      name: r.name,
      model: r.model,
      status: r.status as StoredMessage['status'],
      error: r.error,
      metrics: parseJson<MessageMetrics | null>(r.metrics_json, null),
      attachments: atts.get(r.id) ?? [],
      createdAt: r.created_at,
    }
  }

  list(conversationId: string): StoredMessage[] {
    const rows = this.db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq ASC').all(conversationId) as MessageRow[]
    const atts = this.attachmentsFor(rows.map((r) => r.id))
    return rows.map((r) => this.rowToMessage(r, atts))
  }

  get(id: string): StoredMessage | null {
    const r = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined
    if (!r) return null
    return this.rowToMessage(r, this.attachmentsFor([id]))
  }

  nextSeq(conversationId: string): number {
    const r = this.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM messages WHERE conversation_id = ?').get(conversationId) as { s: number }
    return r.s
  }

  insert(input: Omit<StoredMessage, 'id' | 'seq' | 'createdAt' | 'attachments'> & { id?: string; seq?: number; createdAt?: number }): StoredMessage {
    const id = input.id ?? randomUUID()
    const seq = input.seq ?? this.nextSeq(input.conversationId)
    const createdAt = input.createdAt ?? Date.now()
    this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, seq, role, content_json, reasoning, tool_calls_json, tool_call_id, name, model, status, error, metrics_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.conversationId,
        seq,
        input.role,
        JSON.stringify(input.content ?? ''),
        input.reasoning ?? null,
        input.toolCalls ? JSON.stringify(input.toolCalls) : null,
        input.toolCallId ?? null,
        input.name ?? null,
        input.model ?? null,
        input.status ?? 'complete',
        input.error ?? null,
        input.metrics ? JSON.stringify(input.metrics) : null,
        createdAt,
      )
    this.db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(createdAt, input.conversationId)
    return this.get(id)!
  }

  update(id: string, patch: Partial<Pick<StoredMessage, 'content' | 'reasoning' | 'toolCalls' | 'status' | 'error' | 'metrics' | 'model'>>): StoredMessage | null {
    const cur = this.get(id)
    if (!cur) return null
    const next = { ...cur, ...patch }
    this.db
      .prepare(`UPDATE messages SET content_json=?, reasoning=?, tool_calls_json=?, status=?, error=?, metrics_json=?, model=? WHERE id=?`)
      .run(
        JSON.stringify(next.content ?? ''),
        next.reasoning ?? null,
        next.toolCalls ? JSON.stringify(next.toolCalls) : null,
        next.status,
        next.error ?? null,
        next.metrics ? JSON.stringify(next.metrics) : null,
        next.model ?? null,
        id,
      )
    return this.get(id)
  }

  /** Delete a message and everything after it (used by edit-and-resend / regenerate). */
  truncateFrom(conversationId: string, seq: number): number {
    const r = this.db.prepare('DELETE FROM messages WHERE conversation_id = ? AND seq >= ?').run(conversationId, seq)
    return r.changes
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM messages WHERE id = ?').run(id)
  }
}

export class AttachmentRepo {
  constructor(private db: Database) {}

  insert(a: Omit<Attachment, 'id' | 'createdAt'> & { id?: string }): Attachment {
    const id = a.id ?? randomUUID()
    const now = Date.now()
    this.db
      .prepare(`INSERT INTO attachments (id, message_id, conversation_id, kind, name, mime, size, path, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, a.messageId, a.conversationId, a.kind, a.name, a.mime, a.size, a.path, a.width, a.height, now)
    return this.get(id)!
  }

  get(id: string): Attachment | null {
    const r = this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as AttachmentRow | undefined
    return r ? rowToAttachment(r) : null
  }

  attachToMessage(ids: string[], messageId: string): void {
    const stmt = this.db.prepare('UPDATE attachments SET message_id = ? WHERE id = ?')
    for (const id of ids) stmt.run(messageId, id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id)
  }
}

export class TelemetryRepo {
  constructor(private db: Database) {}

  insert(s: {
    model: string | null
    compute: string | null
    ttftMs: number | null
    totalMs: number | null
    promptTokens: number | null
    completionTokens: number | null
    tokensPerSecond: number | null
    loadMs: number | null
    finishReason: string | null
    conversationId: string | null
  }): void {
    this.db
      .prepare(
        `INSERT INTO telemetry (ts, model, compute, ttft_ms, total_ms, prompt_tokens, completion_tokens, tokens_per_second, load_ms, finish_reason, conversation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(Date.now(), s.model, s.compute, s.ttftMs, s.totalMs, s.promptTokens, s.completionTokens, s.tokensPerSecond, s.loadMs, s.finishReason, s.conversationId)
  }

  recent(limit = 200): unknown[] {
    return this.db.prepare('SELECT * FROM telemetry ORDER BY ts DESC LIMIT ?').all(limit)
  }

  summaryByModel(): unknown[] {
    return this.db
      .prepare(
        `SELECT model, compute, COUNT(*) AS n, AVG(tokens_per_second) AS avg_tps, AVG(ttft_ms) AS avg_ttft, MAX(ts) AS last_ts
         FROM telemetry WHERE tokens_per_second IS NOT NULL GROUP BY model, compute ORDER BY last_ts DESC`,
      )
      .all()
  }
}
