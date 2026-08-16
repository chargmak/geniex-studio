/** Contracts for the optional Python NPU media sidecar (image gen / STT / TTS / embeddings). */

export type SidecarState = 'not-installed' | 'installing' | 'stopped' | 'starting' | 'running' | 'error'

export type SidecarFeature = 'images' | 'stt' | 'tts' | 'embeddings'

export interface SidecarModelInfo {
  id: string
  feature: SidecarFeature
  name: string
  description: string
  sizeBytes: number | null
  installed: boolean
  /** Runtime that executes it: qnn (Hexagon NPU via QAIRT), ort-qnn, cpu */
  runtime: string
  license?: string
}

export interface SidecarStatus {
  state: SidecarState
  url: string
  pid: number | null
  pythonPath: string | null
  pythonVersion: string | null
  venvDir: string
  modelsDir: string
  installedDeps: boolean
  lastError: string | null
  /** From the sidecar's /health once running. */
  features: Record<SidecarFeature, boolean> | null
  version: string | null
  qairt: string | null
  models: SidecarModelInfo[]
  busy: boolean
}

export interface ProvisionEvent {
  type: 'step' | 'log' | 'progress' | 'done' | 'error'
  step?: string
  message?: string
  progress?: number
}

// ---------- images ----------
export interface ImageGenerationRequest {
  prompt: string
  negative_prompt?: string
  model?: string
  width?: number
  height?: number
  steps?: number
  guidance?: number
  seed?: number
  n?: number
  conversationId?: string
}

export interface Generation {
  id: string
  kind: 'image' | 'audio'
  prompt: string | null
  negativePrompt: string | null
  model: string | null
  width: number | null
  height: number | null
  steps: number | null
  seed: number | null
  guidance: number | null
  path: string
  durationMs: number | null
  meta: Record<string, unknown> | null
  conversationId: string | null
  createdAt: number
}

// ---------- audio ----------
export interface TranscriptionResult {
  text: string
  language?: string
  durationMs?: number
  segments?: { start: number; end: number; text: string }[]
}

export interface SpeechRequest {
  input: string
  voice?: string
  model?: string
  speed?: number
}

// ---------- embeddings / knowledge ----------
export interface KnowledgeSource {
  id: string
  name: string
  kind: 'folder' | 'file'
  path: string
  files: number
  chunks: number
  embedModel: string | null
  status: 'idle' | 'indexing' | 'ready' | 'error'
  error: string | null
  createdAt: number
  updatedAt: number
}

export interface KnowledgeHit {
  chunkId: number
  sourceId: string
  sourceName: string
  file: string
  ord: number
  text: string
  score: number
}
