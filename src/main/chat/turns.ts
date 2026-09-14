import type { ChatStreamEvent, ChatToolDefinition, GenieRequestOptions, SamplerSettings } from '@shared/api'
import type { Conversation, KnowledgeOptions, MessageMetrics, StoredMessage } from '@shared/chat'
import type { KnowledgeHit } from '@shared/sidecar'
import { KnowledgeService } from '../knowledge/service'
import type { AppContext } from '../server/context'
import { assemblePrompt } from './prompt'
import { clampMaxTokens, CONTEXT_MARGIN, isContextOverflowCode, MIN_MAX_TOKENS } from './context'
import { findInstalled, pickAutoModel } from '../geniex/select'

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
  /** Retrieval over Knowledge sources for this turn (falls back to the conversation's saved setting). */
  knowledge?: KnowledgeOptions
}

export type TurnEvent =
  | ChatStreamEvent
  | { type: 'message'; message: StoredMessage }
  | { type: 'conversation'; conversation: Conversation }
  | { type: 'prompt'; estimatedTokens: number; contextTokens: number; maxTokens: number; droppedHistory: number; droppedSections: string[]; imagesStripped: number }
  | { type: 'citations'; hits: KnowledgeHit[]; error?: string }

const QAIRT_CONTEXT = 4096

/** Studio refuses to talk to a CLI older than MIN_GENIEX_VERSION rather than carry two protocol variants. */
export function cliVersionGateError(ctx: AppContext): string | null {
  const st = ctx.genie.status()
  if (st.cliVersionOk === false) {
    return `GenieX CLI ${st.cliVersion} is older than the ${st.requiredCliVersion} this version of Studio needs. Run "geniex update" (or reinstall from geniex.aihub.qualcomm.com) and restart the server.`
  }
  return null
}

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
    const { repos, settings, models, client, contextTracker } = this.ctx
    const conv0 = repos.conversations.get(req.conversationId)
    if (!conv0) {
      yield { type: 'error', message: 'conversation not found', status: 404 }
      return
    }
    if (this.active.has(conv0.id)) {
      yield { type: 'error', message: 'a turn is already running for this conversation', status: 409 }
      return
    }
    const gate = cliVersionGateError(this.ctx)
    if (gate) {
      yield { type: 'error', message: gate, status: 428 }
      return
    }
    const ac = new AbortController()
    this.active.set(conv0.id, ac)

    try {
      // ---------------------------------------------------------- resolve model
      const installed = await models.list().catch(() => [])
      const s = settings.get()
      const crashed = this.ctx.genie.crashLog.all()
      // Never auto-walk into a model that already killed the runtime here (see pickAutoModel).
      let model = req.model ?? conv0.model ?? pickAutoModel(installed, { crashed, preferred: s.defaults.chatModel })
      if (!model) {
        yield { type: 'error', message: 'No model available. Pull a model from the Models page first.', status: 400 }
        return
      }
      if (!findInstalled(installed, model) && installed.length) {
        // A stale saved model — fall back to the best healthy one and persist.
        model = pickAutoModel(installed, { crashed, preferred: s.defaults.chatModel }) ?? model
      }
      const modelInfo = findInstalled(installed, model)
      const isVlm = modelInfo?.type === 'vlm'
      const isQairt = modelInfo?.runtime === 'qairt'
      const runtime = modelInfo ? (isQairt ? 'qairt' : 'llama_cpp') : null

      // ---------------------------------------------------------- persist conversation-level changes
      let conv = conv0
      const patch: Partial<Conversation> = {}
      if (model !== conv.model) patch.model = model
      if (req.systemPrompt !== undefined && req.systemPrompt !== conv.systemPrompt) patch.systemPrompt = req.systemPrompt
      if (req.persist && (req.sampler || req.options)) patch.settings = { ...conv.settings, ...(req.sampler ? { sampler: req.sampler } : {}), ...(req.options ? { options: req.options } : {}) }
      if (req.knowledge && JSON.stringify(req.knowledge) !== JSON.stringify(conv.settings.knowledge)) patch.settings = { ...(patch.settings ?? conv.settings), knowledge: req.knowledge }
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
      const wantThink = options.enable_think ?? conv.settings.enableThink ?? s.defaults.enableThink
      options.enable_think = wantThink
      if (!isQairt && options.compute === undefined) options.compute = s.defaults.computeGguf
      // QAIRT Qwen3 bundles ignore enable_think=false and put the thinking into `content`. Asking for thinking and
      // routing it to reasoning_content (then hiding it) is the only way to keep it out of the answer.
      const suppressReasoning = isQairt && !wantThink
      if (isQairt) {
        options.enable_think = true
        // QAIRT bundles ignore nctx/ngl/spec_* and always run on the NPU; sending compute would be coerced anyway.
        delete options.compute
        delete options.nctx
        delete options.ngl
        delete options.spec_type
        delete options.spec_draft_model
      }
      const contextTokens = isQairt ? QAIRT_CONTEXT : (options.nctx ?? s.genie.nctx)
      const maxTokens = sampler.max_tokens ?? 2048
      const tokenFactor = contextTracker.factorFor(conv.id)

      // ---------------------------------------------------------- knowledge retrieval (RAG)
      const extraSections = [...(req.extraSections ?? [])]
      let citations: KnowledgeHit[] | null = null
      const kn = req.knowledge ?? conv.settings.knowledge
      if (kn?.enabled && this.ctx.knowledge.hasReadySources()) {
        const lastUser = [...history].reverse().find((m) => m.role === 'user')
        const query = typeof lastUser?.content === 'string' ? lastUser.content : (lastUser?.content ?? []).map((p) => (p.type === 'text' ? p.text : '')).join(' ')
        try {
          const hits = await this.ctx.knowledge.search(query, { topK: kn.topK ?? 6, sourceIds: kn.sourceIds })
          if (hits.length) {
            citations = hits
            // Budget the excerpts to ~a third of the window so history survives on 4k models.
            extraSections.push({ label: 'knowledge', text: KnowledgeService.formatSection(hits, Math.max(1500, Math.floor(contextTokens * 4 * 0.3))), droppable: true })
            yield { type: 'citations', hits }
          }
        } catch (err) {
          // non-fatal: answer without excerpts, but tell the UI why
          yield { type: 'citations', hits: [], error: `Knowledge search failed: ${err instanceof Error ? err.message : String(err)}` }
        }
      }

      const assembled = assemblePrompt(history, {
        systemPrompt: req.systemPrompt !== undefined ? req.systemPrompt : (conv.systemPrompt ?? s.defaults.systemPrompt),
        contextTokens,
        maxTokens: Math.min(maxTokens, Math.floor(contextTokens / 2)),
        vision: !!isVlm,
        // llama.cpp VLMs see media on every message (and keep the KV cache); QAIRT VLMs are untested → last only.
        mediaHistory: !!isVlm && !isQairt,
        extraSections,
        tokenFactor,
      })
      if (citations && assembled.droppedSections.includes('knowledge')) citations = null
      // Nothing left to trim and still over the window: refuse rather than let the NPU backend abort.
      if (assembled.estimatedTokens + MIN_MAX_TOKENS + CONTEXT_MARGIN > contextTokens) {
        yield { type: 'error', message: `This message is too long for the model's context window (≈${assembled.estimatedTokens} of ${contextTokens} tokens with the system prompt). Shorten it, or raise the context window for GGUF models in Settings → GenieX server.`, code: 'context_length_exceeded', status: 413 }
        return
      }
      // Never let generation run past the window: on the NPU that kills the server (see ContextTracker).
      const maxTokensForRequest = clampMaxTokens(contextTokens, assembled.estimatedTokens, maxTokens)
      yield { type: 'prompt', estimatedTokens: assembled.estimatedTokens, contextTokens, maxTokens: maxTokensForRequest, droppedHistory: assembled.droppedHistory, droppedSections: assembled.droppedSections, imagesStripped: assembled.imagesStripped }

      // ---------------------------------------------------------- assistant placeholder
      let assistant = repos.messages.insert({ conversationId: conv.id, role: 'assistant', content: '', reasoning: null, toolCalls: null, toolCallId: null, name: null, model, status: 'streaming', error: null, metrics: null })
      yield { type: 'message', message: assistant }

      // ---------------------------------------------------------- stream
      let content = ''
      let reasoning = ''
      /** Reasoning the user asked not to see (QAIRT ignores enable_think=false). Kept in case the model stops without an answer. */
      let hiddenReasoning = ''
      let toolCalls: StoredMessage['toolCalls'] = null
      const metrics: MessageMetrics = { compute: options.compute ?? (isQairt ? 'npu' : null), citations, specType: !isQairt && options.spec_type ? options.spec_type : null }
      let finished = false
      let lastFlush = Date.now()

      const flush = (status: StoredMessage['status'] = 'streaming'): void => {
        assistant = repos.messages.update(assistant.id, { content, reasoning: reasoning || null, toolCalls, status, metrics }) ?? assistant
      }

      try {
        const stream = client.chatStream({ model, messages: assembled.messages, tools: req.tools, sampler: { ...sampler, max_tokens: maxTokensForRequest }, options, conversationId: conv.id, runtime }, ac.signal)
        for await (const ev of stream) {
          switch (ev.type) {
            case 'delta': {
              if (ev.content) content += ev.content
              if (ev.reasoning && suppressReasoning) hiddenReasoning += ev.reasoning
              else if (ev.reasoning) reasoning += ev.reasoning
              if (Date.now() - lastFlush > 1500) {
                flush()
                lastFlush = Date.now()
              }
              if (suppressReasoning && !ev.content) continue // drop reasoning-only deltas the user asked not to see
              yield suppressReasoning ? { type: 'delta', content: ev.content } : ev
              continue
            }
            case 'model-ready':
              metrics.loadMs = ev.loadMs
              break
            case 'tool_calls':
              toolCalls = ev.tool_calls
              break
            case 'usage':
              metrics.promptTokens = ev.prompt_tokens
              metrics.completionTokens = ev.completion_tokens
              if (ev.accepted !== undefined) {
                metrics.acceptedTokens = ev.accepted
                metrics.rejectedTokens = ev.rejected ?? 0
              }
              contextTracker.observe(conv.id, assembled.rawTokens, ev.prompt_tokens)
              break
            case 'done':
              metrics.ttftMs = ev.ttftMs
              metrics.totalMs = ev.totalMs
              metrics.tokensPerSecond = ev.tokensPerSecond
              metrics.completionTokens = metrics.completionTokens ?? ev.completionTokens
              metrics.finishReason = ev.finish_reason
              finished = true
              if (!content.trim() && hiddenReasoning.trim() && ev.finish_reason !== 'cancelled') {
                // Small QAIRT models sometimes stop right after the think block: better the thoughts than a blank bubble.
                content = hiddenReasoning.trim()
                yield { type: 'delta', content }
              }
              flush(ev.finish_reason === 'cancelled' ? 'cancelled' : 'complete')
              break
            case 'error': {
              finished = true
              // The estimate was wrong: pad harder for the rest of this conversation so the next turn fits.
              if (isContextOverflowCode(ev.code)) contextTracker.bump(conv.id)
              assistant = repos.messages.update(assistant.id, { content, reasoning: reasoning || null, status: 'error', error: ev.message, metrics }) ?? assistant
              break
            }
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
