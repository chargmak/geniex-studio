import { create } from 'zustand'
import type { ChatStreamEvent, GenieRequestOptions, SamplerSettings } from '@shared/api'
import type { AgentEvent, ApprovalDecision, ApprovalRequest, RunSummary, ToolRisk } from '@shared/agent'
import type { Attachment, Conversation, StoredMessage } from '@shared/chat'
import { api, readSse } from '@/lib/api'

type TurnEvent =
  | ChatStreamEvent
  | { type: 'message'; message: StoredMessage }
  | { type: 'conversation'; conversation: Conversation }
  | { type: 'prompt'; estimatedTokens: number; contextTokens: number; droppedHistory: number; droppedSections: string[]; imagesStripped: number }

export interface StreamState {
  messageId: string | null
  content: string
  reasoning: string
  phase: 'idle' | 'queued' | 'loading-model' | 'thinking' | 'answering' | 'done'
  startedAt: number | null
  firstTokenAt: number | null
  loadMs: number | null
  ttftMs: number | null
  tokensPerSecond: number | null
  completionTokens: number | null
  error: string | null
}

export interface LiveToolCall {
  callId: string
  tool: string
  args: Record<string, unknown>
  summary: string
  risk: ToolRisk
  status: 'running' | 'awaiting-approval' | 'done' | 'error' | 'denied'
  output: string
  result?: string
  ok?: boolean
  durationMs?: number
  meta?: Record<string, unknown>
  startedAt: number
}

export interface AgentLive {
  run: RunSummary | null
  turn: number
  maxTurns: number
  toolCalls: Record<string, LiveToolCall>
  pendingApprovals: ApprovalRequest[]
}

export interface PromptInfo {
  estimatedTokens: number
  contextTokens: number
  droppedHistory: number
  droppedSections: string[]
  imagesStripped: number
}

const idleStream = (): StreamState => ({
  messageId: null,
  content: '',
  reasoning: '',
  phase: 'idle',
  startedAt: null,
  firstTokenAt: null,
  loadMs: null,
  ttftMs: null,
  tokensPerSecond: null,
  completionTokens: null,
  error: null,
})

interface SendOptions {
  text: string
  mode?: 'chat' | 'agent'
  attachmentIds?: string[]
  model?: string
  sampler?: SamplerSettings
  options?: GenieRequestOptions
  regenerate?: boolean
  editMessageId?: string
}

interface ChatState {
  conversations: Conversation[]
  activeId: string | null
  messages: StoredMessage[]
  loadingList: boolean
  loadingMessages: boolean
  streams: Record<string, StreamState>
  agent: Record<string, AgentLive>
  promptInfo: Record<string, PromptInfo>
  pendingAttachments: Attachment[]
  draft: string
  error: string | null

  loadConversations(): Promise<void>
  createConversation(input?: { model?: string | null; mode?: 'chat' | 'agent' }): Promise<Conversation>
  select(id: string | null): Promise<void>
  updateConversation(id: string, patch: Partial<Conversation>): Promise<void>
  deleteConversation(id: string): Promise<void>
  send(opts: SendOptions): Promise<void>
  stop(id?: string): Promise<void>
  uploadFiles(files: File[]): Promise<void>
  addPathAttachments(paths: string[]): Promise<void>
  removePendingAttachment(id: string): Promise<void>
  setDraft(text: string): void
  streamFor(id: string | null): StreamState
  respondApproval(requestId: string, decision: ApprovalDecision): Promise<void>
  clearAgent(id: string): void
}

const controllers = new Map<string, AbortController>()

export const useChatStore = create<ChatState>()((set, get) => ({
  conversations: [],
  activeId: null,
  messages: [],
  loadingList: false,
  loadingMessages: false,
  streams: {},
  agent: {},
  promptInfo: {},
  pendingAttachments: [],
  draft: '',
  error: null,

  streamFor: (id) => (id ? (get().streams[id] ?? idleStream()) : idleStream()),

  loadConversations: async () => {
    set({ loadingList: true })
    try {
      const res = await api<{ conversations: Conversation[] }>('/api/conversations')
      set({ conversations: res.conversations })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ loadingList: false })
    }
  },

  createConversation: async (input = {}) => {
    const res = await api<{ conversation: Conversation }>('/api/conversations', { method: 'POST', json: input })
    set((s) => ({ conversations: [res.conversation, ...s.conversations] }))
    return res.conversation
  },

  select: async (id) => {
    if (!id) {
      set({ activeId: null, messages: [], pendingAttachments: [] })
      return
    }
    set({ activeId: id, loadingMessages: true, pendingAttachments: [] })
    try {
      const res = await api<{ conversation: Conversation; messages: StoredMessage[] }>(`/api/conversations/${id}`)
      // Ignore if the user switched again meanwhile.
      if (get().activeId !== id) return
      set((s) => ({
        messages: res.messages,
        conversations: s.conversations.some((c) => c.id === id) ? s.conversations.map((c) => (c.id === id ? res.conversation : c)) : [res.conversation, ...s.conversations],
      }))
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), messages: [] })
    } finally {
      set({ loadingMessages: false })
    }
  },

  updateConversation: async (id, patch) => {
    const res = await api<{ conversation: Conversation }>(`/api/conversations/${id}`, { method: 'PATCH', json: patch })
    set((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? res.conversation : c)) }))
  },

  deleteConversation: async (id) => {
    await api(`/api/conversations/${id}`, { method: 'DELETE' })
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
      messages: s.activeId === id ? [] : s.messages,
    }))
  },

  setDraft: (text) => set({ draft: text }),

  uploadFiles: async (files) => {
    let convId = get().activeId
    if (!convId) convId = (await get().createConversation()).id
    if (get().activeId !== convId) set({ activeId: convId, messages: [] })
    const fd = new FormData()
    fd.set('conversationId', convId)
    for (const f of files) fd.append('file', f, f.name)
    const res = await fetch('/api/attachments', { method: 'POST', body: fd })
    if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error)
    const { attachments } = (await res.json()) as { attachments: Attachment[] }
    set((s) => ({ pendingAttachments: [...s.pendingAttachments, ...attachments] }))
  },

  addPathAttachments: async (paths) => {
    let convId = get().activeId
    if (!convId) convId = (await get().createConversation()).id
    if (get().activeId !== convId) set({ activeId: convId, messages: [] })
    const res = await api<{ attachments: Attachment[]; errors: string[] }>('/api/attachments/from-path', { method: 'POST', json: { conversationId: convId, paths } })
    set((s) => ({ pendingAttachments: [...s.pendingAttachments, ...res.attachments] }))
    if (res.errors?.length) set({ error: res.errors.join('\n') })
  },

  removePendingAttachment: async (id) => {
    set((s) => ({ pendingAttachments: s.pendingAttachments.filter((a) => a.id !== id) }))
    await api(`/api/attachments/${id}`, { method: 'DELETE' }).catch(() => {})
  },

  send: async (opts) => {
    let convId = get().activeId
    if (!convId) {
      const conv = await get().createConversation({ model: opts.model ?? null })
      convId = conv.id
      set({ activeId: convId, messages: [] })
    }
    const id = convId
    const attachmentIds = opts.attachmentIds ?? get().pendingAttachments.map((a) => a.id)
    const ac = new AbortController()
    controllers.set(id, ac)
    set((s) => ({
      streams: { ...s.streams, [id]: { ...idleStream(), phase: 'queued', startedAt: Date.now() } },
      pendingAttachments: [],
      draft: opts.editMessageId || opts.regenerate ? s.draft : '',
      error: null,
    }))

    const upsertMessage = (m: StoredMessage): void =>
      set((s) => {
        if (s.activeId !== id) return {}
        const exists = s.messages.some((x) => x.id === m.id)
        let messages = exists ? s.messages.map((x) => (x.id === m.id ? m : x)) : [...s.messages, m]
        // Edit/regenerate truncate server-side; mirror by dropping anything at/after a freshly inserted seq.
        if (!exists) messages = messages.filter((x) => x.id === m.id || x.seq < m.seq).sort((a, b) => a.seq - b.seq)
        return { messages }
      })

    const isAgent = opts.mode === 'agent'
    const emptyAgent = (): AgentLive => ({ run: null, turn: 0, maxTurns: 0, toolCalls: {}, pendingApprovals: [] })
    if (isAgent) set((s) => ({ agent: { ...s.agent, [id]: emptyAgent() } }))
    const patchAgent = (fn: (a: AgentLive) => AgentLive): void => set((s) => ({ agent: { ...s.agent, [id]: fn(s.agent[id] ?? emptyAgent()) } }))

    try {
      const res = await fetch(isAgent ? '/api/agent/runs' : `/api/conversations/${id}/turns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isAgent
            ? { conversationId: id, userText: opts.text, attachmentIds, model: opts.model, sampler: opts.sampler, options: opts.options }
            : {
                userText: opts.text,
                attachmentIds,
                model: opts.model,
                sampler: opts.sampler,
                options: opts.options,
                regenerate: opts.regenerate,
                editMessageId: opts.editMessageId,
              },
        ),
        signal: ac.signal,
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(e.error ?? res.statusText)
      }
      if (opts.editMessageId || opts.regenerate) {
        // Server truncated history — reload to stay consistent, then continue streaming updates.
        const snap = await api<{ messages: StoredMessage[] }>(`/api/conversations/${id}`)
        if (get().activeId === id) set({ messages: snap.messages })
      }
      for await (const ev of readSse<TurnEvent | AgentEvent>(res, ac.signal)) {
        const cur = get().streams[id] ?? idleStream()
        switch (ev.type) {
          case 'message':
            upsertMessage(ev.message)
            if (ev.message.role === 'assistant' && ev.message.status === 'streaming') set((s) => ({ streams: { ...s.streams, [id]: { ...cur, messageId: ev.message.id } } }))
            break
          case 'conversation':
            set((s) => ({ conversations: [ev.conversation, ...s.conversations.filter((c) => c.id !== ev.conversation.id)].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt) }))
            break
          case 'prompt':
            set((s) => ({ promptInfo: { ...s.promptInfo, [id]: { estimatedTokens: ev.estimatedTokens, contextTokens: ev.contextTokens, droppedHistory: ev.droppedHistory, droppedSections: ev.droppedSections, imagesStripped: ev.imagesStripped } } }))
            break
          case 'model-loading':
            set((s) => ({ streams: { ...s.streams, [id]: { ...cur, phase: 'loading-model' } } }))
            break
          case 'model-ready':
            set((s) => ({ streams: { ...s.streams, [id]: { ...cur, loadMs: ev.loadMs, phase: 'queued' } } }))
            break
          case 'delta': {
            const now = Date.now()
            set((s) => ({
              streams: {
                ...s.streams,
                [id]: {
                  ...cur,
                  content: cur.content + (ev.content ?? ''),
                  reasoning: cur.reasoning + (ev.reasoning ?? ''),
                  firstTokenAt: cur.firstTokenAt ?? now,
                  phase: ev.content ? 'answering' : cur.phase === 'answering' ? 'answering' : 'thinking',
                },
              },
            }))
            break
          }
          case 'done':
            set((s) => ({
              streams: {
                ...s.streams,
                [id]: { ...cur, phase: 'done', ttftMs: ev.ttftMs, tokensPerSecond: ev.tokensPerSecond, completionTokens: ev.completionTokens },
              },
            }))
            break
          case 'error':
            set((s) => ({ streams: { ...s.streams, [id]: { ...cur, phase: 'done', error: ev.message } }, error: ev.message }))
            break
          case 'run-start':
          case 'run-update':
            patchAgent((a) => ({ ...a, run: ev.run }))
            break
          case 'turn':
            patchAgent((a) => ({ ...a, turn: ev.index, maxTurns: ev.maxTurns }))
            set((s) => ({ streams: { ...s.streams, [id]: { ...(s.streams[id] ?? idleStream()), content: '', reasoning: '', phase: 'queued', firstTokenAt: null } } }))
            break
          case 'tool-call':
            patchAgent((a) => ({ ...a, toolCalls: { ...a.toolCalls, [ev.callId]: { callId: ev.callId, tool: ev.tool, args: ev.args, summary: ev.summary, risk: ev.risk, status: 'running', output: '', startedAt: Date.now() } } }))
            break
          case 'approval-request':
            patchAgent((a) => {
              const call = Object.values(a.toolCalls).find((c) => c.tool === ev.request.tool && c.status === 'running')
              const toolCalls = call ? { ...a.toolCalls, [call.callId]: { ...call, status: 'awaiting-approval' as const } } : a.toolCalls
              return { ...a, toolCalls, pendingApprovals: [...a.pendingApprovals.filter((r) => r.id !== ev.request.id), ev.request] }
            })
            break
          case 'approval-decision':
            patchAgent((a) => {
              const toolCalls = { ...a.toolCalls }
              for (const c of Object.values(toolCalls)) if (c.status === 'awaiting-approval') toolCalls[c.callId] = { ...c, status: ev.decision === 'deny' ? 'denied' : 'running' }
              return { ...a, pendingApprovals: a.pendingApprovals.filter((r) => r.id !== ev.requestId), toolCalls }
            })
            break
          case 'tool-output':
            patchAgent((a) => {
              const c = a.toolCalls[ev.callId]
              return c ? { ...a, toolCalls: { ...a.toolCalls, [ev.callId]: { ...c, output: (c.output + ev.chunk).slice(-20_000) } } } : a
            })
            break
          case 'tool-result':
            patchAgent((a) => {
              const c = a.toolCalls[ev.callId]
              const status: LiveToolCall['status'] = c?.status === 'denied' ? 'denied' : ev.ok ? 'done' : 'error'
              const base: LiveToolCall = c ?? { callId: ev.callId, tool: ev.tool, args: {}, summary: ev.tool, risk: 'read', status: 'running', output: '', startedAt: Date.now() }
              return { ...a, toolCalls: { ...a.toolCalls, [ev.callId]: { ...base, status, result: ev.content, ok: ev.ok, durationMs: ev.durationMs, meta: ev.meta } } }
            })
            break
          case 'run-done':
            patchAgent((a) => ({ ...a, run: ev.run, pendingApprovals: [] }))
            break
        }
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        const message = err instanceof Error ? err.message : String(err)
        set((s) => ({ streams: { ...s.streams, [id]: { ...(s.streams[id] ?? idleStream()), phase: 'done', error: message } }, error: message }))
      }
    } finally {
      controllers.delete(id)
      // Reload the final persisted messages so metrics/status match the DB, then clear the live stream.
      try {
        const snap = await api<{ conversation: Conversation; messages: StoredMessage[] }>(`/api/conversations/${id}`)
        if (get().activeId === id) set({ messages: snap.messages })
        set((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? snap.conversation : c)) }))
      } catch {
        /* ignore */
      }
      set((s) => {
        const next = { ...s.streams }
        delete next[id]
        return { streams: next }
      })
      void get().loadConversations()
    }
  },

  respondApproval: async (requestId, decision) => {
    await api(`/api/agent/approvals/${requestId}`, { method: 'POST', json: { decision } })
    set((s) => {
      const agent = { ...s.agent }
      for (const [cid, a] of Object.entries(agent)) agent[cid] = { ...a, pendingApprovals: a.pendingApprovals.filter((r) => r.id !== requestId) }
      return { agent }
    })
  },

  clearAgent: (id) =>
    set((s) => {
      const agent = { ...s.agent }
      delete agent[id]
      return { agent }
    }),

  stop: async (id) => {
    const target = id ?? get().activeId
    if (!target) return
    await api(`/api/conversations/${target}/cancel`, { method: 'POST' }).catch(() => {})
  },
}))
