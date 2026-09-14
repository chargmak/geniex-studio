import { randomUUID } from 'node:crypto'
import type {
  ChatMessage,
  ChatRequestBody,
  ChatStreamEvent,
  ChatToolCall,
  CompletionRequestBody,
  GenieRequestOptions,
  SamplerSettings,
} from '@shared/api'
import type { Runtime } from '@shared/config'
import { runtimeOfModel } from '@shared/modelSelect'
import type { SettingsStore } from '../settings'
import { isContextOverflowCode } from '../chat/context'
import { parseSse, readAllText, sniffBody } from '../util/sse'
import type { GenieXSupervisor } from './supervisor'

export class GenieXHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string | number,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'GenieXHttpError'
  }
}

interface UpstreamChunk {
  choices?: {
    index?: number
    delta?: {
      role?: string
      content?: string | null
      reasoning_content?: string | null
      reasoning?: string | null
      tool_calls?: { index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }[]
    }
    finish_reason?: string | null
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    completion_tokens_details?: { accepted_prediction_tokens?: number; rejected_prediction_tokens?: number }
  }
  error?: unknown
  code?: number | string
}

/**
 * Serialises requests (GenieX holds one global mutex anyway; queuing here gives accurate busy/queue state and
 * lets queued requests be cancelled before they hit the server).
 */
class Gate {
  private tail: Promise<void> = Promise.resolve()
  depth = 0
  active = 0
  async run<T>(fn: () => Promise<T>, signal?: AbortSignal, onState?: () => void): Promise<T> {
    this.depth++
    onState?.()
    let release!: () => void
    const mine = new Promise<void>((r) => (release = r))
    const prev = this.tail
    this.tail = prev.then(() => mine)
    let started = false
    try {
      await prev
      if (signal?.aborted) throw new DOMException('Cancelled before start', 'AbortError')
      started = true
      this.depth--
      this.active++
      onState?.()
      return await fn()
    } finally {
      if (started) this.active--
      else this.depth--
      release()
      onState?.()
    }
  }
}

function optionsKey(model: string, o: GenieRequestOptions | undefined, defaults: { nctx: number; ngl: number; compute: string | null }): string {
  return [
    model,
    o?.nctx ?? defaults.nctx,
    o?.ngl ?? defaults.ngl,
    o?.compute ?? defaults.compute ?? '',
    o?.spec_type ?? '',
    o?.spec_draft_model ?? '',
    o?.spec_n_max ?? '',
    o?.spec_n_min ?? '',
    o?.spec_p_min ?? '',
  ].join('|')
}

function defined<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v
  return out
}

/** Strip Studio-only fields before sending messages upstream. */
function sanitizeMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    const { reasoning: _reasoning, ...rest } = m
    void _reasoning
    return rest
  })
}

/** Human explanation for a runtime crash, by what the supervisor saw in the log before the exit. */
export function explainRuntimeCrash(model: string | null, code: string, kind: 'model' | 'context_overflow' | 'unknown' = 'model'): string {
  if (kind === 'context_overflow') {
    return (
      `The context window overflowed while ${model ?? 'the model'} was running on the NPU, and GenieX's llama.cpp backend aborted ` +
      `instead of trimming (a GenieX bug: context shifts cannot run on the Hexagon backend). The server has been restarted and nothing ` +
      `was recorded against the model. Studio will pad its token estimate for this conversation; you can also raise the context window ` +
      `(Settings > GenieX server) or lower "Max tokens".`
    )
  }
  const head = `GenieX runtime crashed while loading ${model ?? 'the model'} (exit ${code}).`
  const isAiHub = !!model && /^(qualcomm|ai-hub-models)[/]/i.test(model)
  if (isAiHub) {
    return `${head} The server has been restarted. If this AI Hub bundle keeps crashing, check for a GenieX CLI update (geniex update) and a newer Qualcomm NPU driver, or use a GGUF Q4_0 model.`
  }
  return `${head} The server has been restarted; try again, a smaller quantisation, or compute "cpu".`
}

export interface TelemetrySample {
  model: string
  compute: string | null
  ttftMs: number | null
  totalMs: number | null
  promptTokens: number | null
  completionTokens: number | null
  tokensPerSecond: number | null
  loadMs: number | null
  finishReason: string | null
  conversationId: string | null
}

export class GenieXClient {
  private gate = new Gate()
  private residentKey: string | null = null
  /** Set by bootstrap to persist per-request performance samples. */
  recorder: ((s: TelemetrySample) => void) | null = null

  constructor(
    private readonly sup: GenieXSupervisor,
    private readonly settings: SettingsStore,
  ) {
    sup.on('state', (s) => {
      if (s !== 'running') this.residentKey = null
    })
  }

  private get base(): string {
    return this.sup.baseUrl
  }

  private syncGate(): void {
    this.sup.busy = this.gate.active > 0
    this.sup.queueDepth = this.gate.depth
    this.sup.emit('status')
  }

  private async ensureRunning(): Promise<void> {
    if (!this.sup.isRunning) await this.sup.start()
  }

  // ------------------------------------------------------------ models

  async listModels(signal?: AbortSignal): Promise<{ id: string; owned_by: string }[]> {
    await this.ensureRunning()
    const res = await fetch(`${this.base}/v1/models`, { signal: signal ?? AbortSignal.timeout(10_000) })
    if (!res.ok) throw new GenieXHttpError(`GET /v1/models failed: ${res.status}`, res.status)
    const json = (await res.json()) as { data?: { id: string; owned_by?: string }[] }
    return (json.data ?? []).map((m) => ({ id: m.id, owned_by: m.owned_by ?? '' }))
  }

  // ------------------------------------------------------------ request building

  private buildBody(body: ChatRequestBody, stream: boolean): Record<string, unknown> {
    const d = this.settings.get()
    const s: SamplerSettings = { ...d.defaults.sampler, ...(body.sampler ?? {}) }
    const o = body.options ?? {}
    const maxTokens = s.max_tokens ?? 2048
    return {
      model: body.model,
      messages: sanitizeMessages(body.messages),
      ...(body.tools?.length ? { tools: body.tools } : {}),
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      // Both spellings are read (max_tokens was re-honoured in v0.6.0); sending both is harmless.
      max_tokens: maxTokens,
      max_completion_tokens: maxTokens,
      ...defined({
        temperature: s.temperature,
        top_p: s.top_p,
        top_k: s.top_k,
        min_p: s.min_p,
        repetition_penalty: s.repetition_penalty,
        presence_penalty: s.presence_penalty,
        frequency_penalty: s.frequency_penalty,
        seed: s.seed,
        enable_think: o.enable_think ?? d.defaults.enableThink,
        reasoning_format: 'auto',
        compute: o.compute,
        nctx: o.nctx,
        ngl: o.ngl,
        spec_type: o.spec_type,
        spec_draft_model: o.spec_draft_model,
        spec_n_max: o.spec_n_max,
        spec_n_min: o.spec_n_min,
        spec_p_min: o.spec_p_min,
      }),
    }
  }

  /** GenieX >= 0.6 detects conversation continuation from the messages themselves; no cache header exists any more. */
  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' }
  }

  /**
   * llama.cpp cannot open its Hexagon session once a QAIRT bundle has been loaded in the same `geniex serve`
   * process (v0.6.1). Studio owns the process, so switching QAIRT -> GGUF means restarting it first.
   * Returns true when a restart happened.
   */
  private async prepareRuntime(model: string, runtime: Runtime | null | undefined, onRestart?: (reason: string) => void): Promise<boolean> {
    const rt = runtime ?? runtimeOfModel(model)
    let restarted = false
    if (rt === 'llama_cpp' && this.sup.qairtLoadedSinceStart && this.sup.managedRunning) {
      const reason = 'Restarting GenieX: a QAIRT model was loaded in this server process and GGUF models cannot follow it without a restart.'
      this.sup.log('studio', reason)
      onRestart?.(reason)
      try {
        await this.sup.restart()
      } catch (err) {
        // The old process can take a moment to release the port; one more try before giving up.
        this.sup.log('studio', `restart failed once (${err instanceof Error ? err.message : String(err)}); retrying`)
        await new Promise((r) => setTimeout(r, 1500))
        await this.sup.start()
      }
      this.residentKey = null
      restarted = true
    }
    this.sup.noteRuntime(rt)
    return restarted
  }

  private async readError(res: Response): Promise<GenieXHttpError> {
    const text = await res.text().catch(() => '')
    let message = text || res.statusText
    let code: string | number | undefined
    let parsed: unknown = text
    try {
      parsed = JSON.parse(text)
      const e = (parsed as { error?: unknown; code?: string | number }).error
      if (typeof e === 'string') message = e
      else if (e && typeof e === 'object') {
        message = (e as { message?: string }).message ?? message
        code = (e as { code?: string | number }).code
      }
      code = code ?? (parsed as { code?: string | number }).code
    } catch {
      /* plain text */
    }
    if (isContextOverflowCode(code)) {
      code = 'context_length_exceeded'
      message = "The prompt is longer than the model's context window."
    }
    return new GenieXHttpError(message, res.status, code, parsed)
  }

  // ------------------------------------------------------------ warm-up (explicit model load)

  /**
   * Loads a model by sending an empty chat (undocumented but what `geniex run` does). Runs the same
   * nctx/ngl/compute/spec_* as the real request so the server's cache key matches and no second reload happens.
   */
  async warmUp(model: string, options?: GenieRequestOptions, signal?: AbortSignal, runtime?: Runtime | null): Promise<number> {
    await this.ensureRunning()
    await this.prepareRuntime(model, runtime)
    // Restore rather than clear on the way out: chatStream sets activeModel before calling us and still needs it
    // for crash attribution during the generation that follows. A standalone warm-up must not leave it dangling,
    // or an unrelated later exit would be blamed on this model.
    const previousActive = this.sup.activeModel
    this.sup.activeModel = model
    const started = Date.now()
    const body = this.buildBody({ model, messages: [], options }, false)
    body.max_tokens = 1
    body.max_completion_tokens = 1
    const res = await fetch(`${this.base}/v1/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) throw await this.readError(res)
    await res.text().catch(() => '')
    // Only on success — a failure here may be the runtime dying, and the exit handler still needs activeModel
    // to attribute the crash to this model.
    this.sup.activeModel = previousActive
    const key = optionsKey(model, options, this.serveDefaults())
    this.residentKey = key
    this.sup.residentModel = model
    this.sup.residentSince = Date.now()
    this.sup.emit('status')
    return Date.now() - started
  }

  /**
   * A dropped connection during a request almost always means `geniex serve` died (access violation while a
   * QAIRT bundle initialised on the NPU). Give the crash a proper name; the supervisor auto-restarts.
   */
  private async translateFailure(err: unknown, model: string): Promise<unknown> {
    const e = err as Error & { cause?: { code?: string }; name?: string }
    if (e?.name === 'AbortError') return err
    // Stopping the server ourselves (Stop button, restart, app quit) drops any in-flight connection. That is not a
    // model crash, and blaming the in-flight model would permanently blacklist it in runtime-crashes.json.
    if (this.sup.stoppedIntentionally) return err
    const connDropped =
      /fetch failed|ECONNRESET|ECONNREFUSED|socket hang up|terminated|other side closed/i.test(e?.message ?? '') ||
      /ECONNRESET|ECONNREFUSED|UND_ERR_SOCKET/i.test(e?.cause?.code ?? '')
    if (!connDropped) return err
    // Give the process a moment to report its exit so we can attribute it.
    for (let i = 0; i < 20 && this.sup.isRunning && !this.sup.lastCrash; i++) await new Promise((r) => setTimeout(r, 100))
    const crash = this.sup.lastCrash
    const recent = crash && Date.now() - crash.at < 30_000
    if (recent || !this.sup.isRunning) {
      this.residentKey = null
      const code = recent ? crash!.code : 'connection lost'
      const kind = recent ? crash!.kind : this.sup.overflowSeenRecently ? 'context_overflow' : 'model'
      if (!recent && kind === 'model') {
        // Attribute the loss to this model even if the exit event hasn't fired yet.
        this.sup.crashedModels.set(model, this.sup.crashLog.record(model, code, this.sup.cliVersion))
      }
      return new GenieXHttpError(explainRuntimeCrash(model, code, kind), 502, kind === 'context_overflow' ? 'context_overflow' : 'runtime_crash')
    }
    return err
  }

  private serveDefaults(): { nctx: number; ngl: number; compute: string | null } {
    const g = this.settings.get().genie
    return { nctx: g.nctx, ngl: g.ngl, compute: g.compute }
  }

  // ------------------------------------------------------------ chat (streaming)

  async *chatStream(body: ChatRequestBody, signal?: AbortSignal): AsyncGenerator<ChatStreamEvent> {
    const requestId = randomUUID()
    const events: ChatStreamEvent[] = []
    let resolveNext: (() => void) | null = null
    let finished = false
    let failure: unknown = null
    const push = (e: ChatStreamEvent): void => {
      events.push(e)
      resolveNext?.()
      resolveNext = null
    }

    const work = this.gate
      .run(
        async () => {
          await this.ensureRunning()
          push({ type: 'start', model: body.model, requestId, at: Date.now() })
          await this.prepareRuntime(body.model, body.runtime, (reason) => push({ type: 'runtime-restart', reason }))
          this.sup.activeModel = body.model

          // Explicit load when the resident model/options differ so the UI can show a proper "loading" state.
          const key = optionsKey(body.model, body.options, this.serveDefaults())
          let loadMs: number | null = null
          if (this.residentKey !== key) {
            push({ type: 'model-loading', model: body.model })
            loadMs = await this.warmUp(body.model, body.options, signal, body.runtime)
            push({ type: 'model-ready', model: body.model, loadMs })
          }

          const sentAt = Date.now()
          let firstTokenAt: number | null = null
          let lastTokenAt: number | null = null
          let completionTokensSeen = 0
          let usageCompletion: number | null = null
          let usagePrompt: number | null = null
          let finish: string | null = null
          const toolAcc = new Map<number, ChatToolCall>()

          const res = await fetch(`${this.base}/v1/chat/completions`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(this.buildBody(body, true)),
            signal,
          })
          if (!res.ok || !res.body) throw await this.readError(res)

          // GenieX sometimes omits Content-Type on streaming responses; sniff the body instead of trusting headers.
          const sniffed = await sniffBody(res.body)
          if (sniffed.kind === 'json') {
            // Non-streaming JSON answer (some tool-call paths return a full object).
            const json = JSON.parse(await readAllText(sniffed.stream)) as {
              choices?: { message?: { content?: string; reasoning_content?: string; tool_calls?: ChatToolCall[] }; finish_reason?: string }[]
              usage?: UpstreamChunk['usage']
            }
            const ch = json.choices?.[0]
            if (ch?.message?.reasoning_content) push({ type: 'delta', reasoning: ch.message.reasoning_content })
            if (ch?.message?.content) push({ type: 'delta', content: ch.message.content })
            if (ch?.message?.tool_calls?.length) push({ type: 'tool_calls', tool_calls: ch.message.tool_calls })
            if (json.usage) {
              usageCompletion = json.usage.completion_tokens ?? null
              usagePrompt = json.usage.prompt_tokens ?? null
              push({
                type: 'usage',
                prompt_tokens: json.usage.prompt_tokens ?? 0,
                completion_tokens: json.usage.completion_tokens ?? 0,
                total_tokens: json.usage.total_tokens ?? 0,
              })
            }
            finish = ch?.finish_reason ?? 'stop'
          } else if (sniffed.kind === 'empty') {
            finish = 'stop'
          } else {
            for await (const payload of parseSse(sniffed.stream, signal)) {
              if (payload === '[DONE]') break
              let chunk: UpstreamChunk
              try {
                chunk = JSON.parse(payload) as UpstreamChunk
              } catch {
                continue
              }
              if (chunk.error !== undefined) {
                const e = chunk.error
                let message = typeof e === 'string' ? e : ((e as { message?: string })?.message ?? JSON.stringify(e))
                let code = (e as { code?: string | number })?.code ?? chunk.code
                // A streamed overflow arrives as an SDK code (-200103 "Input prompt too long"), not as the 400 body.
                if (isContextOverflowCode(code)) {
                  code = 'context_length_exceeded'
                  message = "The prompt is longer than the model's context window."
                }
                throw new GenieXHttpError(message, 200, code, chunk)
              }
              const now = Date.now()
              const choice = chunk.choices?.[0]
              const delta = choice?.delta
              if (delta) {
                const reasoning = delta.reasoning_content ?? delta.reasoning ?? undefined
                const content = delta.content ?? undefined
                if (reasoning || content) {
                  if (firstTokenAt === null) firstTokenAt = now
                  lastTokenAt = now
                  completionTokensSeen++
                  push({ type: 'delta', ...(content ? { content } : {}), ...(reasoning ? { reasoning } : {}) })
                }
                if (delta.tool_calls?.length) {
                  if (firstTokenAt === null) firstTokenAt = now
                  lastTokenAt = now
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0
                    const cur = toolAcc.get(idx) ?? { id: tc.id ?? `call_${randomUUID().slice(0, 8)}`, type: 'function', function: { name: '', arguments: '' } }
                    if (tc.id) cur.id = tc.id
                    if (tc.function?.name) cur.function.name += tc.function.name
                    if (tc.function?.arguments) cur.function.arguments += tc.function.arguments
                    toolAcc.set(idx, cur)
                  }
                }
              }
              if (choice?.finish_reason) finish = choice.finish_reason
              if (chunk.usage) {
                usageCompletion = chunk.usage.completion_tokens ?? null
                usagePrompt = chunk.usage.prompt_tokens ?? null
                push({
                  type: 'usage',
                  prompt_tokens: chunk.usage.prompt_tokens ?? 0,
                  completion_tokens: chunk.usage.completion_tokens ?? 0,
                  total_tokens: chunk.usage.total_tokens ?? 0,
                  ...(chunk.usage.completion_tokens_details?.accepted_prediction_tokens !== undefined
                    ? {
                        accepted: chunk.usage.completion_tokens_details.accepted_prediction_tokens,
                        rejected: chunk.usage.completion_tokens_details.rejected_prediction_tokens ?? 0,
                      }
                    : {}),
                })
              }
            }
          }

          // Aborting mid-stream cancels the body reader, which *ends* the read loop cleanly rather than throwing —
          // so without this check a cancelled turn would be persisted as a normal, complete reply.
          if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')

          if (toolAcc.size) {
            push({ type: 'tool_calls', tool_calls: [...toolAcc.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v) })
            finish = finish ?? 'tool_calls'
          }

          const endAt = Date.now()
          this.residentKey = key
          this.sup.residentModel = body.model
          this.sup.residentSince = this.sup.residentSince ?? endAt
          const completionTokens = usageCompletion ?? (completionTokensSeen || null)
          const decodeMs = firstTokenAt && lastTokenAt && lastTokenAt > firstTokenAt ? lastTokenAt - firstTokenAt : null
          const doneEv = {
            type: 'done' as const,
            finish_reason: finish ?? 'stop',
            ttftMs: firstTokenAt ? firstTokenAt - sentAt : null,
            totalMs: endAt - sentAt,
            completionTokens,
            tokensPerSecond: completionTokens && decodeMs && completionTokens > 1 ? ((completionTokens - 1) / decodeMs) * 1000 : null,
          }
          push(doneEv)
          try {
            this.recorder?.({
              model: body.model,
              compute: body.options?.compute ?? this.serveDefaults().compute ?? null,
              ttftMs: doneEv.ttftMs,
              totalMs: doneEv.totalMs,
              promptTokens: usagePrompt,
              completionTokens,
              tokensPerSecond: doneEv.tokensPerSecond,
              loadMs,
              finishReason: doneEv.finish_reason,
              conversationId: body.conversationId ?? null,
            })
          } catch {
            /* telemetry must never break a turn */
          }
        },
        signal,
        () => this.syncGate(),
      )
      .catch(async (err: unknown) => {
        failure = await this.translateFailure(err, body.model)
      })
      .finally(() => {
        this.sup.activeModel = null
        finished = true
        resolveNext?.()
        resolveNext = null
      })

    try {
      while (true) {
        while (events.length) yield events.shift()!
        if (finished) break
        await new Promise<void>((r) => (resolveNext = r))
      }
      while (events.length) yield events.shift()!
      if (failure) {
        const err = failure as Error & { status?: number; code?: string | number }
        const cancelled = err?.name === 'AbortError' || signal?.aborted
        yield cancelled
          ? { type: 'done', finish_reason: 'cancelled', ttftMs: null, totalMs: 0, completionTokens: null, tokensPerSecond: null }
          : { type: 'error', message: err?.message ?? String(failure), code: err?.code, status: err?.status }
      }
    } finally {
      await work
    }
  }

  // ------------------------------------------------------------ raw completions (FIM / continuation)

  async completions(body: CompletionRequestBody, signal?: AbortSignal): Promise<{ text: string; finish_reason: string | null; usage: unknown }> {
    return this.gate.run(
      async () => {
        await this.ensureRunning()
        const d = this.settings.get()
        const s: SamplerSettings = { ...d.defaults.sampler, ...(body.sampler ?? {}) }
        const o = body.options ?? {}
        await this.prepareRuntime(body.model, null)
        const res = await fetch(`${this.base}/v1/completions`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({
            model: body.model,
            prompt: body.prompt,
            stream: false,
            max_tokens: s.max_tokens ?? 256,
            ...defined({
              temperature: s.temperature,
              top_p: s.top_p,
              top_k: s.top_k,
              min_p: s.min_p,
              repetition_penalty: s.repetition_penalty,
              seed: s.seed,
              stop: body.stop,
              compute: o.compute,
              nctx: o.nctx,
              ngl: o.ngl,
            }),
          }),
          signal,
        })
        if (!res.ok) throw await this.readError(res)
        const json = (await res.json()) as { choices?: { text?: string; finish_reason?: string }[]; usage?: unknown }
        this.sup.residentModel = body.model
        return { text: json.choices?.[0]?.text ?? '', finish_reason: json.choices?.[0]?.finish_reason ?? null, usage: json.usage ?? null }
      },
      signal,
      () => this.syncGate(),
    )
  }
}
