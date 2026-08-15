/**
 * Shared constants for main + renderer. Keep this file free of Node/DOM imports.
 */

/** Port of the in-process Studio API server (Hono). Overridable with GENIEX_STUDIO_PORT. */
export const DEFAULT_STUDIO_PORT = 18190

/** Default bind address of `geniex serve` (GenieX CLI v0.4.0). */
export const DEFAULT_GENIEX_HOST = '127.0.0.1:18181'

/** GenieX server keepalive (seconds a loaded model stays resident after the last request). */
export const DEFAULT_GENIEX_KEEPALIVE_SECONDS = 600

/** Context window default for llama.cpp-backed (GGUF) models. QAIRT bundles have their context baked in (~4096). */
export const DEFAULT_NCTX = 4096

export const APP_NAME = 'GenieX Studio'
export const APP_ID = 'dev.stama.geniex-studio'

export type ComputeUnit = 'npu' | 'gpu' | 'cpu' | 'hybrid'
export const COMPUTE_UNITS: readonly ComputeUnit[] = ['npu', 'hybrid', 'gpu', 'cpu'] as const

export type ModelType = 'llm' | 'vlm'
export type ModelHub = 'aihub' | 'hf' | 'docker' | 'localfs'
export type Runtime = 'qairt' | 'llama_cpp'
