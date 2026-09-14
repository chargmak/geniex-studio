/**
 * HTTP API contracts between renderer and the Studio server. Keep in sync with src/main/server/routes/*.
 * Pure types + zod-free (renderer bundle stays light); validation lives on the server side.
 */
import type { ComputeUnit, ModelHub, ModelType, Runtime } from './config'

// ---------- /api/health ----------
export interface HealthResponse {
  ok: boolean
  name: string
  version: string
  mode: 'electron' | 'headless'
  uptimeMs: number
  platform: string
  arch: string
  node: string
  electron: string | null
}

// ---------- /api/genie/status ----------
export type GenieServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

export interface GenieServerStatus {
  state: GenieServerState
  /** True when Studio spawned the process; false when attached to an already-running external `geniex serve`. */
  managed: boolean
  url: string
  pid: number | null
  cliPath: string | null
  cliFound: boolean
  cliVersion: string | null
  /** Whether the CLI meets MIN_GENIEX_VERSION; null while unknown. Studio refuses to chat below it. */
  cliVersionOk: boolean | null
  requiredCliVersion: string
  qairtVersion: string | null
  llamaCppHash: string | null
  chipset: string | null
  startedAt: number | null
  lastError: string | null
  /** Model currently believed to be resident (last successfully used); GenieX exposes no API for this. */
  residentModel: string | null
  residentSince: number | null
  /** True while a /v1 request is in flight (GenieX serialises all requests behind one mutex). */
  busy: boolean
  queueDepth: number
  settings: GenieServeSettings
  /** Last unexpected process exit. `kind` says whether a model load did it or a context overflow on the NPU. */
  lastCrash: { at: number; code: string; model: string | null; kind: CrashKind } | null
  /** Models whose load has crashed the server on this machine (this CLI version) → UI warns, auto-pick avoids them. */
  crashedModels: Record<string, { count: number; lastAt: number; code: string; cliVersion?: string | null }>
  /**
   * A QAIRT bundle has been loaded in this `serve` process. llama.cpp cannot open its Hexagon session after that
   * (GenieX v0.6.1: `HTP0 failed to open session : error 0x80000406`), so the next GGUF request restarts the server.
   */
  qairtLoadedSinceStart: boolean
}

/**
 * 'model' — the process died while loading/running a model (recorded against it);
 * 'context_overflow' — llama.cpp on the NPU tried a context shift and aborted (a GenieX bug, not the model's fault);
 * 'unknown' — nothing was in flight.
 */
export type CrashKind = 'model' | 'context_overflow' | 'unknown'

export interface GenieServeSettings {
  host: string
  keepaliveSeconds: number
  nctx: number
  ngl: number
  compute: ComputeUnit | null
  origins: string
  logLevel: 'none' | 'error' | 'warn' | 'info' | 'debug' | 'trace'
  autoStart: boolean
}

// ---------- /api/models ----------
export interface CachedModel {
  /** Full identifier as `geniex list` reports it, e.g. `qualcomm/Qwen3-4B` or `unsloth/Qwen3-4B-GGUF`. */
  name: string
  displayName: string
  runtime: Runtime | string
  type: ModelType | string
  sizeBytes: number | null
  precisions: string[]
  hub: ModelHub | 'unknown'
  /** Precision-qualified ids usable in `model` of chat requests (`name` for QAIRT, `name:PREC` for GGUF). */
  requestIds: string[]
  npuEligible: boolean
}

export interface CatalogueModel {
  name: string
  type: ModelType | string
  chipsets: string[]
  installed: boolean
  vendor: 'qualcomm'
}

export interface PullRequestBody {
  name: string
  precision?: string
  hub?: ModelHub
  modelType?: ModelType
  localPath?: string
}

export type PullJobState = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface PullJob {
  id: string
  name: string
  precision: string | null
  hub: ModelHub | null
  modelType: ModelType | null
  state: PullJobState
  progress: number | null // 0..1 or null when indeterminate
  downloadedBytes: number | null
  totalBytes: number | null
  speedBytesPerSec: number | null
  etaSeconds: number | null
  message: string
  log: string[]
  startedAt: number
  finishedAt: number | null
  error: string | null
}

// ---------- /api/genie/chat (SSE) ----------
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'input_audio'; input_audio: { data: string } }

export interface ChatToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  role: ChatRole
  content: string | ChatContentPart[] | null
  name?: string
  tool_call_id?: string
  tool_calls?: ChatToolCall[]
  /** Studio-side only: reasoning captured for assistant messages (never sent back to the model). */
  reasoning?: string
}

export interface ChatToolDefinition {
  type: 'function'
  function: { name: string; description?: string; parameters?: Record<string, unknown> }
}

export interface SamplerSettings {
  temperature?: number
  top_p?: number
  top_k?: number
  min_p?: number
  repetition_penalty?: number
  presence_penalty?: number
  frequency_penalty?: number
  seed?: number
  max_tokens?: number
}

export interface GenieRequestOptions {
  compute?: ComputeUnit
  nctx?: number
  ngl?: number
  enable_think?: boolean
  spec_type?: string
  spec_draft_model?: string
  spec_n_max?: number
  spec_n_min?: number
  spec_p_min?: number
}

export interface ChatRequestBody {
  model: string
  messages: ChatMessage[]
  tools?: ChatToolDefinition[]
  sampler?: SamplerSettings
  options?: GenieRequestOptions
  /** Studio conversation id for bookkeeping/telemetry (optional). */
  conversationId?: string
  /** Runtime family of `model` when the caller knows it (drives the QAIRT → GGUF server restart). */
  runtime?: Runtime | null
}

/** Server-sent events emitted by /api/genie/chat. */
export type ChatStreamEvent =
  | { type: 'start'; model: string; requestId: string; at: number }
  | { type: 'model-loading'; model: string }
  | { type: 'model-ready'; model: string; loadMs: number }
  /** `geniex serve` is being restarted before this request (QAIRT → GGUF switch). */
  | { type: 'runtime-restart'; reason: string }
  | { type: 'delta'; content?: string; reasoning?: string }
  | { type: 'tool_calls'; tool_calls: ChatToolCall[] }
  | { type: 'usage'; prompt_tokens: number; completion_tokens: number; total_tokens: number; accepted?: number; rejected?: number }
  | {
      type: 'done'
      finish_reason: 'stop' | 'length' | 'tool_calls' | 'error' | 'cancelled' | string
      ttftMs: number | null
      totalMs: number
      completionTokens: number | null
      tokensPerSecond: number | null
    }
  | { type: 'error'; message: string; code?: number | string; status?: number }

// ---------- /api/genie/completions (raw / FIM) ----------
export interface CompletionRequestBody {
  model: string
  prompt: string
  sampler?: SamplerSettings
  stop?: string[]
  options?: GenieRequestOptions
}

// ---------- /api/system/bench (geniex-bench) ----------
export interface BenchStatus {
  installed: boolean
  version: string | null
  path: string | null
  downloadUrl: string
  running: { model: string; startedAt: number } | null
  installing: boolean
}

export interface BenchRunRequest {
  /** Model-manager id (`org/repo[:quant]`), i.e. a Studio request id. */
  model: string
  device?: ComputeUnit
  promptTokens?: number
  genTokens?: number
  repetitions?: number
  /** llama.cpp speculative type (e.g. ngram-cache); ignored for QAIRT. */
  specType?: string | null
}

export interface BenchStat {
  median: number | null
  min: number | null
  max: number | null
  mean: number | null
  stdev: number | null
}

export interface BenchResult {
  model: string
  runtime: Runtime
  device: string
  specType: string | null
  promptTokens: number
  genTokens: number
  repetitions: number
  ttftMs: BenchStat
  prefillTps: BenchStat
  decodeTps: BenchStat
  benchVersion: string | null
  llamaCppVersion: string | null
  qairtVersion: string | null
  summaryLine: string | null
  wallMs: number
  at: number
}

// ---------- Generic ----------
export interface ApiError {
  error: string
  code?: string | number
  details?: unknown
}
