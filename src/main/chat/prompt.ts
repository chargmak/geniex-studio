import type { ChatContentPart, ChatMessage } from '@shared/api'
import type { StoredMessage } from '@shared/chat'

/**
 * Rough token estimate (≈ chars/3.6 for English + code, +4 per message for template overhead).
 * Good enough for budgeting against a 4k–32k window; the server still rejects true overflow with a clear code.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 3.6)
}

export function estimateMessageTokens(m: ChatMessage): number {
  let n = 4
  if (typeof m.content === 'string') n += estimateTokens(m.content)
  else if (Array.isArray(m.content)) {
    for (const p of m.content) {
      if (p.type === 'text') n += estimateTokens(p.text)
      else n += 512 // an image is worth many tokens to the encoder; keep budgeting conservative
    }
  }
  if (m.tool_calls?.length) n += estimateTokens(JSON.stringify(m.tool_calls))
  return n
}

export interface AssembleOptions {
  systemPrompt: string | null
  /** Context window the model actually runs with (QAIRT ≈ 4096, GGUF = nctx). */
  contextTokens: number
  /** Output reserve (max_tokens). */
  maxTokens: number
  /** Whether the target model accepts image parts (VLM). LLM-typed models 400 on image parts. */
  vision: boolean
  /** Extra sections to add to the system prompt (agent tools, memory, …). Dropped in order when over budget. */
  extraSections?: { label: string; text: string; droppable: boolean }[]
}

export interface AssembledPrompt {
  messages: ChatMessage[]
  estimatedTokens: number
  droppedHistory: number
  droppedSections: string[]
  imagesStripped: number
}

function toChatMessage(m: StoredMessage, vision: boolean, isLast: boolean): { msg: ChatMessage; imagesStripped: number } {
  let imagesStripped = 0
  const parts: ChatContentPart[] = []
  const text = typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n')
  const attachmentImages = m.attachments.filter((a) => a.kind === 'image')
  const attachmentAudio = m.attachments.filter((a) => a.kind === 'audio')
  const inlineParts = Array.isArray(m.content) ? m.content.filter((p) => p.type !== 'text') : []

  // GenieX only encodes media found on the LAST message; earlier images would be dead weight (and can 400 on LLMs).
  const includeMedia = vision && isLast
  if (includeMedia) {
    for (const a of attachmentImages) parts.push({ type: 'image_url', image_url: { url: a.path } })
    for (const a of attachmentAudio) parts.push({ type: 'input_audio', input_audio: { data: a.path } })
    for (const p of inlineParts) parts.push(p)
  } else {
    imagesStripped += attachmentImages.length + attachmentAudio.length + inlineParts.length
  }

  const textWithFileNotes =
    !includeMedia && attachmentImages.length + attachmentAudio.length > 0
      ? `${text}${text ? '\n' : ''}[${attachmentImages.length + attachmentAudio.length} attachment(s) omitted here — only the latest message's media is sent to the model]`
      : text

  const msg: ChatMessage =
    parts.length > 0
      ? { role: m.role, content: [{ type: 'text', text: textWithFileNotes }, ...parts] }
      : { role: m.role, content: textWithFileNotes }
  if (m.role === 'assistant' && m.toolCalls?.length) msg.tool_calls = m.toolCalls
  if (m.role === 'tool' && m.toolCallId) msg.tool_call_id = m.toolCallId
  if (m.name) msg.name = m.name
  return { msg, imagesStripped }
}

/**
 * Builds the wire messages for a turn from persisted history, trimming oldest history first, then droppable
 * sections, so the request always fits `contextTokens - maxTokens - margin`. Never drops the system core or the
 * newest user message.
 */
export function assemblePrompt(history: StoredMessage[], opts: AssembleOptions): AssembledPrompt {
  const margin = 256
  const budget = Math.max(512, opts.contextTokens - opts.maxTokens - margin)

  const sections = [...(opts.extraSections ?? [])]
  const buildSystem = (): string | null => {
    const parts = [opts.systemPrompt?.trim() || null, ...sections.map((s) => s.text.trim())].filter(Boolean) as string[]
    return parts.length ? parts.join('\n\n') : null
  }

  const usable = history.filter((m) => m.status !== 'error' && (m.role !== 'assistant' || m.status !== 'streaming'))
  const converted = usable.map((m, i) => toChatMessage(m, opts.vision, i === usable.length - 1))
  let imagesStripped = converted.reduce((n, c) => n + c.imagesStripped, 0)
  let msgs = converted.map((c) => c.msg)

  const droppedSections: string[] = []
  let droppedHistory = 0

  const total = (): number => {
    const sys = buildSystem()
    return (sys ? estimateTokens(sys) + 4 : 0) + msgs.reduce((n, m) => n + estimateMessageTokens(m), 0)
  }

  // 1) Trim oldest history (keep at least the last user message).
  while (total() > budget && msgs.length > 1) {
    msgs = msgs.slice(1)
    droppedHistory++
    // never start with a dangling tool result
    while (msgs.length > 1 && msgs[0].role === 'tool') {
      msgs = msgs.slice(1)
      droppedHistory++
    }
  }
  // 2) Drop droppable sections, last first.
  while (total() > budget && sections.some((s) => s.droppable)) {
    const idx = [...sections].reverse().findIndex((s) => s.droppable)
    const real = sections.length - 1 - idx
    droppedSections.push(sections[real].label)
    sections.splice(real, 1)
  }

  const sys = buildSystem()
  const messages: ChatMessage[] = sys ? [{ role: 'system', content: sys }, ...msgs] : msgs
  return { messages, estimatedTokens: total(), droppedHistory, droppedSections, imagesStripped }
}
