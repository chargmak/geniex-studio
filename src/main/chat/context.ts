/**
 * Context-window accounting for llama.cpp models on the NPU.
 *
 * GenieX v0.6.1 has no safety net there: a prompt longer than `nctx`, or a generation that reaches it, makes
 * llama.cpp attempt a context shift, and the ROPE the shift needs cannot run on the HTP buffer — the server aborts
 * (`ggml-backend.cpp:941 … cannot run the operation (ROPE)`, `fatal: backend aborted`). On the CPU the same
 * overflow silently drops the middle of the prompt instead. Either way the request must never overflow, and only
 * the client can guarantee that. Two tools:
 *
 *  - a per-conversation *token factor* that pads Studio's chars/3.6 estimate. It starts conservative and is
 *    calibrated from the server's own `usage.prompt_tokens` whenever a turn was prefilled from scratch, so code-heavy
 *    or non-English chats (which tokenise denser) stop being underestimated after their first turn;
 *  - `clampMaxTokens`, which shrinks the requested `max_tokens` to what is left of the window.
 */

export const DEFAULT_TOKEN_FACTOR = 1.15
const MAX_TOKEN_FACTOR = 2.5
/** Tokens kept free for the chat template, BOS/EOS and rounding. */
export const CONTEXT_MARGIN = 256
/** Below this the request is pointless; trim history instead. */
export const MIN_MAX_TOKENS = 64

interface Calibration {
  factor: number
  samples: number
}

export class ContextTracker {
  private byConversation = new Map<string, Calibration>()

  /** Multiplier to apply to the raw estimate for this conversation (≥ DEFAULT_TOKEN_FACTOR). */
  factorFor(conversationId: string | null | undefined): number {
    return (conversationId && this.byConversation.get(conversationId)?.factor) || DEFAULT_TOKEN_FACTOR
  }

  /**
   * Feed back the server's count. `reportedPromptTokens` is the number of *newly prefilled* tokens (GenieX reuses
   * the KV cache for continuation turns), so only a report close to the full prompt tells us the real ratio.
   */
  observe(conversationId: string | null | undefined, rawEstimate: number, reportedPromptTokens: number | null | undefined): void {
    if (!conversationId || !rawEstimate || !reportedPromptTokens) return
    if (reportedPromptTokens < rawEstimate * 0.6) return // continuation turn — partial count, nothing to learn
    const ratio = reportedPromptTokens / rawEstimate
    const cur = this.byConversation.get(conversationId)
    // Keep the worst ratio seen (safety first), padded by 5 %, never below the default.
    const factor = Math.min(MAX_TOKEN_FACTOR, Math.max(DEFAULT_TOKEN_FACTOR, ratio * 1.05, cur?.factor ?? 0))
    this.byConversation.set(conversationId, { factor, samples: (cur?.samples ?? 0) + 1 })
  }

  /** After an overflow the estimate was wrong by definition: pad harder for the rest of the conversation. */
  bump(conversationId: string | null | undefined, multiplier = 1.3): void {
    if (!conversationId) return
    const cur = this.byConversation.get(conversationId)
    this.byConversation.set(conversationId, { factor: Math.min(MAX_TOKEN_FACTOR, (cur?.factor ?? DEFAULT_TOKEN_FACTOR) * multiplier), samples: cur?.samples ?? 0 })
  }

  forget(conversationId: string): void {
    this.byConversation.delete(conversationId)
  }
}

/**
 * The largest `max_tokens` that still fits: `contextTokens − promptEstimate − margin`, never more than requested.
 * Returns MIN_MAX_TOKENS at the floor; callers treat a result below `requested` as "the window is tight".
 */
export function clampMaxTokens(contextTokens: number, promptEstimate: number, requested: number, margin = CONTEXT_MARGIN): number {
  const room = Math.floor(contextTokens - promptEstimate - margin)
  return Math.max(MIN_MAX_TOKENS, Math.min(requested, room))
}

/** True for the error codes GenieX uses when a prompt does not fit (QAIRT 400 body, or the SSE frame's SDK code). */
export function isContextOverflowCode(code: unknown): boolean {
  return code === 'context_length_exceeded' || code === 'context_overflow' || code === -200103 || code === '-200103'
}
