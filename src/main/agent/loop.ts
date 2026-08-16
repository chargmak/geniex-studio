import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { ChatToolCall, GenieRequestOptions, SamplerSettings } from '@shared/api'
import type { AgentEvent, RunSummary, ToolRisk } from '@shared/agent'
import type { KnowledgeOptions, StoredMessage } from '@shared/chat'
import type { KnowledgeHit } from '@shared/sidecar'
import { KnowledgeService } from '../knowledge/service'
import type { AppContext } from '../server/context'
import { assemblePrompt } from '../chat/prompt'
import { buildToolset } from './registry'
import { pickAutoModel } from '../geniex/select'
import { toChatTool, type Tool } from './tools/types'

export interface AgentRunRequest {
  conversationId: string
  userText: string
  attachmentIds?: string[]
  model?: string
  sampler?: SamplerSettings
  options?: GenieRequestOptions
  families?: string[]
  knowledge?: KnowledgeOptions
}

const QAIRT_CONTEXT = 4096

function agentInstructions(workspaceRoot: string, tools: Tool[], extra: string): string {
  const list = tools.map((t) => `- ${t.name}: ${t.description.split('. ')[0]}`).join('\n')
  return [
    `You are an autonomous assistant with tools, running locally on a Windows (Snapdragon) machine.`,
    `Workspace folder: ${workspaceRoot} — all file paths are relative to it. Shell = PowerShell.`,
    `Rules: call ONE tool at a time and wait for its result. Use tools when you need real information or to change files; do not guess file contents. When the task is complete, reply with a plain final answer (no tool call). Keep answers concise. Never invent tool results.`,
    `Available tools:\n${list}`,
    extra.trim() ? `Additional instructions:\n${extra.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Try hard to turn model-produced argument text into an object. Repairs are cumulative (fence → commas → quotes → keys). */
export function parseToolArgs(raw: string | undefined | null): { args: Record<string, unknown>; repaired: boolean; error?: string } {
  if (!raw || !raw.trim()) return { args: {}, repaired: false }
  const tryParse = (text: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(text) as unknown
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  const direct = tryParse(raw)
  if (direct) return { args: direct, repaired: false }
  const steps: ((t: string) => string)[] = [
    (t) => t.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim(),
    (t) => t.replace(/,\s*([}\]])/g, '$1'),
    (t) => t.replace(/'/g, '"'),
    (t) => t.replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":'),
  ]
  let cur = raw
  for (const step of steps) {
    cur = step(cur)
    const v = tryParse(cur)
    if (v) return { args: v, repaired: true }
  }
  // Salvage the first {...} block from the repaired text
  const m = cur.match(/\{[\s\S]*\}/)
  if (m) {
    const v = tryParse(m[0])
    if (v) return { args: v, repaired: true }
  }
  return { args: {}, repaired: false, error: 'arguments were not valid JSON' }
}

/** Fallback for models that print a tool call in text instead of the parsed field. */
export function extractInlineToolCall(text: string, known: Set<string>): ChatToolCall | null {
  const candidates: string[] = []
  const tag = text.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i)
  if (tag) candidates.push(tag[1])
  const fence = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i)
  if (fence) candidates.push(fence[1])
  const bare = text.match(/\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*\}\s*\}/)
  if (bare) candidates.push(bare[0])
  for (const c of candidates) {
    try {
      const v = JSON.parse(c) as { name?: string; arguments?: unknown; parameters?: unknown }
      const name = v?.name
      if (typeof name === 'string' && known.has(name)) {
        const args = v.arguments ?? v.parameters ?? {}
        return { id: `call_${randomUUID().slice(0, 8)}`, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } }
      }
    } catch {
      /* next */
    }
  }
  return null
}

export function defaultWorkspaceRoot(): string {
  const p = join(homedir(), 'GenieX Studio Workspace')
  mkdirSync(p, { recursive: true })
  return p
}

/** Multi-turn tool loop on top of GenieX's OpenAI-style tool calling (one call per assistant turn). */
export class AgentRunner {
  private active = new Map<string, { ac: AbortController; conversationId: string; run: RunSummary }>()

  constructor(private readonly ctx: AppContext) {}

  isRunning(conversationId: string): boolean {
    return [...this.active.values()].some((a) => a.conversationId === conversationId)
  }

  runFor(conversationId: string): RunSummary | null {
    return [...this.active.values()].find((a) => a.conversationId === conversationId)?.run ?? null
  }

  cancel(idOrConversation: string): boolean {
    let hit = false
    for (const [id, a] of this.active) {
      if (id === idOrConversation || a.conversationId === idOrConversation) {
        a.ac.abort()
        hit = true
      }
    }
    return hit
  }

  private saveRun(run: RunSummary): void {
    this.ctx.db
      .prepare(
        `INSERT INTO runs (id, conversation_id, title, model, status, turns, tool_calls, started_at, finished_at, error, summary)
         VALUES (@id, @conversationId, @title, @model, @status, @turns, @toolCalls, @startedAt, @finishedAt, @error, @summary)
         ON CONFLICT(id) DO UPDATE SET status=excluded.status, turns=excluded.turns, tool_calls=excluded.tool_calls, finished_at=excluded.finished_at, error=excluded.error, summary=excluded.summary, model=excluded.model, title=excluded.title`,
      )
      .run(run)
  }

  private event(runId: string, type: string, payload: unknown): void {
    this.ctx.db.prepare('INSERT INTO run_events (run_id, ts, type, payload_json) VALUES (?, ?, ?, ?)').run(runId, Date.now(), type, JSON.stringify(payload))
  }

  async *run(req: AgentRunRequest): AsyncGenerator<AgentEvent> {
    const { repos, settings, models, client, approvals } = this.ctx
    const conv0 = repos.conversations.get(req.conversationId)
    if (!conv0) {
      yield { type: 'error', message: 'conversation not found', status: 404 }
      return
    }
    if (this.isRunning(conv0.id) || this.ctx.turns.isRunning(conv0.id)) {
      yield { type: 'error', message: 'a run is already active for this conversation', status: 409 }
      return
    }

    const s = settings.get()
    const workspaceRoot = conv0.workspaceRoot ?? s.workspace.root ?? defaultWorkspaceRoot()
    mkdirSync(workspaceRoot, { recursive: true })
    const installed = await models.list().catch(() => [])
    const crashed = this.ctx.genie.crashLog.all()
    let model = req.model ?? conv0.model ?? pickAutoModel(installed, { crashed, preferred: s.defaults.agentModel ?? s.defaults.chatModel })
    if (!model) {
      yield { type: 'error', message: 'No model available. Pull a model first.', status: 400 }
      return
    }
    const info = installed.find((m) => m.requestIds.includes(model!) || m.name === model)
    if (!info && installed.length) model = pickAutoModel(installed, { crashed, preferred: s.defaults.agentModel ?? s.defaults.chatModel }) ?? model
    const modelInfo = installed.find((m) => m.requestIds.includes(model!) || m.name === model)
    const isQairt = modelInfo?.runtime === 'qairt'
    const isVlm = modelInfo?.type === 'vlm'

    const ac = new AbortController()
    const run: RunSummary = {
      id: randomUUID(),
      conversationId: conv0.id,
      title: req.userText.replace(/\s+/g, ' ').slice(0, 80),
      model,
      status: 'running',
      turns: 0,
      toolCalls: 0,
      startedAt: Date.now(),
      finishedAt: null,
      error: null,
      summary: null,
    }
    this.active.set(run.id, { ac, conversationId: conv0.id, run })
    this.saveRun(run)

    try {
      let conv = repos.conversations.update(conv0.id, { mode: 'agent', model, workspaceRoot }) ?? conv0
      const userMsg = repos.messages.insert({ conversationId: conv.id, role: 'user', content: req.userText, reasoning: null, toolCalls: null, toolCallId: null, name: null, model: null, status: 'complete', error: null, metrics: null })
      if (req.attachmentIds?.length) repos.attachments.attachToMessage(req.attachmentIds, userMsg.id)
      yield { type: 'message', message: repos.messages.get(userMsg.id)! }
      if (conv.title === 'New chat' && req.userText.trim()) {
        const t = req.userText.replace(/\s+/g, ' ').slice(0, 64).trim()
        conv = repos.conversations.update(conv.id, { title: t.length < req.userText.length ? `${t}…` : t }) ?? conv
      }
      yield { type: 'conversation', conversation: conv }
      yield { type: 'run-start', run }

      const tools = await buildToolset(this.ctx, { families: req.families, hasVisionModel: installed.some((m) => m.type === 'vlm') })
      const known = new Set(tools.map((t) => t.name))
      const chatTools = tools.map(toChatTool)
      const instructions = agentInstructions(workspaceRoot, tools, s.agent.instructions)
      const maxTurns = Math.max(1, s.agent.maxTurns)

      const sampler: SamplerSettings = { ...s.defaults.sampler, ...(conv.settings.sampler ?? {}), ...(req.sampler ?? {}) }
      const options: GenieRequestOptions = { ...(conv.settings.options ?? {}), ...(req.options ?? {}) }
      if (options.enable_think === undefined) options.enable_think = conv.settings.enableThink ?? s.defaults.enableThink
      if (!isQairt && options.compute === undefined) options.compute = s.defaults.computeGguf
      if (isQairt) {
        delete options.compute
        delete options.nctx
        delete options.ngl
      }
      const contextTokens = isQairt ? QAIRT_CONTEXT : (options.nctx ?? s.genie.nctx)

      // Knowledge retrieval once per run, on the user's request; the excerpts ride along on every turn (droppable).
      const kn = req.knowledge ?? conv.settings.knowledge
      let knowledgeSection: { label: string; text: string; droppable: boolean } | null = null
      let citations: KnowledgeHit[] | null = null
      if (kn?.enabled && this.ctx.knowledge.hasReadySources()) {
        try {
          const hits = await this.ctx.knowledge.search(req.userText, { topK: kn.topK ?? 6, sourceIds: kn.sourceIds })
          if (hits.length) {
            citations = hits
            knowledgeSection = { label: 'knowledge', text: KnowledgeService.formatSection(hits, Math.max(1500, Math.floor(contextTokens * 4 * 0.25))), droppable: true }
            yield { type: 'citations', hits }
          }
        } catch (err) {
          yield { type: 'citations', hits: [], error: `Knowledge search failed: ${err instanceof Error ? err.message : String(err)}` }
        }
      }

      for (let turn = 1; turn <= maxTurns; turn++) {
        if (ac.signal.aborted) break
        run.turns = turn
        this.saveRun(run)
        yield { type: 'turn', index: turn, maxTurns }

        const history = repos.messages.list(conv.id)
        const assembled = assemblePrompt(history, {
          systemPrompt: conv.systemPrompt ?? s.defaults.systemPrompt,
          contextTokens,
          maxTokens: Math.min(sampler.max_tokens ?? 2048, Math.floor(contextTokens / 2)),
          vision: !!isVlm,
          extraSections: [{ label: 'agent', text: instructions, droppable: false }, ...(knowledgeSection ? [knowledgeSection] : [])],
        })
        yield { type: 'prompt', estimatedTokens: assembled.estimatedTokens, contextTokens, droppedHistory: assembled.droppedHistory, droppedSections: assembled.droppedSections, imagesStripped: assembled.imagesStripped }

        let assistant = repos.messages.insert({ conversationId: conv.id, role: 'assistant', content: '', reasoning: null, toolCalls: null, toolCallId: null, name: null, model, status: 'streaming', error: null, metrics: null })
        yield { type: 'message', message: assistant }

        let content = ''
        let reasoning = ''
        let toolCalls: ChatToolCall[] = []
        const metrics: StoredMessage['metrics'] = { compute: options.compute ?? (isQairt ? 'npu' : null), citations: turn === 1 && !assembled.droppedSections.includes('knowledge') ? citations : null }
        let streamError: string | null = null
        let finish: string | null = null
        // On the very last turn, force a final answer by withholding tools.
        const toolsForTurn = turn === maxTurns ? undefined : chatTools

        for await (const ev of client.chatStream({ model, messages: assembled.messages, tools: toolsForTurn, sampler, options, conversationId: conv.id }, ac.signal)) {
          switch (ev.type) {
            case 'delta':
              if (ev.content) content += ev.content
              if (ev.reasoning) reasoning += ev.reasoning
              break
            case 'tool_calls':
              toolCalls = ev.tool_calls
              break
            case 'model-ready':
              metrics.loadMs = ev.loadMs
              break
            case 'usage':
              metrics.promptTokens = ev.prompt_tokens
              metrics.completionTokens = ev.completion_tokens
              break
            case 'done':
              metrics.ttftMs = ev.ttftMs
              metrics.totalMs = ev.totalMs
              metrics.tokensPerSecond = ev.tokensPerSecond
              metrics.finishReason = ev.finish_reason
              finish = ev.finish_reason
              break
            case 'error':
              streamError = ev.message
              break
          }
          yield ev
        }

        if (streamError) {
          assistant = repos.messages.update(assistant.id, { content, reasoning: reasoning || null, status: 'error', error: streamError, metrics }) ?? assistant
          yield { type: 'message', message: assistant }
          run.status = 'error'
          run.error = streamError
          break
        }
        if (ac.signal.aborted || finish === 'cancelled') {
          assistant = repos.messages.update(assistant.id, { content, reasoning: reasoning || null, status: 'cancelled', metrics }) ?? assistant
          yield { type: 'message', message: assistant }
          run.status = 'cancelled'
          break
        }

        // Fallback: tool call printed as text.
        if (!toolCalls.length && toolsForTurn) {
          const inline = extractInlineToolCall(content, known)
          if (inline) {
            toolCalls = [inline]
            content = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/i, '').replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/i, '').trim()
          }
        }

        assistant = repos.messages.update(assistant.id, { content, reasoning: reasoning || null, toolCalls: toolCalls.length ? toolCalls : null, status: 'complete', metrics }) ?? assistant
        yield { type: 'message', message: assistant }

        if (!toolCalls.length) {
          run.status = 'done'
          run.summary = content.slice(0, 200)
          break
        }

        // Execute tool calls sequentially (GenieX yields one per turn; handle several defensively).
        for (const call of toolCalls) {
          if (ac.signal.aborted) break
          const tool = tools.find((t) => t.name === call.function.name)
          const parsed = parseToolArgs(call.function.arguments)
          const args = parsed.args
          const summary = tool ? tool.summarize(args) : `Unknown tool ${call.function.name}`
          const risk: ToolRisk = tool?.risk ?? 'exec'
          run.toolCalls++
          yield { type: 'tool-call', callId: call.id, tool: call.function.name, args, summary, risk }
          this.event(run.id, 'tool-call', { callId: call.id, tool: call.function.name, args, summary })

          let ok = false
          let result = ''
          let meta: Record<string, unknown> | undefined
          const started = Date.now()
          if (!tool) {
            result = `Unknown tool "${call.function.name}". Available tools: ${tools.map((t) => t.name).join(', ')}.`
          } else if (parsed.error) {
            result = `Could not parse arguments (${parsed.error}). Send valid JSON matching the tool's parameters.`
          } else {
            const decision = approvals.decide(tool.name, tool.risk, tool.needsApproval(args), summary)
            let allowed = decision === 'allow'
            if (decision === 'ask') {
              run.status = 'waiting_approval'
              this.saveRun(run)
              yield { type: 'run-update', run }
              const request = { runId: run.id, tool: tool.name, risk: tool.risk, args, summary }
              // Emit the request via the approvals center so the route can forward it, and await the answer.
              const pending = approvals.request(request, ac.signal)
              const reqObj = approvals.listPending(run.id).at(-1)!
              yield { type: 'approval-request', request: reqObj }
              const d = await pending
              yield { type: 'approval-decision', requestId: reqObj.id, decision: d }
              this.event(run.id, 'approval', { requestId: reqObj.id, decision: d, tool: tool.name, summary })
              allowed = d === 'allow' || d === 'allow-always'
              run.status = 'running'
              this.saveRun(run)
              yield { type: 'run-update', run }
            }
            if (!allowed) {
              result = decision === 'deny' ? 'This action is blocked by a deny rule.' : 'The user declined this action. Ask for an alternative or explain what you would need.'
            } else {
              try {
                const outputs: string[] = []
                const r = await tool.run(args, {
                  ctx: this.ctx,
                  runId: run.id,
                  conversationId: conv.id,
                  workspaceRoot,
                  signal: ac.signal,
                  onOutput: (chunk) => {
                    outputs.push(chunk)
                  },
                })
                ok = r.ok
                result = r.content
                meta = r.meta
              } catch (err) {
                ok = false
                result = `Tool failed: ${err instanceof Error ? err.message : String(err)}`
              }
            }
          }
          const durationMs = Date.now() - started
          const toolMsg = repos.messages.insert({ conversationId: conv.id, role: 'tool', content: result, reasoning: null, toolCalls: null, toolCallId: call.id, name: call.function.name, model: null, status: 'complete', error: ok ? null : 'tool_error', metrics: null })
          yield { type: 'tool-result', callId: call.id, tool: call.function.name, ok, content: result, durationMs, meta }
          this.event(run.id, 'tool-result', { callId: call.id, tool: call.function.name, ok, durationMs, meta, content: result.slice(0, 4000) })
          yield { type: 'message', message: toolMsg }
        }
        this.saveRun(run)

        if (turn === maxTurns) {
          run.status = 'done'
          run.summary = `Stopped after ${maxTurns} turns.`
        }
      }
      if (run.status === 'running') run.status = ac.signal.aborted ? 'cancelled' : 'done'
    } catch (err) {
      run.status = ac.signal.aborted ? 'cancelled' : 'error'
      run.error = err instanceof Error ? err.message : String(err)
      yield { type: 'error', message: run.error }
    } finally {
      run.finishedAt = Date.now()
      this.saveRun(run)
      this.active.delete(run.id)
      repos.conversations.touch(conv0.id)
      yield { type: 'conversation', conversation: repos.conversations.get(conv0.id) ?? conv0 }
      yield { type: 'run-done', run }
    }
  }
}
