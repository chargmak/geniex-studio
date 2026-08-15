import type { ChatStreamEvent, ChatToolDefinition, GenieRequestOptions, SamplerSettings } from '@shared/api'
import type { Conversation, MessageMetrics, StoredMessage } from '@shared/chat'
import type { AppContext } from '../server/context'
import { assemblePrompt } from './prompt'

export interface TurnRequest {
  conversationId: string
  /** New user message text (may be empty when only attachments are sent). */
  userText?: string
  attachmentIds?: string[]
  /** Re-run the last assistant reply (deletes it and anything after). */
  regenerate?: boolean
  /** Replace this user message's text and drop everything after it, then re-run. */
  editMessageId?: string
  /** One-off overrides for this turn (persisted onto the conversation when `persist` is true). */
  model?: string
  sampler?: SamplerSettings
  options?: GenieRequestOptions
  systemPrompt?: string | null
  persist?: boolean
  /** Agent mode hooks (M4): tool definitions and extra prompt sections. */
  tools?: ChatToolDefinition[]
  extraSections?: { label: string; text: string; droppable: boolean }[]
}

export type TurnEvent =
  | ChatStreamEvent
  | { type: 'message'; message: StoredMessage }
  | { type: 'conversation'; conversation: Conversation }
  | { type: 'prompt'; estimatedTokens: number; contextTokens: number; droppedHistory: number; droppedSections: string[]; imagesStripped: number }

const QAIRT_CONTEXT = 4096

/**
 * Runs one assistant turn for a conversation: persists the user message, streams the model, persists the
 * assistant message incrementally, and yields renderer-friendly events. One active turn per conversation.
 */
export class TurnRunner {
  private active = new Map<string, AbortController>()

  constructor(private readonly ctx: AppContext) {}

  isRunning(conversationId: string): boolean {
    return this.active.has(conversationId)
  }

  cancel(conversationId: string): boolean {
    const ac = this.active.get(conversationId)
    if (!ac) return false
    ac.abort()
    return true
  }

  async *run(req: TurnRequest): AsyncGenerator<TurnEvent> {
    const { repos, settings, models, client } = this.ctx
    const conv0 = repos.conversations.get(req.conversationId)
    if (!conv0) {
      yield { type: 'error', message: 'conversation not found', status: 404 }
      return
    }
    if (this.active.has(conv0.id)) {
      yield { type: 'error', message: 'a turn is already running for this conversation', status: 409 }
      return
    }
    const ac = new AbortController()
    this.active.set(conv0.id, ac)

    try {
      // ---------------------------------------------------------- resolve model
      const installed = await models.list().catch(() => [])
      const s = settings.get()
      let model = req.model ?? conv0.model ?? s.defaults.chatModel ?? installed[0]?.requestIds[0] ?? null
      if (!model) {
        yield { type: 'error', message: 'No model available. Pull a model from the Models page first.', status: 400 }
        return
      }
      const info = installed.find((m) => m.requestIds.includes(model!) || m.name === model)
      if (!info && installed.length) {
        // A stale saved model — fall back to the first installed one and persist.
        model = s.defaults.chatModel && installed.some((m) => m.requestIds.includes(s.defaults.chatModel!)) ? s.defaults.chatModel : installed[0].requestIds[0]
      }
      const modelInfo = installed.find((m) => m.requestIds.includes(model!) || m.name === model)
      const isVlm = modelInfo?.type === 'vlm'
      const isQairt = modelInfo?.runtime === 'qairt'

      // ---------------------------------------------------------- persist conversation-level changes
      let conv = conv0
      const patch: Partial<Conversation> = {}
      if (model !== conv.model) patch.model = model
      if (req.systemPrompt !== undefined && req.systemPrompt !== conv.systemPrompt) patch.systemPrompt = req.systemPrompt
      if (req.persist && (req.sampler || req.options)) patch.settings = { ...conv.settings, ...(req.sampler ? { sampler: req.sampler } : {}), ...(req.options ? { options: req.options } : {}) }
      if (Object.keys(patch).length) conv = repos.conversations.update(conv.id, patch) ?? conv

      // ---------------------------------------------------------- mutations: edit / regenerate / new message
      if (req.editMessageId) {
        const target = repos.messages.get(req.editMessageId)
        if (!target || target.conversationId !== conv.id || target.role !== 'user') {
          yield { type: 'error', message: 'message to edit not found', status: 404 }
          return
        }
        repos.messages.truncateFrom(conv.id, target.seq + 1)
        repos.messages.update(target.id, { content: req.userText ?? (typeof target.content === 'string' ? target.content : '') })
      } else if (req.regenerate) {
        const history = repos.messages.list(conv.id)
        const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant')
        if (lastAssistant) repos.messages.truncateFrom(conv.id, lastAssistant.seq)
      } else {
        const text = (req.userText ?? '').trim()
        if (!text && !(req.attachmentIds?.length)) {
          yield { type: 'error', message: 'empty message', status: 400 }
          return
        }
        const userMsg = repos.messages.insert({ conversationId: conv.id, role: 'user', content: text, reasoning: null, toolCalls: null, toolCallId: null, name: null, model: null, status: 'complete', error: null, metrics: null })
        if (req.attachmentIds?.length) repos.attachments.attachToMessage(req.attachmentIds, userMsg.id)
        const withAtt = repos.messages.get(userMsg.id)!
        yield { type: 'message', message: withAtt }
        // Auto-title from the first user message.
        if (conv.title === 'New chat' && text) {
          const title = text.replace(/\s+/g, ' ').slice(0, 64).trim()
          conv = repos.conversations.update(conv.id, { title: title.length < text.length ? `${title}…` : title }) ?? conv
        }
      }
      yield { type: 'conversation', conversation: repos.conversations.get(conv.id) ?? conv }

      // ---------------------------------------------------------- assemble prompt
      const history = repos.messages.list(conv.id)
      const sampler: SamplerSettings = { ...s.defaults.sampler, ...(conv.settings.sampler ?? {}), ...(req.sampler ?? {}) }
      const options: GenieRequestOptions = { ...(conv.settings.options ?? {}), ...(req.options ?? {}) }
      if (options.enable_think === undefined) options.enable_think = conv.settings.enableThink ?? s.defaults.enableThink
      if (!isQairt && options.compute === undefined) options.compute = s.defaults.computeGguf
      if (isQairt) {
        // QAIRT bundles ignore nctx/ngl and always run on the NPU; sending compute would be coerced anyway.
        delete options.compute
        delete options.nctx
        delete options.ngl
      }
      const contextTokens = isQairt ? QAIRT_CONTEXT : (options.nctx ?? s.genie.nctx)
      const maxTokens = sampler.max_tokens ?? 2048
      const assembled = assemblePrompt(history, {
        systemPrompt: req.systemPrompt !== undefined ? req.systemPrompt : (conv.systemPrompt ?? s.defaults.systemPrompt),
        contextTokens,
        maxTokens: Math.min(maxTokens, Math.floor(contextTokens / 2)),
        vision: !!isVlm,
        extraSections: req.extraSections,
      })
      yield { type: 'prompt', estimatedTokens: assembled.estimatedTokens, contextTokens, droppedHistory: assembled.droppedHistory, droppedSections: assembled.droppedSections, imagesStripped: assembled.imagesStripped }

      // ---------------------------------------------------------- assistant placeholder
      let assistant = repos.messages.insert({ conversationId: conv.id, role: 'assistant', content: '', reasoning: null, toolCalls: null, toolCallId: null, name: null, model, status: 'streaming', error: null, metrics: null })
      yield { type: 'message', message: assistant }

      // ---------------------------------------------------------- stream
      let content = ''
      let reasoning = ''
      let toolCalls: StoredMessage['toolCalls'] = null
      const metrics: MessageMetrics = { compute: options.compute ?? (isQairt ? 'npu' : null) }
      let finished = false
      let lastFlush = Date.now()

      const flush = (status: StoredMessage['status'] = 'streaming'): void => {
        assistant = repos.messages.update(assistant.id, { content, reasoning: reasoning || null, toolCalls, status, metrics }) ?? assistant
      }

      try {
        for await (const ev of client.chatStream({ model, messages: assembled.messages, tools: req.tools, sampler, options, conversationId: conv.id }, ac.signal)) {
          switch (ev.type) {
            case 'delta':
              if (ev.content) content += ev.content
              if (ev.reasoning) reasoning += ev.reasoning
              if (Date.now() - lastFlush > 1500) {
                flush()
                lastFlush = Date.now()
              }
              break
            case 'model-ready':
              metrics.loadMs = ev.loadMs
              break
            case 'tool_calls':
              toolCalls = ev.tool_calls
              break
            case 'usage':
              metrics.promptTokens = ev.prompt_tokens
              metrics.completionTokens = ev.completion_tokens
              break
            case 'done':
              metrics.ttftMs = ev.ttftMs
              metrics.totalMs = ev.totalMs
              metrics.tokensPerSecond = ev.tokensPerSecond
              metrics.completionTokens = metrics.completionTokens ?? ev.completionTokens
              metrics.finishReason = ev.finish_reason
              finished = true
              flush(ev.finish_reason === 'cancelled' ? 'cancelled' : 'complete')
              break
            case 'error':
              finished = true
              assistant = repos.messages.update(assistant.id, { content, reasoning: reasoning || null, status: 'error', error: ev.message, metrics }) ?? assistant
              break
          }
          yield ev
        }
      } finally {
        if (!finished) {
          const cancelled = ac.signal.aborted
          assistant = repos.messages.update(assistant.id, { content, reasoning: reasoning || null, toolCalls, status: cancelled ? 'cancelled' : 'error', error: cancelled ? null : 'stream ended unexpectedly', metrics }) ?? assistant
        }
      }
      yield { type: 'message', message: repos.messages.get(assistant.id) ?? assistant }
      repos.conversations.touch(conv.id)
      yield { type: 'conversation', conversation: repos.conversations.get(conv.id) ?? conv }
    } finally {
      this.active.delete(conv0.id)
    }
  }
}
